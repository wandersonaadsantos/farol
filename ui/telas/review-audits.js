// A pessoa inicia a leitura paga e avalia cada conclusão; a UI nunca publica review.
import { $, api } from './infra.js';
import { esc } from '../pure/comum.js';
import { auditJob, auditMetrics } from '../pure/review-audits.js';
let model = null, busy = false;
function message(text) { $('#auditMessage').textContent = text; }
async function request(action, extra = {}) {
  const result = await api('/api/review-audits', { action, ...extra });
  if (!result?.ok) { message(result?.error || 'Não foi possível concluir.'); return null; }
  return result;
}
async function load() {
  const result = await request('view'); if (!result) return;
  model = result;
  $('#auditCandidate').innerHTML = result.candidates.map((c, i) => `<option value="${i}">${esc(c.account)} · ${esc(c.key)} · ${esc(c.head.slice(0, 7))} · risco ${c.risk}</option>`).join('');
  $('#auditJobs').innerHTML = result.jobs.map(auditJob).join('') || '<p class="empty">Nenhuma auditoria registrada.</p>';
  $('#auditMetrics').innerHTML = `<details class="disc"><summary>Métricas e limites da comparação</summary><div class="disc-body"><p>${esc(auditMetrics(result.metrics))}</p></div></details>`;
  $('#auditEnabled').checked = result.policy.enabled;
  $('#auditAccounts').value = result.policy.accounts.join(', ');
  $('#auditLimit').value = result.policy.dailyLimit;
  $('#auditBudget').value = result.policy.budgetUsd;
  $('#auditReserve').value = result.policy.reserveUsd;
  message(result.admission.reason || 'Amostragem habilitada e dentro dos limites de admissão.');
}
async function mutate(action, value) {
  if (busy) return;
  busy = true;
  try { const result = await request(action, value); if (result) await load(); }
  finally { busy = false; }
}
function initReviewAudits() {
  $('#auditLoad').onclick = load;
  $('#auditStart').onclick = () => {
    const candidate = model?.candidates[Number($('#auditCandidate').value)];
    if (!candidate) { message('Carregue uma revisão elegível primeiro.'); return; }
    mutate('start', { decisionId: candidate.id, account: candidate.account, confirmed: true, retry: $('#auditRetry').checked });
  };
  $('#auditSavePolicy').onclick = () => mutate('configure', { expected: model?.policyVersion,
    policy: { enabled: $('#auditEnabled').checked, accounts: $('#auditAccounts').value.split(',').map(x => x.trim()).filter(Boolean),
      dailyLimit: Number($('#auditLimit').value), budgetUsd: Number($('#auditBudget').value), reserveUsd: Number($('#auditReserve').value) } });
  $('#auditJobs').addEventListener('click', event => {
    const button = event.target.closest('[data-audit-assess]'); if (!button || !model) return;
    const job = model.jobs.find(v => v.job.id === button.dataset.auditAssess);
    mutate('assess', { id: job.job.id, expected: job.assessments.at(-1)?.id || null, item: button.dataset.item,
      verdict: button.dataset.verdict, note: $(`#audit-note-${job.job.id}-${button.dataset.item}`).value });
  });
}
export { initReviewAudits };
