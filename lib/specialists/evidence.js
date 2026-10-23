// Procedência de quem montou o contexto, fora do envelope controlado pelo modelo.
const evidence = new WeakMap();
function attachSpecialistEvidence(result, summary) {
  delete result.specialistEvidence;
  if (summary) evidence.set(result, Object.freeze({ ...summary }));
}
function specialistEvidenceFor(result) { return evidence.get(result) || null; }
export { attachSpecialistEvidence, specialistEvidenceFor };
