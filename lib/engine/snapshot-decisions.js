// Projeção canônica do histórico recente, preservando dados da caixa de revisão.
import { decisionForUi } from './public-review.js';
function snapshotDecisions(engine) {
  return { pending: engine.decisions.pending.map(decisionForUi),
    resolved: engine.decisions.resolved.slice(0, 30).map(decisionForUi) };
}
export { snapshotDecisions };
