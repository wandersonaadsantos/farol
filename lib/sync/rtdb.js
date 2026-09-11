// Cliente REST do Firebase Realtime Database, em Node puro (fetch nativo). Único
// ponto do app que fala com o banco da sincronização entre dispositivos.
//
// Contratos de fora que moldam este arquivo:
//  - o ID token do usuário vai em `?auth=` na query (é a única forma documentada
//    para token de usuário no REST do RTDB), então NENHUMA URL daqui pode ir para
//    log, erro ou tela crua: quem precisar mostrar usa redactUrl, e as mensagens de
//    erro saem da tabela de errors.js, nunca do texto do fetch;
//  - CAS por ETag só em PUT e DELETE (`if-match`); PATCH com `if-match` o servidor
//    responde 400, por isso patch() nem aceita a opção;
//  - `?ns=<projeto>` só existe no emulador (http local); no host de produção ele é
//    redundante e fica de fora.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para quem chama decidir.
// fetch entra por injeção para o teste não tocar a rede.
import { SYNC } from '../constants.js';
import io from '../io.js';
import { SYNC_CODES, SyncError, codeFromStatus, motivoDe } from './errors.js';
import { assertRtdbKey } from './keys.js';
import { createSseParser } from './sse.js';

// cabeçalhos fora da chamada: objeto literal aninhado conta como nível de chave no gate
const CABECALHO_ETAG = { 'X-Firebase-ETag': 'true' };
const CABECALHO_JSON = { 'Content-Type': 'application/json' };
const CABECALHO_SSE = { Accept: 'text/event-stream' };
const DECODE_PARCIAL = { stream: true };
// eventos do stream cujo `data` é JSON do banco; os outros seguem como texto
const EVENTOS_JSON = new Set(['put', 'patch', 'cancel']);
// put/patch com data ilegível é descartado em vez de virar null: null nesses dois é
// o banco dizendo que o nó foi APAGADO, e o consumidor não tem como distinguir
const EVENTOS_DE_ESCRITA = new Set(['put', 'patch']);
// marca de corpo que não é JSON (null é valor legítimo do banco, não serve de marca)
const SEM_CORPO = Symbol('sem-corpo');
const MAX_MOTIVO = 200;
// leitura que PEDE etag e volta sem ele: ver a recusa em get()
const MOTIVO_SEM_ETAG = 'o Firebase não devolveu o ETag pedido';

function redactUrl(url) {
  return String(url || '').replace(/([?&]auth=)[^&#]*/g, '$1***');
}

function falha(code, status, motivo) {
  return { ok: false, code, status, motivo: motivo || motivoDe(code) };
}

// AbortError é o nosso alarme de tempo; qualquer outra rejeição do fetch é rede
function codigoDeRede(err) {
  return err && err.name === 'AbortError' ? SYNC_CODES.TIMEOUT : SYNC_CODES.INDISPONIVEL;
}

// O RTDB responde erro como { "error": "Permission denied" }; o texto do servidor é
// útil para quem opera e não carrega a URL. Qualquer outra forma cai na tabela.
function motivoDoCorpo(corpo, code) {
  if (corpo && typeof corpo === 'object' && typeof corpo.error === 'string') return corpo.error.slice(0, MAX_MOTIVO);
  return motivoDe(code);
}

function erroHttp(r) {
  const code = codeFromStatus(r.status);
  return falha(code, r.status, motivoDoCorpo(r.corpo, code));
}

function conflito(r) {
  return { ok: false, code: SYNC_CODES.CONFLITO, status: 412, data: r.corpo === SEM_CORPO ? null : r.corpo, etag: r.etag };
}

function semToken(tok) {
  return falha((tok && tok.code) || SYNC_CODES.SEM_CREDENCIAL, 0, tok && tok.motivo);
}

function parametros(ctx, query) {
  const q = query || {};
  const lista = [];
  if (q.auth) lista.push(`auth=${encodeURIComponent(q.auth)}`);
  if (ctx.emulador && ctx.projectId) lista.push(`ns=${encodeURIComponent(ctx.projectId)}`);
  for (const [k, v] of Object.entries(q)) {
    if (k === 'auth' || k === 'ns' || v === undefined || v === null || v === false) continue;
    lista.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return lista.length ? `?${lista.join('&')}` : '';
}

// Cada segmento passa pela allowlist de chave do banco: caminho montado com texto
// de fora (id de aparelho corrompido, chave de PR) nunca vira outro caminho.
function montarUrl(ctx, path, query) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new SyncError(SYNC_CODES.FALHA_INTERNA, 'caminho do banco precisa começar com /');
  const segmentos = path.slice(1).split('/').map((s) => encodeURIComponent(assertRtdbKey(s)));
  return `${ctx.base}/${segmentos.join('/')}.json${parametros(ctx, query)}`;
}

// token + URL, ou a falha pronta; nada disto toca a rede
async function prepararUrl(ctx, path, query) {
  const tok = await ctx.getIdToken();
  if (!tok || !tok.ok) return { erro: semToken(tok) };
  try {
    return { url: montarUrl(ctx, path, { ...query, auth: tok.idToken }) };
  } catch (err) {
    return { erro: falha(SYNC_CODES.FALHA_INTERNA, 0, err && err.message) };
  }
}

// O alarme cobre o corpo também: servidor que manda o cabeçalho e trava no corpo
// seguraria o heartbeat do lease para sempre se o timeout parasse no primeiro byte.
async function requisitar(ctx, method, path, opcoes) {
  const alvo = await prepararUrl(ctx, path, opcoes.query);
  if (alvo.erro) return alvo;
  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetchImpl(alvo.url, { method, headers: opcoes.headers, body: opcoes.body, signal: controle.signal });
    const texto = await res.text();
    return { status: res.status, ok: res.ok, etag: res.headers.get('etag') || '', corpo: io.parseJson(texto, SEM_CORPO) };
  } catch (err) {
    return { erro: falha(codigoDeRede(err), 0) };
  } finally {
    clearTimeout(alarme);
  }
}

// corpo serializado ou '' quando o valor não serializa: o safeStringify devolveria
// 'null' por padrão, e PUT de null APAGA o nó no banco
function serializar(value) {
  const texto = io.safeStringify(value, '');
  return typeof texto === 'string' ? texto : '';
}

async function get(ctx, path, { etag = false, shallow = false } = {}) {
  const query = shallow ? { shallow: 'true' } : {};
  const r = await requisitar(ctx, 'GET', path, { query, headers: etag ? CABECALHO_ETAG : {} });
  if (r.erro) return r.erro;
  if (!r.ok) return erroHttp(r);
  if (r.corpo === SEM_CORPO) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status);
  // Quem pede etag é o CAS (lease, recibo, rodada): devolver etag vazio faria a escrita
  // seguinte sair SEM if-match, ou seja, incondicional, por cima do que outro aparelho
  // acabou de gravar. Proxy que engole cabeçalho é o caso real; a saída segura é recusar
  // a leitura e deixar quem chama tratar como banco indisponível.
  if (etag && !r.etag) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status, MOTIVO_SEM_ETAG);
  return { ok: true, status: r.status, data: r.corpo, etag: etag ? r.etag : '' };
}

async function put(ctx, path, value, { ifMatch = '', etag = false } = {}) {
  const body = serializar(value);
  if (!body) return falha(SYNC_CODES.FALHA_INTERNA, 0, 'valor não serializável para o banco');
  const headers = { ...CABECALHO_JSON };
  if (etag) headers['X-Firebase-ETag'] = 'true';
  if (ifMatch) headers['if-match'] = ifMatch;
  const r = await requisitar(ctx, 'PUT', path, { headers, body });
  if (r.erro) return r.erro;
  if (r.status === 412) return conflito(r);
  if (!r.ok) return erroHttp(r);
  if (r.corpo === SEM_CORPO) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status);
  return { ok: true, status: r.status, data: r.corpo, etag: etag ? r.etag : '' };
}

async function patch(ctx, path, value) {
  const body = serializar(value);
  if (!body) return falha(SYNC_CODES.FALHA_INTERNA, 0, 'valor não serializável para o banco');
  const r = await requisitar(ctx, 'PATCH', path, { headers: CABECALHO_JSON, body });
  if (r.erro) return r.erro;
  if (!r.ok) return erroHttp(r);
  if (r.corpo === SEM_CORPO) return falha(SYNC_CODES.RESPOSTA_INVALIDA, r.status);
  return { ok: true, status: r.status, data: r.corpo };
}

async function del(ctx, path, { ifMatch = '' } = {}) {
  const headers = ifMatch ? { 'if-match': ifMatch } : {};
  const r = await requisitar(ctx, 'DELETE', path, { headers });
  if (r.erro) return r.erro;
  if (r.status === 412) return conflito(r);
  if (!r.ok) return erroHttp(r);
  return { ok: true, status: r.status };
}

function falhaStream(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

// keep-alive é do protocolo e morre aqui; auth_revoked chega a quem chama, que
// renova o token e reabre. Consumidor com defeito não pode derrubar a leitura.
function despachante(onEvent) {
  const entregar = typeof onEvent === 'function' ? onEvent : () => {};
  return (ev) => {
    if (ev.event === 'keep-alive') return;
    const lido = EVENTOS_JSON.has(ev.event) ? io.parseJson(ev.data, SEM_CORPO) : ev.data;
    if (lido === SEM_CORPO && EVENTOS_DE_ESCRITA.has(ev.event)) return;
    const data = lido === SEM_CORPO ? null : lido;
    try { entregar({ event: ev.event, data }); } catch { /* defeito do consumidor não fecha o stream */ }
  };
}

// Todo pedaço que chega (keep-alive incluso) avisa quem chama: é o sinal de vida que a
// vigia de inatividade do stream precisa, e o keep-alive nunca chega ao onEvent.
function tocar(onActivity) {
  if (typeof onActivity !== 'function') return;
  try { onActivity(); } catch { /* defeito do consumidor não fecha o stream */ }
}

async function consumir(res, { onEvent, signal, onActivity }) {
  const parser = createSseParser(despachante(onEvent));
  const leitor = res.body.getReader();
  const decoder = new TextDecoder();
  // O abort pode vir de DENTRO do onEvent (auth_revoked e cancel abortam ali mesmo, em
  // lib/engine/sync-stream.js). Nesse caso o read() seguinte não se resolve no Node 22.12,
  // que é o piso declarado no package.json e o que o CI roda: a promessa do stream fica
  // pendurada, depoisDaConexao nunca corre, o token não é invalidado e a reconexão só
  // aconteceria quando a vigia de inatividade estourasse, 90 s depois. No Node 24 o mesmo
  // read() se resolve e o defeito não aparece, que foi por que a suíte passava aqui e
  // reprovava nos três sistemas do CI. Correr a leitura contra o sinal fecha o laço na
  // hora, sem depender de o read() settlar.
  const abortado = signal ? new Promise((resolve) => {
    if (signal.aborted) { resolve(true); return; }
    signal.addEventListener('abort', () => resolve(true), { once: true });
  }) : null;
  try {
    for (;;) {
      const lido = abortado ? await Promise.race([leitor.read(), abortado]) : await leitor.read();
      if (lido === true) break;
      if (lido.done) break;
      tocar(onActivity);
      parser.feed(decoder.decode(lido.value, DECODE_PARCIAL));
    }
    // sem parser.end() de propósito: o que sobrou no buffer quando a conexão fecha é
    // evento sem a linha vazia final, ou seja, cortado no meio, e a especificação SSE
    // (WHATWG) manda descartar. Despachar entregaria um put truncado; o caminho de erro
    // (catch) também não despacha, então fim limpo e fim sujo têm o mesmo desfecho.
    parser.feed(decoder.decode());
    return { ok: true };
  } catch (err) {
    if (signal && signal.aborted) return { ok: true };
    return falhaStream(codigoDeRede(err));
  } finally {
    // sair pelo sinal deixa o corpo sem consumidor; sem o cancel o socket fica preso
    try { await leitor.cancel(); } catch { /* corpo ja encerrado */ }
  }
}

// Conexão longa: o alarme de tempo vale só até o cabeçalho chegar. Fechar por
// pedido de quem chama (signal) é fim normal, não falha.
async function conectar(ctx, url, signal) {
  const controle = new AbortController();
  const soltar = () => controle.abort();
  if (signal) signal.addEventListener('abort', soltar, { once: true });
  const alarme = setTimeout(soltar, ctx.timeoutMs);
  try {
    return { res: await ctx.fetchImpl(url, { headers: CABECALHO_SSE, signal: controle.signal }), soltar };
  } catch (err) {
    return { erro: signal && signal.aborted ? { ok: true } : falhaStream(codigoDeRede(err)), soltar };
  } finally {
    clearTimeout(alarme);
  }
}

async function stream(ctx, path, opcoes = {}) {
  const { signal } = opcoes;
  if (signal && signal.aborted) return { ok: true };
  const alvo = await prepararUrl(ctx, path, {});
  if (alvo.erro) return falhaStream(alvo.erro.code, alvo.erro.motivo);
  const con = await conectar(ctx, alvo.url, signal);
  try {
    if (con.erro) return con.erro;
    if (!con.res.ok) {
      const corpo = io.parseJson(await con.res.text().catch(() => ''), SEM_CORPO);
      const code = codeFromStatus(con.res.status);
      return falhaStream(code, motivoDoCorpo(corpo, code));
    }
    return await consumir(con.res, opcoes);
  } finally {
    if (signal) signal.removeEventListener('abort', con.soltar);
  }
}

function createRtdbClient({ databaseUrl, projectId = '', getIdToken, fetchImpl = fetch, timeoutMs = SYNC.REQUEST_TIMEOUT_MS }) {
  const base = String(databaseUrl || '').replace(/\/+$/, '');
  const ctx = { base, emulador: base.startsWith('http://'), projectId: String(projectId || ''), getIdToken, fetchImpl, timeoutMs };
  return {
    get: (path, opcoes) => get(ctx, path, opcoes),
    put: (path, value, opcoes) => put(ctx, path, value, opcoes),
    patch: (path, value) => patch(ctx, path, value),
    del: (path, opcoes) => del(ctx, path, opcoes),
    stream: (path, opcoes) => stream(ctx, path, opcoes),
    urlFor: (path, query = {}) => montarUrl(ctx, path, query),
  };
}

export default { createRtdbClient, redactUrl };
export { createRtdbClient, redactUrl };
