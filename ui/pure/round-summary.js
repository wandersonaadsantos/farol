import { esc } from './comum.js';
function roundSummaryHtml(rounds, attrs = '') {
  if (!rounds || rounds.schema !== 1) return '';
  const count = value => Number.isInteger(value) && value >= 0 ? value : 'não informado';
  const mode = rounds.mode === 'enforce' ? 'Comparação ativa' : 'Comparação em observação';
  const integrity = rounds.unverified ? 'Memória não verificada; não comprova ausência de pendências.' : 'Resumo da comparação registrada nesta análise.';
  return `<details class="round-summary"${attrs}><summary>Rodada ${count(rounds.ordinal)} · ${count(rounds.unresolvedCount)} pendência(s) rastreada(s)</summary><p>${mode}. ${integrity}</p><ul><li>Rodadas anteriores referenciadas: ${count(rounds.parentCount)}</li><li>Apontamentos sem resposta: ${count(rounds.droppedCount)}</li><li>Novos em arquivo inalterado: ${count(rounds.lateCount)}</li><li>Resolvidos em arquivo inalterado: ${count(rounds.resolvedOnUnchangedCount)}</li></ul><p>Contexto alterado: ${rounds.changedContext ? 'sim' : 'não registrado'}. A comparação não substitui a evidência do relatório.</p><p>Identificador: <code>${esc(rounds.id || 'indisponível')}</code></p></details>`;
}
export { roundSummaryHtml };
