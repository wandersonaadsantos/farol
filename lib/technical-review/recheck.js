// Uma mudança comprovada de contexto pede revisão nova, sem reaproveitar a aprovação.
function needsTechnicalRecheck(item) {
  return item?.technicalRecheck === true || item?.blockedKind === 'technical_recheck';
}

function requestRecheck(engine, pr) {
  const item = engine.decisions?.pending?.find(d => d.key === pr.key);
  if (!item || item.technicalRecheck) return;
  item.technicalRecheck = true;
  item.blockedKind = 'technical_recheck';
  engine.saveDecisions();
}

function launchTechnicalRechecks(engine) {
  for (const item of engine.decisions?.pending || []) {
    if (!item.technicalRecheck || item.esperaProva || item.pr?.requested !== true) continue;
    const pr = { ...item.pr, key: item.key };
    const account = engine.accountForPr(pr);
    if (!engine.autoReviewFor(account) || engine.isMuted(account) || !engine.tokenFor(account)) continue;
    const queued = engine.enqueueHeadless(pr);
    if (!queued?.ok) continue;
    item.technicalRecheck = false;
    engine.saveDecisions();
  }
}

export { requestRecheck, launchTechnicalRechecks, needsTechnicalRecheck };
