import { safeJsonStringify } from './comum.js';

// A revisão ativa prevalece sobre a espera, sem alterar o snapshot do motor.
// A conta distingue pedidos legítimos de revisão do mesmo PR.
const identidade = (pr, contaDe) => safeJsonStringify([String(pr.key).toLowerCase(), String(contaDe(pr)).toLowerCase()]);

export function mesmaRevisao(a, b, contaDe) {
  return identidade(a, contaDe) === identidade(b, contaDe);
}

export function filaSemRevisoesAtivas(fila, sessoes, contaDe) {
  const ativos = new Set(sessoes.flatMap(s =>
    (s.keys || []).map(key => identidade({ ...s.pr, key }, contaDe))));
  return fila.filter(pr => !ativos.has(identidade(pr, contaDe)));
}

export function revisaoAtiva(pr, sessoes, contaDe) {
  return filaSemRevisoesAtivas([pr], sessoes, contaDe).length === 0;
}
