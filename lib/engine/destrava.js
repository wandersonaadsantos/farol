/* Estado novo do PR destrava o que esperava clique (v2.59.3).

   Caso de campo (Edicoes-CNBB/biblioteca-cnbb-api#22, 09/09/2026) e a pergunta que ele
   levantou: "se eu pedir uma nova revisão, o outro Farol executa ou pode travar?". A
   investigação reproduziu três jeitos de o PR ficar esperando clique PRA SEMPRE, mesmo
   com o autor empurrando commit ou pedindo revisão de novo:

   - `presa`: pendência stale_head cuja rodada relançada saiu (âncora == blockedHead) e
     não concluiu (estacionou por falha, ou a coordenação entre aparelhos devolveu
     recibo). O blockedHead nunca acompanha o head atual, então o gatilho B do
     explicaReRound nunca mais arma.
   - `estacionado`: a revisão parou por falha e ficou em autoReviewParked. Nada fora do
     clique tirava de lá.
   - `pulado`: alguém clicou Pular. O markReRequests não conta Pular como revisado (de
     propósito: nada foi postado), então o pedido de revisão de novo nunca é reconhecido.

   A regra daqui: commit novo ou pedido de revisão PRA MIM, posterior à parada, é estado
   novo do PR, e estado novo merece nova tentativa. Duas exceções deliberadas ficam de
   fora: estacionamento por "cancelada por você" (decisão sua sobre aquele PR) e PR
   ignorado (descarte deliberado).

   Custo: a seleção é SÍNCRONA e sem IO, e só entra candidato cujo `updatedAt` do
   panorama é posterior à parada (commit e pedido de revisão mexem nele). Só esses custam
   uma chamada gh (timeline) e, quando a timeline não prova nada e há head conhecido, uma
   segunda (head atual). Teto por ciclo em MAX_POR_CICLO. PR fora do panorama não tem
   updatedAt e fica de fora: a fila mine entra no panorama, então o caso real é coberto.

   O marcador `destravados` ({ key: epoch do sinal usado }, state/destravados.json)
   impede o mesmo sinal de destravar duas vezes, inclusive depois de reinício. Nada aqui
   posta no GitHub nem lança sessão: só devolve o PR aos caminhos automáticos de sempre,
   que seguem com todos os gates deles. */
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io, { writeJsonAtomic } from '../io.js';
import { normalizeAncora, desestacionar } from './review.js';

const ARQUIVO = path.join(STATE_DIR, 'destravados.json');
const MAX_POR_CICLO = 10;
// eventos da timeline que provam estado novo, achatados pelo --jq em TSV:
// evento, quando, login pedido (review_requested), sha (push)
const JQ_TIMELINE = '.[] | select(.event=="review_requested" or .event=="head_ref_force_pushed" or .event=="committed")'
  + ' | [.event, (.created_at // .committer.date // ""), (.requested_reviewer.login // ""), (.commit_id // .sha // "")] | @tsv';

function loadDestravados(log) {
  const bruto = io.readJson(ARQUIVO, {}, log);
  return (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) ? bruto : {};
}

function saveDestravados(engine) {
  try { writeJsonAtomic(ARQUIVO, engine.destravados || {}); }
  catch (err) { engine.log('WARN', `salvar destravados: ${err.message}`); }
}

const ms = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(String(v || ''));
  return Number.isFinite(n) ? n : 0;
};

// a decisão mais recente deste PR: pendente primeiro (mais nova no topo), depois o histórico
function ultimaDecisao(engine, key) {
  const decisions = engine.decisions || {};
  return (decisions.pending || []).find(d => d.key === key) || (decisions.resolved || []).find(d => d.key === key) || null;
}

function candidatoPresa(engine, d) {
  if (d.blockedKind !== 'stale_head' || !d.blockedHead) return null;
  const ancora = normalizeAncora((engine.reReviewLaunched || {})[d.key]);
  if (ancora.head !== d.blockedHead) return null; // o gatilho B ainda arma sozinho
  const parada = (engine.parkedMotivos || {})[d.key] || {};
  if (engine.autoReviewParked.has(d.key) && parada.tipo === 'cancelado') return null;
  return { tipo: 'presa', desde: Math.max(ms(d.createdAt), ancora.at, ms(parada.at)), headConhecido: d.blockedHead };
}

function candidatoEstacionado(engine, key) {
  const parada = (engine.parkedMotivos || {})[key];
  // sem motivo gravado (legado) não dá pra saber se foi cancelamento: fica manual
  if (!parada || parada.tipo === 'cancelado') return null;
  return { tipo: 'estacionado', desde: ms(parada.at), headConhecido: String(parada.head || '') };
}

function candidatoPulado(engine, key) {
  const d = ultimaDecisao(engine, key);
  if (!d || d.status !== 'skipped') return null;
  if (!(engine.mineKeys || new Set()).has(key) || !engine.seen.has(key)) return null;
  if (engine.ignorados && engine.ignorados.has(key)) return null;
  return { tipo: 'pulado', desde: ms(d.resolvedAt), headConhecido: String(d.headSha || '') };
}

function candidatoDe(engine, pr) {
  const pend = (((engine.decisions || {}).pending) || []).find(d => d.key === pr.key && d.blockedKind === 'stale_head');
  if (pend) return candidatoPresa(engine, pend);
  if (engine.autoReviewParked.has(pr.key)) return candidatoEstacionado(engine, pr.key);
  return candidatoPulado(engine, pr.key);
}

// PURA: quem pode ter sido destravado por estado novo neste ciclo
function candidatosDestrave(engine, inflightKeys) {
  const out = [];
  for (const pr of engine.panorama || []) {
    if (inflightKeys.has(pr.key) || engine.retryAfterNet.has(pr.key)) continue;
    const c = candidatoDe(engine, pr);
    if (!c) continue;
    const desde = Math.max(c.desde, Number((engine.destravados || {})[pr.key]) || 0);
    if (!(ms(pr.updatedAt) > desde)) continue;
    out.push({ ...c, key: pr.key, pr, desde });
  }
  return out;
}

function lerTimeline(stdout, desde, me) {
  let pedido = 0, push = { at: 0, head: '' };
  for (const linha of String(stdout || '').split('\n')) {
    const [evento, quando, login, sha] = linha.split('\t');
    const at = ms(quando);
    if (!(at > desde)) continue;
    if (evento === 'review_requested' && String(login || '').toLowerCase() === me && at > pedido) pedido = at;
    if (evento !== 'review_requested' && at >= push.at) push = { at, head: String(sha || '').trim() };
  }
  if (!pedido && !push.at) return null;
  return push.at >= pedido ? { tipo: 'push', at: push.at, head: push.head } : { tipo: 'pedido', at: pedido, head: '' };
}

// Sem evento na timeline (commit com data antiga empurrado agora não tem data de push),
// head diferente do conhecido também prova commit novo; a hora é a do updatedAt.
async function headMudou(engine, cand) {
  if (!cand.headConhecido) return null;
  let head = '';
  try { head = await engine.headSha(cand.pr); } catch { /* sem head não inventa sinal */ }
  if (!head || head === cand.headConhecido) return null;
  return { tipo: 'push', at: ms(cand.pr.updatedAt), head };
}

// Uma chamada gh (timeline) e, se ela não provar nada, no máximo mais uma (head).
// Falha da timeline não destrava nada: falta de dado nunca vira estado novo.
async function sinalDeEstadoNovo(engine, cand, run = io.run) {
  const repo = String(cand.pr.repo || cand.key.split('#')[0]);
  const numero = cand.pr.number || parseInt(cand.key.split('#')[1], 10);
  const acc = engine.accountForPr(cand.pr);
  const r = await run('gh', ['api', '--paginate', `repos/${repo}/issues/${numero}/timeline?per_page=100`, '--jq', JQ_TIMELINE],
    { env: engine.ghEnv(acc) });
  if (!r || !r.ok) return null;
  return lerTimeline(r.stdout, cand.desde, String(acc || '').toLowerCase()) || headMudou(engine, cand);
}

function voltaPraFila(engine, pr) {
  engine.unsee(pr.key);
  if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
}

function soltaPresa(engine, cand, sinal) {
  if (desestacionar(engine, cand.key)) engine.saveAutoReviewParked();
  const ancora = (engine.reReviewLaunched || {})[cand.key];
  if (ancora && typeof ancora === 'object') engine.reReviewLaunched[cand.key] = { ...ancora, head: '' };
  else if (ancora !== undefined) delete engine.reReviewLaunched[cand.key];
  engine.saveReReviewLaunched();
  const pend = engine.decisions.pending.find(d => d.key === cand.key && d.blockedKind === 'stale_head');
  if (pend && sinal.head) pend.blockedHead = sinal.head;
  // o relógio de PR quieto recomeça no sinal: rajada de push ainda em curso espera
  if (pend) pend.headQuietoDesde = sinal.at;
  engine.saveDecisions();
}

function aplicarDestrave(engine, cand, sinal) {
  if (cand.tipo === 'presa') soltaPresa(engine, cand, sinal);
  if (cand.tipo === 'estacionado') {
    desestacionar(engine, cand.key);
    engine.saveAutoReviewParked();
    voltaPraFila(engine, cand.pr);
  }
  if (cand.tipo === 'pulado') voltaPraFila(engine, cand.pr);
  if (!engine.destravados || typeof engine.destravados !== 'object') engine.destravados = {};
  engine.destravados[cand.key] = sinal.at;
  engine.saveDestravados();
  const causa = sinal.tipo === 'pedido' ? 'pediram revisão de novo' : 'chegou commit novo';
  const seguimento = engine.autoReviewFor(engine.accountForPr(cand.pr)) ? 'volto a revisar sozinho' : 'o PR voltou pra sua fila';
  engine.emit('toast', { kind: 'info', text: `↻ ${cand.key}: ${causa} depois que a revisão parou; ${seguimento}.` });
}

// marcador de PR que saiu do panorama e da mesa não serve pra nada
function podarDestravados(engine) {
  const abertos = new Set([
    ...(engine.panorama || []).map(p => p.key),
    ...(((engine.decisions || {}).pending) || []).map(d => d.key),
  ]);
  let mudou = false;
  for (const k of Object.keys(engine.destravados || {})) {
    if (!abertos.has(k)) { delete engine.destravados[k]; mudou = true; }
  }
  if (mudou) engine.saveDestravados();
}

async function destravarPorEstadoNovo(engine, run = io.run) {
  podarDestravados(engine);
  const inflight = new Set([
    ...(engine.headlessQueue || []).map(p => p.key),
    ...[...(engine.activeReviews || new Map()).values()].flatMap(s => s.keys || []),
  ]);
  for (const cand of candidatosDestrave(engine, inflight).slice(0, MAX_POR_CICLO)) {
    const sinal = await sinalDeEstadoNovo(engine, cand, run);
    if (sinal) aplicarDestrave(engine, cand, sinal);
  }
}

const destravaMod = {
  loadDestravados, saveDestravados, candidatosDestrave, sinalDeEstadoNovo, aplicarDestrave,
  podarDestravados, destravarPorEstadoNovo,
};
export default destravaMod;
export {
  loadDestravados, saveDestravados, candidatosDestrave, sinalDeEstadoNovo, aplicarDestrave,
  podarDestravados, destravarPorEstadoNovo,
};
