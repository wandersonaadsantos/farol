/* Farol · UI: gerenciador de contas do GitHub, perfis de assinatura Claude e o editor
   de orçamento de cada perfil (Sistema). As três seções moram juntas porque compartilham
   o mesmo formulário-tabela editável in loco (guarda de foco, PATCH /api/settings otimista,
   toast de confirmação) e o orçamento é sub-seção do perfil, não assunto à parte. */

import { esc, accountSaveArray, accountsManagerHtml, claudeProfilesHtml, genId } from '../pure.js';
import { estado, escopo, definirEscopo, ehWin } from './estado.js';
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

// Gerenciador de perfis de assinatura Claude (Sistema): cada perfil é {id,label,dir}
// (login por assinatura) ou {id,label,kind:'apikey',apiKey,baseUrl} (chave de API).
// Perfil padrão global + perfis salvos, cada um com o e-mail logado (badge, via doctor).

function saveClaudeProfiles(profiles, defaultId) {
  estado().config.claudeProfiles = profiles;
  const patch = { claudeProfiles: profiles };
  // defaultId opcional: usado pela migração (btnClaudeMigrate), que precisa setar o
  // perfil recém-criado como o padrão global no MESMO patch (senão o perfil migrado
  // fica sem dono, ver achado da revisão final sobre legado invisível).
  if (defaultId !== undefined) { estado().config.claudeProfileId = defaultId; patch.claudeProfileId = defaultId; }
  api('/api/settings', patch).then(r => {
    if (r?.ok) toast('ok', '✓ Configurações salvas', 2000);
    else toast('error', 'Erro ao salvar configurações');
  });
}

export function renderClaudeProfiles() {
  const box = $('#claudeProfilesManager'); if (!box) return;
  // guarda de foco: não reconstrói enquanto você digita num campo deste bloco
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  box.innerHTML = claudeProfilesHtml({ config: estado().config, usage: estado().usage, doctor: estado().doctor, ehWin: ehWin() });
  // efeito de DOM, não de markup: o listener do seletor mostra de volta no modo Chave de API
  const hint = $('#cpAddHint'); if (hint) hint.hidden = true;
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

/* editor de perfis de assinatura Claude: adicionar / remover / editar / migrar / padrão global */
/* ---------- cliques do editor de orçamento ----------
   Separado do handler grande de cliques do gerenciador porque são cinco botões de
   um mesmo assunto; devolve true quando tratou, pra o handler original sair cedo. */

// escreve o mesmo valor num conjunto de dias da semana (atalho "dias úteis" e "fim
// de semana"). Sem valor base preenchido não faz nada e explica: copiar `undefined`
// pros sete dias apagaria a configuração em silêncio.
function espalhaTeto(id, dows) {
  const campo = document.querySelector(`.cp-budget-daily[data-id="${CSS.escape(id)}"]`);
  const v = (campo && campo.value.trim()) || '';
  if (v === '') { toast('info', 'Preencha o teto por dia antes de copiar pros dias.', 3500); return; }
  saveClaudeProfiles(mapProfile(id, p => {
    const porDia = { ...(p.budgetByWeekday || {}) };
    for (const d of dows) porDia[d] = Number(v);
    return { ...p, budgetByWeekday: porDia };
  }));
}

function adicionaDataDeTeto(id) {
  const dia = document.querySelector(`.cp-budget-date-new[data-id="${CSS.escape(id)}"]`);
  const val = document.querySelector(`.cp-budget-date-val[data-id="${CSS.escape(id)}"]`);
  const d = (dia && dia.value) || '';
  const v = (val && val.value.trim()) || '';
  if (!d || v === '') { toast('info', 'Escolha a data e o valor do teto desse dia.', 3500); return; }
  saveClaudeProfiles(mapProfile(id, p => ({ ...p, budgetDates: { ...(p.budgetDates || {}), [d]: Number(v) } })));
}

function removeDataDeTeto(id, dia) {
  saveClaudeProfiles(mapProfile(id, p => {
    const datas = { ...(p.budgetDates || {}) };
    delete datas[dia];
    return { ...p, budgetDates: datas };
  }));
}

// vazio APAGA a chave (o dia volta ao teto base), nunca grava 0: 0 é um teto
// válido que bloquearia o dia inteiro, e seria o oposto do que "limpar" quer dizer
function salvaTetoDoDia(id, dow, valor) {
  return saveClaudeProfiles(mapProfile(id, p => {
    const porDia = { ...(p.budgetByWeekday || {}) };
    if (valor === '') delete porDia[dow]; else porDia[dow] = Number(valor);
    return { ...p, budgetByWeekday: porDia };
  }));
}

function tratouOrcamento(t) {
  const id = t.dataset && t.dataset.id;
  if (!id) return false;
  // a sugestão só PREENCHE o campo; quem salva é o change do próprio input, e é
  // por isso que ela nunca passa a bloquear sozinha (decisão de 20/08/2026)
  if (t.classList.contains('cp-usar-sugerido')) {
    const campo = document.querySelector(`.cp-budget-daily[data-id="${CSS.escape(id)}"]`);
    if (campo) { campo.value = t.dataset.valor; campo.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  if (t.classList.contains('cp-budget-uteis')) { espalhaTeto(id, ['1', '2', '3', '4', '5']); return true; }
  if (t.classList.contains('cp-budget-fds')) { espalhaTeto(id, ['0', '6']); return true; }
  if (t.classList.contains('cp-budget-limpa-dow')) {
    saveClaudeProfiles(mapProfile(id, p => ({ ...p, budgetByWeekday: {} })));
    return true;
  }
  if (t.classList.contains('cp-budget-date-add')) { adicionaDataDeTeto(id); return true; }
  if (t.classList.contains('cp-budget-date-del')) { removeDataDeTeto(id, t.dataset.dia); return true; }
  return false;
}

$('#claudeProfilesManager').addEventListener('click', (e) => {
  const t = e.target;
  if (tratouOrcamento(t)) return;
  // seletor "Login por assinatura" / "Chave de API" no form de adicionar: troca os
  // campos visíveis, sem tocar em nenhum perfil já salvo.
  const seg = t.closest('#cpAddKind .seg-btn');
  if (seg) {
    $('#cpAddKind').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === seg));
    const isApiKey = seg.dataset.kind === 'apikey';
    const isOpenRouter = seg.dataset.kind === 'openrouter';
    const isCodex = seg.dataset.kind === 'codex';
    const usaChave = isApiKey || isOpenRouter;
    $('#cpAddDir').hidden = usaChave || isCodex;
    $('#cpAddApiKey').hidden = !usaChave;
    $('#cpAddBaseUrl').hidden = !usaChave;
    $('#cpAddHint').hidden = !isApiKey;
    const orHint = $('#cpAddOpenRouterHint');
    if (orHint) orHint.hidden = !isOpenRouter;
    $('#cpAddCodexHint').hidden = !isCodex;
    if (isOpenRouter) {
      $('#cpAddApiKey').placeholder = 'chave OpenRouter (sk-or-...)';
      $('#cpAddBaseUrl').placeholder = 'https://openrouter.ai/api';
      $('#cpAddBaseUrl').value = $('#cpAddBaseUrl').value || 'https://openrouter.ai/api';
    } else if (isApiKey) {
      $('#cpAddApiKey').placeholder = 'chave de API';
      $('#cpAddBaseUrl').placeholder = 'URL base (opcional)';
    }
    return;
  }
  // mostrar/ocultar a chave de um perfil já salvo (não é validação nem salvamento, só
  // alterna o type do input entre password e text).
  if (t.classList.contains('cp-toggle-key')) {
    const input = e.currentTarget.querySelector(`.cp-apikey[data-id="${CSS.escape(t.dataset.id)}"]`);
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
    return;
  }
  if (t.id === 'btnCpAdd') {
    const label = ($('#cpAddLabel').value || '').trim();
    const kindBtn = $('#cpAddKind .seg-btn.active');
    const isApiKey = kindBtn && kindBtn.dataset.kind === 'apikey';
    const isOpenRouter = kindBtn && kindBtn.dataset.kind === 'openrouter';
    const isCodex = kindBtn && kindBtn.dataset.kind === 'codex';
    if (isCodex) {
      if (!label) return toast('error', 'Preencha o nome do perfil.', 3000);
      const profiles = [...(estado().config.claudeProfiles || []), { id: genId(), label, kind: 'codex' }];
      $('#cpAddLabel').value = '';
      saveClaudeProfiles(profiles);
      return;
    }
    if (isApiKey || isOpenRouter) {
      const apiKey = ($('#cpAddApiKey').value || '').trim();
      const baseUrl = ($('#cpAddBaseUrl').value || '').trim();
      if (!label || !apiKey) return toast('error', 'Preencha nome e chave.', 3000);
      if (/["\r\n]/.test(apiKey.replace(/^"(.*)"$/s, '$1').trim()) || /["\r\n]/.test(baseUrl.replace(/^"(.*)"$/s, '$1').trim())) {
        return toast('error', 'Chave ou URL base com aspas ou quebra de linha no meio (não em volta) não pode ser usada.', 4500);
      }
      const kind = isOpenRouter ? 'openrouter' : 'apikey';
      const profiles = [...(estado().config.claudeProfiles || []), { id: genId(), label, kind, apiKey, baseUrl }];
      $('#cpAddLabel').value = ''; $('#cpAddApiKey').value = ''; $('#cpAddBaseUrl').value = '';
      saveClaudeProfiles(profiles);
      return;
    }
    const dir = ($('#cpAddDir').value || '').trim();
    if (!label || !dir) return toast('error', 'Preencha nome e diretório do perfil.', 3000);
    if (/["\r\n]/.test(dir.replace(/^"(.*)"$/s, '$1').trim())) {
      return toast('error', 'Esse caminho tem aspas ou quebra de linha no meio (não em volta), não pode ser usado. Confira se colou o caminho certo.', 4500);
    }
    const profiles = [...(estado().config.claudeProfiles || []), { id: genId(), label, dir }];
    $('#cpAddLabel').value = ''; $('#cpAddDir').value = '';
    saveClaudeProfiles(profiles);
    return;
  }
  if (t.classList.contains('cp-remove')) {
    const id = t.dataset.id;
    const profiles = (estado().config.claudeProfiles || []).filter(p => p.id !== id);
    // combina TUDO num único PATCH (claudeProfiles + claudeProfileId + accounts), em vez de
    // N requests separados: com 2+ contas referenciando o perfil removido, PATCHes
    // concorrentes e fire-and-forget não garantiam ordem de chegada no servidor, e o último
    // a processar sobrescrevia o array accounts inteiro, podendo restaurar a referência
    // órfã que os PATCHes anteriores já tinham limpado (achado de auditoria adversarial).
    const patch = { claudeProfiles: profiles };
    estado().config.claudeProfiles = profiles;
    if (estado().config.claudeProfileId === id) {
      estado().config.claudeProfileId = '';
      patch.claudeProfileId = '';
    }
    const accounts = (estado().accounts || []);
    const affected = accounts.some(a => a.claudeProfileId === id);
    if (affected) {
      const updated = accounts.map(a => a.claudeProfileId === id ? { ...a, claudeProfileId: undefined } : a);
      estado().accounts = updated; rebuildAccounts();
      patch.accounts = accountSaveArray(updated);
    }
    renderClaudeProfiles(); renderAccountsManager();
    api('/api/settings', patch);
    return;
  }
  if (t.classList.contains('cp-login')) {
    const id = t.dataset.id || '';
    api('/api/claude-login', { profileId: id });
    toast('ok', 'Abrindo sessão de terminal pra login. Rode /login lá, se pedir, e pode fechar quando terminar.', 4500);
    return;
  }
  if (t.id === 'btnClaudeMigrate') {
    const label = ($('#claudeMigrateLabel').value || '').trim() || 'Perfil atual';
    const newId = genId();
    const profiles = [{ id: newId, label, dir: estado().config.claudeConfigDir }];
    // o perfil migrado precisa virar o padrão global na hora: senão ele fica "novo" mas
    // sem dono, e o legado (claudeConfigDir) continua vencendo por baixo dos panos, sem
    // jeito de editar ou desativar (achado da revisão final).
    saveClaudeProfiles(profiles, newId);
    return;
  }
});
// aplica uma transformação num perfil e devolve a lista inteira, que é o que o
// PATCH /api/settings espera (claudeProfiles é substituído por completo). Existe
// pra os handlers de orçamento não repetirem o mesmo .map cinco vezes.
function mapProfile(id, fn) {
  return (estado().config.claudeProfiles || []).map(p => (p.id === id ? fn(p) : p));
}

$('#claudeProfilesManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'claudeProfileDefault') {
    estado().config.claudeProfileId = t.value;
    const patch = api('/api/settings', { claudeProfileId: t.value });
    // tira o foco do select: renderClaudeProfiles() tem uma guarda que pula o re-render
    // enquanto INPUT/SELECT do gerenciador estiver focado (pra não atrapalhar quem está
    // digitando), e trocar de opção não tira o foco sozinho. Sem o blur, o botão "Abrir
    // sessão de login" ficava com o data-id do perfil ANTERIOR até o próximo re-render
    // manual (achado de bug real). O blur libera o próximo re-render legítimo (o push de
    // 'settings' via SSE que já acontece depois de qualquer PATCH em /api/settings).
    t.blur();
    return patch;
  }
  // teto por dia da semana: mesmo caminho dos outros campos, só que o valor mora
  // num mapa em vez de num campo solto. Vazio APAGA a chave (o dia volta ao teto
  // base), nunca grava 0, porque 0 é um teto válido que bloquearia o dia inteiro.
  if (t.classList.contains('cp-budget-dow')) return salvaTetoDoDia(t.dataset.id, t.dataset.dow, t.value.trim());
  const camposEditaveis = ['cp-label', 'cp-dir', 'cp-apikey', 'cp-baseurl', 'cp-budget-daily', 'cp-budget-total', 'cp-budget-since'];
  if (camposEditaveis.some(cls => t.classList.contains(cls))) {
    const id = t.dataset.id;
    if ((t.classList.contains('cp-dir') || t.classList.contains('cp-apikey') || t.classList.contains('cp-baseurl'))
        && /["\r\n]/.test(t.value.replace(/^"(.*)"$/s, '$1').trim())) {
      toast('error', 'Esse valor tem aspas ou quebra de linha no meio, não pode ser usado.', 4500);
      return;
    }
    const profiles = (estado().config.claudeProfiles || []).map(p => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (t.classList.contains('cp-label')) next.label = t.value.trim() || p.label;
      if (t.classList.contains('cp-dir')) next.dir = t.value.trim();
      if (t.classList.contains('cp-apikey')) next.apiKey = t.value.trim();
      if (t.classList.contains('cp-baseurl')) next.baseUrl = t.value.trim();
      if (t.classList.contains('cp-budget-daily')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetDaily; else next.budgetDaily = Number(v);
      }
      if (t.classList.contains('cp-budget-total')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetTotal; else next.budgetTotal = Number(v);
      }
      if (t.classList.contains('cp-budget-since')) {
        const v = t.value.trim();
        if (v === '') delete next.budgetSince; else next.budgetSince = v;
      }
      return next;
    });
    saveClaudeProfiles(profiles);
  }
});
