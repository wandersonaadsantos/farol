// Projeção canônica do histórico recente, preservando dados da caixa de revisão.
import { decisionForUi } from './public-review.js';
import { reviewActions } from './decision.js';

const RECENTES = 30;

function snapshotDecisions(engine) {
  return { pending: engine.decisions.pending.map(decisionForUi),
    resolved: engine.decisions.resolved.slice(0, RECENTES).map(decisionForUi) };
}

// A indicação de última ação acompanha os PRs que a tela conhece. O histórico
// completo continua disponível no engine e na consulta de revisão por chave.
function snapshotReviewActions(engine) {
  const visiveis = [...(engine.panorama || []), ...(engine.queue || []), ...(engine.myPRs || []),
    ...engine.decisions.pending, ...engine.decisions.resolved.slice(0, RECENTES)];
  const keys = new Set(visiveis.map(pr => pr.key));
  const resolved = engine.decisions.resolved.filter(d => keys.has(d.key));
  return reviewActions({ decisions: { pending: engine.decisions.pending, resolved } });
}

export { snapshotDecisions, snapshotReviewActions };
