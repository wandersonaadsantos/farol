// Política pura de encerramento automático por conta, PR e commit.
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED']);
const AUTOMATIC_PATHS = new Set(['revisao', 'reenvio', 'espera-ci', 'coassinatura']);

function decisaoAutomaticaJaPublicada(pr, states) {
  return !pr?.manual && Array.isArray(states) && states.some(s => DECISIVE_REVIEW_STATES.has(s));
}

function postagemAutomatica(pr, options) {
  return !pr?.manual && AUTOMATIC_PATHS.has(options?.via);
}

export { DECISIVE_REVIEW_STATES, decisaoAutomaticaJaPublicada, postagemAutomatica };
