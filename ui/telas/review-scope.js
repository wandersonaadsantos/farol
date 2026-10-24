import { $, api, get, toast } from './infra.js';
import { estado } from './estado.js';

async function salvarRegraDoReview(bloco, op, render) {
  if (bloco.dataset.saving === 'true') return;
  bloco.dataset.saving = 'true';
  const status = bloco.querySelector('.scope-status');
  status.textContent = 'Salvando regra…';
  const controles = [...bloco.querySelectorAll('input, select, button')];
  for (const controle of controles) controle.disabled = true;
  const r = await api('/api/accounts/edit', { tipo: 'regra-review', ...op });
  if (!r || r.ok !== true) {
    status.textContent = r?.erro || 'Não foi possível confirmar a gravação. Recarregue as regras antes de tentar novamente.';
    for (const controle of controles) controle.disabled = false;
    delete bloco.dataset.saving;
    return;
  }
  const atual = await get('/api/state');
  if (!atual?.accounts) {
    status.textContent = 'Regra salva, mas não consegui atualizar a lista. Recarregue a tela.';
    delete bloco.dataset.saving;
    return;
  }
  estado().accounts = atual.accounts;
  const user = bloco.dataset.user;
  delete bloco.dataset.saving;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  render();
  const novo = [...$('#accountsManager').querySelectorAll('.review-scope')].find(b => b.dataset.user === user);
  if (novo) {
    novo.open = true;
    novo.querySelector('.scope-status').textContent = op.mode === 'inherit' ? 'Regra removida. A herança foi restaurada.' : 'Regra salva.';
    novo.querySelector('summary').focus();
  }
  toast('ok', op.mode === 'inherit' ? 'Regra removida; herança restaurada.' : 'Regra de review salva.');
}

export function configurarRegrasDeReview(render) {
  const box = $('#accountsManager');
  box.addEventListener('input', e => {
    const bloco = e.target.closest('.review-scope');
    if (!bloco || bloco.dataset.saving === 'true') return;
    const autor = bloco.querySelector('.scope-author').value.trim();
    bloco.querySelector('.scope-new-mode option[value="inherit"]').textContent = autor ? 'Seguir organização' : 'Seguir conta';
    bloco.querySelector('.scope-add').disabled = !bloco.querySelector('.scope-organization').value.trim() || bloco.querySelector('.scope-new-mode').value === 'inherit';
  });
  box.addEventListener('change', e => {
    if (!e.target.matches('.scope-mode')) return;
    const t = e.target;
    salvarRegraDoReview(t.closest('.review-scope'), { user: t.dataset.user, organization: t.dataset.organization, author: t.dataset.author, mode: t.value }, render);
  });
  box.addEventListener('click', e => {
    const t = e.target.closest('.scope-add, .scope-remove');
    if (!t) return;
    const bloco = t.closest('.review-scope');
    let op = { user: t.dataset.user, organization: t.dataset.organization, author: t.dataset.author, mode: 'inherit' };
    if (t.matches('.scope-add')) op = {
      user: t.dataset.user, organization: bloco.querySelector('.scope-organization').value,
      author: bloco.querySelector('.scope-author').value, mode: bloco.querySelector('.scope-new-mode').value,
    };
    salvarRegraDoReview(bloco, op, render);
  });
}
