// Provas produzidas pelo engine, nunca pela saída do modelo.
function rememberReview(engine, pr, result) {
  if (!(engine.technicalApprovals instanceof Map)) engine.technicalApprovals = new Map();
  // provaEsgotada (17/10/2026): as duas tentativas próprias do Farol neste head já rodaram, e a
  // lacuna técnica que não é dura virou ressalva (lib/engine/busca-da-prova.js)
  engine.technicalApprovals.set(pr.key, { report: result.technicalReview, evidence: result.approvalEvidence || [], provaEsgotada: result.provaEsgotada === true });
}

function publicationEvidence(engine, pr) {
  const key = pr.key || `${pr.repo}#${pr.number}`;
  const fresh = engine.technicalApprovals?.get(key);
  if (fresh) return fresh;
  const item = engine.decisions?.pending?.find(d => d.key === key);
  return { report: item?.technicalReview, evidence: item?.approvalEvidence || ['prova de revisão ausente'], provaEsgotada: item?.provaEsgotada === true };
}


export { rememberReview, publicationEvidence };
