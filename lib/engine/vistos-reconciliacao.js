// PR pedido a mim, marcado como visto e sem decisão registrada no Farol: volta para a fila
// ou já está resolvido? (05/10/2026)
//
// O reconciliarVistos (que morava no server.js) devolvia à fila todo PR visto sem decisão,
// para não perder revisão que nunca decidiu. Faltava o caso do PR que EU já revisei FORA do
// Farol (no GitHub ou pelo chat): a fila automática perguntava ao GitHub "já revisei este
// head?", ouvia que sim, saía de cena marcando o PR como visto de novo, e no ciclo seguinte o
// reconciliarVistos o devolvia outra vez. Medido em 04/10/2026 num PR de infraestrutura:
// 90 voltas no dia, uma por ciclo, 660 leituras de review e um toast "você já tinha revisado
// este commit" em cada uma. O PR seguia pedido a mim porque a própria conta tinha pedido a
// revisão de novo 13 segundos depois de aprovar.
//
// Aqui a decisão "já resolvido" vira uma marca local { head, updatedAt }:
//   - enquanto o updatedAt do PR não muda, o reconciliarVistos respeita a marca, sem gh;
//   - quando muda (push, comentário, pedido novo), o PR volta e a conferência roda UMA vez;
//   - head novo: revisa; novo pedido, comentário ou label no mesmo head não reabre
//     automaticamente uma aprovação ou reprovação já publicada.
// Falta de dado nunca vira marca: sem head ou sem os meus reviews, a revisão segue (como
// sempre foi). A decisão publicada no head confirmado dispensa consultar a timeline.
import path from 'node:path';
import io, { readJson, writeJsonAtomic } from '../io.js';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { DECISIVE_REVIEW_STATES } from './decision.js';
import labelsATirar from './labels-a-tirar.js';

const ARQUIVO = path.join(STATE_DIR, 'revisados-fora.json');
const VALIDADE_MS = 30 * TEMPOS.DIA_MS; // PR que fechou nunca mais volta: a marca envelhece e sai

function marcas(engine) {
  if (!engine.revisadosFora || typeof engine.revisadosFora !== 'object') {
    const lido = readJson(ARQUIVO, {});
    engine.revisadosFora = (lido && typeof lido === 'object' && !Array.isArray(lido)) ? lido : {};
  }
  return engine.revisadosFora;
}

function salvar(engine) {
  try { writeJsonAtomic(ARQUIVO, marcas(engine)); }
  catch (err) { engine.log('WARN', `salvar revisados-fora.json: ${err.message}`); }
}

// A marca segura o PR enquanto o PR não mudou desde que ela foi gravada.
function seguraNaReconciliacao(engine, pr) {
  const m = marcas(engine)[pr && pr.key];
  return !!m && String(m.updatedAt || '') === String((pr && pr.updatedAt) || '');
}

function podarVencidas(engine, agora) {
  const todas = marcas(engine);
  let mudou = false;
  for (const [k, m] of Object.entries(todas)) {
    if (!m || !(Number(m.at) > agora - VALIDADE_MS)) { delete todas[k]; mudou = true; }
  }
  if (mudou) salvar(engine);
}

// O corpo que morava no server.js, com a marca como mais uma razão para não devolver.
function reconciliarVistos(engine, mineList, agora = Date.now()) {
  if (!engine.ignorados) return 0;
  podarVencidas(engine, agora);
  const comDecisao = new Set([
    ...((engine.decisions && engine.decisions.pending) || []).map((d) => d.key),
    ...((engine.decisions && engine.decisions.resolved) || []).map((d) => d.key),
  ]);
  const emCurso = new Set();
  for (const s of engine.activeReviews.values()) for (const k of (s.keys || [])) emCurso.add(k);
  for (const pr of engine.headlessQueue) emCurso.add(pr.key);
  let devolvidos = 0;
  for (const pr of mineList) {
    const k = pr.key;
    if (!engine.seen.has(k)) continue;
    if (engine.ignorados.has(k) || comDecisao.has(k) || (engine.vistosPorRecibo && engine.vistosPorRecibo.has(k))) continue;
    if (emCurso.has(k) || engine.autoReviewParked.has(k) || engine.retryAfterNet.has(k)) continue;
    if (seguraNaReconciliacao(engine, pr)) continue;
    engine.unsee(k);
    devolvidos++;
  }
  if (devolvidos) engine.log('WARN', `${devolvidos} PR(s) voltaram à fila: marcados como vistos por revisão que não chegou a decidir`);
  return devolvidos;
}

// A boca da fila automática: devolve true quando o PR já está resolvido neste head (e o tira
// da fila sem sessão), false quando a revisão deve rodar. Substitui o jaRevisado + sairDeCena.
async function jaResolvido(engine, pr, agora = Date.now()) {
  let head = '';
  try { head = await engine.headSha(pr); } catch { head = ''; }
  if (!head) return false; // sem head não dá para provar nada: a revisão segue
  const estados = await engine.myReviewStates(pr, head).catch(() => null);
  if (!Array.isArray(estados) || !estados.some((s) => DECISIVE_REVIEW_STATES.has(s))) return false;
  // Só a nossa tag observada. A fila durável confirma ausência de sessão/lease vivo
  // antes de remover, inclusive quando outro aparelho usa a mesma conta.
  const account = String(engine.accountForPr(pr) || '').trim();
  const expected = `${account}:revisando`.toLowerCase();
  const label = (Array.isArray(pr.labels) ? pr.labels : []).find(l => typeof l === 'string' && l.toLowerCase() === expected);
  if (account && label) labelsATirar.anotar(engine, pr, label, agora, account);
  const anterior = marcas(engine)[pr.key];
  marcas(engine)[pr.key] = { head, updatedAt: String(pr.updatedAt || ''), at: agora };
  salvar(engine);
  engine.markSeen(pr.key);
  engine.queue = engine.queue.filter((p) => p.key !== pr.key);
  // o aviso sai uma vez por head: voltar ao mesmo head resolvido não é notícia
  if (!anterior || anterior.head !== head) {
    engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha revisado este commit; não gastei uma revisão nova.` });
  }
  return true;
}

export default { reconciliarVistos, seguraNaReconciliacao, jaResolvido, ARQUIVO };
export { reconciliarVistos, seguraNaReconciliacao, jaResolvido, ARQUIVO };
