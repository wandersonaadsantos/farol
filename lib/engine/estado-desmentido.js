// Pedido de mudanças que só se apoiava no estado do PR, e esse estado não vale (08/11/2026).
//
// Ordem do dono: a conta configurada para aprovar ou reprovar sozinha decide sozinha. Dois
// caminhos ainda paravam na mesa com "a decisão é sua":
//   - o pedido sustentado só pelo CI obrigatório com "CI obrigatório antes da aprovação"
//     desligado: o CI está fora da decisão, então o pedido não tinha o que sustentar;
//   - o conflito com a base que a revisão declarou e o GitHub desmente (PR MERGEABLE).
// Nos dois, nenhum defeito do código foi provado. Os bloqueios de estado viram sugestão, o
// veredito vira aprovar com ressalva dizendo por quê, e a política de ressalvas da conta decide.
// Sem texto de aprovação escrito pela revisão, o app escreve um curto, sujeito à trava de
// linguagem de sempre no postReview. Roda antes da memória de rodadas e das lacunas da rodada
// (review.js), para todo o resto enxergar uma aprovação coerente.
import { causasDosBloqueios } from './review-findings-contract.js';
import { reprovacaoSoPeloCi, reviewCoherenceGap } from './review-consistency.js';
import { relatorioComViolacao } from '../technical-review/verdict.js';
import { aguardaCiParaAprovar } from './gate-espera.js';
import { mergeavelDoPr } from './gh-queries.js';
import { anexarChecksObrigatorios } from './checks-exigidos.js';

const CAUSAS_DESMENTIVEIS = new Set(['ci', 'conflito']);

function temTexto(p) {
  return !!(p && (String(p.body || '').trim() || (Array.isArray(p.comments) && p.comments.length)));
}

// PURO. O APPROVE que o app escreve quando a revisão só escreveu o pedido de mudanças.
function aprovacaoDoApp(ci, conflito) {
  const partes = ['Li as mudanças deste commit e não encontrei defeito no código que segure a aprovação.'];
  if (ci) partes.push('O estado do CI obrigatório fica fora desta aprovação: onde o check é exigido, o merge continua dependendo dele.');
  if (conflito) partes.push('O GitHub não aponta conflito com a base neste commit.');
  return { event: 'APPROVE', body: partes.join(' '), comments: [] };
}

// PURO. Quais estados sustentam o pedido, ou null quando o pedido não é só de estado desmentível.
function estadosDoPedido(engine, result) {
  if (result?.verdict !== 'request_changes' || result.analysisStatus !== 'complete' || reviewCoherenceGap(result)) return null;
  if (relatorioComViolacao(result.technicalReview) || result.cardParteDestePr === false) return null;
  const causas = causasDosBloqueios(result);
  if ([...causas].some((c) => !CAUSAS_DESMENTIVEIS.has(c))) return null;
  const ci = causas.has('ci') || (causas.size === 0 && reprovacaoSoPeloCi(result));
  const conflito = causas.has('conflito');
  if (!ci && !conflito) return null;
  // com a espera do CI ligada, o CI decide: a espera do CI de sempre cuida dele
  if (ci && aguardaCiParaAprovar(engine.config)) return null;
  return { ci, conflito };
}

// PURO. Aplica no próprio resultado: bloqueios de estado viram sugestão e o veredito vira aprovar.
function aprovarSemOEstado(result, { ci, conflito }, gateReason) {
  result.findings = (Array.isArray(result.findings) ? result.findings : []).map((f) => {
    if (!f || f.severity !== 'blocking' || !CAUSAS_DESMENTIVEIS.has(f.causa)) return f;
    // o que vinha de rodada anterior sai como retirado, para a memória não o guardar vivo
    return { ...f, severity: 'suggestion', ...(f.ref ? { status: 'retirado' } : {}) };
  });
  result.verdict = 'approve';
  result.decision = 'needs_decision';
  result.payloads = { ...(result.payloads || {}) };
  if (!temTexto(result.payloads.approve)) result.payloads.approve = aprovacaoDoApp(ci, conflito);
  const estados = [ci && 'pelo CI obrigatório, com a espera do CI desligada em Sistema > Automação', conflito && 'por um conflito com a base que o GitHub não confirma']
    .filter(Boolean).join(' e ');
  result.reasons = [gateReason(`a revisão pediu mudanças só ${estados}; nenhum defeito do código segura a aprovação, então a política da conta decide`),
    ...(result.reasons || [])];
}

// O conflito é conferido no GitHub; leitura que falha ou UNKNOWN não desmente nada.
async function aplicarEstadoDesmentido(engine, pr, result, gateReason) {
  const estados = estadosDoPedido(engine, result);
  if (!estados) return false;
  if (estados.conflito && await mergeavelDoPr(engine, pr).catch(() => null) !== 'MERGEABLE') return false;
  aprovarSemOEstado(result, estados, gateReason);
  return true;
}

// O que o runHeadlessReview lê do estado do PR antes das lacunas da rodada: os checks obrigatórios
// no head e, com eles, o pedido que só o estado sustentava.
async function checksEEstadoDoPr(engine, pr, result, gateReason) {
  await anexarChecksObrigatorios(engine, pr, result);
  return aplicarEstadoDesmentido(engine, pr, result, gateReason);
}

export { aprovacaoDoApp, estadosDoPedido, aprovarSemOEstado, aplicarEstadoDesmentido, checksEEstadoDoPr };
