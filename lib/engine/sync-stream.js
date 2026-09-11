// Tempo real da coordenação entre aparelhos: o stream SSE de /users/{uid}/leases, a
// árvore remota que ele mantém em memória e a visão que a tela mostra (quem, em outro
// aparelho, está analisando um PR que este Farol acompanha). Separado de
// lib/engine/sync.js para aquele caber no teto de linhas, e porque tem ciclo de vida
// próprio: abre e fecha junto com a coordenação, reconecta sozinho e nunca decide nada.
// Quem decide a admissão continua sendo o lease lido na hora (lib/sync/coordinator.js);
// esta visão só evita que a tela precise perguntar ao banco.
//
// O stream é REST+SSE de propósito (§5 do spec): é o que dá tempo real sem SDK. O banco
// manda `put` (substitui o nó do caminho) e `patch` (mescla chave a chave), com `data`
// null querendo dizer nó apagado, e um keep-alive a cada ~30 s.
//
// O nome do PR nunca sobe (D6): a árvore só tem hashes, e a tradução para a chave
// legível usa os PRs que ESTE aparelho já conhece. PR que ele não acompanha fica fora da
// visão e só conta em leasesOutros.
import { SYNC } from '../constants.js';
import io from '../io.js';
import { coordinationActive } from '../sync/config.js';
import { SYNC_CODES } from '../sync/errors.js';
import { accountHash, prHash } from '../sync/keys.js';

const CONECTADO = 'conectado';
// o teste troca por um agendador que ele dispara à mão (engine.sync.agendadorStream):
// é assim que a vigia de 90 s e o backoff são testados sem dormir de verdade
const AGENDADOR = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };

// --- derivação pura -------------------------------------------------------------------

function ehObjeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function segmentosDe(caminho) { return String(caminho || '').split('/').filter(Boolean); }

function entradas(no) { return ehObjeto(no) ? Object.entries(no) : []; }

// grava o valor no caminho e devolve uma árvore NOVA; nó que fica vazio some, como no
// banco, então apagar o último lease de uma conta apaga a conta da árvore
function gravarNo(no, segs, valor) {
  if (!segs.length) return valor === undefined ? null : valor;
  const base = ehObjeto(no) ? { ...no } : {};
  const filho = gravarNo(base[segs[0]], segs.slice(1), valor);
  if (filho === null) delete base[segs[0]];
  else base[segs[0]] = filho;
  return Object.keys(base).length ? base : null;
}

// Chave vazia no patch é pulada: gravar nela trocaria o nó inteiro do caminho, que é o
// efeito de um put, não de um patch.
function aplicarPatch(arvore, segs, dados) {
  let nova = arvore;
  for (const [k, v] of Object.entries(dados)) {
    const alvo = segmentosDe(k);
    if (alvo.length) nova = gravarNo(nova, [...segs, ...alvo], v ?? null);
  }
  return nova;
}

function aplicarEvento(arvore, ev) {
  const corpo = ev && ev.data;
  if (!ehObjeto(corpo) || typeof corpo.path !== 'string') return arvore;
  const segs = segmentosDe(corpo.path);
  if (ev.event === 'put') return gravarNo(arvore, segs, corpo.data ?? null);
  if (ev.event !== 'patch' || !ehObjeto(corpo.data)) return arvore;
  return aplicarPatch(arvore, segs, corpo.data);
}

// `${accountHash}/${prHash}` -> chave legível, para cada PR que este aparelho acompanha.
// A conta é a dona do PR (a mesma que o coordenador usa para montar o caminho do lease).
function mapaDePrs(prs, contaDe) {
  const mapa = new Map();
  for (const p of prs) {
    if (!p || typeof p.key !== 'string') continue;
    const ph = prHash(p.key);
    const ch = ph ? `${accountHash(contaDe(p))}/${ph}` : '';
    if (ch && !mapa.has(ch)) mapa.set(ch, p.key);
  }
  return mapa;
}

// Só lease VIVO de OUTRO aparelho: o meu a tela já mostra em "Analisando agora", e o
// vencido não segura ninguém (o próximo admit o toma). Sem expiresAt numérico não é
// "vivo provado", e a visão não afirma o que não sabe.
function leaseVisivel(lease, euDeviceId, nowMs) {
  if (!ehObjeto(lease) || lease.deviceId === euDeviceId) return false;
  return typeof lease.expiresAt === 'number' && lease.expiresAt > nowMs;
}

function visaoDoLease(lease, devices) {
  const d = ehObjeto(devices) ? devices[lease.deviceId] : null;
  return {
    deviceId: String(lease.deviceId || ''), deviceName: (d && d.name) || '',
    since: Number(lease.acquiredAt) || 0, operationKind: String(lease.operationKind || ''),
  };
}

function leasesVistosDe(arvore, { euDeviceId, nowMs, conhecidos, devices }) {
  const vistos = {};
  let outros = 0;
  for (const [acct, prs] of entradas(arvore)) {
    for (const [ph, lease] of entradas(prs)) {
      if (!leaseVisivel(lease, euDeviceId, nowMs)) continue;
      const key = conhecidos.get(`${acct}/${ph}`);
      if (key) vistos[key] = visaoDoLease(lease, devices);
      else outros++;
    }
  }
  return { vistos, outros };
}

// --- ciclo de vida --------------------------------------------------------------------

function coordenacaoAtiva(engine) { return coordinationActive((engine.config && engine.config.sync) || {}); }

function avisarTela(engine) {
  if (typeof engine.pushState === 'function') engine.pushState();
}

function agendadorDe(rt) { return rt.agendadorStream || AGENDADOR; }

// timer do stream nunca segura o processo vivo: fechar o app não espera reconexão
function agendar(rt, fn, ms) {
  const t = agendadorDe(rt).setTimeout(fn, ms);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}

function desagendar(rt, t) {
  if (t) agendadorDe(rt).clearTimeout(t);
}

function prsConhecidos(engine) {
  const lista = [...(engine.panorama || []), ...(engine.queue || []), ...(engine.myPRs || [])];
  return mapaDePrs(lista, (p) => engine.accountForPr(p));
}

// Recalcula a visão a partir da árvore e avisa a tela SÓ quando ela muda: roda a cada
// evento e a cada tick, porque o lease também vence sem evento nenhum (o dono caiu) e
// porque a lista de PRs conhecidos muda a cada ciclo de polling.
function atualizarVistos(engine) {
  const rt = engine.sync;
  const st = rt.stream;
  if (!st) return false;
  const opcoes = { euDeviceId: rt.deviceId, nowMs: rt.agora(), conhecidos: prsConhecidos(engine), devices: rt.devices };
  const { vistos, outros } = leasesVistosDe(st.arvore, opcoes);
  const assinatura = io.safeStringify([vistos, outros], '');
  if (assinatura === st.assinatura) return false;
  Object.assign(st, { assinatura });
  Object.assign(rt, { leasesVistos: vistos, leasesOutros: outros });
  avisarTela(engine);
  return true;
}

// Zera a visão sem falar com a tela. É o que quem SOLTA A CONEXÃO chama: o lease que
// a visão mostra tem validade de LEASE_TTL_MS e ninguém mais a mantém depois que o
// stream fecha, então deixá-la de pé afirmaria, por tempo indefinido, que outro
// aparelho está analisando um PR que ele já largou. Quem solta a conexão avisa a tela
// junto com o status novo.
function esquecerVisao(rt) {
  if (!rt) return false;
  if (!Object.keys(rt.leasesVistos || {}).length && !rt.leasesOutros) return false;
  Object.assign(rt, { leasesVistos: {}, leasesOutros: 0 });
  return true;
}

function limparVistos(engine) {
  if (!esquecerVisao(engine.sync)) return;
  avisarTela(engine);
}

function novoStream() {
  return {
    fechado: false, arvore: null, assinatura: '', esperaMs: SYNC.STREAM_RECONNECT_MS,
    controle: null, vigia: null, vigias: 0, espera: null, acordar: null, avisouCancel: false,
  };
}

// O stream só vive enquanto a coordenação está ligada e a conexão está de pé. Status
// fora de 'conectado' encerra o laço: quem reconecta é o startSync, que reabre no fim.
function ativo(engine, st) {
  const rt = engine.sync;
  return !st.fechado && rt.stream === st && rt.status === CONECTADO && !!rt.client && coordenacaoAtiva(engine);
}

// A vigia é rearmada a cada pedaço que chega (keep-alive incluso). Sem nada por
// STREAM_IDLE_MS a conexão está morta sem ter avisado (proxy, NAT, sono do aparelho),
// e esperar o TCP perceber pode levar horas.
function armarVigia(rt, st, conexao) {
  desagendar(rt, st.vigia);
  const marca = ++st.vigias;
  st.vigia = agendar(rt, () => {
    if (marca !== st.vigias || st.controle !== conexao.controle) return;
    conexao.fim = 'inativo';
    conexao.controle.abort();
  }, SYNC.STREAM_IDLE_MS);
}

function aoEvento(engine, st, conexao, ev) {
  if (st.fechado || st.controle !== conexao.controle) return;
  if (ev.event === 'put' || ev.event === 'patch') {
    // dado chegando é o stream são: a próxima queda volta a esperar o mínimo
    Object.assign(conexao, { dados: true });
    Object.assign(st, { esperaMs: SYNC.STREAM_RECONNECT_MS, avisouCancel: false, arvore: aplicarEvento(st.arvore, ev) });
    atualizarVistos(engine);
    return;
  }
  if (ev.event !== 'auth_revoked' && ev.event !== 'cancel') return;
  conexao.fim = ev.event;
  conexao.controle.abort();
}

async function umaConexao(engine, st) {
  const rt = engine.sync;
  const conexao = { controle: new AbortController(), fim: '', dados: false };
  st.controle = conexao.controle;
  armarVigia(rt, st, conexao);
  const r = await rt.client.stream(`/users/${rt.uid}/leases`, {
    signal: conexao.controle.signal,
    onActivity: () => armarVigia(rt, st, conexao),
    onEvent: (ev) => aoEvento(engine, st, conexao, ev),
  });
  desagendar(rt, st.vigia);
  st.vigia = null;
  return { conexao, r };
}

// `cancel` é o banco dizendo que a regra deixou de permitir a leitura: é falha, então
// vai para o log, mas uma vez por episódio (o farol.log é de falha, não de estado). A
// frase é a que a classe coordenacao-indisponivel da taxonomia reconhece.
function avisarCancelamento(engine, st) {
  if (st.avisouCancel) return;
  st.avisouCancel = true;
  if (typeof engine.log === 'function') engine.log('WARN', 'coordenação entre dispositivos indisponível: o banco cancelou o stream dos leases (a leitura deixou de ser permitida)');
}

// Devolve true quando a reconexão deve ser imediata: token revogado numa conexão que
// estava saudável (o banco revoga o ID token quando ele vence, e o token novo resolve).
// Revogado antes de qualquer dado quer dizer que o token NOVO também foi recusado, e
// reabrir na hora viraria laço quente; aí vale a espera de sempre.
function depoisDaConexao(engine, st, conexao, r) {
  const rt = engine.sync;
  const recusado = conexao.fim === 'auth_revoked' || (r && r.code === SYNC_CODES.NAO_AUTORIZADO);
  if (recusado && rt.tokenSource) rt.tokenSource.invalidate();
  if (conexao.fim === 'cancel') avisarCancelamento(engine, st);
  return conexao.fim === 'auth_revoked' && conexao.dados;
}

function proximaEspera(st) {
  const ms = st.esperaMs;
  st.esperaMs = Math.min(ms * 2, SYNC.STREAM_RECONNECT_MAX_MS);
  return ms;
}

// fecharStream acorda a espera (acordar), e o laço sai porque `ativo` ficou falso
function esperar(rt, st, ms) {
  return new Promise((resolve) => {
    st.acordar = resolve;
    st.espera = agendar(rt, resolve, ms);
  });
}

async function ciclo(engine, st) {
  while (ativo(engine, st)) {
    const { conexao, r } = await umaConexao(engine, st);
    if (!ativo(engine, st)) break;
    if (!depoisDaConexao(engine, st, conexao, r)) await esperar(engine.sync, st, proximaEspera(st));
  }
  // saiu sem ninguém fechar (status caiu ou a coordenação foi desligada): solta o lugar
  // para o startSync ou o próximo tick reabrirem, e a visão sai junto, porque sem
  // stream ninguém mais a mantém e ela envelheceria calada na tela
  if (engine.sync.stream !== st) return;
  fecharStream(engine.sync);
  limparVistos(engine);
}

function abrirStream(engine) {
  const rt = engine.sync;
  if (rt.stream) return false;
  const st = novoStream();
  rt.stream = st;
  ciclo(engine, st).catch((err) => {
    if (typeof engine.log === 'function') engine.log('WARN', `coordenação entre dispositivos: stream dos leases parou (${err && err.message})`);
    if (rt.stream !== st) return;
    fecharStream(rt);
    // mesmo tratamento do fim normal do ciclo: sem stream ninguém mantém a visão
    limparVistos(engine);
  });
  return true;
}

function fecharStream(rt) {
  const st = rt && rt.stream;
  if (!st) return false;
  st.fechado = true;
  rt.stream = null;
  desagendar(rt, st.vigia);
  desagendar(rt, st.espera);
  if (st.controle) st.controle.abort();
  if (st.acordar) st.acordar();
  return true;
}

// Ponto único de reconciliação, chamado no fim do startSync, pelo aplicarConfig e a cada
// tick conectado: abre quando a coordenação está ligada e a conexão de pé, fecha (e
// limpa a visão) quando não está, e recalcula a visão do stream que já corre.
function sincronizarStream(engine) {
  const rt = engine.sync;
  if (coordenacaoAtiva(engine) && rt.status === CONECTADO && rt.client) {
    abrirStream(engine);
    return atualizarVistos(engine);
  }
  fecharStream(rt);
  limparVistos(engine);
  return false;
}

export default { aplicarEvento, mapaDePrs, leasesVistosDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
export { aplicarEvento, mapaDePrs, leasesVistosDe, sincronizarStream, fecharStream, esquecerVisao, atualizarVistos };
