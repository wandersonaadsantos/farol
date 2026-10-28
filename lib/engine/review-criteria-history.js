// Publicação, não mera tentativa, define compromisso de critério com o autor.
function publishedCriteriaParents(rounds, decisions) {
  const published = new Set((decisions?.resolved || []).filter(d => !d.postRetry
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

export { publishedCriteriaParents };
