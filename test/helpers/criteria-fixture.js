// Contrato de uma resposta de provedor para testes de outras responsabilidades.
function criteriaFixture(verdict = 'approve') {
  const findings = verdict === 'request_changes' ? [{ severity: 'blocking', title: 'Defeito da fixture',
    summary: 'O fluxo da fixture viola o contrato.', evidence: 'fixture.js:1',
    criteria: { key: 'defeito-fixture', criterion: 'Contrato da fixture', source: 'fixture.js:1', scope: 'Este diff' } }] : [];
  return { criteriaVersion: 1, productDecisions: [], findings };
}

export { criteriaFixture };
