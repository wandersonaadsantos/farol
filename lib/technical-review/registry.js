// Provas produzidas pelo engine, nunca pela saída do modelo.
function reviewEvidenceFields(result = {}) {
  return { technicalReview: result.technicalReview || null, criteriaEvidence: result.criteriaEvidence || null,
    approvalEvidence: result.approvalEvidence || ['prova necessária à aprovação ausente'],
    approvalEvidenceVersion: result.approvalEvidenceVersion };
}

function rememberReview(engine, pr, result) {
  if (!(engine.technicalApprovals instanceof Map)) engine.technicalApprovals = new Map();
  const fields = reviewEvidenceFields(result);
  engine.technicalApprovals.set(pr.key, { report: fields.technicalReview, evidence: fields.approvalEvidence,
    criteriaEvidence: fields.criteriaEvidence,
    provaEsgotada: result.provaEsgotada === true, evidenceVersion: fields.approvalEvidenceVersion });
}

function publicationEvidence(engine, pr) {
  const key = pr.key || `${pr.repo}#${pr.number}`;
  const fresh = engine.technicalApprovals?.get(key);
  if (fresh) return fresh;
  const item = engine.decisions?.pending?.find(d => d.key === key);
  const fields = reviewEvidenceFields(item);
  return { report: fields.technicalReview, evidence: fields.approvalEvidence, criteriaEvidence: fields.criteriaEvidence,
    provaEsgotada: item?.provaEsgotada === true, evidenceVersion: fields.approvalEvidenceVersion };
}


export { rememberReview, publicationEvidence, reviewEvidenceFields };
