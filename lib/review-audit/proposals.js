// Só avaliações humanas favoráveis geram propostas; nunca ativam conhecimento.
import { jobs, read, assessments } from './store.js';
import { digest } from './contract.js';
function readProposals(scope) {
  return jobs().filter(j => j.target.repo === scope.repo && j.target.account === scope.account).flatMap(job => {
    const result = read(job.id, 'result'), history = assessments(job.id);
    const humans = new Map(history.map(h => [h.item, h]));
    return (result?.report?.items || []).filter(item => ['incorrect', 'omitted'].includes(item.kind) && humans.get(item.id)?.verdict === 'agree').map(item => ({
      type: 'audit', key: `${job.target.repo}#${job.target.number}@${job.id}:${item.id}`,
      text: item.explanation, fingerprint: digest([job.id, item, humans.get(item.id)])
    }));
  });
}
function auditProposals(engine, scope) {
  try { return readProposals(scope); }
  catch { engine.log('WARN', 'Propostas de auditoria indisponíveis; lições delas não são consideradas válidas.'); return []; }
}
export { auditProposals };
