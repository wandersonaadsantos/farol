import { safeJsonStringify } from './comum.js';

// A revisão ativa prevalece sobre a espera, sem alterar o snapshot do motor.
// A conta distingue pedidos legítimos de revisão do mesmo PR.
export function filaSemRevisoesAtivas(fila, sessoes, contaDe) {
  const identidade = pr => safeJsonStringify([String(pr.key).toLowerCase(), String(contaDe(pr)).toLowerCase()]);
  const ativos = new Set(sessoes.flatMap(s =>
    (s.keys || []).map(key => identidade({ ...s.pr, key }))));
  return fila.filter(pr => !ativos.has(identidade(pr)));
}

export function revisaoAtiva(pr, sessoes, contaDe) {
  return filaSemRevisoesAtivas([pr], sessoes, contaDe).length === 0;
}
