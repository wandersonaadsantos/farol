/* Farol · UI: gerenciador de contas do GitHub (Sistema). */

import { esc, accountSaveArray, accountsManagerHtml } from '../pure.js';
import { estado, escopo, definirEscopo } from './estado.js';
import { $, api, toast, confirmModal } from './infra.js';
import { ACCT, rebuildAccounts, renderAccountBar, renderIdentity } from './contas.js';

/* ---------- gerenciador/editor de contas (Sistema) ---------- */
function editAccount(user, patch) {
  const list = (estado().accounts || []).map(a => a.user === user ? { ...a, ...patch } : a);
  estado().accounts = list; rebuildAccounts();
  renderAccountsManager(); renderAccountBar(); renderIdentity();
  api('/api/settings', { accounts: accountSaveArray(list) });
}
function removeAccount(user) {
  const list = (estado().accounts || []).filter(a => a.user !== user);
  estado().accounts = list; rebuildAccounts();
  renderAccountsManager(); renderAccountBar(); renderIdentity();
  api('/api/settings', { accounts: accountSaveArray(list) });
}
function addAccount(user, owners, label) {
  const list = [...(estado().accounts || []), { user, owners, label: label || user, color: '', kind: '', muted: false, tokenOk: false, primary: false }];
  estado().accounts = list; rebuildAccounts();
  renderAccountsManager(); renderAccountBar();
  api('/api/settings', { accounts: accountSaveArray(list) });
}
export function renderAccountsManager() {
  const box = $('#accountsManager'); if (!box) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  box.innerHTML = accountsManagerHtml({ accounts: estado().accounts, config: estado().config, acct: ACCT, doctor: estado().doctor, usage: estado().usage });
}

/* editor de contas: mudar cor / rótulo / tipo / orgs */
$('#accountsManager').addEventListener('change', (e) => {
  const t = e.target, user = t.dataset && t.dataset.user;
  if (!user) return;
  if (t.classList.contains('acct-color')) return editAccount(user, { color: t.value });
  if (t.classList.contains('acct-label')) return editAccount(user, { label: (t.value || '').trim() || user });
  if (t.classList.contains('acct-kind')) return editAccount(user, { kind: (t.value || '').trim() });
  if (t.classList.contains('acct-owners')) return editAccount(user, { owners: (t.value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) });
  // política de automação por conta ('' = herda o global)
  if (t.classList.contains('acct-autoreview')) return editAccount(user, { autoReview: t.value === '' ? undefined : t.value === 'on' });
  if (t.classList.contains('acct-onclean')) return editAccount(user, { onClean: t.value || undefined });
  if (t.classList.contains('acct-oncaveats')) return editAccount(user, { onCaveats: t.value || undefined });
  if (t.classList.contains('acct-onreject')) return editAccount(user, { onReject: t.value === 'request_changes' ? 'request_changes' : undefined });
  if (t.classList.contains('acct-claudeprofile')) return editAccount(user, { claudeProfileId: t.value || undefined });
  // peso na cota do perfil (Politica 2): vazio = igual as outras, que e o padrao e
  // nao guarda campo nenhum (accountSaveArray so persiste peso positivo).
  if (t.classList.contains('acct-budgetweight')) return editAccount(user, { budgetWeight: Number(t.value) || undefined });
});
/* editor de contas: silenciar/reativar, remover, adicionar */
$('#accountsManager').addEventListener('click', (e) => {
  const mute = e.target.closest('.act-mute');
  if (mute) {
    const user = mute.dataset.user;
    const a = (estado().accounts || []).find(x => x.user === user);
    const willMute = !(a && a.muted);
    if (willMute && String(escopo()).toLowerCase() === user.toLowerCase()) { definirEscopo('all'); localStorage.setItem('farol-scope', 'all'); }
    editAccount(user, { muted: willMute });
    return;
  }
  const rem = e.target.closest('.acct-remove');
  if (rem) {
    const user = rem.dataset.user;
    if ((estado().accounts || []).length <= 1) { toast('error', 'Precisa de ao menos uma conta configurada.'); return; }
    const a = (estado().accounts || []).find(x => x.user === user) || {};
    const orgs = (a.owners || []).length ? ` (orgs: ${esc(a.owners.join(', '))})` : '';
    confirmModal({
      title: `Remover a conta @${user} do Farol?`,
      danger: true, confirmLabel: 'Remover conta', cancelLabel: 'Manter',
      body: `<p>Isso mexe <b>só aqui no Farol</b>, não toca no seu GitHub nem apaga nada lá.</p>
        <p><b>O que muda:</b></p>
        <ul>
          <li>O Farol <b>para de monitorar</b> os PRs, a fila e os avisos dessa conta${orgs}.</li>
          <li>Some a <b>identidade</b> dela do painel: rótulo, cor e tipo que você configurou.</li>
          ${a.primary ? '<li>Ela é a conta <b>primária</b> hoje; a próxima da lista assume como primária.</li>' : ''}
          <li>A <b>memória de reviews</b> (Destaques e Time) e o histórico <b>não são apagados</b>.</li>
        </ul>
        <p>Dá pra <b>adicionar de volta</b> a qualquer momento (o rótulo, a cor e o tipo você reconfigura).</p>`
    }).then(ok => {
      if (!ok) return;
      if (String(escopo()).toLowerCase() === user.toLowerCase()) { definirEscopo('all'); localStorage.setItem('farol-scope', 'all'); }
      removeAccount(user);
      toast('info', `Conta @${user} removida do Farol.`, 3000);
    });
    return;
  }
  if (e.target.closest('#btnAcctAdd')) {
    const u = ($('#acctAddUser').value || '').trim().replace(/^@/, '');
    const owners = ($('#acctAddOwners').value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    const label = ($('#acctAddLabel').value || '').trim();
    if (!u) { toast('error', 'Informe o login da conta.'); return; }
    if ((estado().accounts || []).some(a => a.user.toLowerCase() === u.toLowerCase())) { toast('error', 'Essa conta já está na lista.'); return; }
    addAccount(u, owners, label);
    toast('ok', `Conta @${u} adicionada. Se ainda não estiver logada, rode gh auth login.`, 5000);
    return;
  }
});
