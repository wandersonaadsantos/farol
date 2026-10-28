// Costura da memória com a revisão: carregar, comparar, persistir e projetar diagnóstico.
import { randomUUID } from 'node:crypto';
import { normalizeFindings, classifyFindings, previousBlockers, roundMemoryBlock, roundGap } from './review-findings.js';
import { SCHEMA, scopeFor, readRounds, saveRound, frontier, historyIssues, recordOutcome } from './review-round-store.js';
import sync from './review-round-sync.js';
import { publishedCriteriaParents } from './review-criteria-history.js';

async function prepareRoundReview(engine, pr, headSha, inventory) {
  const scope = scopeFor(pr.key, engine.accountForPr(pr));
  const local = readRounds(scope);
  const issues = [];
  for (const round of local.rounds) {
    const publication = await sync.publishRound(engine, round);
    if (!publication.ok) issues.push(publication.reason || 'memória local não publicada para os outros executores');
  }
  const remote = await sync.readRemoteRounds(engine, scope);
  if (!local.ok) issues.push(local.reason);
  if (!remote.ok) issues.push(remote.reason);
  for (const round of remote.rounds) {
    try { saveRound(round); }
    catch { issues.push('memória remota conflita com a memória local'); }
  }
  const merged = readRounds(scope);
  const historyIntegrity = historyIssues(merged.rounds);
  issues.push(...historyIntegrity);
  const parents = frontier(merged.rounds);
  const criteriaParents = publishedCriteriaParents(merged.rounds, engine.decisions);
  let status = parents.length ? 'ready' : 'first';
  if (issues.length) status = 'unavailable';
  const context = { id: randomUUID().replaceAll('-', ''), scope, headSha, baseSha: inventory.baseSha || '',
    mode: engine.config.reviewRoundsMode === 'enforce' ? 'enforce' : 'observe',
    status, reason: issues.join('; '), parents, criteriaParents, criteriaContractRequired: true,
    criteriaHistoryAvailable: local.ok && merged.ok && !historyIntegrity.length };
  if (issues.length) engine.log('WARN', `memória ${pr.key}: ${context.reason}`);
  return context;
}

async function finishRoundReview(engine, pr, context, inventory, result) {
  delete result.roundId; delete result.roundReview;
  if (result.analysisStatus !== 'complete') { delete result.roundId; delete result.roundReview; return; }
  const normalized = normalizeFindings(result.findings);
  const comparison = classifyFindings(context, normalized, inventory.status === 'complete' ? inventory.files : null);
  const findings = normalized.findings.map((f, i) => ({ ...f, id: `${context.id}:f${i + 1}` }));
  const unresolved = [...comparison.unresolved];
  const previousIds = new Set(context.parents.flatMap(r => [...r.findings, ...r.unresolved]).map(f => f.id));
  for (const f of findings) if (f.severity === 'blocking' && (!f.ref || !previousIds.has(f.ref) || !['persiste', 'resolvido', 'retirado'].includes(f.status))) unresolved.push(f);
  const integrity = [...comparison.issues];
  if (context.status === 'unavailable') integrity.push(context.reason);
  if (normalized.status !== 'complete') integrity.push(`findings ${normalized.status}: ${normalized.issues.join('; ') || 'declaração ausente'}`);
  if (comparison.dropped.length) integrity.push(`${comparison.dropped.length} blocker(s) anterior(es) sem resposta`);
  const ordinal = Math.max(0, ...context.parents.map(r => r.ordinal || 1)) + 1;
  const round = { schema: SCHEMA, ordinal, id: context.id, scope: context.scope, parents: context.parents.map(r => r.id),
    headSha: context.headSha, baseSha: context.baseSha, at: Date.now(), executor: engine.sync?.deviceId || 'local',
    decision: result.decision, verdict: result.verdict, findingsStatus: normalized.status, findings, unresolved,
    files: inventory.status === 'complete' ? inventory.files : [], integrity };
  try {
    saveRound(round);
    result.roundId = round.id;
    const publication = await sync.publishRound(engine, round);
    if (!publication.ok) integrity.push(publication.reason);
  } catch { integrity.push('a análise não foi persistida na memória de rodadas'); }
  result.roundReview = { schema: SCHEMA, ordinal, mode: context.mode, parentIds: round.parents,
    lateCount: comparison.late.length, droppedCount: comparison.dropped.length,
    resolvedOnUnchangedCount: comparison.resolvedOnUnchanged.length, unresolvedCount: unresolved.length,
    changedContext: comparison.changedContext, integrity: [...new Set(integrity)] };
  if (integrity.length) engine.log('WARN', `memória ${pr.key}: ${result.roundReview.integrity.join('; ')}`);
}

function recordPublicationOutcome(engine, item) {
  if (!item.roundId) return;
  const status = item.status || 'pending';
  const state = ['auto_approved', 'auto_rejected', 'posted', 'commented_own_pr'].includes(status) ? 'published' : 'pending';
  try {
    recordOutcome(scopeFor(item.key, engine.accountForPr({ ...item.pr, key: item.key })), item.roundId,
      { decisionId: item.id, at: item.resolvedAt || item.createdAt, status, publicationState: item.postRetry || item.reasons?.some(r => r.kind === 'infra') ? 'failed' : state });
  } catch { engine.log('WARN', `memória ${item.key}: desfecho da publicação não foi registrado`); }
}

async function publishKnownRounds(engine, pr) {
  const local = readRounds(scopeFor(pr.key, engine.accountForPr(pr)));
  if (!local.ok) return { ok: false, reason: local.reason };
  for (const round of local.rounds) {
    const sent = await sync.publishRound(engine, round);
    if (!sent.ok) return sent;
  }
  return { ok: true };
}

function publicationRefusal(engine, options, payload) {
  if (engine.config?.reviewRoundsMode !== 'enforce' || ['clique', 'sessao'].includes(options?.via)) return null;
  const roundReview = options?.roundReview || options?.continuidade?.roundReview;
  const verdict = options?.verdict || options?.continuidade?.verdict;
  const rejecting = payload?.event === 'REQUEST_CHANGES' || (payload?.event === 'COMMENT' && verdict === 'request_changes');
  const action = rejecting ? 'request_changes' : 'approve';
  const gap = roundGap({ roundReview }, 'enforce', action);
  return gap ? { ok: false, blocked: 'round_memory', attempted: false, error: gap, needsReview: true } : null;
}

export default { publicationRefusal, publishKnownRounds, prepareRoundReview, finishRoundReview, recordPublicationOutcome, roundMemoryBlock, roundGap };
export { publicationRefusal, publishKnownRounds, prepareRoundReview, finishRoundReview, recordPublicationOutcome, roundMemoryBlock, roundGap, previousBlockers };
