// Projeções puras dos diagnósticos para a UI; nunca carregam estado ou disco.
function roundSummary(item) {
  const r = item.roundReview;
  if (!r || r.schema !== 1) return null;
  return { schema: 1, id: item.roundId || null, ordinal: r.ordinal || 1, mode: r.mode, parentCount: r.parentIds?.length || 0,
    lateCount: r.lateCount || 0, droppedCount: r.droppedCount || 0,
    resolvedOnUnchangedCount: r.resolvedOnUnchangedCount || 0, unresolvedCount: r.unresolvedCount || 0,
    unverified: !!r.integrity?.length, changedContext: r.changedContext === true };
}

function checkpointForUi(vc) {
  const total = Number.isFinite(Number(vc.total)) ? Number(vc.total) : 0;
  const confirmedCount = Number.isFinite(Number(vc.confirmedCount)) ? Number(vc.confirmedCount) : 0;
  const conflictCount = Array.isArray(vc.conflicts) ? vc.conflicts.length : 0;
  return { total, confirmedCount, conflictCount };
}

export { roundSummary, checkpointForUi };
