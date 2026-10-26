import { $, api, confirmModal } from './infra.js';
import { esc } from '../pure/comum.js';
let current = null, busy = false;
function message(text) { $('#reviewLabelsMessage').textContent = text; }
function render() {
  $('#reviewLabelsList').innerHTML = (current?.labels || []).map(label => `<div class="set-row"><span class="set-title">${esc(label)}</span><button type="button" class="btn sm" data-remove-review-label="${esc(label)}">Remover tag</button></div>`).join('');
}
async function request(action, label) {
  const url = current?.url || $('#reviewLabelsUrl').value.trim();
  const result = await api('/api/review-labels', { action, url, label });
  if (!result?.ok) { message(result?.error || 'Não foi possível concluir a operação. Tente novamente.'); return; }
  current = { ...result, url }; render();
  const prefix = action === 'remove' ? 'Tag removida deste PR. ' : '';
  message(prefix + `${result.key} · conta ${result.account}. ` + (result.labels.length ? 'Escolha a tag que deseja remover.' : 'Nenhuma tag de revisão encontrada.'));
}
async function act(operation) {
  if (busy) return;
  busy = true; $('#reviewLabels').setAttribute('aria-busy', 'true');
  for (const el of $('#reviewLabels').querySelectorAll('button, input')) el.disabled = true;
  try { await operation(); }
  catch { message('Não foi possível concluir a operação. Consulte as tags novamente.'); }
  finally {
    busy = false; $('#reviewLabels').setAttribute('aria-busy', 'false');
    for (const el of $('#reviewLabels').querySelectorAll('button, input')) el.disabled = false;
  }
}
function initReviewLabels() {
  $('#reviewLabelsUrl').oninput = () => { current = null; render(); message('Consulte o PR antes de remover uma tag.'); };
  $('#reviewLabelsInspect').onclick = () => act(() => request('list'));
  $('#reviewLabelsList').onclick = e => {
    const button = e.target.closest('[data-remove-review-label]');
    if (!button || !current) return;
    return act(async () => {
      const label = button.dataset.removeReviewLabel;
      const confirmed = await confirmModal({ title: 'Remover tag de revisão?', body: `<p>Remover <b>${esc(label)}</b> de <b>${esc(current.key)}</b> usando a conta <b>${esc(current.account)}</b>?</p><p>A remoção não cancela a revisão em andamento. Uma nova revisão ou outro aparelho pode adicionar a tag novamente.</p>`, confirmLabel: 'Remover tag' });
      if (confirmed) await request('remove', label);
    });
  };
}
export { initReviewLabels };
