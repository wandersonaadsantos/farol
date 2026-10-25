// Recuperação após reinício exige um desfecho positivo; silêncio não prova término.
import { iniciarManutencaoMaterial } from './material-maintenance.js';

const CONCLUDED = new Set(['auto_approved', 'auto_rejected', 'posted', 'already_reviewed', 'commented_own_pr']);
const SHA = /^[a-f0-9]{40}$/;
function materialIdentity(record) {
  const scope = record.sourceReference?.scope;
  const key = record.context?.prKey || (scope?.number ? `${scope.repo}#${scope.number}` : '');
  const repo = record.context?.repo, account = record.context?.account, head = record.context?.head;
  if (typeof repo !== 'string' || typeof account !== 'string' || !account || typeof key !== 'string'
    || !key.startsWith(`${repo}#`) || !/^\d+$/.test(key.slice(repo.length + 1))
    || !SHA.test(head || '') || !Number.isFinite(record.createdAt)) return null;
  return { key, repo, account, head };
}
function hasReference(engine, identity, record) {
  const active = [...engine.activeReviews.values()];
  if (active.some(s => s.id === record.owner.sessionId || s.pr?.key === identity.key || s.keys?.includes(identity.key))) return true;
  if (engine.headlessQueue.some(p => p.key === identity.key)) return true;
  return engine.retomadas.has(identity.key);
}
function concludedDecision(item, identity, record) {
  return item?.key === identity.key && item.pr?.repo === identity.repo
    && `${item.pr.repo}#${item.pr.number}` === identity.key && item.pr.account === identity.account
    && item.headSha === identity.head && CONCLUDED.has(item.status)
    && Number.isFinite(item.resolvedAt) && item.resolvedAt >= record.createdAt;
}
function materialReferenceState(engine, record) {
  const identity = materialIdentity(record);
  if (!identity || !(engine.activeReviews instanceof Map) || !(engine.retomadas instanceof Map)
    || !Array.isArray(engine.headlessQueue) || !Array.isArray(engine.decisions?.resolved)) return 'unknown';
  if (hasReference(engine, identity, record)) return 'active';
  return engine.decisions.resolved.some(item => concludedDecision(item, identity, record)) ? 'ended' : 'unknown';
}
function iniciarManutencaoDoEngine(engine, options = {}) {
  return iniciarManutencaoMaterial({ ...options, referenceState: record => materialReferenceState(engine, record) });
}
export { materialReferenceState, iniciarManutencaoDoEngine };
