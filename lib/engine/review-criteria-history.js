// Publicação, não mera tentativa, define compromisso de critério com o autor.
import { localScopes, readRounds, historyIssues } from './review-round-store.js';

function publishedCriteriaParents(rounds, decisions) {
  const published = new Set((decisions?.resolved || []).filter(d => (!d.postRetry || d.status === 'posted')
    && ['auto_approved', 'auto_rejected', 'posted', 'commented_own_pr'].includes(d.status)).map(d => d.roundId));
  const byId = new Map(rounds.map(r => [r.id, r]));
  const ancestors = new Set();
  for (const r of rounds.filter(r => published.has(r.id))) {
    const pending = [...r.parents], visited = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      ancestors.add(id);
      pending.push(...(byId.get(id)?.parents || []));
    }
  }
  return rounds.filter(r => published.has(r.id) && !ancestors.has(r.id));
}

function relatedCriteriaParents(engine, pr, card) {
  const result = { parents: [], complete: card ? true : null };
  if (!card) return result;
  const account = String(engine.accountForPr(pr) || '').toLowerCase();
  if (!account || !pr.repo) return { ...result, complete: false };
  const prefix = `${account}|${pr.repo}#`;
  for (const scope of localScopes().filter(s => s.startsWith(prefix) && s !== `${account}|${pr.key}`)) {
    const read = readRounds(scope);
    if (!read.ok || historyIssues(read.rounds).length) { result.complete = false; continue; }
    for (const round of publishedCriteriaParents(read.rounds, engine.decisions)) {
      const findings = round.findings.filter(f => f.criteria?.card === card);
      if (findings.length) result.parents.push({ ...round, related: true, findings });
    }
  }
  return result;
}

export { publishedCriteriaParents, relatedCriteriaParents };
