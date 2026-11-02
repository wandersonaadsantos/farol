const text = value => typeof value === 'string' ? value.trim() : '';
const CHANGES = ['nova_evidencia', 'agravamento', 'requisito_alterado', 'correcao_da_avaliacao'];
const ACTIVE = f => !['resolvido', 'retirado'].includes(f.status);

function findingCriteriaFields(f) {
  const fields = {};
  if (f.criteria !== undefined) {
    fields.criteria = Object.fromEntries(['key', 'criterion', 'source', 'scope'].map(k => [k, text(f.criteria?.[k])]));
  }
  if (f.change !== undefined) fields.change = Object.fromEntries(['type', 'reason', 'evidence', 'scope'].map(k => [k, text(f.change?.[k])]));
  if (f.recommendation !== undefined) {
    const r = f.recommendation;
    fields.recommendation = { descricao: text(r?.descricao), estado: text(r?.estado), headSha: text(r?.headSha) };
    for (const campo of ['casoDefeito', 'casoPreservado']) {
      fields.recommendation[campo] = Object.fromEntries(['cenario', 'esperado', 'observado', 'prova', 'resultado'].map(k => [k, text(r?.[campo]?.[k])]));
    }
  }
  return fields;
}

function criteriaTransitionIssues(f, previous) {
  if (!previous) return [];
  const promoted = f.severity === 'blocking' && ACTIVE(f) && (previous.severity !== 'blocking' || !ACTIVE(previous));
  const changedRule = previous.criteria && ['criterion', 'source', 'scope'].some(k => f.criteria?.[k] !== previous.criteria[k]);
  const changedClass = ACTIVE(f) && f.severity !== previous.severity;
  const c = f.change;
  if ((promoted || changedRule || changedClass) && !(CHANGES.includes(c?.type) && c.reason && c.scope && c.evidence && c.evidence !== previous.evidence)) {
    return [`${f.title}: mudança de critério ou classificação sem nova evidência e justificativa de escopo`];
  }
  if (f.status && f.status !== previous.status && !ACTIVE(f) && (!f.evidence || f.evidence === previous.evidence)) return [`${f.title}: encerramento sem evidência atualizada`];
  return [];
}


export { findingCriteriaFields, criteriaTransitionIssues };
