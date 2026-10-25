// Resposta sintética da fronteira IA, compartilhada pelos probes de Node e Electron.
function auditResponse(prompt) {
  const data = JSON.parse(prompt.trim().split('\n').at(-1));
  if (!data.original) return { observations: [], limitations: [] };
  return { items: data.original.findings.map(f => ({ kind: 'incorrect', ref: f.id, blindRef: null, title: 'Regra já atendida',
    explanation: 'O valor é constante; confirme com o contrato antes de transformar isso em lição.',
    evidence: [{ path: 'src/a.ts', side: 'head', start: 1, end: 1, quote: 'export const value = 1;' }] })), limitations: ['Consumidores fora do diff não foram fornecidos.'] };
}
export { auditResponse };
