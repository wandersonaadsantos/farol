// Libera apenas a âncora da rodada que não chegou a executar, preservando metadados.
function liberarAncora(engine, key, headEsperado) {
  const ancora = engine.reReviewLaunched?.[key];
  if (ancora === undefined) return;
  const head = ancora && typeof ancora === 'object' ? ancora.head : ancora;
  if (headEsperado !== undefined && head !== headEsperado) return;
  if (ancora && typeof ancora === 'object') engine.reReviewLaunched[key] = { ...ancora, head: '' };
  else delete engine.reReviewLaunched[key];
  engine.saveReReviewLaunched();
}

export { liberarAncora };
