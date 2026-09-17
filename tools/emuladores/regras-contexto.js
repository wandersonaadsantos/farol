// Contexto do executor do roteiro de regras do banco (firebase/README.md, seções
// "Validação manual das regras v2"), contra os emuladores oficiais do Firebase.
//
// NADA AQUI SOBE NADA: as URLs dos emuladores chegam por argumento ou variável de
// ambiente, e o executor falha dizendo o que falta quando elas não respondem. O
// contêiner é responsabilidade de quem chama (tools/emuladores/Dockerfile).
//
// O ESPAÇO DE NOMES É O PONTO MAIS FÁCIL DE ERRAR. O emulador do banco carrega as
// regras em `<projeto>-default-rtdb`, e serve `<projeto>` como um banco SEM REGRA
// NENHUMA. Testar em `ns=<projeto>` devolve 200 para tudo, inclusive para a escrita
// na árvore de outra pessoa: seria um roteiro inteiro verde sem medir uma regra.
// Por isso `ns` sai de `espacoDeNomes()` e nunca do id do projeto cru.
//
// O TOKEN DE DONO DO EMULADOR (`Authorization: Bearer owner`) IGNORA AS REGRAS. Ele
// só aparece em `preparar` e nas funções marcadas PREPARAÇÃO, para montar estado de
// partida. Todo caso que PROVA permissão usa token de usuário, sempre.
import io from '../../lib/io.js';

const TEMPO_LIMITE_MS = 15000;
const CABECALHO_DONO = 'Bearer owner';
const SUFIXO_EMULADOR = '-default-rtdb';
// o emulador de Auth aceita qualquer chave web; não existe segredo neste ambiente
const CHAVE_WEB = 'chave-do-emulador';
const SENHA = 'senha-de-teste-do-emulador';
const DERIVA_MAXIMA_MS = 30000;

/** O banco em que as regras do commit realmente valem no emulador. */
export function espacoDeNomes(projeto) {
  return `${projeto}${SUFIXO_EMULADOR}`;
}

function montarUrl(ctx, caminho, query) {
  const partes = [`ns=${encodeURIComponent(ctx.ns)}`];
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    partes.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return `${ctx.banco}/${String(caminho).replace(/^\/+/, '')}.json?${partes.join('&')}`;
}

function cabecalhosDe(opcoes) {
  const h = { ...(opcoes.cabecalhos || {}) };
  if (opcoes.dono) h.Authorization = CABECALHO_DONO;
  if (opcoes.corpo !== undefined) h['Content-Type'] = 'application/json';
  return h;
}

function queryDe(opcoes) {
  const q = { ...(opcoes.query || {}) };
  if (!opcoes.dono && opcoes.token) q.auth = opcoes.token;
  return q;
}

async function resposta(res) {
  const texto = await res.text();
  return { status: res.status, corpo: io.parseJson(texto, null), etag: res.headers.get('etag') || '', texto };
}

/** Uma requisição ao banco. Não lança por status: o status É o resultado medido. */
export async function pedir(ctx, metodo, caminho, opcoes = {}) {
  const alvo = montarUrl(ctx, caminho, queryDe(opcoes));
  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  const corpo = opcoes.corpo === undefined ? undefined : io.safeStringify(opcoes.corpo);
  try {
    const res = await fetch(alvo, { method: metodo, headers: cabecalhosDe(opcoes), body: corpo, signal: controle.signal });
    if (opcoes.fluxo) return { status: res.status, corpo: null, etag: '', texto: '' };
    return await resposta(res);
  } finally {
    clearTimeout(alarme);
    if (opcoes.fluxo) controle.abort();
  }
}

// ---------------------------------------------------------------- emulador de Auth

async function identity(ctx, rota, corpo) {
  const alvo = `${ctx.auth}/identitytoolkit.googleapis.com/v1/accounts:${rota}?key=${CHAVE_WEB}`;
  const res = await fetch(alvo, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: io.safeStringify(corpo) });
  return io.parseJson(await res.text(), null);
}

async function renovarPorRefresh(ctx, refreshToken) {
  const alvo = `${ctx.auth}/securetoken.googleapis.com/v1/token?key=${CHAVE_WEB}`;
  const corpo = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  const res = await fetch(alvo, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo });
  return io.parseJson(await res.text(), null);
}

/** auth_time do ID token, em SEGUNDOS (é a unidade que as regras comparam). */
export function authTimeDe(idToken) {
  const carga = String(idToken || '').split('.')[1] || '';
  const json = Buffer.from(carga, 'base64url').toString('utf8');
  const dados = io.parseJson(json, {});
  return Number(dados.auth_time || 0);
}

async function criarUsuario(ctx, email) {
  const r = await identity(ctx, 'signUp', { email, password: SENHA, returnSecureToken: true });
  if (!r || !r.idToken) throw new Error(`o emulador de Auth não criou ${email}: ${io.safeStringify(r)}`);
  return { email, uid: r.localId, idToken: r.idToken, refreshToken: r.refreshToken, authTime: authTimeDe(r.idToken) };
}

/** Novo login por senha: renova o auth_time, que é o que as regras @REC@ exigem. */
export async function renovarSenha(ctx, usuario) {
  const r = await identity(ctx, 'signInWithPassword', { email: usuario.email, password: SENHA, returnSecureToken: true });
  if (!r || !r.idToken) throw new Error(`o emulador de Auth recusou o login de ${usuario.email}`);
  usuario.idToken = r.idToken;
  usuario.refreshToken = r.refreshToken;
  usuario.authTime = authTimeDe(r.idToken);
  return usuario;
}

/** Renova o ACESSO sem refazer o login: o auth_time continua o do login antigo. */
export async function renovarSemSenha(ctx, usuario) {
  const r = await renovarPorRefresh(ctx, usuario.refreshToken);
  const novo = r && (r.id_token || r.idToken);
  if (!novo) throw new Error('o emulador de Auth não renovou o token pelo refresh');
  return { ...usuario, idToken: novo, authTime: authTimeDe(novo) };
}

// ---------------------------------------------------------------- PREPARAÇÃO

/**
 * PREPARAÇÃO (token de dono do emulador, IGNORA as regras). Só monta estado de
 * partida; nenhum caso de permissão pode se apoiar no resultado daqui.
 */
export async function preparar(ctx, metodo, caminho, corpo) {
  return pedir(ctx, metodo, caminho, { dono: true, corpo });
}

// ---------------------------------------------------------------- disponibilidade

async function respondeu(fn) {
  try { return await fn(); } catch (err) { return { erro: err && err.message }; }
}

/** Relógio do servidor do emulador contra o desta máquina (`now` das regras é o de lá). */
export async function derivaDoRelogio(ctx) {
  const caminho = `${ctx.raizSonda}/relogio`;
  const antes = Date.now();
  await preparar(ctx, 'PUT', caminho, { '.sv': 'timestamp' });
  const r = await pedir(ctx, 'GET', caminho, { dono: true });
  const depois = Date.now();
  const servidor = Number(r.corpo || 0);
  if (!servidor) return { ok: false, motivo: 'o emulador não devolveu o carimbo de tempo do servidor' };
  const meio = Math.round((antes + depois) / 2);
  const deriva = servidor - meio;
  if (Math.abs(deriva) > DERIVA_MAXIMA_MS) return { ok: false, motivo: `o relógio do emulador está ${deriva} ms fora do desta máquina`, deriva };
  return { ok: true, deriva };
}

/** Falha dizendo o que falta, em vez de despencar em erro de rede no primeiro caso. */
export async function conferirDisponibilidade(ctx) {
  const faltas = [];
  const banco = await respondeu(() => pedir(ctx, 'GET', ctx.raizSonda, { dono: true }));
  if (banco.erro || !banco.status) faltas.push(`o emulador do banco não respondeu em ${ctx.banco} (${banco.erro || 'sem status'})`);
  const auth = await respondeu(() => identity(ctx, 'signUp', { returnSecureToken: true }));
  if (!auth || auth.erro) faltas.push(`o emulador de Auth não respondeu em ${ctx.auth} (${(auth && auth.erro) || 'sem corpo'})`);
  return faltas;
}

// ---------------------------------------------------------------- regras carregadas

function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (!valor || typeof valor !== 'object') return valor;
  const saida = {};
  for (const chave of Object.keys(valor).sort()) saida[chave] = canonico(valor[chave]);
  return saida;
}

/**
 * As regras carregadas no emulador são as do commit? Sem esta conferência, todo o
 * resto mede uma versão qualquer e o relatório mente com cara de prova.
 */
export async function conferirRegras(ctx, textoDoCommit) {
  const r = await pedir(ctx, 'GET', '.settings/rules', { dono: true });
  if (r.status !== 200) return { ok: false, motivo: `o emulador recusou /.settings/rules.json (HTTP ${r.status})` };
  const doEmulador = io.safeStringify(canonico(r.corpo));
  const doCommit = io.safeStringify(canonico(io.parseJson(textoDoCommit, null)));
  if (doEmulador !== doCommit) return { ok: false, motivo: 'as regras carregadas no emulador DIVERGEM de firebase/database.rules.json' };
  return { ok: true };
}

// ---------------------------------------------------------------- montagem

export async function montarContexto({ banco, auth, projeto, raizSonda }) {
  const ctx = { banco, auth, projeto, ns: espacoDeNomes(projeto), raizSonda };
  ctx.u1 = await criarUsuario(ctx, `dono-${Date.now()}@exemplo.test`);
  ctx.u2 = await criarUsuario(ctx, `outro-${Date.now()}@exemplo.test`);
  return ctx;
}

export default { montarContexto, pedir, preparar, conferirRegras, conferirDisponibilidade, derivaDoRelogio, espacoDeNomes, renovarSenha, renovarSemSenha, authTimeDe };
