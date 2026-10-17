// Provas produzidas pelo engine, nunca pela saída do modelo.
function rememberReview(engine, pr, result) {
  if (!(engine.technicalApprovals instanceof Map)) engine.technicalApprovals = new Map();
  engine.technicalApprovals.set(pr.key, { report: result.technicalReview, evidence: result.approvalEvidence || [] });
}

function publicationEvidence(engine, pr) {
  const key = pr.key || `${pr.repo}#${pr.number}`;
  const fresh = engine.technicalApprovals?.get(key);
  if (fresh) return fresh;
  const item = engine.decisions?.pending?.find(d => d.key === key);
  return { report: item?.technicalReview, evidence: item?.approvalEvidence || ['prova de revisão ausente'] };
}


export { rememberReview, publicationEvidence };
