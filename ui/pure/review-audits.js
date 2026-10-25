import { esc } from './comum.js';
const KINDS = { confirmed: 'Confirmado pelo auditor', incorrect: 'Possível falso positivo', omitted: 'Possível omissão', inconclusive: 'Inconclusivo' };
function auditCost(cost) {
  if (cost.usd === null) return 'Custo indisponível';
  return `US$ ${cost.usd.toFixed(4)} · ${cost.source === 'measured' ? 'medido' : 'estimado'}`;
}
function auditItem(value, item) {
  const human = value.assessments.filter(a => a.item === item.id).at(-1);
  const noteId = `audit-note-${value.job.id}-${item.id}`;
  return `<article class="audit-item"><div class="irow-head"><span class="chip">${esc(KINDS[item.kind])}</span><h4>${esc(item.title)}</h4></div><p class="irow-sub">${esc(item.explanation)}</p>
    <details class="disc"><summary>Evidências e referências</summary><div class="disc-body"><p>Referência original: ${esc(item.ref || 'nova')} · Leitura independente: ${esc(item.blindRef || 'sem correspondência')}</p><div class="src-preview">
    ${item.evidence.map(e => `<div class="src-snip"><div class="src-snip-head">${esc(e.path)} · ${esc(e.side)}:${e.start}–${e.end}</div><pre>${esc(e.quote)}</pre></div>`).join('')}</div></div></details>
    <div class="eval"><p class="set-desc">Avaliação humana atual: ${esc(human?.verdict || 'não avaliado')}${human ? ` · ${esc(human.note)}` : ''}</p>
    <label class="set-title" for="${noteId}">Justificativa da sua avaliação ou contestação</label><textarea id="${noteId}" maxlength="2000" rows="2"></textarea>
    <div class="set-actions">${[['agree', 'Concordo'], ['disagree', 'Discordo'], ['inconclusive', 'Não consigo concluir']].map(([v, label]) => `<button type="button" class="btn sm" data-audit-assess="${esc(value.job.id)}" data-item="${esc(item.id)}" data-verdict="${v}">${label}</button>`).join(' ')}</div></div></article>`;
}
function auditJob(value) {
  const { job, result, status, cost } = value;
  const labels = { queued: 'Na fila', running: 'Executando', completed: 'Concluída', failed: 'Falhou', inconclusive: 'Inconclusiva' };
  const state = { queued: 'info', running: 'info', completed: 'ok', failed: 'bad', inconclusive: 'warn' }[status] || 'off';
  return `<details class="disc audit-job"><summary><span>${esc(job.target.key)}</span><span class="chip ${state}">${esc(labels[status] || status)}</span><span class="chip off">${esc(auditCost(cost))}</span></summary><div class="disc-body">
    <details class="disc"><summary>Detalhes técnicos · ${esc(job.target.head.slice(0, 7))}</summary><div class="disc-body"><p>Conta: ${esc(job.target.account)} · ${esc(job.mode)} · auditoria ${esc(job.id)}</p>
    <p>Head: ${esc(job.target.head)} · Base: ${esc(job.target.base)} · Rodada: ${esc(job.target.roundId)}</p>
    <p>Impressão do retrato: ${esc(result?.snapshot || 'ainda não disponível')}. Duas sessões novas; mesma família de provedor pode compartilhar erros.</p></div></details>
    <div class="audit-items">${(result?.report?.items || []).map(item => auditItem(value, item)).join('')}</div>
    <p>${esc(result?.reason || '')}</p>${(result?.report?.limitations || []).map(l => `<p>Limitação: ${esc(l)}</p>`).join('')}</div></details>`;
}
function auditMetrics(m) {
  const agreement = m.agreement === null ? 'sem comparação humana' : `${(m.agreement * 100).toFixed(1)}% nos ${m.humanCompared} itens avaliados`;
  const perError = m.costPerConfirmedError === null ? 'indisponível' : `US$ ${m.costPerConfirmedError.toFixed(4)}`;
  return `Concordância: ${agreement}. Discordâncias: ${m.disagree}. Inconclusivos humanos: ${m.inconclusive}. Erros confirmados por pessoa: ${m.confirmedErrors}. Custo por erro: ${perError}. Auditorias com custo estimado: ${m.costEstimated}. Custos indisponíveis: ${m.costUnavailable}. Isso não mede a precisão de todos os reviews.`;
}
export { auditJob, auditMetrics, auditCost };
