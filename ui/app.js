/* Farol · UI: consome o engine local via SSE + fetch. Sem frameworks. */

import {
  esc, safeJsonParse, fmtClock, sysNorm, canonicalGithubPrUrl, prKeyFromUrl, repoShort,
  sameSet, accountSaveArray,
  feedLine, selfSessionKey,
  sessionProgress, personMention, parseGoto, reviewBoxHtml,
  operationChecks, runtimeChecks,
  creditsHtml,
  escAttrSelector, defaultFor,
  overrideFor, suggestDefault, renderOrgBlock,
  reasonText, claudeProfilesHtml, accountsManagerHtml,
  jiraBaseUrlProblema, jiraPrefixosProblema,
  syncSecaoHtml, syncCfgComGeral
} from './pure.js';
import { registrarTela, telasRegistradas, telaPorId } from './telas/registro.js';
import {
  estado, escopo, abaAtual, definirEstado, definirEscopo, definirAba,
  teamHighlightsEnabled, deliveriesEnabled,
} from './telas/estado.js';
import {
  $, api, get, toast, toastRich, confirmModal, showOp, updateOp, closeOp, ACTIVE_OPS,
  syncAnalysisOps, copyToClipboard,
  origemLocal, marcarSeg, sysFlash,
} from './telas/infra.js';
export { toast } from './telas/infra.js';
import {
  TWEAK, ACCT, OWNER2USER, rebuildAccounts, multiAccount,
  scopeVisible, renderAccountBar, renderIdentity, renderSilenced,
  fecharSilenciadas, alternarSilenciadas,
} from './telas/contas.js';
import { gotoDeliv } from './telas/entregas.js';
import { loadHighlights, loadTeam } from './telas/time.js';
import { renderTools, loadLog, ping, notifyNewPRs, kudosScopeKey } from './telas/ferramentas.js';
import { revisarUrls, registrarTelaConsumo, renderUsage } from './telas/consumo.js';
import { renderStatus, tickCountdown, updateStageFlow, updateSessionBar, renderActive } from './telas/sessoes.js';
import { openChat, renderChat, chatKeyAtual } from './telas/chat.js';
import {
  renderDecisions, submitPushback, renderQueue, renderPanorama, renderRadarNav,
} from './telas/radar.js';
import { renderMyPRs } from './telas/meus-prs.js';

const isElectron = navigator.userAgent.includes('Electron');
if (isElectron) document.body.classList.add('electron');

/* Plataforma: a FONTE DE VERDADE é o engine (snapshot.app.platform = process.platform).
   O userAgent aqui é só o palpite do PRIMEIRO PAINT, antes do primeiro estado chegar pelo
   SSE: sem ele o padding do semáforo do macOS piscaria. aplicaPlataforma reconcilia assim
   que o estado chega, e é ela que manda daí em diante.
   Antes eram duas fontes de verdade no mesmo arquivo (userAgent no cromo, app.platform no
   doctor), que divergem de verdade ao abrir a UI de um Mac contra um engine Windows.
   ehMac/ehWin são FUNÇÕES de propósito: uma referência esquecida a `isMac` vira
   ReferenceError alto, em vez de um `if (isMac)` sempre verdadeiro falhando calado. */
let PLATAFORMA = /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'darwin' : 'win32';
const ehMac = () => PLATAFORMA === 'darwin';
const ehWin = () => PLATAFORMA === 'win32';
function aplicaPlataforma(p) {
  if (p) PLATAFORMA = p;
  document.body.classList.toggle('mac', ehMac());
  // o botão da paleta é estático no HTML e misturava as duas convenções (⌘K com
  // tooltip Ctrl+K); aqui ele fica coerente com o SO real do engine
  const cmdBtn = document.getElementById('btnCmdK');
  if (cmdBtn) {
    cmdBtn.textContent = ehMac() ? '⌘K' : 'Ctrl+K';
    cmdBtn.title = `Paleta de comandos (${ehMac() ? 'Cmd' : 'Ctrl'}+K)`;
  }
}
aplicaPlataforma();

let logTimer = null;

/* ---------- camada de contas (separação por identidade) ---------- */
definirEscopo(localStorage.getItem('farol-scope') || 'all');   // 'all' ou o login de uma conta
// espelha a aba no <body> pro CSS ajustar a largura útil (a aba Sistema tem sidebar e
// precisa de mais). switchTab não roda no boot, então a aba inicial é marcada aqui.
document.body.dataset.tab = abaAtual();
function syncOptionalTabsVisibility() {
  const features = [
    { tab: 'destaques', enabled: teamHighlightsEnabled() },
    { tab: 'entregas', enabled: deliveriesEnabled() },
  ];
  for (const feature of features) {
    $(`#tabbtn-${feature.tab}`).hidden = !feature.enabled;
    $(`#tab-${feature.tab}`).hidden = !feature.enabled;
    if (!feature.enabled && abaAtual() === feature.tab) switchTab('radar');
  }
}

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
function renderAccountsManager() {
  const box = $('#accountsManager'); if (!box) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  box.innerHTML = accountsManagerHtml({ accounts: estado().accounts, config: estado().config, acct: ACCT, doctor: estado().doctor, usage: estado().usage });
}

// Gerenciador de perfis de assinatura Claude (Sistema): cada perfil é {id,label,dir}
// (login por assinatura) ou {id,label,kind:'apikey',apiKey,baseUrl} (chave de API).
// Perfil padrão global + perfis salvos, cada um com o e-mail logado (badge, via doctor).

function genProfileId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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

function renderClaudeProfiles() {
  const box = $('#claudeProfilesManager'); if (!box) return;
  // guarda de foco: não reconstrói enquanto você digita num campo deste bloco
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  box.innerHTML = claudeProfilesHtml({ config: estado().config, usage: estado().usage, doctor: estado().doctor, ehWin: ehWin() });
  // efeito de DOM, não de markup: o listener do seletor mostra de volta no modo Chave de API
  const hint = $('#cpAddHint'); if (hint) hint.hidden = true;
}

// re-render das seções sensíveis ao escopo (sem esperar novo state do engine). Morava em
// telas/contas.js recebendo nove funções por parâmetro (a costura da Task 6, criada
// enquanto elas ainda viviam no app.js). Com o Radar e Meus PRs virando módulo na Task
// 8, quase todas essas nove viraram import de mão única, e deixar rerenderScope na
// camada de identidade faria contas.js importar as telas que a importam de volta: o
// ciclo que a Fase 1b existe para evitar. Por isso ela veio pra cá: o bootstrap pode
// conhecer todas as telas, a camada de identidade não pode.
function rerenderScope() {
  if (!estado()) return;
  renderAccountBar(); renderIdentity();
  renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
  renderRadarNav();
  if ($('#tab-destaques').classList.contains('active')) { loadHighlights(); renderTools(); }
  if ($('#tab-time').classList.contains('active')) loadTeam();
}

$('#btnCmdK').addEventListener('click', () => cmdOpen());

/* trocar de conta na barra */
$('#accountBar').addEventListener('click', (e) => {
  const seg = e.target.closest('.acct-seg');
  if (!seg) return;
  definirEscopo(seg.dataset.scope);
  localStorage.setItem('farol-scope', escopo());
  fecharSilenciadas();
  rerenderScope();
});
/* abrir/fechar o resumo de silenciadas */
$('#silenced').addEventListener('click', (e) => {
  if (e.target.closest('.sil-toggle')) { alternarSilenciadas(); renderSilenced(); }
});
/* marcar o perfil de review de uma pessoa (papel e domínios): molda o tom e a
   postura da revisão automática. Global (delegado no documento) pra funcionar na
   aba Time E nos cards do PR (fila, Precisa de você), inclusive pra marcar o 1º
   PR de quem ainda não está no time. */
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.classList) return;
  const isPapel = t.classList.contains('papel-level');
  const isDom = t.classList.contains('dom-level');
  if (!isPapel && !isDom) return;
  const login = String(t.dataset.login || '').toLowerCase();
  if (!login) return;
  const people = { ...((estado().config && estado().config.people) || {}) };
  const person = { ...(people[login] || {}) };
  if (isPapel) {
    if (t.value) person.papel = t.value; else delete person.papel;
  } else {
    const dom = { ...(person.dominios || {}) };
    if (t.value) dom[t.dataset.domain] = t.value; else delete dom[t.dataset.domain];
    if (Object.keys(dom).length) person.dominios = dom; else delete person.dominios;
  }
  if (person.papel || person.dominios) people[login] = person; else delete people[login];
  if (estado().config) estado().config.people = people;   // otimista, pra o select não piscar
  api('/api/settings', { people });
});
/* registrar pushback nas linhas de Revisões recentes (desfecho + nota) */
$('#resolved').addEventListener('change', (e) => {
  if (e.target.classList && (e.target.classList.contains('pb-outcome') || e.target.classList.contains('pb-note'))) submitPushback(e.target);
});
/* confirmar o palpite re-selecionando a MESMA opção não dispara change; o botão cobre
   o caminho pending -> confirmed com o desfecho sugerido (achado M21) */
$('#resolved').addEventListener('click', async (e) => {
  const btn = e.target.closest('.pb-confirm');
  if (btn) { submitPushback(btn); return; }
  // revisar de novo: mesma rota do Revisar da fila. O .act-review NÃO tem listener
  // global (o da fila é escutado dentro do #queue, o do panorama dentro do #panorama),
  // então a seção escuta o seu. O botão desabilita até o próximo estado re-renderizar.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; revisarUrls([rev.dataset.url]); return; }
  const cp = e.target.closest('.rr-copy');
  if (cp) {
    const ok = await copyToClipboard(cp.dataset.url || cp.dataset.key || '');
    toast(ok ? 'ok' : 'error', ok ? 'URL do PR copiada.' : 'Não consegui copiar (permissão do navegador).', 2500);
  }
});
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
      const profiles = [...(estado().config.claudeProfiles || []), { id: genProfileId(), label, kind: 'codex' }];
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
      const profiles = [...(estado().config.claudeProfiles || []), { id: genProfileId(), label, kind, apiKey, baseUrl }];
      $('#cpAddLabel').value = ''; $('#cpAddApiKey').value = ''; $('#cpAddBaseUrl').value = '';
      saveClaudeProfiles(profiles);
      return;
    }
    const dir = ($('#cpAddDir').value || '').trim();
    if (!label || !dir) return toast('error', 'Preencha nome e diretório do perfil.', 3000);
    if (/["\r\n]/.test(dir.replace(/^"(.*)"$/s, '$1').trim())) {
      return toast('error', 'Esse caminho tem aspas ou quebra de linha no meio (não em volta), não pode ser usado. Confira se colou o caminho certo.', 4500);
    }
    const profiles = [...(estado().config.claudeProfiles || []), { id: genProfileId(), label, dir }];
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
    const newId = genProfileId();
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

/* ---------- sites do Jira e credencial (Sistema > Conexões) ----------
   Espelha o gerenciador de perfis do Claude logo acima: estado().jiraSites (a lista
   MASCARADA que o snapshot manda, com hasCredential) é a fonte de leitura E de
   edição; salvar manda ela de volta em PATCH /api/settings, e o servidor descarta
   o campo hasCredential ao sanear (parseJiraSites só lê os campos que conhece).
   O id nasce aqui com genProfileId(), nunca digitado: mantém o formato que a
   allowlist do servidor exige e evita a tela oferecer um campo de id livre.
   A credencial (e-mail e token) NUNCA entra em estado: os dois campos são lidos
   direto do DOM na hora do clique e a chamada zera o formulário depois. */
const jiraLista = (v) => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
/* Recusa ANTES de mandar: o servidor não corrige nem devolve erro por campo (ver
   jiraBaseUrlProblema em pure.js). Na edição in loco o campo recusado volta ao
   valor salvo, senão a tela mostraria um texto que o site já não tem. */
function jiraEdicaoProblema(t) {
  if (t.classList.contains('js-baseurl')) return jiraBaseUrlProblema(t.value);
  if (t.classList.contains('js-projectkeys')) return jiraPrefixosProblema(jiraLista(t.value));
  return '';
}
function jiraCampoSalvo(site, t) {
  if (t.classList.contains('js-baseurl')) return site.baseUrl;
  return (site.projectKeys || []).join(', ');
}
function saveJiraSites(sites) {
  estado().jiraSites = sites;
  renderJiraSites();
  api('/api/settings', { jiraSites: sites }).then(r => {
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes('jiraSites')) {
      toast('error', '"jiraSites" não foi salvo: o servidor não reconhece essa preferência.', 6000);
      return;
    }
    toast('ok', '✓ Configurações salvas', 2000);
  });
}
function jiraSelo(s) {
  if (s.hasCredential) {
    return '<span class="jira-chip"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg>credencial cadastrada</span>';
  }
  return '<span class="jira-chip falta"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 4.5v4.2M8 11.2v.5"/></svg>falta a credencial</span>';
}

/* O mapeamento org do GitHub -> site do Jira e o coracao do recurso e estava implicito
   em dois campos de texto. Aqui ele vira uma frase legivel no topo do cartao. Org ou
   URL faltando aparece como lacuna marcada, nunca como frase pela metade. */
function jiraMapaHtml(s) {
  const orgs = (s.owners || []).filter(Boolean);
  const esquerda = orgs.length ? `<code>${esc(orgs.join(', '))}</code>` : '<span class="vago">sem org</span>';
  const host = String(s.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const direita = host ? `<code>${esc(host)}</code>` : '<span class="vago">sem URL</span>';
  return `<span class="jira-mapa">${esquerda} <span class="seta">&rarr;</span> ${direita}</span>`;
}

function jiraCredHtml(s) {
  const cabecalho = `<div class="jira-cred-topo">
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="7" width="9" height="6" rx="1.5"/><path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7"/></svg>
      <span class="jira-cred-titulo">Credencial</span>
      <span class="jira-cred-onde">${s.hasCredential ? 'jira-credentials.json' : 'token criado em id.atlassian.com'}</span>
    </div>`;
  if (s.hasCredential) {
    return `<div class="jira-cred">${cabecalho}
      <div class="jira-cred-guardada">
        <span>Guardada fora do <code>config.json</code>, com permissão restrita. O token não volta a aparecer.</span>
        <span class="espaco"></span>
        <button class="btn sm danger-ghost js-cred-remove" data-id="${esc(s.id)}">Remover credencial</button>
      </div>
    </div>`;
  }
  return `<div class="jira-cred">${cabecalho}
    <div class="jira-cred-corpo">
      <span class="jira-campo">
        <label for="jcEmail-${esc(s.id)}">E-mail da conta Atlassian</label>
        <input id="jcEmail-${esc(s.id)}" class="js-cred-email" data-id="${esc(s.id)}" placeholder="voce@empresa.com" spellcheck="false" autocomplete="off">
      </span>
      <span class="jira-campo">
        <label for="jcToken-${esc(s.id)}">Token de API</label>
        <input id="jcToken-${esc(s.id)}" class="js-cred-token" type="password" data-id="${esc(s.id)}" placeholder="token de API" spellcheck="false" autocomplete="off">
      </span>
      <button class="btn sm js-cred-save" data-id="${esc(s.id)}">Cadastrar credencial</button>
    </div>
    <p class="jira-cred-nota">O token nunca passa por linha de comando: o arquivo de configuração do MCP carrega só o id do site, e quem lê o segredo do disco é o servidor do Farol.</p>
  </div>`;
}

function jiraSiteCardHtml(s) {
  return `<div class="card jira-site${s.hasCredential ? '' : ' sem-cred'}" data-site="${esc(s.id)}">
    <div class="jira-topo">
      <input class="jira-nome js-label" data-id="${esc(s.id)}" value="${esc(s.label)}" placeholder="rótulo" spellcheck="false" aria-label="Rótulo do site">
      ${jiraMapaHtml(s)}
      <span class="jira-espaco"></span>
      ${jiraSelo(s)}
    </div>
    <div class="jira-corpo">
      <span class="jira-campo">
        <label for="jsUrl-${esc(s.id)}">URL do Jira</label>
        <input id="jsUrl-${esc(s.id)}" class="js-baseurl" data-id="${esc(s.id)}" value="${esc(s.baseUrl)}" placeholder="https://empresa.atlassian.net" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsOwners-${esc(s.id)}">Orgs do GitHub</label>
        <input id="jsOwners-${esc(s.id)}" class="js-owners" data-id="${esc(s.id)}" value="${esc((s.owners || []).join(', '))}" placeholder="org1, org2" spellcheck="false">
        <span class="dica">quem é dona do PR decide o site</span>
      </span>
      <span class="jira-campo">
        <label for="jsKeys-${esc(s.id)}">Prefixos de projeto</label>
        <input id="jsKeys-${esc(s.id)}" class="js-projectkeys" data-id="${esc(s.id)}" value="${esc((s.projectKeys || []).join(', '))}" placeholder="ABC, XYZ" spellcheck="false">
        <span class="dica">é por onde a chave do card é reconhecida</span>
      </span>
    </div>
    ${jiraCredHtml(s)}
    <div class="jira-rodape">
      <button class="btn sm js-site-test" data-id="${esc(s.id)}">
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.2"/><path d="M13.7 2.5v3.2h-3.2"/></svg>
        Testar leitura
      </button>
      <span class="jira-teste" data-teste="${esc(s.id)}"></span>
      <span class="espaco"></span>
      <button class="btn sm danger-ghost js-site-remove" data-id="${esc(s.id)}">Remover site</button>
    </div>
  </div>`;
}

function jiraSiteAddFormHtml() {
  return `<div class="card jira-add">
    <div class="jira-add-titulo">Adicionar site</div>
    <div class="jira-add-grade">
      <span class="jira-campo">
        <label for="jsAddLabel">Rótulo</label>
        <input id="jsAddLabel" placeholder="Jira Acme" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsAddBaseUrl">URL do Jira</label>
        <input id="jsAddBaseUrl" placeholder="https://acme.atlassian.net" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsAddOwners">Orgs do GitHub</label>
        <input id="jsAddOwners" placeholder="acme, acme-labs" spellcheck="false">
      </span>
      <span class="jira-campo">
        <label for="jsAddProjectKeys">Prefixos de projeto</label>
        <input id="jsAddProjectKeys" placeholder="ACME, OPS" spellcheck="false">
      </span>
      <button class="btn js-site-add" id="btnJiraSiteAdd">Adicionar</button>
    </div>
    <p class="jira-add-hint">Rótulo, URL e ao menos um prefixo são obrigatórios. A credencial se cadastra depois, dentro do card do site já salvo.</p>
  </div>`;
}

function renderJiraSites() {
  const box = $('#jiraSitesManager'); if (!box) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const sites = estado().jiraSites || [];
  const rows = sites.map(jiraSiteCardHtml).join('');
  box.innerHTML = rows + jiraSiteAddFormHtml();
}
$('#jiraSitesManager').addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'btnJiraSiteAdd') {
    const label = ($('#jsAddLabel').value || '').trim();
    const baseUrl = ($('#jsAddBaseUrl').value || '').trim();
    const owners = jiraLista($('#jsAddOwners').value);
    const projectKeys = jiraLista($('#jsAddProjectKeys').value);
    if (!label || !baseUrl) return toast('error', 'Preencha rótulo e URL base.', 3000);
    const problema = jiraBaseUrlProblema(baseUrl) || jiraPrefixosProblema(projectKeys);
    if (problema) return toast('error', problema, 6000);
    const site = { id: genProfileId(), label, baseUrl, owners, projectKeys };
    $('#jsAddLabel').value = ''; $('#jsAddBaseUrl').value = ''; $('#jsAddOwners').value = ''; $('#jsAddProjectKeys').value = '';
    saveJiraSites([...(estado().jiraSites || []), site]);
    return;
  }
  if (t.classList.contains('js-site-remove')) {
    // a credencial mora FORA do config.json: tirar o site da lista sem isto
    // deixaria e-mail e token órfãos no arquivo de credenciais pra sempre
    const id = t.dataset.id;
    api('/api/jira/credential/remove', { siteId: id }).then(() => {
      saveJiraSites((estado().jiraSites || []).filter(s => s.id !== id));
    });
    return;
  }
  if (t.classList.contains('js-cred-save')) {
    const card = t.closest('.jira-site');
    const email = (card.querySelector('.js-cred-email').value || '').trim();
    const token = (card.querySelector('.js-cred-token').value || '').trim();
    if (!email || !token) return toast('error', 'Preencha e-mail e token.', 3000);
    api('/api/jira/credential', { siteId: t.dataset.id, email, token }).then(r => {
      card.querySelector('.js-cred-email').value = ''; card.querySelector('.js-cred-token').value = '';
      if (r && r.ok) toast('ok', 'Credencial salva.', 2500);
      else toast('error', 'Não deu pra salvar a credencial.');
    });
    return;
  }
  if (t.classList.contains('js-cred-remove')) {
    api('/api/jira/credential/remove', { siteId: t.dataset.id }).then(r => {
      if (r && r.ok) toast('ok', 'Credencial removida.', 2500);
      else toast('error', 'Não deu pra remover a credencial.');
    });
    return;
  }
  // Testar leitura: prova o site AGORA, sem esperar o próximo PR. O resultado fica na
  // linha ao lado do botão (e não só num toast que some), porque é estado do site.
  const btnTeste = t.closest('.js-site-test');
  if (btnTeste) {
    const id = btnTeste.dataset.id;
    const linha = $(`.jira-teste[data-teste="${id}"]`);
    btnTeste.disabled = true;
    if (linha) { linha.className = 'jira-teste'; linha.textContent = 'testando...'; }
    api('/api/jira/test', { siteId: id }).then(r => {
      btnTeste.disabled = false;
      if (!linha) return;
      if (!r) { linha.className = 'jira-teste ruim'; linha.textContent = 'o Farol não respondeu ao teste'; return; }
      if (r.ok) {
        linha.className = 'jira-teste ok';
        linha.textContent = r.quem ? `respondeu como ${r.quem}` : 'o Jira respondeu, credencial válida';
        return;
      }
      linha.className = 'jira-teste ruim';
      linha.textContent = r.motivo || 'o teste falhou';
    });
    return;
  }
});
$('#jiraSitesManager').addEventListener('change', (e) => {
  const t = e.target;
  const campos = ['js-label', 'js-baseurl', 'js-owners', 'js-projectkeys'];
  if (!campos.some(cls => t.classList.contains(cls))) return;
  const id = t.dataset.id;
  const atual = (estado().jiraSites || []).find(s => s.id === id);
  const problema = jiraEdicaoProblema(t);
  if (problema) {
    toast('error', problema, 6000);
    t.value = atual ? jiraCampoSalvo(atual, t) : '';
    return;
  }
  const sites = (estado().jiraSites || []).map(s => {
    if (s.id !== id) return s;
    const next = { ...s };
    if (t.classList.contains('js-label')) next.label = t.value.trim() || s.label;
    if (t.classList.contains('js-baseurl')) next.baseUrl = t.value.trim();
    if (t.classList.contains('js-owners')) next.owners = jiraLista(t.value);
    if (t.classList.contains('js-projectkeys')) next.projectKeys = jiraLista(t.value);
    return next;
  });
  saveJiraSites(sites);
});


/* ---------- Sistema > Sincronização entre dispositivos ----------

   O HTML todo sai de funções puras (ui/pure.js, testadas em test/ui-pure-sync.test.js);
   aqui fica só o que toca o DOM e a rede. O padrão é o do Jira: um container que a
   seção inteira reescreve, com delegação de evento no container, porque os elementos
   nascem e morrem a cada render e um listener por botão vazaria.

   A senha é lida do DOM no instante do clique, numa const local, e some com o re-render:
   ela nunca entra no estado nem em nada que o snapshot carregue. */

function syncCfgAtual() {
  return (estado() && estado().config && estado().config.sync) || {};
}

/* Salva o objeto INTEIRO de sync. Mandar só o campo alterado faria o engine receber uma
   config parcial e apagar o resto, que é o oposto do que a tela mostra. */
function saveSync(sync, aoSalvar) {
  if (!estado()) return;
  estado().config = { ...estado().config, sync };
  renderSync();
  api('/api/settings', { sync }).then(r => {
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes('sync')) {
      toast('error', '"sync" não foi salvo: o servidor não reconhece essa preferência.', 6000);
      return;
    }
    // o servidor devolve a config JÁ saneada: é ela que diz o que de fato ficou gravado
    if (typeof aoSalvar === 'function' && r && r.sync) { aoSalvar(r); return; }
    toast('ok', '✓ Configurações salvas', 2000);
  });
}

/* O que foi digitado no login do Firebase, entre uma repintura e a próxima. Vive só em
   memória da tela: nada daqui vai pro engine sem clique, e nada vai pro disco nunca. É
   zerado no sucesso do login e ao sair do aparelho, porque aí a senha já não serve pra
   nada. Ver syncContaHtml (ui/pure.js) pro porquê de a senha sobreviver à recusa. */
function syncRascunhoVazio() { return { email: '', senha: '', senhaVisivel: false }; }

let syncRascunho = syncRascunhoVazio();

function syncRascunhoDoDom() {
  const email = $('#syncEmail');
  const senha = $('#syncSenha');
  if (email) syncRascunho.email = email.value || '';
  if (senha) syncRascunho.senha = senha.value || '';
  return syncRascunho;
}

function renderSync() {
  const box = $('#syncManager');
  if (!box) return;
  // Mesma guarda do renderJiraSites: o estado chega por push a cada ciclo, e repintar
  // por baixo de quem digita apaga e-mail, senha ou URL no meio da frase. Checkbox fica
  // FORA da guarda de propósito: o interruptor precisa repintar a seção no mesmo clique.
  const foco = document.activeElement;
  if (foco && box.contains(foco) && /INPUT|SELECT/.test(foco.tagName) && foco.type !== 'checkbox') return;
  // o rascunho sai do DOM ANTES de reescrevê-lo: a guarda de foco acima não cobre quem
  // clicou em Entrar (o foco está no botão), e era por ali que o e-mail se perdia
  syncRascunhoDoDom();
  box.innerHTML = syncSecaoHtml((estado() && estado().sync) || {}, syncCfgAtual(), syncRascunho);
}

// Os três interruptores. A regra da chave geral mora em syncCfgComGeral (ui/pure.js),
// que é pura e testada: o comentário aqui já prometeu o arrasto das sub-chaves antes de
// o código fazê-lo, e promessa em prosa não se verifica sozinha.
function syncToggle(id, valor) {
  const c = syncCfgAtual();
  if (id === 'setSyncEnabled') {
    saveSync(syncCfgComGeral(c, valor));
    return;
  }
  const chave = id === 'setSyncCoordination' ? 'coordination' : 'consolidation';
  saveSync({ ...c, [chave]: { ...(c[chave] || {}), enabled: valor } });
}

// A URL do banco passa por allowlist de host no servidor (lib/sync/config.js), e valor
// recusado faz o saneador MANTER o anterior. Sem este aviso, o campo simplesmente
// voltava ao valor velho depois do salvamento: da tela, é indistinguível de "não salvou"
// ou de bug. Quem valida continua sendo o servidor, que é a fonte única; aqui só se
// compara o que foi pedido com o que ficou.
function syncCampoSalvar(id, valor) {
  const c = syncCfgAtual();
  const campo = { syncApiKey: 'apiKey', syncDatabaseUrl: 'databaseUrl', syncDeviceName: 'deviceName' }[id];
  if (!campo || String(c[campo] || '') === valor) return;
  saveSync({ ...c, [campo]: valor }, (r) => {
    const ficou = String(((r || {}).sync || {})[campo] || '');
    if (ficou === String(valor)) return;
    if (campo === 'databaseUrl') toast('error', 'Endereço do banco recusado: use a URL do Realtime Database do seu projeto (…firebaseio.com ou …firebasedatabase.app). O valor anterior foi mantido.', 8000);
    else toast('error', 'Valor recusado pelo servidor; o anterior foi mantido.', 6000);
  });
}

async function syncFazerLogin() {
  const email = ($('#syncEmail') || {}).value || '';
  const senha = ($('#syncSenha') || {}).value || '';
  if (!email.trim() || !senha) { toast('error', 'Informe o e-mail e a senha do Firebase.', 4000); return; }
  const r = await api('/api/sync/login', { email: email.trim(), password: senha });
  // Só o SUCESSO limpa. Na recusa o que foi digitado fica: quase sempre falta uma caixa
  // marcada no console do Firebase, e obrigar a redigitar e-mail e senha a cada tentativa
  // punia quem está justamente corrigindo a configuração do outro lado.
  if (r && r.ok) {
    syncRascunho = syncRascunhoVazio();
    toast('ok', '✓ Conectado ao Firebase', 3000);
  } else {
    syncRascunho.email = email;
    syncRascunho.senha = senha;
    toast('error', `Não deu pra entrar: ${(r && r.motivo) || 'o servidor não respondeu'}`, 7000);
  }
  renderSync();
}

/* O olho da senha. O `aria-pressed` do botão é o estado; o rascunho só o espelha pra
   sobreviver à repintura, e o input volta a ficar oculto sozinho quando o login dá certo. */
function syncAlternarSenha() {
  syncRascunhoDoDom();
  syncRascunho.senhaVisivel = !syncRascunho.senhaVisivel;
  renderSync();
  const campo = $('#syncSenha');
  if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
}

async function syncTestar() {
  const out = $('#syncTestOut');
  if (out) out.textContent = 'testando…';
  const r = await api('/api/sync/test', {});
  if (!out) return;
  if (r && r.ok) {
    out.className = 'sync-teste ok';
    out.textContent = `respondeu agora, ${r.devices} aparelho(s) neste banco`;
    return;
  }
  out.className = 'sync-teste ruim';
  out.textContent = (r && r.motivo) || 'não respondeu';
}

async function syncSair() {
  await api('/api/sync/logout', {});
  // sair zera o rascunho: a senha da conta anterior não fica esperando na tela
  syncRascunho = syncRascunhoVazio();
  toast('info', 'Este aparelho saiu do Firebase. Nada local foi apagado.', 4000);
  renderSync();
}

async function syncApagarRemoto() {
  const ok = await confirmModal({
    danger: true,
    title: 'Apagar dados sincronizados?',
    confirmLabel: 'Apagar do Firebase',
    body: `<p>Apaga do seu Firebase os aparelhos, as coordenações e o consumo enviado por <b>todos</b> os aparelhos.</p>
      <p><b>Análise em curso em outro aparelho é interrompida.</b> A coordenação dela sai junto, e aquele aparelho descarta o resultado sem postar quando perceber.</p>
      <p>Nenhum arquivo local é tocado: o histórico de cada aparelho continua nele. A sincronização segue ligada e o consumo deste aparelho é reenviado do zero.</p>`,
  });
  if (!ok) return;
  const r = await api('/api/sync/erase-remote', {});
  if (r && r.ok) toast('ok', '✓ Dados sincronizados apagados do Firebase', 4000);
  else toast('error', `Não deu pra apagar: ${(r && r.motivo) || 'o servidor não respondeu'}`, 7000);
  renderSync();
}

/* "Refazer neste aparelho" APAGA a prova de que uma análise foi feita, então ele
   confirma sempre, nomeando o aparelho e o custo. O engine ainda recusa por conta
   própria se o recibo tiver deixado de ser órfão entre a tela e o clique. */
async function syncRefazer(key) {
  const r = ((estado() && estado().sync && estado().sync.recibosVistos) || {})[key] || {};
  const onde = esc(r.deviceName || 'outro aparelho');
  const ok = await confirmModal({
    title: 'Refazer este commit neste aparelho?',
    confirmLabel: 'Refazer neste aparelho',
    body: `<p><code>${esc(key)}</code> já foi analisado no <b>${onde}</b> neste commit, e o resultado só existe lá.</p>
      <p>Refazer aqui abre uma sessão nova e consome tokens. Se o ${onde} voltar, ele confere antes de postar e não publica por cima.</p>`,
  });
  if (!ok) return;
  const resp = await api('/api/sync/redo', { key });
  if (resp && resp.ok) toast('ok', `✓ ${key} relançado neste aparelho`, 4000);
  else toast('error', `Não deu pra refazer: ${(resp && resp.motivo) || 'o servidor não respondeu'}`, 7000);
  renderSync();
}

$('#syncManager').addEventListener('click', (e) => {
  const redo = e.target.closest('.sync-redo');
  if (redo) { syncRefazer(redo.dataset.key); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'syncLogin') syncFazerLogin();
  else if (b.id === 'syncSenhaOlho') syncAlternarSenha();
  else if (b.id === 'syncLogout') syncSair();
  else if (b.id === 'syncTest') syncTestar();
  else if (b.id === 'syncErase') syncApagarRemoto();
});

$('#syncManager').addEventListener('change', (e) => {
  const t = e.target;
  if (t.type === 'checkbox' && t.id.startsWith('setSync')) { syncToggle(t.id, t.checked); return; }
  if (t.id && t.id.startsWith('sync')) syncCampoSalvar(t.id, String(t.value || '').trim());
});

/* ---------- tema ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('farol-theme', theme);
  $('#iconMoon').style.display = theme === 'dark' ? '' : 'none';
  $('#iconSun').style.display = theme === 'dark' ? 'none' : '';
}
applyTheme(localStorage.getItem('farol-theme') || 'dark');
$('#btnTheme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  api('/api/settings', { theme: next });
};

/* ---------- navegação ---------- */
/* Altura REAL da topbar num custom property. Os dois elementos sticky do app (a
   navegação do Radar e a sidebar do Sistema) tinham o deslocamento cravado em 54px e
   66px, mas a topbar muda de altura: encolhe abaixo de 620px e cresce quando a barra de
   contas aparece e quebra em duas linhas. O resultado era uma faixa vazada por baixo, ou
   a navegação passando por trás da topbar. Aqui a medida é observada. */
function medirTopbar() {
  const tb = document.querySelector('.topbar');
  if (!tb) return;
  document.documentElement.style.setProperty('--topbar-h', Math.round(tb.getBoundingClientRect().height) + 'px');
}
medirTopbar();
if (window.ResizeObserver) new ResizeObserver(medirTopbar).observe(document.querySelector('.topbar'));

/* Redesenho no resize: o gráfico do Consumo mede o container pra montar o viewBox, então
   precisa ser refeito quando a largura muda. Debounce pra não redesenhar a cada pixel. */
let resizeTimer = null;
window.addEventListener('resize', () => {
  medirTopbar();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if ($('#tab-consumo').classList.contains('active')) renderUsage();
  }, 150);
});

function switchTab(name) {
  if (name === 'destaques' && !teamHighlightsEnabled()) name = 'radar';
  if (name === 'entregas' && !deliveriesEnabled()) name = 'radar';
  definirAba(name);
  document.body.dataset.tab = name;   // largura útil por aba (ver body[data-tab] no app.css)
  // aria-selected junto com a classe: a classe pinta, o aria é o que o leitor de tela lê
  document.querySelectorAll('.nav-item').forEach(t => {
    const ativo = t.dataset.tab === name;
    t.classList.toggle('active', ativo);
    t.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (estado()) renderAccountBar();   // mostra/esconde a barra de contas conforme a aba
  const tela = telaPorId(name);
  if (tela && tela.aoEntrar) tela.aoEntrar();
}
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) switchTab(btn.dataset.tab);
});

/* ---------- sistema: sub-navegação sidebar ---------- */
let SISTEMA_SECTION = 'overview';

function switchSistemaSection(name) {
  if (name) SISTEMA_SECTION = name;
  document.querySelectorAll('.sys-nav-item').forEach(b => {
    const ativo = b.dataset.section === SISTEMA_SECTION;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  document.querySelectorAll('.sys-section').forEach(s => s.classList.toggle('active', s.id === 'sys-' + SISTEMA_SECTION));
}

$('#sysNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.sys-nav-item');
  if (!btn) return;
  const q = $('#sysSearch');
  if (q.value) { q.value = ''; sysSearchFilter(''); }
  switchSistemaSection(btn.dataset.section);
});

/* Índice da busca do Sistema. Casar por textContent da seção inteira, como era antes,
   acendia meia dúzia de seções ao mesmo tempo (o termo "conta" aparece em quase todas)
   e empilhava tudo na vertical. Com índice, o resultado é uma lista curta que aponta
   pra UMA linha. 'at' é o seletor do alvo, e todo alvo tem que existir no HTML. */
const SYS_INDEX = [
  { sec: 'overview', at: '#updateBox', title: 'Versão e atualização', hint: 'update, atualizar, versão, release' },
  { sec: 'overview', at: '#doctor', title: 'Saúde do ambiente', hint: 'doctor, gh, claude, git bash, diagnóstico' },
  { sec: 'sync', at: '#syncManager', title: 'Sincronização entre aparelhos', hint: 'sync, firebase, aparelho, dispositivo, coordenação, lease, consolidação, consumo, um farol por pr' },
  { sec: 'accounts', at: '#accountsManager', title: 'Contas do GitHub', hint: 'conta, identidade, cor, silenciar, política, token' },
  { sec: 'automation', at: '#sys-row-autoreview', title: 'Revisar automaticamente quando chegar PR', hint: 'auto review, revisão na hora, fila' },
  { sec: 'automation', at: '#sys-row-autoapprove', title: 'Aprovar sozinho os aprováveis com ressalvas', hint: 'auto approve, ressalva, aprovação' },
  { sec: 'automation', at: '#sys-row-pushback', title: 'Detectar pushback automaticamente', hint: 'contestação, autor, desfecho' },
  { sec: 'automation', at: '#sys-row-provedor', title: 'Configuração do provedor', hint: 'claude, codex, openrouter, perfil, conta, provedor' },
  { sec: 'automation', at: '#sys-row-modelo', title: 'Modelo das sessões autônomas', hint: 'opus, sonnet, haiku, fable, auto, best, codex, gpt, sol, terra, luna, modelo, limite do plano, openrouter' },
  { sec: 'automation', at: '#sys-row-paralelas', title: 'Revisões paralelas por conta', hint: 'paralelo, simultâneo, série, fila, velocidade' },
  { sec: 'automation', at: '#sys-row-esforco', title: 'Esforço de raciocínio', hint: 'effort, pensar, raciocínio, alto, baixo, xhigh' },
  { sec: 'automation', at: '#sys-row-intervalo', title: 'Intervalo de checagem', hint: 'polling, minutos, frequência' },
  { sec: 'automation', at: '#sys-row-skipperms', title: 'Sessão no terminal sem pedir permissões', hint: 'dangerously skip permissions, prompts' },
  { sec: 'connections', at: '#sys-row-ghuser', title: 'Conta do GitHub (trabalho)', hint: 'usuário, login, gh, conta primária' },
  { sec: 'connections', at: '#sys-row-orgs', title: 'Organizações monitoradas', hint: 'org, owners, panorama, repositórios' },
  { sec: 'connections', at: '#sys-row-mergeblocked', title: 'Repos bloqueados pra merge', hint: 'merge, bloqueio, repo, self merge' },
  { sec: 'plans', at: '#claudeProfilesManager', title: 'Perfis de IA e chaves', hint: 'claude, codex, chatgpt, plano, assinatura, config dir, login, chave' },
  { sec: 'reviewers', at: '#reviewersEditor', title: 'Reviewers por projeto', hint: 'revisor, time, padrão da org, exceção, repo' },
  { sec: 'prefs', at: '#sys-row-identity', title: 'Identidade nos cards', hint: 'barra, etiqueta, ponto, marcador' },
  { sec: 'prefs', at: '#sys-row-mutedview', title: 'Contas silenciadas', hint: 'recolher, esmaecer, ocultar, exibição' },
  { sec: 'prefs', at: '#sys-row-sound', title: 'Som ao chegar PR novo', hint: 'som, aviso, notificação' },
  { sec: 'prefs', at: '#sys-row-teamhighlights', title: 'Destaques do time', hint: 'destaques, kudos, elogios, memória, time, equipe' },
  { sec: 'prefs', at: '#sys-row-deliveries', title: 'Entregas', hint: 'entregas, merges, prs mergeados, github, atividade' },
  { sec: 'prefs', at: '#rowAutostart', title: 'Iniciar com o Windows', hint: 'autostart, inicialização, segundo plano' },
  { sec: 'news', at: '#relNotes', title: 'Novidades por versão', hint: 'changelog, release notes, o que mudou' },
  { sec: 'diag', at: '#sys-row-spawns', title: 'Registrar processos (diagnóstico)', hint: 'spawns, terminal piscando, debug' },
  { sec: 'diag', at: '#sys-row-log', title: 'Log de falhas', hint: 'log, erro, falha, pr-health' },
  { sec: 'about', at: '#aboutPrivacy', title: 'Privacidade', hint: 'dados, telemetria, coleta, local, privacidade' },
  { sec: 'about', at: '#aboutLicense', title: 'Licença', hint: 'mit, licença, open source, garantia' },
  { sec: 'about', at: '#aboutCredits', title: 'Créditos', hint: 'contribuidores, autores, idealizador, mantenedor, quem fez' },
];


function sysSecName(sec) {
  const b = document.querySelector(`.sys-nav-item[data-section="${sec}"]`);
  return b ? b.textContent.trim() : sec;
}

/* Navega pra uma entrada do índice. A ordem importa: a seção precisa estar VISÍVEL
   antes do scroll, porque scrollIntoView em elemento display:none não faz nada e não
   avisa. Daí o setTimeout depois do switchSistemaSection. */
function sysGoTo(sec, at) {
  const q = $('#sysSearch');
  if (q.value) { q.value = ''; sysSearchFilter(''); }
  switchSistemaSection(sec);
  setTimeout(() => {
    const el = at && document.querySelector(at);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sysFlash(el);
  }, 0);
}

/* ---------- caixa de revisão por chave (atalho da tabela de Consumo) ----------
   O snapshot manda só as 30 revisões mais recentes (com relatório, cada decisão
   pesa ~5 KB; 3000 seriam 15 MB a CADA push de SSE). Então procura primeiro no
   que já está em mãos e, só se não achar, pergunta ao engine, que varre o
   histórico completo (3000 em disco). Handler delegado no document, igual ao
   data-goto: nenhuma tela registra listener próprio. */
function decisaoLocal(key) {
  const d = estado()?.decisions || {};
  return (d.pending || []).find(x => x.key === key) || (d.resolved || []).find(x => x.key === key) || null;
}

async function abrirCaixaRevisao(key) {
  // o get() devolve null em QUALQUER falha, por isso a rota responde envelope:
  // sem ele, "não há revisão desse PR" e "a busca falhou" seriam a mesma coisa
  // na tela, e o clique ficaria indistinguível de bug.
  let d = decisaoLocal(key);
  if (!d) {
    const env = await get('/api/decision?key=' + encodeURIComponent(key));
    if (!env) { toast('error', 'Não consegui buscar a revisão agora. Tente de novo.'); return; }
    d = env.decision;
  }
  overlayModal(`Revisão de ${esc(key)}`, reviewBoxHtml(d));
}

// overlay de leitura (sem confirmar/cancelar), no mesmo esqueleto do confirmModal
function overlayModal(titulo, corpo) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="revBoxTitle">
    <div class="modal-title" id="revBoxTitle">${titulo}</div>
    <div class="modal-body scroll">${corpo}</div>
    <div class="modal-actions"><button class="btn sm primary modal-ok">Fechar</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.querySelector('.modal-ok').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => ov.querySelector('.modal-ok').focus(), 30);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-review-key]');
  if (!b) return;
  e.preventDefault();
  abrirCaixaRevisao(b.dataset.reviewKey);
});

/* ---------- navegação interna centralizada: data-goto ----------
   Contrapartida interna dos helpers de menção do ui/pure.js (personMention,
   repoMention, prRefMention levam pro GitHub; aqui é pra levar a um lugar do
   PRÓPRIO app). Um handler só, delegado no document, pra nenhuma tela precisar
   registrar listener próprio nem repetir a sequência "switchTab depois
   sysGoTo com setTimeout" (a ordem importa: sysGoTo rola/pisca e elemento em
   aba escondida não rola).

   Formatos aceitos (data-goto):
     aba:<nome>                        → só troca de aba (radar, entregas, …)
     aba:<nome>:<seletor CSS>          → idem + rola e pisca o alvo
     sys:<secao>                       → aba Sistema + seção
     sys:<secao>:<seletor CSS>         → idem + rola e pisca o alvo
     deliv:repo:<owner/repo>           → Entregas, visão por repo, no grupo
     deliv:author:<login>              → Entregas, visão por pessoa, no grupo
     deliv:days:<0|7|15|30>            → Entregas, troca o período

   Quem emite passa o valor CRU; a leitura é sempre por dataset (nada de parse
   de HTML). Elemento com data-goto ganha o affordance de clique no CSS
   (.is-goto) e vira botão pra teclado/leitor de tela via role/tabindex. */
// troca de aba e, se veio seletor, rola e pisca o alvo. Mesma ordem do sysGoTo
// (aba visível ANTES do scroll: scrollIntoView em elemento escondido não faz nada
// e não avisa). Painel de ferramenta nasce hidden: sem resultado gerado ainda, a
// navegação para na aba certa em vez de piscar o que ninguém vê.
function gotoAba(nome, at) {
  switchTab(nome);
  if (!at) return;
  setTimeout(() => {
    const el = document.querySelector(at);
    if (!el || el.hidden) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sysFlash(el);
  }, 0);
}

function goTo(spec) {
  const { tipo, alvo, seletor } = parseGoto(spec);
  if (tipo === 'aba') return gotoAba(alvo, seletor || null);
  if (tipo === 'sys') {
    switchTab('sistema');
    return sysGoTo(alvo, seletor || null);
  }
  if (tipo === 'deliv') return gotoDeliv(alvo, seletor, switchTab);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto]');
  if (!el) return;
  e.preventDefault();
  goTo(el.dataset.goto);
});
// mesma navegação pelo teclado: quem tem data-goto é anunciado como botão
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest && e.target.closest('[data-goto]');
  if (!el || el.tagName === 'A' || el.tagName === 'BUTTON') return;
  e.preventDefault();
  goTo(el.dataset.goto);
});

function sysSearchFilter(query) {
  const q = sysNorm(query).trim();
  const box = $('#sysResults');
  const navItems = document.querySelectorAll('.sys-nav-item');
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    document.querySelectorAll('.sys-section').forEach(s => s.classList.toggle('active', s.id === 'sys-' + SISTEMA_SECTION));
    navItems.forEach(b => { b.classList.remove('match'); b.classList.toggle('active', b.dataset.section === SISTEMA_SECTION); });
    return;
  }
  const hits = SYS_INDEX.filter(e => sysNorm(`${e.title} ${e.hint} ${sysSecName(e.sec)}`).includes(q));
  // enquanto busca, nenhuma seção fica aberta: quem ocupa a área é a lista de resultados
  document.querySelectorAll('.sys-section').forEach(s => s.classList.remove('active'));
  const comHit = new Set(hits.map(h => h.sec));
  navItems.forEach(b => { b.classList.remove('active'); b.classList.toggle('match', comHit.has(b.dataset.section)); });
  box.hidden = false;
  box.innerHTML = hits.length
    ? hits.map(h => `<button class="sys-hit" data-sec="${esc(h.sec)}" data-at="${esc(h.at)}">
        <span class="sys-hit-txt">${esc(h.title)}<span class="sys-hit-sub">${esc(h.hint)}</span></span>
        <span class="sys-hit-sec">${esc(sysSecName(h.sec))}</span>
      </button>`).join('')
    : `<div class="empty">Nada com esse nome. Tenta "modelo", "esforço", "som", "orgs" ou "log".</div>`;
}

$('#sysSearch').addEventListener('input', (e) => sysSearchFilter(e.target.value));
$('#sysResults').addEventListener('click', (e) => {
  const btn = e.target.closest('.sys-hit');
  if (btn) sysGoTo(btn.dataset.sec, btn.dataset.at);
});

// Deep-link de alerta: rola até o card do PR e dá um pulso de destaque.
// Ordem de busca = onde a ação mora (decisão > fila > meus PRs > panorama > recentes).
function focusPr(url, tentativa = 0) {
  if (!url) return;
  switchTab('radar');
  const sel = ['#decisions .decision', '#queue .pr-card', '#myPRs .mypr-card', '#panorama [data-url]', '#resolved [data-url]']
    .map(s => `${s}[data-url="${CSS.escape(url)}"]`).join(', ');
  const card = document.querySelector(sel);
  if (!card) {
    // o state pode ainda estar chegando pelo SSE; tenta de novo uma vez
    if (tentativa < 2) setTimeout(() => focusPr(url, tentativa + 1), 700);
    return;
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('pulse-focus');
  setTimeout(() => card.classList.remove('pulse-focus'), 2600);
}

/* ---------- atalhos de teclado ---------- */
// J/K navegam nas decisões pendentes; A aprova, M pede mudanças, C comenta, P pula;
// / foca a consulta de PR; 1-6 trocam de aba; ? mostra esta lista.
const KBD_ACTIONS = { a: 'approve', m: 'request_changes', c: 'comment', p: 'skip' };
function kbdCards() { return [...document.querySelectorAll('#decisions .decision')]; }
function kbdSelected() { return document.querySelector('#decisions .decision.kbd-sel'); }
function kbdMove(delta) {
  const cards = kbdCards();
  if (!cards.length) return;
  switchTab('radar');
  const cur = kbdSelected();
  // sem card atual, entra pela ponta que o sentido do passo indica
  const daPonta = delta > 0 ? 0 : cards.length - 1;
  let i = cur ? cards.indexOf(cur) + delta : daPonta;
  i = Math.max(0, Math.min(cards.length - 1, i));
  cards.forEach(c => c.classList.remove('kbd-sel'));
  cards[i].classList.add('kbd-sel');
  cards[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function kbdHelp() {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal-card">
    <div class="modal-title">Atalhos de teclado</div>
    <div class="modal-body"><table class="kbd-table">
      <tr><td><kbd>J</kbd> / <kbd>K</kbd></td><td>navegar nas decisões pendentes</td></tr>
      <tr><td><kbd>A</kbd></td><td>aprovar a decisão selecionada</td></tr>
      <tr><td><kbd>M</kbd></td><td>pedir mudanças na selecionada</td></tr>
      <tr><td><kbd>C</kbd></td><td>só comentar na selecionada</td></tr>
      <tr><td><kbd>P</kbd></td><td>pular a selecionada</td></tr>
      <tr><td><kbd>/</kbd></td><td>consultar um PR por URL</td></tr>
      <tr><td><kbd>${ehMac() ? 'Cmd' : 'Ctrl'}</kbd>+<kbd>K</kbd></td><td>paleta de comando: ir a qualquer lugar</td></tr>
      <tr><td><kbd>1</kbd>…<kbd>6</kbd></td><td>trocar de aba</td></tr>
      <tr><td><kbd>?</kbd></td><td>esta lista</td></tr>
    </table></div>
    <div class="modal-actions"><button class="btn sm primary modal-ok">Fechar</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.querySelector('.modal-ok').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
}
/* decisão pendente: caminho ÚNICO de POST, usado pelo card (#decisions) e pela paleta.
   O achado A5: a paleta chamava um decide() que nunca existiu (ReferenceError engolido). */
function decide(id, action) {
  return api('/api/decide', { id, action }).then(r => {
    if (!r || !r.ok) toast('error', (r && r.error) || 'não consegui registrar a decisão');
    return r;
  });
}
// a paleta não tem o modal do card, então o REQUEST_CHANGES ganha a MESMA confirmação
async function decideComConfirmacao(id, action, ref) {
  if (action === 'request_changes') {
    const ok = await confirmModal({
      title: `Pedir mudanças em ${ref || 'este PR'}?`, danger: true, confirmLabel: 'Pedir mudanças', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>posta um REQUEST CHANGES no GitHub</b>, visível pra todo mundo do PR, com os pontos que a revisão levantou.</p>`
    });
    if (!ok) return { ok: false };
  }
  return decide(id, action);
}
/* ---------- paleta de comando (Ctrl+K / Cmd+K) ---------- */
// Ir a qualquer lugar rápido: abas, seções do Radar, ou colar/digitar URL/key
// de PR (org/repo#NN) pra abrir a conversa salva, sem precisar do mouse.
/* Era `const`: o array era montado UMA vez, no load. As decisões pendentes mudam a cada
   evento SSE, então nunca entravam na paleta. Como função, ela é remontada a cada
   abertura. Em janela estreita a paleta deixa de ser atalho de gente avançada e vira a
   rota principal pra tudo que não cabe na tira de abas. */
function cmdStatic() { return [
  // as decisões pendentes primeiro: são a única ação urgente e destrutiva do app
  ...(estado()?.decisions?.pending || []).flatMap(d => {
    const ref = d.key || '';
    const acao = (rotulo, action) => ({
      kind: 'decisão', label: `${rotulo} ${ref}`, hint: 'decisão',
      run: () => decideComConfirmacao(d.id, action, ref)
    });
    return [acao('Aprovar', 'approve'), acao('Pedir mudanças em', 'request_changes')];
  }),
  // o lote respeita o ESCOPO: aprova só o que o filtro de conta mostra, nunca a
  // fila inteira (agravante do achado A5, regra R13 do plano mestre)
  ...(() => {
    const visiveis = (estado()?.decisions?.pending || []).filter(scopeVisible);
    return visiveis.length > 1
      ? [{ kind: 'lote', label: `Aprovar as ${visiveis.length} pendentes`, hint: 'lote',
          run: async () => { for (const d of visiveis) await decide(d.id, 'approve'); } }]
      : [];
  })(),
  ...[...document.querySelectorAll('.nav-item')].filter(b => !b.hidden).map(b => ({ kind: 'tab', label: `Ir para ${b.textContent}`, hint: 'aba', run: () => switchTab(b.dataset.tab) })),
  // as 9 seções do Sistema, lidas do DOM: seção nova entra aqui sozinha.
  // .trim() porque o botão tem um <svg aria-hidden="true"> antes do texto e sobra espaço em branco.
  ...[...document.querySelectorAll('.sys-nav-item')].map(b => ({
    kind: 'section', label: `Sistema: ${b.textContent.trim()}`, hint: 'sistema',
    run: () => { switchTab('sistema'); switchSistemaSection(b.dataset.section); }
  })),
  { kind: 'section', label: 'Ir para Precisa de você', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('decisionsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Sua fila', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('queueSection')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Meus PRs', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('myPRsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Panorama', hint: 'seção', run: () => { switchTab('radar'); document.getElementById('panoramaSection')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'action', label: 'Verificar agora', hint: 'ação', run: () => $('#btnCheck').click() },
  { kind: 'action', label: 'Alternar tema', hint: 'ação', run: () => $('#btnTheme').click() },
  { kind: 'action', label: 'Atalhos de teclado', hint: '?', run: () => kbdHelp() },
]; }
let cmdOverlay = null;
function cmdClose() {
  if (!cmdOverlay) return;
  cmdOverlay.remove(); cmdOverlay = null;
  document.removeEventListener('keydown', cmdOnKey, true);
}
function cmdOnKey(e) {
  if (!cmdOverlay) return;
  const list = [...cmdOverlay.querySelectorAll('.cmd-item')];
  const cur = cmdOverlay.querySelector('.cmd-item.sel');
  let i = cur ? list.indexOf(cur) : -1;
  if (e.key === 'Escape') { cmdClose(); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { i = Math.min(list.length - 1, i + 1); cmdMark(list, i); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { i = Math.max(0, i - 1); cmdMark(list, i); e.preventDefault(); }
  else if (e.key === 'Enter') { e.preventDefault(); (cur || list[0])?.click(); }
}
function cmdMark(list, i) {
  list.forEach(el => el.classList.remove('sel'));
  if (list[i]) { list[i].classList.add('sel'); list[i].scrollIntoView({ block: 'nearest' }); }
}
function cmdOpen() {
  if (cmdOverlay) { cmdClose(); return; }
  const ov = document.createElement('div');
  ov.className = 'modal-overlay cmd-overlay';
  ov.innerHTML = `<div class="cmd-box">
    <input id="cmdInput" class="cmd-input" type="text" spellcheck="false" placeholder="Ir para… ou cole a URL/key de um PR (org/repo#NN)">
    <div id="cmdList" class="cmd-list"></div>
  </div>`;
  document.body.appendChild(ov);
  cmdOverlay = ov;
  const input = ov.querySelector('#cmdInput');
  const list = ov.querySelector('#cmdList');
  const renderList = () => {
    const q = input.value.trim();
    const prMatch = q.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i) || q.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    const items = [];
    if (prMatch) {
      const key = `${prMatch[1]}#${prMatch[2]}`;
      const url = q.startsWith('http') ? q : `https://github.com/${prMatch[1]}/pull/${prMatch[2]}`;
      items.push({ label: `Abrir a conversa de ${key}`, hint: 'PR', run: () => openChat(key, url) });
    }
    const ql = q.toLowerCase();
    items.push(...cmdStatic().filter(c => !ql || c.label.toLowerCase().includes(ql)));
    list.innerHTML = items.map((c, idx) => `<div class="cmd-item${idx === 0 ? ' sel' : ''}" data-idx="${idx}"><span>${esc(c.label)}</span><span class="cmd-hint">${esc(c.hint)}</span></div>`).join('')
      || '<div class="cmd-empty">Nada encontrado. Cole a URL de um PR pra abrir a conversa.</div>';
    [...list.querySelectorAll('.cmd-item')].forEach((el, idx) => {
      // fecha ANTES de rodar: um run() que lança não pode travar a paleta aberta,
      // e a rejeição vira toast em vez de sumir no console
      el.onclick = () => { cmdClose(); Promise.resolve().then(() => items[idx].run()).catch(err => toast('error', (err && err.message) || 'a ação falhou')); };
    });
  };
  input.addEventListener('input', renderList);
  ov.addEventListener('click', (e) => { if (e.target === ov) cmdClose(); });
  document.addEventListener('keydown', cmdOnKey, true);
  renderList();
  setTimeout(() => input.focus(), 20);
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdOpen(); }
});

document.addEventListener('keydown', (e) => {
  // nunca por cima de digitação, diálogo, chat ou combinação com modificador
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
  if (document.querySelector('.modal-overlay')) return;
  if (!$('#chatPanel').hidden) return;
  const k = e.key;
  if (k >= '1' && k <= '6') {
    const tabs = [...document.querySelectorAll('.nav-item')].filter(b => !b.hidden);
    const btn = tabs[Number(k) - 1];
    if (btn) { switchTab(btn.dataset.tab); e.preventDefault(); }
    return;
  }
  if (k === '/') { switchTab('radar'); $('#lookupUrl').focus(); e.preventDefault(); return; }
  if (k === '?') { kbdHelp(); e.preventDefault(); return; }
  const low = k.toLowerCase();
  if (low === 'j') { kbdMove(1); e.preventDefault(); return; }
  if (low === 'k') { kbdMove(-1); e.preventDefault(); return; }
  if (KBD_ACTIONS[low]) {
    const card = kbdSelected();
    const btn = card && card.querySelector(`.dec-act[data-action="${KBD_ACTIONS[low]}"]`);
    if (btn) { btn.click(); e.preventDefault(); }
  }
});

/* ---------- chat com o Claude ---------- */
/* qualquer botão .act-chat da página abre a conversa do PR */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.act-chat');
  if (btn) openChat(btn.dataset.key, btn.dataset.url || null);
});
/* consultar um PR por URL: abre a conversa salva mesmo que ele não esteja na lista
   (some do "Revisões recentes" por escopo ou pelo limite de 30). Reusa o chat. */
$('#lookupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = canonicalGithubPrUrl($('#lookupUrl').value);
  const key = prKeyFromUrl(url);
  if (!key) { toast('error', 'Cole a URL de um PR do GitHub (…/pull/NN).'); return; }
  openChat(key, url);
  $('#lookupUrl').value = '';
});

/* ---------- Meus PRs: botão Reviewers ----------
   O resto do bloco (renderMyPRs, merge, ocultar, prompt de correcao) mora em
   telas/meus-prs.js. So este botao fica aqui: ele navega pra aba Sistema e usa o
   editor de reviewers (switchTab, switchSistemaSection, sysSearchFilter,
   loadReviewerCands, renderReviewersEditor, revCtx), primitivas do shell/Sistema
   que nao migraram nesta tarefa. Segundo listener delegado no MESMO #myPRs: o de
   meus-prs.js cuida de todo o resto dos cliques do card. */
$('#myPRs').addEventListener('click', (e) => {
  const rev = e.target.closest('.act-set-reviewers');
  if (!rev) return;
  const card = rev.closest('.mypr-card');
  const repo = String(card?.dataset.key || '').split('#')[0];
  const org = repo.split('/')[0];
  // efetivo = exceção do repo, senão o padrão da org
  const eff = overrideFor(repo, revCtx()) || defaultFor(org, revCtx());
  // sem reviewers (nem exceção nem padrão): leva pra tela de config
  if (!eff || !eff.length) {
    switchTab('sistema');
    // sem isso a seção fica display:none e o scroll abaixo não mostra nada: o usuário
    // caía na Visão geral com um toast falando de uma tela que ele não estava vendo
    switchSistemaSection('reviewers');
    const busca = $('#sysSearch');
    if (busca.value) { busca.value = ''; sysSearchFilter(''); }
    loadReviewerCands();
    renderReviewersEditor();
    setTimeout(() => { const el = $('#reviewersEditor'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); sysFlash(el); } }, 60);
    toast('info', `Defina os reviewers padrão de ${org} (ou uma exceção pra ${repoShort(repo)}) aqui, depois é só clicar em Reviewers no PR.`, 7000);
    return;
  }
  // tem config: aplica na hora, sem confirmação
  rev.disabled = true; rev.textContent = 'Setando…';
  api('/api/self-review/reviewers', { url: rev.dataset.url }).then(r => {
    if (!r?.ok) toast('error', r?.error || 'não consegui setar os reviewers');
    rev.disabled = false; rev.textContent = '👥 Reviewers';
  });
});

/* ---------- render: versão e atualização ---------- */
function renderUpdate() {
  const u = estado().update;
  const box = $('#updateBox');
  if (!u) { box.textContent = 'Verificando…'; return; }
  const remote = u.channel === 'remote';
  // o repo das releases é menção a coisa navegável: abre a página de releases
  const origin = remote
    ? `GitHub Releases (<a href="https://github.com/${esc(u.repo || '')}/releases" target="_blank" rel="noreferrer" title="Abrir as releases no GitHub"><code>${esc(u.repo || '')}</code></a>)`
    : origemLocal(u);
  const hasChannel = remote || !!u.source;
  // não deu pra ler a release (repo privado/sem acesso, sem release ainda, ou rede):
  // sourceVersion nulo + note. Não é "está na mais recente", é falta de acesso.
  const noAccess = hasChannel && !u.available && !u.sourceVersion && !!u.note;
  box.classList.toggle('avail', !!u.available);
  box.classList.toggle('ok-state', !u.available && hasChannel && !noAccess);
  if (u.available) {
    const autoOn = remote && estado().config?.autoUpdate !== false;
    const noteAuto = autoOn
      ? `Atualização disponível ${'nas ' + origin}. Com "Atualizar sozinho" ligado (Sistema > Automação), o Farol aplica sozinho assim que ficar ocioso (sem análise, chat ou terminal em andamento), fecha e reabre preservando estado e configurações. O botão abaixo aplica agora, sem esperar.`
      : `Atualização disponível ${remote ? 'nas ' + origin : 'na ' + origin}. O Farol ${remote ? 'baixa e instala, ' : ''}fecha e reabre sozinho, preservando estado e configurações.`;
    const queuedLine = u.queued ? ' <b>Agendado:</b> aplica sozinho assim que as sessões em andamento terminarem.' : '';
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)} → v${esc(u.sourceVersion)}</span>
      <span class="up-note">${noteAuto}${queuedLine}</span>
      <button id="btnUpdateNow" class="btn primary sm">Atualizar agora</button>`;
    $('#btnUpdateNow').onclick = async () => {
      // confirm() nativo era o último popup fora da identidade do app neste fluxo
      // (pedido do Wanderson, 15/08/2026): o modal do próprio Farol explica o que
      // vai acontecer, e nada roda sem o clique em Atualizar.
      const ok = await confirmModal({
        title: `Atualizar pra v${u.sourceVersion}?`,
        body: `<p>O Farol sai da <b>v${esc(u.current)}</b> pra <b>v${esc(u.sourceVersion)}</b>.</p>
          <ul>
            <li>${remote ? 'baixa a release e instala' : 'copia os arquivos da pasta-fonte'} sozinho;</li>
            <li>o app <b>fecha e reabre</b> no fim (leva alguns segundos);</li>
            <li>estado, memória do time e configurações ficam intactos;</li>
            <li>se houver revisão ou sessão em andamento, nada é morto no meio: o update fica agendado e aplica sozinho assim que terminar.</li>
          </ul>`,
        confirmLabel: 'Atualizar'
      });
      if (!ok) return;
      const r = await api('/api/update', {});
      // ocupado não é erro (v2.46.1): o clique agenda e o Farol aplica ao ficar ocioso
      if (r?.queued) toast('info', 'Tem análise, chat ou sessão de terminal em andamento. O update ficou agendado: assim que terminar, o Farol aplica sozinho, fecha e reabre.');
      else if (!r?.ok) toast('error', r?.error || 'não consegui iniciar a atualização');
    };
  } else if (noAccess) {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Não consegui ler as releases em ${origin} (${esc(u.note || 'sem acesso')}). Se o repo for privado, a conta primária do gh precisa ter acesso a ele (ou torne o repo público). Última verificação ${fmtClock(u.checkedAt)}.</span>`;
  } else if (hasChannel) {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Você está na versão mais recente (${origin}${u.sourceVersion ? ` também na v${esc(u.sourceVersion)}` : ''}). Última verificação ${fmtClock(u.checkedAt)}.</span>`;
  } else {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Nenhuma fonte de atualização nesta máquina. Configure <code>updateRepo</code> (releases do GitHub) ou <code>updateSource</code> (pasta) no config.json.</span>`;
  }
}

/* ---------- render: sistema ---------- */
function renderDoctor() {
  const d = estado() && estado().doctor;
  const box = $('#doctor');
  if (!d) { box.innerHTML = '<div class="empty">Verificando o ambiente…</div>'; return; }
  // `goto` (opcional): o check cita uma coisa configurável do app, então clicar
  // leva até ela (a conta abre o card dela em Contas)
  const checks = [
    { ok: !!d.gh, label: 'GitHub CLI', detail: d.gh || 'gh não encontrado no PATH' },
    {
      ok: d.ghAuth, label: estado().config.ghUser ? `Conta @${estado().config.ghUser}` : 'Conta do GitHub',
      detail: d.ghAuth ? 'autenticada no gh' : 'sem token: rode gh auth login (conta de trabalho)',
      goto: estado().config.ghUser ? `sys:accounts:.acct-label[data-user="${escAttrSelector(estado().config.ghUser)}"]` : 'sys:accounts:#accountsManager'
    },
    { ok: !!d.claude, label: 'Claude Code', detail: d.claude || 'claude não encontrado no PATH', goto: 'sys:plans:#claudeProfilesManager' },
    // Git Bash é pré-requisito só no Windows (CLAUDE_CODE_GIT_BASH_PATH)
    ...(ehWin() ? [{ ok: !!d.gitBash, label: 'Git Bash', detail: d.gitBash || 'não encontrado: sessões do Claude podem travar' }] : []),
    { ok: true, label: 'Pasta de trabalho', detail: d.workspace },
    // ambiente ok não quer dizer que vai achar PR: os checks de operação (conta
    // sem organização, conta sem token, tudo silenciado) moram no pure.js
    ...operationChecks(estado().accounts),
    // nem que vai conseguir ABRIR a sessão: rodar como root faz toda revisão
    // autônoma morrer no spawn, com o resto da tela verde
    ...runtimeChecks(estado().doctor, estado().config)
  ];
  box.innerHTML = checks.map(c => `
    <div class="check ${c.ok ? 'ok' : 'bad'}${c.goto ? ' is-goto' : ''}"${c.goto ? ` data-goto="${esc(c.goto)}" role="button" tabindex="0" title="Abrir a configuração deste item"` : ''}>
      <span class="led"></span>
      <div><div class="label">${esc(c.label)}</div><div class="detail">${esc(c.detail)}</div></div>
    </div>`).join('');
  $('#about').innerHTML = `O polling usa só o GitHub CLI (zero tokens de IA). Claude ou Codex entram apenas quando uma sessão de IA é aberta.`;
  // versão e caminho dos dados moram no rodapé da sidebar, visíveis em qualquer seção.
  // A versão leva às Novidades dela (a menção mais citada da tela toda).
  $('#sysFoot').innerHTML = `<span class="is-goto" data-goto="sys:news:#relNotes" role="button" tabindex="0" title="Ver as novidades desta versão">Farol v${esc(estado().app.version)}</span><br>dados em <code>${esc(estado().paths.home)}</code>`;
}

// Novidades por versão (mostradas na aba Sistema; a versão atual vem marcada).
// Ao cortar uma release, some uma linha aqui no topo.
const RELEASE_NOTES = [
  ['2.59.4', ['Entregas: até 5000 por organização. Organização com mais de 1000 entregas no período mostrava só as 1000 mais recentes, e os números e o gráfico ficavam abaixo do real. A busca agora divide o período quando uma consulta volta cheia, e o aviso de limite só aparece acima de 5000.',
    'O instalador do Windows volta a levar o servidor do Jira. Quem instalava pelo Farol-Setup.exe ficava sem ele até o primeiro auto-update.',
    'Os guias vêm com o app: configuração, gates de revisão, macOS e Linux, e release ficam em quatro guias na pasta docs da instalação.']],
  ['2.59.3', ['O card de commit novo diz quem está com a bola. Quando o autor envia commit durante a revisão, a caixa azul mostra "Reviso de novo sozinho a partir de 19:47", avisa quando a revisão nova está rodando, e fica âmbar com o motivo quando o Farol não vai agir sozinho. Antes o card pedia uma revisão nova num caso em que o app já ia revisar minutos depois.',
    'Aprovar, Pedir mudanças e Só comentar saíram do card de commit novo, porque o texto fala do commit anterior e o GitHub recusaria a postagem. O botão agora é Revisar agora.',
    'Commit novo ou pedido de revisão destrava o que ficava preso: a revisão refeita que falhava, a revisão estacionada por falha e o PR que você pulou, se ele ainda pede a sua revisão, voltam sozinhos. Continuam manuais a revisão que você cancelou, o PR que você ignorou e a revisão que ficou estacionada antes da v2.57.4, que não tem motivo gravado pra dizer se foi cancelamento.',
    'Acabou o teto de 3 revisões automáticas por PR por dia. Se 3 revisões seguidas pegarem commit novo no meio, o Farol espera 30 minutos sem push e volta sozinho. Com a sincronização entre aparelhos ligada, o teto compartilhado continua.',
    'O README ganhou perguntas frequentes sobre commit novo durante a revisão, com cada motivo pelo qual o Farol não revisa sozinho e a saída de cada um.']],
  ['2.59.2', ['A tela de fila vazia parou de nomear a organização errada quando você monitora mais de uma. A frase "o Farol monitora X a cada N minutos" lia o campo antigo de organizações, o de quando o Farol tinha uma conta só, e esse campo deixa de valer no momento em que você cadastra contas no painel Contas: de lá em diante quem manda são as organizações de cada conta, e o antigo fica parado no que você digitou um dia. Medido numa máquina real, a tela prometia monitorar uma organização enquanto o Farol buscava em cinco. Agora a frase nomeia o que ele de fato consulta.',
    'Escolher uma conta no seletor mudava a lista e não mudava a frase: o vazio continuava citando as organizações do campo global, incluindo organização que aquela conta nem cobre. Agora a frase acompanha o filtro, com as organizações daquela conta, ou as de todas em Todas.',
    'Organização monitorada só por conta silenciada, ou por conta sem login no gh, aparecia como monitorada. As duas estão fora da busca, a silenciada por escolha sua e a sem login porque o Farol pula a consulta dela, então citá-las prometia vigilância que não existe. Saíram da frase. Nada aqui muda decisão de revisão: é texto de tela.']],
  ['2.59.1', ['Entrar no seu Firebase parou de acusar o Firebase por problema que era de configuração sua. O app conhecia sete recusas do login e mandava todo o resto para "o Firebase respondeu em formato inesperado", que manda investigar o fornecedor; caíam ali justamente as que você resolve sozinho em um clique, como o provedor de e-mail e senha desligado no console, o Authentication do projeto nunca inicializado e o e-mail digitado errado. Agora cada uma diz o que é e onde resolver.',
    'Conta que pede confirmação no celular passou a ser reconhecida. Com segundo fator ligado, o Firebase responde bem, só que pedindo a etapa seguinte em vez da sessão, e o app lia isso como defeito do fornecedor. O login do Farol não sabe fazer essa etapa, então ele passa a dizer exatamente isso e a sugerir um usuário sem segundo fator para a sincronização.',
    'A tentativa que falhou não apaga mais o que você digitou. O e-mail sumia junto com a senha a cada recusa, e quem estava justamente corrigindo a configuração do outro lado redigitava os dois a cada ida e volta. Agora só o login que dá certo limpa os campos, e o campo de senha ganhou o botão de mostrar e ocultar para conferir antes de tentar de novo.',
    'Recusa que só sai com ação sua parou de ser tentada a cada ciclo: provedor desligado, Authentication não inicializado e segundo fator não viram sessão por insistência.']],
  ['2.59.0', ['Seus aparelhos passam a conversar entre si. Se você usa o Farol em mais de uma máquina, as duas analisavam o mesmo PR e você pagava a conta duas vezes; agora um assume e o outro espera, com o card da fila dizendo quem está com ele. Ligue em Sistema > Sincronização, apontando para o seu próprio Firebase. Nasce desligado: quem não ligar não muda nada.',
    'A aba Consumo ganhou a visão "Todos os aparelhos", com o gasto somado e a quebra por máquina. O seletor de janela subiu para o topo da seção, porque vale para as duas visões.',
    'O que sobe para o seu banco são hashes do PR, qual aparelho está com ele e os números de consumo. Nome de repositório, título, diff e relatório nunca saem da sua máquina.',
    'Análise que perde a coordenação no meio do caminho não posta review: se outro aparelho pode ter assumido o PR, nada sai no GitHub. E coordenação fora do ar faz a revisão esperar, não estacionar.']],
  ['2.58.1', ['A revisão que não conseguiu ler nada parou de virar uma lista de pendências sobre o seu PR. Caso real de 10/09/2026: a assinatura do Claude venceu, as quatro leituras em paralelo morreram antes de abrir o primeiro arquivo, e a sessão sobreviveu e devolveu um resultado bem-formado descrevendo a própria morte. Como nada quebrou, o app gravou aquilo como veredito, e o PR apareceu em “Precisa de você” com 24 pendências que ninguém tinha lido. Agora um resultado que não analisou nada, sem uma linha escrita em lugar nenhum, e que aponta falha de credencial ou de rede, é tratado como falha: o PR volta para a fila com o motivo escrito, em vez de carregar uma acusação inventada. Revisão parcial que chegou a escrever algum achado continua sendo revisão.',
    'Login vencido voltou a ser reconhecido como login vencido. O app conhecia uma das duas frases que o Claude Code usa para dizer que a credencial caiu; a outra, a que aparece quando a renovação automática falha, não casava com nada e virava “erro desconhecido do aplicativo”. O Diagnóstico culpava o Farol por um problema que era da assinatura, e quem lia não tinha como saber que bastava refazer o login.',
    'O Farol parou de brigar com o Claude Code pelo mesmo arquivo de configuração. Ele gravava a permissão da pasta de trabalho por cima do arquivo aberto, sem a troca segura que o resto do app usa, e ainda reescrevia tudo a cada abertura por causa de um campo que o próprio Claude Code apaga quando salva: os dois escrevendo no mesmo lugar o tempo todo, e o aviso de “arquivo ilegível” a cada boot. Agora a gravação é atômica e só acontece quando a permissão de fato falta.']],
  ['2.58.0', ["A fila passou a alternar entre as orgs em vez de atender por ordem de chegada. O Farol sempre separou o trabalho por conta, então duas contas nunca disputaram vez entre si; o que não existia era divisão entre as orgs de uma mesma conta. Uma org de alto volume comia o lugar sozinha e a org pequena esperava a fila inteira da grande esvaziar. Agora a próxima vaga vai para a org que está esperando há mais tempo, e dentro da mesma org continua valendo a ordem de chegada: com dez PRs de uma org e um de outra, o PR sozinho entra na segunda vaga, não na décima primeira. Quem tem uma org por conta não vê diferença nenhuma.", "Cada conta ganhou uma cota dentro do perfil de IA que ela usa. O teto de gasto sempre foi do perfil, não da conta: duas contas apontando para o mesmo perfil dividiam um teto único, e a de alto volume queimava a cota do dia sozinha. A outra era barrada sem nunca ter tido uma revisão, e o aviso falava do perfil, então nem dava para ver quem tinha consumido. Agora o teto do dia é dividido entre as contas daquele perfil, e o aviso diz quem cedeu a vez, para quem e quanto falta.", "A cota só vale quando há disputa de verdade. Se ninguém do outro lado está esperando, a conta segue sendo atendida até o teto do perfil, como antes. Com fila, o Farol divide; sem fila, o que chegar é atendido.", "Teto global de revisões simultâneas, opcional, em Sistema > Automação: um limite do total rodando ao mesmo tempo somando todas as contas. Vem desligado, que é o comportamento de sempre. A vaga que liberar vai para a org que espera há mais tempo, não para a primeira da fila.", "Um painel de Justiça de fila na aba Consumo, mostrando por org quantos PRs esperam e quando ela foi atendida pela última vez, e por perfil cada conta contra a própria cota, marcando quem está cedendo a vez. Ele existe porque uma automação que cede a vez, vista de fora, é idêntica a uma automação quebrada. Some sozinho quando não há rodízio a explicar.", "Peso por conta no painel Contas, para quem não quer divisão igual: uma conta pode valer o dobro, o triplo ou a metade das outras no rateio da cota. O padrão é todo mundo igual.", "Token OAuth expirado deixou de ser tratado como problema de rede. A mensagem do provedor vem com um sufixo de tentativas de reconexao, e isso fazia a falha ser lida como transitoria: o Farol relancava a revisao contra uma credencial que nao ia funcionar ate esgotar as tentativas, e o PR parava com “falhou varias vezes seguidas”. Agora a credencial expirada e reconhecida na primeira falha e o card diz o que de fato resolve, que e renovar o login do perfil em Plano e chaves antes de clicar em Revisar. Vale tambem para os PRs que ja estavam parados por tentativas esgotadas.", "Um token OAuth solto no ambiente da maquina deixou de vencer o perfil escolhido. O Farol ja limpava as variaveis de chave, de URL e de diretorio antes de cada sessao, mas nao o CLAUDE_CODE_OAUTH_TOKEN, que passa por cima do login salvo no diretorio do perfil: um token expirado esquecido no shell se reinjetava em toda sessao nova e derrubava a revisao sem nada na tela explicar. Agora ele e removido junto com as outras, no ambiente e tambem dentro do shell no macOS e no Linux, onde o perfil do usuario e carregado depois.", "Sessao que so produziu texto de progresso deixou de contar como decisao. Uma resposta em prosa dizendo que esta esperando lint, testes ou subagentes podia encobrir uma verificacao interrompida ou uma ferramenta recusada, e o Farol seguia adiante como se tivesse um parecer. Agora, sem o resultado estruturado, a revisao fica explicitamente nao concluida: nao posta nada e nao e relancada sozinha para repetir a acao ja recusada.", "A leitura do resultado da revisao ficou mais rigorosa: aceita o JSON puro ou um unico bloco marcado como json, e parou de confundir chaves de template no meio da prosa com o comeco do objeto. Bloco ambiguo, nao encerrado ou fora do contrato continua recusado, em vez de virar um parecer meio lido.", "O protocolo de revisao passou a exigir que as verificacoes necessarias terminem antes do parecer. Quando alguma nao puder concluir, a sessao devolve o envelope marcado como incompleto e pede decisao sua, em vez de omitir o resultado.", "Nada aqui muda o resultado de uma revisão: as políticas mexem só em ordem e admissão, e um PR atendido mais cedo ou mais tarde recebe exatamente a mesma revisão, com os mesmos gates de aprovação de sempre."]],
  ['2.57.6', ['O card de “Precisa de você” parou de sumir quando você filtra por conta. A conta dona da revisão era descartada no caminho entre o motor e a tela, e sem ela o app tentava adivinhar pela organização do repositório: em organização que não está cadastrada nas suas contas não havia palpite, e o card aparecia em Todas e sumia ao escolher qualquer conta, sem erro e sem aviso. Em organização cadastrada o palpite acertava por coincidência, e foi por isso que a falha ficou escondida.', 'A conversa do PR passa a agir pela conta dona daquele PR. Conversando sobre um PR de organização não cadastrada, a sessão caía na conta principal, e num repositório privado que essa conta não enxerga a postagem morria com não encontrado. O app já sabia de quem era o PR e jogava essa informação fora; agora ele a usa.', 'Electron atualizado da série 43 para a 44, que é a base do aplicativo de janela. A instalação e a atualização passaram a conferir o runtime antes de dar por pronto: a compatibilidade sai de uma regra única usada pelo instalador e pelo update, e pacote sem requisito declarado recusa explicitamente pedindo o instalador completo, em vez de instalar algo que não abriria. O CI ganhou provas de execução real do Electron nos três sistemas.']],
  ['2.57.5', ['PR que já estava estacionado antes da v2.57.4 também aparece avisado no card. O arquivo antigo guardava só a chave, sem hora nem motivo, e o aviso só era desenhado quando havia motivo: o estoque que já estava parado continuava idêntico a um PR nunca revisado. Agora ele aparece como parou antes desta versão, sem motivo registrado, com a lembrança de que o botão Revisar tenta de novo.']],
  ['2.57.4', ['O card da fila diz quando e por que a revisão automática parou. Caso real de 03/09/2026: a sessão abriu, morreu sete minutos depois sem postar nada, e o PR voltou para Sua fila idêntico a um PR que nunca foi revisado. O único rastro era um toast de cinco segundos e uma linha no Diagnóstico, e o PR ficou duas horas parado enquanto o mesmo Farol revisava os vizinhos. Agora o estacionamento guarda a hora e o motivo (falha, cancelamento, orçamento estourado ou tentativas esgotadas) e o card mostra isso embaixo do título, lembrando que o botão Revisar tenta de novo.', 'Provedor de IA fora do ar não estaciona mais o PR. API Error 529 Overloaded e os demais 5xx caíam em falha desconhecida, que é permanente por desenho, e o PR esperava clique. Sete sessões morreram assim na mesma manhã. O próprio texto do provedor diz que é temporário: agora a classe é transitória, o PR volta para a fila e relança sozinho com o teto de três tentativas, retomando a sessão interrompida quando dá.', 'A poda do estacionamento exige duas ausências seguidas do panorama. A busca do GitHub é índice, e índice atrasado responde não achei sobre PR aberto: uma ausência tirava a chave do estacionamento, o ciclo seguinte relançava a sessão fadada à mesma falha, e ela estacionava de novo. Agora vale a mesma régua da poda da autoanálise: duas medições seguidas concordando.']],
  ['2.57.3', ["Aprovação não sai mais com a pipe reprovando. A regra de CI vermelho só existia no protocolo da sessão e a política de aprovar com ressalvas passava por cima: a revisão dizia \"precisa de você\" e o app postava o APPROVE mesmo assim. Caso real de 02/09/2026, com aprovação postada com o check de auditoria vermelho e merge por bypass três minutos depois. Agora o app lê os checks obrigatórios da branch de destino na saída da revisão e segura a aprovação quando qualquer um está em falha, inclusive na revisão iniciada pelo botão Revisar. Check ainda rodando não segura, e leitura que falha não inventa CI vermelho.","Gatilho declarado no tipo é gatilho provado. O revisor rebaixava para ressalva um defeito no fluxo principal da feature por não ter provado que o backend produz aquele valor, quando o valor estava declarado na própria união de tipos do código. Agora o ônus de tratar valor que o código declara possível é do PR, e defeito assim no fluxo principal é bloqueio. Contestação passada do autor calibra o tom, nunca a severidade.","Ocultar análise apagava a análise. O botão prometia recolher da tela e por baixo removia o registro do disco: o relatório, as dicas e a evidência que uma sessão paga produziu morriam num clique que parecia reversível, e recuperar exigia reanalisar, ou seja, pagar de novo pra reproduzir o que já tinha sido pago. Agora ocultar é só visual, a análise fica guardada e o botão vira Mostrar análise, que a traz de volta sem custar nada.","Commit novo no PR não apaga mais a análise inteira. O que envelhece com um push é o veredito, não o texto: o relatório continua descrevendo o código que foi lido. A análise fica, marcada como desatualizada, com um aviso no topo dizendo isso. O Merge continua indisponível, porque veredito vencido não autoriza nada, e o motivo aparece escrito no botão.","A remoção silenciosa acabou. Quando o PR saía da lista de PRs seus abertos, a análise era apagada sem uma linha de log e sem nada na tela. Agora a remoção é registrada, e só acontece depois de duas buscas seguidas confirmarem a ausência, porque a busca do GitHub é índice e índice atrasado já respondeu não achei sobre PR que estava aberto.","O gasto de uma análise que envelheceu aparece no Consumo como parcial, e não como descartada: a sessão não liberou merge, mas produziu um relatório que continua na tela.","Falha de rede na sessão autônoma: morte após retries de API e estouro do teto de 30 min agora são transitórios (voltam pra fila e relançam sozinhos, teto de 3) em vez de estacionar o PR.","Relançamento retoma a sessão interrompida com --resume (o que já foi lido e verificado não é pago de novo); sem sessão recuperável, ou com commit novo no PR durante a espera, recomeça do zero como antes. Vale pras revisões feitas pelo Claude: no caminho do Codex o Farol não recebe o identificador da sessão, então não há o que retomar e o relançamento lê do zero."]],
  ['2.57.2', ['Aprovação em branco não sai mais sozinha. O gate exigia texto para reprovar sozinho e não exigia para aprovar, então uma aprovação sem uma palavra sairia no PR assinada por você. As doze aprovações automáticas mais recentes têm de 651 a 2886 caracteres, então isto não segura nada que hoje passa: segura o envelope que veio quebrado, que agora chega como decisão sua, com o motivo escrito.', 'O rascunho solto na raiz do workspace também passou a ter prazo. A limpeza anterior cobria só o tmp, e sobraram 331 MB um nível acima. Agora o Farol também poda a raiz no boot, preservando o que ele mesmo semeia, o state e o tmp. A lista do que preservar vem do próprio template, então arquivo novo já nasce protegido; e se o Farol não conseguir ler o template, ele não apaga nada.', 'Parte do PR ficou sem análise deixa de aparecer quando o problema é o instrumento. Em sessões do Codex, que não reportam leitura de arquivo, a cobertura nunca podia ser observada e o Merge da autoanálise culpava a análise por isso. O botão continua indisponível, porque sem prova de leitura não se libera merge, mas a linha agora diz a verdade.']],
  ['2.57.1', ['A revisão automática aprende o sync de linhagem: PR que só promove uma branch contínua do gitflow para outra (release para production, por exemplo) era lido como um pacote gigante sem card e ficava sempre esperando o seu clique. Agora a revisão prova a procedência de cada commit (veio de PR mesclado ou tag publicada) em vez de reler tudo, e o sync verificado sai aprovável sozinho, citando os PRs e tags de origem. Commit sem procedência continua sendo lido por inteiro.']],
  ['2.57.0', ['O Farol só começa a revisar sozinho quando 100% dos checks obrigatórios do PR estão verdes. Sugestão do Guilherme, a partir de dois desperdícios medidos no dia a dia: o Farol começava a revisar, alguém clicava em Update branch, entrava commit novo e a sessão inteira virava lixo; e o Farol aprovava, a pipe quebrava depois, e o ciclo de correção custava outra revisão.', 'Obrigatórios, e não todos: o Farol lê da branch de destino quais checks ela exige, então um check que vive vermelho sem ser exigido não segura nada. Exigir tudo verde nunca revisaria esses repositórios.', 'Quem tem pressa não espera: o botão Revisar atravessa o gate sem consultar nada, como sempre fez. Quando o Farol segura, ele avisa uma vez dizendo o que falta (o check, e se está rodando, vermelho ou nem começou) e lembra que o botão continua valendo.', 'Check relançado deixa de ser confundido com a rodada que falhou antes: quando o mesmo check aparece mais de uma vez, vale a rodada mais recente. E falta de dado nunca segura: repositório sem check obrigatório, ou leitura que não deu certo, seguem revisando na hora.']],
  ['2.56.6', ['Sessão que morre no meio deixa de sumir da conta. O consumo só era registrado quando a sessão chegava ao fim e reportava o total, então sessão interrompida antes disso não gerava registro nenhum, e os tokens já gastos ficavam fora da tela e fora do teto de orçamento. Agora o Farol soma o gasto enquanto a sessão roda e registra o que houve mesmo quando ela não termina.', 'Custo estimado nunca se disfarça de medido. O valor em dólar só existe no relatório final da sessão, então sessão interrompida tem token medido e custo estimado, e a tela diz qual é qual (o valor aparece com ~ e explica de onde veio). A taxa vem das suas próprias sessões concluídas do mesmo tipo e modelo, não de tabela de preço, então se corrige sozinha quando o preço muda.', 'Análise descartada deixa de aparecer como sucesso. Quando entra commit novo e o resultado da autoanálise é jogado fora, o gasto existiu e não virou nada, mas era gravado como concluído. Agora esses casos têm nome próprio na coluna Estado (descartada e parcial), inclusive quando o descarte só é percebido ciclos depois.', 'A aba Consumo passa a responder quanto do gasto virou resultado: uma linha ao pé da tabela soma o que não virou nada e quanto do custo é estimativa. Ela só aparece quando há o que dizer.']],
  ['2.56.5', ['O Farol apaga sozinho o rascunho antigo das sessões. As sessões de revisão criam material próprio em ~/.farol/workspace/tmp (clone de repositório, patch avulso, cópia para comparar), e nada olhava para aquilo: o app limpava só o que ele mesmo cria. Medido numa instalação de uso diário, eram 4,0 GB em 394.683 arquivos, o mais novo com quatro dias. Agora, no boot, o que passou de sete dias sai. O prazo é folgado porque uma sessão vive no máximo trinta minutos, e a limpeza nunca derruba a abertura do app.']],
  ['2.56.4', ['A autoanálise para na hora em que entra commit novo, em vez de rodar até o fim pra ser descartada. O resultado dela vale pro commit que ela leu, então commit novo no meio sempre invalidou a análise; só que a conferência acontecia no fim, com a sessão inteira já paga. Num único dia isso jogou fora oito de dez análises. Agora o Farol interrompe no ciclo em que percebe o commit novo e diz por quê.', 'O teto de gasto estourado aparece no Radar e no log. Passar do teto pausa a revisão automática, e isso é assim desde sempre; o que mudou é que a fila vazia dizia que o Farol estava monitorando, e o único aviso era um alerta passageiro. Agora a fila vazia diz que a automação está pausada, por qual perfil e com quanto de quanto.', 'A contagem de "aprovou sozinho hoje" passou a dizer a verdade: ela somava também o que você mandou postar pelo chat e contava cada rodada de um mesmo PR como um PR diferente. Num dia de 2 PRs aprovados por conta própria, a tela dizia 5.', 'Uma revisão que refina o próprio parecer deixa de travar a aprovação automática. Quando a mesma sessão reavaliava uma afirmação segundos depois, o Farol lia aquilo como discordância entre rodadas e segurava o PR pra sempre.', 'A análise dos seus PRs passou a registrar a qual commit cada verificação pertence. Sem isso, um ponto refutado já corrigido bloqueava o Merge daquele PR pra sempre, e um ponto confirmado sobre trecho já alterado liberava o Merge sobre código que ninguém conferiu.', 'A limpeza de etiqueta presa no boot voltou a funcionar: ela rodava antes de o Farol resolver as credenciais e nunca removeu nada. Etiqueta presa faz os Farols do time saírem de cena naquele PR sem ninguém estar revisando.', 'Rodada que não conseguiu confirmar o commit deixa rastro, envelope incompleto é explicado como envelope em vez de virar "precisa da sua atenção", e o registro de comandos disparados parou de crescer sem limite (estava com 60 MB).']],
  ['2.56.3', ['Destaques do time agora só aparece e trabalha quando você habilita a função em Sistema > Preferências. Desligado, o Farol não pede à IA que procure elogios, não grava novos destaques e não roda o kudos; ao habilitar, suas próprias autoanálises também entram na visão com identidade e PR atribuídos pelo app.', 'Entregas também passa a ser opt-in. Desligada, a aba fica oculta e o Farol não consulta no GitHub os PRs mergeados. Essa visão não usa IA, mas agora evita rede e processamento local quando você não a utiliza.']],
  ['2.56.2', ['Um token do GitHub exportado no terminal da sua máquina deixa de valer por cima da conta que o Farol resolveu. O app monta o ambiente de cada comando gh a partir do ambiente da máquina, então um GH_TOKEN (ou GITHUB_TOKEN) solto no seu shell viajava junto, e nas chamadas em que o Farol não tinha token resolvido o gh saía agindo como o dono daquela variável, sem nada na tela e sem linha no log. Com conta e token normais, nada muda.', 'O Diagnóstico deixa de ficar verde por um token que o Farol não usaria. Sem conta configurada, o check de autenticação do GitHub aceitava o token do ambiente e podia dizer "autenticado" enquanto nenhuma ação usaria aquela credencial; agora ele pergunta no mesmo ambiente em que o app age.']],
  ['2.56.1', ['A publicação passa a construir e anexar o instalador de macOS sozinha. Até aqui era um lembrete impresso no fim do script, e três releases seguidas saíram sem o anexo: quem fosse instalar no Mac pela primeira vez não tinha por onde. Lembrete que depende de disciplina não é processo.', 'O parecer da análise passou a viver num campo só. "Aprovável" era gravado duas vezes, em dois campos que diziam a mesma coisa; agora um deriva do outro na leitura, e análise antiga continua sendo lida como sempre.']],
  ['2.56.0', ['O Jira deixa de ser obrigatório pro Merge da autoanálise. Em repo que não usa card, o botão ficaria indisponível pra sempre com "atendimento ao card não comprovado" como único motivo; agora, quando não existe card a cobrar (Jira desligado, organização sem site ligado, ou PR sem chave de card), o requisito não se aplica.', 'O que mantém isso seguro: quem decide se EXISTE requisito é o Farol, que é quem chama o Jira e sabe por que não leu. Card que existe e não pôde ser lido (credencial recusada, Jira fora do ar, sem permissão) continua segurando o Merge, porque ali a resposta é "não sei" e não "não há". E card que a análise diz que não foi atendido continua bloqueando: dispensar o requisito nunca apaga um achado.']],
  ['2.55.1', ['Conserto do que a versão anterior prometia: o agente que faz a leitura do PR não sabia ler do escopo que o Farol prepara, então ele baixava o diff inteiro num arquivo só e a cobertura podia nunca ser comprovada. Na prática o Merge ficaria indisponível pra sempre, sem dar pra entender por quê. Agora a instrução é condicional: com escopo preparado ele lê de lá, um arquivo por vez; sem escopo, a revisão comum segue como sempre.', 'A autoanálise rodou de ponta a ponta contra um PR real pela primeira vez: 3 arquivos no escopo, 3 abertos e observados, 3 verificações registradas e a evidência amarrada ao commit analisado.']],
  ['2.55.0', ['O botão Merge de "Meus PRs" volta a funcionar, agora sobre evidência que o próprio Farol observa: qual commit foi analisado, se a sessão terminou, quais arquivos ela de fato abriu e o que a verificação empírica devolveu. O parecer da análise segue na tela, e segue sem autorizar nada.', 'A cobertura passou a ser medida, não declarada. O Farol grava o patch de cada arquivo do PR num diretório próprio e a análise lê dali, um arquivo por vez. Arquivo que ela não abrir conta como não analisado, e não existe nada que ela possa escrever pra aumentar esse número. Diminuir, ela pode: quando abre um arquivo e ainda assim não consegue avaliá-lo, declara e a cobertura cai.', 'A autoanálise passou a verificar de verdade. A checagem empírica que existia só na revisão oficial agora vale pra ela também, com registro próprio: verificação que refuta uma afirmação derruba a elegibilidade, e verificação que faltou vale como "não sei", nunca como aprovação.', 'O card do Jira passa a ser lido pelo Farol também na autoanálise. Antes a sessão buscava sozinha e o resultado variava a cada rodada.', 'A análise pode investigar com git de novo. A regra antiga proibia qualquer comando git e com isso impedia a verificação que dá valor a ela. Continua proibido MUTAR: nada de escrever no seu repositório ou trocar a sua branch.']],
  ['2.54.8', ['O botão Merge de "Meus PRs" deixa de ser autorizado pelo veredito da própria análise. Até aqui o único gate de qualidade do merge era um "aprovável" que a sessão produzia, e o mesmo gate servia o "Merge (admin)", que bypassa a proteção da branch: a proteção do repositório deixava de valer justamente onde a decisão de qualidade era a mais frágil. Agora quem calcula a elegibilidade é o Farol, sobre o que ele mesmo observa, e o veredito da análise fica na tela como parecer.', 'Falta de evidência passa a valer como "não sei", nunca como "pode": análise que não terminou, cobertura não comprovada ou card não lido deixam o PR inelegível.', 'O botão desabilitado passou a dizer por quê: uma frase explicando que a autoanálise ainda não comprova qualidade suficiente, e os motivos listados em português ("Sem cobertura comprovada", "Atendimento ao card não comprovado") em vez de sumir da tela.', 'ATENÇÃO: nesta versão o botão Merge fica indisponível em todos os PRs, de propósito. A análise ainda não produz a evidência que o gate novo exige, então nenhuma análise libera merge, nem as antigas nem as novas. A elegibilidade volta quando o Farol passar a observar por conta própria a cobertura, o desfecho da sessão e a verificação. Não é a análise que vai declarar isso: quem se autodeclara completo devolve ao modelo a autoridade que esta versão tirou dele. O merge pelo próprio GitHub segue normal.']],
  ['2.54.7', ['Sem mudança de comportamento: esta versão carrega documentação e uma trava de desenvolvimento, e nada muda para quem usa o Farol.', 'O servidor do Jira ganhou teste de verdade. Ele era o único componente que roda como programa separado sem nenhum teste que o executasse (os testes liam arquivos de configuração e concluíam que estava certo), e foi por isso que o defeito da versão anterior passou pelo gate.', 'Nada sobe mais sem o gate local passar, e tudo passa a entrar por pull request, o que faz a checagem nos três sistemas acontecer antes e não depois.']],
  ['2.54.6', ['Revisão com Jira cadastrado volta a funcionar na cópia instalada. Eram dois problemas somados: os instaladores não copiavam a pasta `tools/` para a cópia instalada (o servidor local do Jira não existia lá, embora viajasse no pacote desde a v2.53.2), e o Farol chamava o binário do Electron sem avisar que ele deveria agir como Node, então ele tentava abrir o arquivo como se fosse um aplicativo. Instalação e atualização passam a levar a pasta, e ela é ignorada com segurança quando falta na origem em vez de apagar o que já estava instalado. Correção do Guilherme, encontrada no Mac dele.', 'O teste que protege essa pasta parou de depender da ordem da lista: ele reprovava quando a pasta saía do fim da lista, sem nada ter quebrado. Agora lê o laço que copia de verdade e verifica só a presença.']],
  ['2.54.5', ['A autoanálise volta a ser exclusivamente por clique, desfazendo a v2.54.4. Analisar o próprio PR é decisão sua, sempre: quando um commit novo invalida a análise, o card volta a "não analisado" e espera você pedir de novo, em vez de gastar uma sessão por conta própria.']],
  ['2.54.3', ['Commit novo durante a revisão volta a se resolver sozinho. O Farol não posta review sobre código que mudou no meio da sessão e agenda um round novo, mas esse round estava sendo cancelado em silêncio: a marca de "já rodei neste head" era gravada antes de o round acontecer, então a revisão automática morria naquele head e passava a depender de clique. A marca agora só é gravada quando o round acontece de verdade.', 'A label de revisão em andamento passou a ter validade. Quando o app morre no meio de uma revisão a `<conta>:revisando` fica presa no PR, e todo Farol da equipe entendia "já tem alguém revisando" e pulava sem ninguém estar revisando. Label alheia vista há mais de uma hora passa a ser tratada como abandonada, e no boot o Farol remove as que ele mesmo deixou presas.']],
  ['2.54.2', ['Conserto no gate de consciência: o Acrity voltou a ser reconhecido como ferramenta. O gate identificava ele pelo nome curto da label, mas a lista de reviews traz o login completo do bot, então a reprovação dele contava como reprovação de gente e segurava a revisão automática do PR até alguém clicar. A identificação agora usa o tipo de conta informado pela API, o sufixo de bot no login e o nome cadastrado, e vale para qualquer bot de review.', 'O motivo de não ter revisado passa a ficar no farol.log. O automático segurado pelo histórico do head e a revisão que rodou inteira mas não postou porque o código mudou no meio da sessão terminavam sem rastro nenhum, indistinguíveis de uma revisão que morreu; as duas agora registram quem segurou, qual head e o que mudou.']],
  ['2.54.1', ['Calibração do gate de consciência: uma aprovação humana no head não segura mais a revisão automática (ela ainda vale como a segunda aprovação, que é o teto do fluxo); o bloqueio por aprovação passa a valer com duas. Reprovação de gente continua segurando na primeira, e cada pessoa conta pelo último estado dela no head (quem pediu mudanças e depois aprovou conta como aprovação).']],
  ['2.54.0', ['O review automático agora tem consciência do estado do PR: se o head atual já tem aprovação ou pedido de mudanças de uma pessoa (review de ferramenta não conta), ou se alguém está revisando, a sessão não roda sozinha e o PR espera o seu clique, com aviso único no app. Commit novo zera o histórico e a automação volta, conforme a configuração da conta.', 'A label `<conta>:revisando` voltou a ser o sinal visível de revisão em andamento (decisão final: ela deixa o time ciente). O comentário fixo de "não vou duplicar a revisão" segue removido, e as refs invisíveis da v2.53.9 ficam só como leitura de transição.', 'Ver alguém revisando sempre segura o automático: caiu a exceção de dono de código que mandava revisar por cima; o guarda de nunca co-assinar onde você é a autoridade continua.']],
  ['2.53.9', ['Nada de automação aparece mais publicamente no GitHub: a label `<conta>:revisando` deixou de existir e o sinal de revisão em andamento virou uma ref git invisível na interface, com validade de 1 hora e coleta de refs órfãs. Cópias antigas seguem coordenadas na transição: esta versão lê os dois sinais e escreve só o invisível.', 'O comentário público de pulo ("não vou duplicar a revisão") foi removido: era texto fixo e reconhecível. A saída de cena continua durável e o aviso virou toast no app, sem nada postado no PR.']],
  ['2.53.8', ['No macOS, o Farol deixa de aparecer como `Electron` na barra de menu/Cmd-Tab: o processo declara `Farol` no boot e o instalador ajusta a identidade visível do bundle interno do Electron preservado nos updates.']],
  ['2.53.7', ['Sistema > Automação agora separa Claude Code e Codex: cada provedor preserva o próprio modelo e esforço, e o Codex oferece os níveis minimal, low, medium, high e xhigh aceitos pelo CLI.', 'O consumo do Codex registra tokens, tipo de operação e o modelo realmente enviado. Sem modelo explícito, aparece `Codex (padrão)`; o Farol não atribui mais um alias Claude à sessão Codex.', 'Perfis Codex deixaram de mostrar ou aplicar orçamento fictício em US$: o CLI informa tokens, mas não expõe saldo da cota nem custo por sessão. A retomada de round e chat também passou a usar `codex exec resume`.']],
  ['2.53.6', ['O fluxo Codex agora tem ação direta de login: perfis Codex em Sistema > Plano e chaves mostram "Abrir sessão de login", abrindo um terminal próprio com `codex login` e `codex login status`.', 'No Windows, o Farol inclui no boot os diretórios locais do Codex instalado em `%LOCALAPPDATA%\\OpenAI\\Codex\\bin`, porque o atalho do app pode não herdar o mesmo PATH do terminal.', 'Acentuação do diagnóstico Codex corrigida: chamadas via `cmd.exe` forçam UTF-8 antes do comando, evitando mensagens como `n�� reconhecido` quando o Windows devolve erro em português.']],
  ['2.53.5', ['Correção de acabamento da primeira versão com Codex: quando há perfil Codex configurado, a Visão geral passa a mostrar `Codex CLI` e `Login Codex` separadamente.', 'O selo "SEM CODEX" deixou de esconder a causa: agora o tooltip mostra a primeira linha real de `codex login status`, então fica claro se o app não encontrou o CLI, se o login é por API key ou se falta login ChatGPT.']],
  ['2.53.4', ['O Farol passa a usar também a cota do plano ChatGPT pelo Codex CLI. Em Sistema > Plano e chaves, além de login Claude e chave de API, agora dá para criar um perfil Codex; ele não pede diretório nem chave e só roda quando `codex login status` confirma login pelo ChatGPT.', 'A alternância usa o mesmo seletor de perfil padrão e o mesmo override por conta GitHub: dá para deixar uma conta no Claude e outra no Codex, ou trocar o padrão quando quiser, sem sair do Farol.', 'Correções de segurança e compatibilidade: o Farol limpa OPENAI_API_KEY e CODEX_API_KEY antes desse caminho para não cair em cobrança por chave, e separa modelo/esforço por executor para não mandar opção de GPT ao Claude nem alias de Claude ao Codex.']],
  ['2.53.3', ['Rodar o Farol como root fazia toda revisão autônoma morrer no instante em que a sessão abria, e o app tratava isso como problema passageiro: relançava a mesma revisão a cada ciclo, pra sempre, sem dizer o motivo. O Claude Code recusa o modo sem prompts de permissão quando o usuário do sistema é root, e agora essa recusa é reconhecida pelo que é (só sai com alguém agindo), então a revisão estaciona na primeira vez.', 'O Diagnóstico passou a avisar antes de doer. Nessa situação os checks de ambiente ficavam todos verdes enquanto nada funcionava; Sistema > Visão geral ganhou a linha "Usuário do sistema" e o relatório copiável traz o mesmo aviso, com a saída: criar um usuário não-root e rodar o Farol por ele. É o caso de quem roda o motor num Android (Termux + proot), onde o login padrão é root.']],
  ['2.53.2', ['Conserto do recurso de Jira em quem instala o Farol pronto: o servidor MCP local do Jira (tools/jira-mcp.js) não viajava no pacote de distribuição, então revisar PR com site de Jira cadastrado mostrava o erro "Unable to find Electron app" em toda cópia instalada, embora funcionasse na máquina que roda do fonte. O arquivo entrou no pacote e um teste novo garante que todo arquivo de tools usado em runtime viaja junto.']],
  ['2.53.1',['Refino da re-revisão automática pós-push da v2.53.0. O mapa de memória que segura o debounce de head quieto e o aviso de teto diário agora é podado a cada ciclo, em vez de crescer pra sempre. O candidato de PR reconstruído a partir de uma pendência travada por commit novo passou a carregar se ele é rascunho de verdade, em vez de assumir que nunca é. E o teto de 3 rodadas automáticas por dia deixou de zerar quando o app reinicia no meio de uma revisão: só o trava de head é liberada, o contador do dia continua valendo.']],
  ['2.53.0', ['O round de re-revisão automática pós-push passou a respeitar de verdade a autonomia que a conta já tinha configurado. Motivação medida: 14 commits em rajada com as rodadas de correção dependendo de clique. Agora um APPROVE stale também relança (antes só pedido de mudanças armava), e a pendência que travava quando o autor empurrava commit novo durante a sessão deixa de segurar o round e passa a destravá-lo sozinha, em vez de travar o próprio mecanismo que a resolveria. Nenhum toggle novo: continua tudo governado pelo que a conta já tinha configurado em Sistema > Contas.', 'Duas proteções de orçamento acompanham a autonomia nova: teto de 3 rodadas automáticas por PR por dia (com aviso único quando estoura; o botão Re-revisar continua valendo sempre) e um debounce de 5 minutos de head quieto contra rajada de pushes.', 'Correção: a conta certa passou a viajar junto de uma pendência bloqueada por commit novo, e essa pendência deixou de poder entrar no pulo de "o push não mudou o diff", que existia pra rebase e merge da base e recriava um travamento silencioso se aplicado ali.']],
  ['2.52.5', ['Ajuste na trava contra review duplicado da v2.52.2. A memória que impede a duplicata passou a durar 5 minutos em vez de 6 horas: ela existe pra cobrir a corrida entre duas vias postando ao mesmo tempo, que dura segundos. Com a janela longa um caso legítimo ficava barrado: se o autor derruba a sua aprovação e pede review de novo no mesmo commit, aprovar outra vez é correto, e a memória vetaria, dando a pendência por resolvida com o PR sem aprovação nenhuma. Passada a janela, quem decide volta a ser a consulta ao GitHub, que sabe distinguir review derrubado de review válido.']],
  ['2.52.4', ['A tela do Jira virou secao propria em Sistema e passou por desenho. Todos os campos ganharam rotulo (placeholder some quando voce digita), o cartao do site se dividiu em tres blocos com papel proprio (identidade, configuracao e credencial) e o mapeamento org do GitHub para site do Jira, que e o coracao do recurso e estava implicito em dois campos de texto, agora se le como uma frase no topo do cartao.', 'Novo: Testar leitura. Cada site ganhou um botao que prova a credencial na hora, sem esperar o proximo PR chegar, e a resposta fica na linha ao lado em vez de num toast que some. Usa o endpoint de identidade do Jira de proposito: qualquer credencial valida responde a ele, entao falha ali e sempre credencial ou URL errada, nunca falta de permissao num projeto.', 'A credencial ganhou bloco separado com cadeado, dizendo onde o segredo fica e que ele nao volta a aparecer, e a barra do cartao acompanha o estado (verde com credencial, ambar sem). O aviso de que o Farol assume todos os MCPs das sessoes a partir do primeiro site saiu do meio do paragrafo e virou aviso emoldurado.', 'A seta do select passou a ser desenhada nos cinco lugares em que a caixa ja era estilizada e a seta continuava sendo a nativa do sistema.']],
  ['2.52.3', ['A queda de rede mais comum desta máquina era tratada como problema PERMANENTE. O gh escreve "dial tcp ...: connectex:" quando não consegue nem abrir conexão com o GitHub, e nenhuma das palavras que o Farol procurava aparece nessa linha; medido no log de 21 a 24/08/2026, 773 falhas de rede entravam como "Falha não classificada". O efeito não era cosmético: postagem de review que morre nessa falha nunca era reenviada sozinha (o reenvio automático só vale pro que é passageiro) e a revisão que caía na mesma rede ficava parada esperando clique.', 'O diagnóstico passou a distinguir episódio de regime. Antes ele somava os eventos e dizia "101 se resolvem sozinhos, 0 exigem ação humana" sobre seis horas seguidas de falha de rede. Agora, quando um problema que passa sozinho dura mais de duas horas com pelo menos duas falhas por hora, o resumo diz a duração, a taxa por hora e que a decisão é sua (rede, provedor), não do app. A aba Sistema mostra a mesma duração.', 'E "nenhuma atualização disponível" deixou de entrar no log como erro: quando o Farol vai atualizar e descobre que já não há atualização, nada foi baixado e nada foi mexido, mas isso aparecia como falha e ainda represava a próxima tentativa por 30 minutos.']],
  ['2.52.2', ['Correção de review duplicado no mesmo PR. Medido no biud-esg#230 em 23/08/2026: a postagem falhou por rede às 22:10 e às 23:04 saíram dois APPROVE com 10 segundos de diferença, um do reenvio automático e outro do clique em Aprovar. Cada caminho pergunta ao GitHub se já existe review seu antes de postar, e os dois perguntaram; a resposta fala do passado, e entre a pergunta e a postagem cabia outra postagem. Agora as postagens do mesmo PR entram em fila e quem chega depois não repete o veredito que acabou de sair para o mesmo commit.', 'O que é legítimo continua passando: rodada nova depois de commit novo posta normalmente, comentário do chat nunca é engolido (comentar duas vezes é conversa, não duplicata), PR de outra pessoa e conta diferente seguem independentes, e postagem que falhou nunca conta como entregue.']],
  ['2.52.1', ['Durante a revisão dá pra ver de quem é o PR. O card de "Analisando agora" passou a mostrar a foto e o @ de quem escreveu o PR, com clique que leva ao perfil no GitHub. É a mesma menção navegável que Revisões recentes, Panorama e Entregas já usavam; o card ao vivo era o último lugar que ainda falava do PR sem dizer por quem você está esperando. Sessão de ferramenta (Kudos, Diagnóstico) e autor desconhecido não ganham rótulo vazio.']],
  ['2.52.0', ['O Farol le cards de VARIOS Jiras, de empresas diferentes. Em Sistema > Jira voce cadastra um site por organizacao do GitHub (URL do Jira, org dona dos PRs, prefixo dos projetos) com e-mail e API token do Atlassian. Antes de abrir a revisao, o Farol descobre o site pela org dona do PR, le o card e injeta titulo, status, criterios de aceite, escopo e fora de escopo no prompt. Some a dependencia do conector Atlassian Rovo do claude.ai, que e um grant por conta e alcanca um tenant so.', 'A ferramenta que a revisao usa passou a ser do Farol e ja nasce apontada pro Jira certo: a sessao sobe com um servidor MCP local (getJiraIssue e busca por JQL) e com strict-mcp-config, que desliga todos os outros MCPs. O modelo continua investigando alem do card, sem a chance de alcancar o Jira de outra empresa. A autoanalise dos seus PRs tambem roda escopada.', 'Sem site cadastrado pra org, o card e nao-verificavel e nunca tenta o site padrao: ler o Jira errado e pior do que nao ler. E card ilegivel agora derruba o cardMet, que antes era afirmacao do modelo sem ninguem conferir.', 'A credencial mora fora do config.json, com permissao restrita, e nunca passa por linha de comando: o arquivo de mcp-config carrega so o id do site e o servidor MCP le o segredo do disco. O texto do card entra delimitado e rotulado como dado, entao nada escrito no card muda o protocolo, o veredito ou o cardMet.', 'Fora do escopo desta entrega: a sessao de chat do PR continua sem o MCP escopado (chat nao produz veredito), e nao ha migracao de dados. Quem nao cadastrar site nenhum nao ve diferenca: o recurso fica desligado, nao loga, nao etiqueta e nao encosta no cardMet.']],
  ['2.51.4', ['O card que travava por commit novo durante a revisao virou um beco sem saida, e agora tem saida. Desde a v2.51.2 o Farol nao posta um review quando o autor empurra commit no meio da revisao (aquele texto fala do codigo anterior) e o card pede uma revisao nova do estado atual, mas so oferecia Aprovar, Pedir mudancas, So comentar, Conversar e Pular, nenhum deles util nesse estado: pra pedir a revisao nova voce tinha que cacar o PR no Panorama. Agora o botao Revisar de novo esta no proprio card. Visto no biud-frontend#796 em 23/08/2026.', 'O round novo substitui o card travado em vez de empilhar: o card antigo fala de um commit que nao esta mais no PR e nunca vai poder ser postado, entao ele sai da mesa e aparece em Revisoes recentes como substituido. E Aprovar deixa de ser a acao principal do card travado, porque naquele estado ela e recusada de qualquer jeito.']],
  ['2.51.3', ['Sigla interna de ferramenta parou de passar como explicacao. Docblock, comentario, mensagem de commit ou titulo de PR que cita codigo de regra do Sonar (S2871), marcador do Acrity ou nome de check sem dizer em palavras o que a regra quer agora vira detalhe nao-bloqueante na revisao. Medido num PR real de 18/08/2026: o autor documentou a correcao citando dois codigos de regra, e a revisao elogiou o registro sem notar que quem abre o arquivo seis meses depois le so uma sigla opaca. O pedido e pelas palavras junto do codigo, nunca no lugar dele, e o supressor (NOSONAR, eslint-disable) fica de fora porque precisa do identificador pra funcionar.', 'O texto que o Farol posta nunca carrega esses identificadores, nem quando ele adota o achado de outra ferramenta: a frase diz o que a regra exige (o Sonar pede comparador no sort) pra o autor entender sem abrir o catalogo da ferramenta. Na pratica ele ja vinha fazendo isso por instinto, agora e regra escrita.']],
  ['2.51.2', ['O APPROVE falhava com "Unprocessable Entity (HTTP 422)" e o botao Aprovar repetia a mesma falha pra sempre. Medido num PR real em 21/08/2026: a revisao terminou as 18:34, o autor tinha empurrado um commit novo dois minutos antes, e o review saiu ancorado no commit que a sessao leu. O GitHub recusou e cada clique em Aprovar reenviava o mesmo pedido recusado. Agora o Farol confere o commit antes de postar: se o PR andou durante a revisao, ele nao posta (aquele texto fala do codigo anterior) e escreve o motivo no card, com os dois commits, pra voce pedir uma revisao nova do estado atual.', 'Erro do GitHub deixou de chegar como frase generica: o gh escreve a recusa em dois canais, e o Farol so lia o da linha curta. Era por isso que o 422 chegava no log e na tela sem dizer o campo recusado. Agora as duas metades andam juntas.', 'Review recusado por causa da ancora de commit ganha uma segunda chance: quando a recusa vem num review sem comentario de linha (o caso do APPROVE), o Farol reenvia uma vez sem a ancora em vez de desistir.']],
  ['2.51.1', ['O Farol comentava que nao ia revisar e revisava por outro caminho. A trava nasceu no lugar errado: vivia no caminho principal, e os outros dois por onde uma revisao pode ser relancada (retentativa apos falha passageira e re-analise pos-push) entravam por baixo dela. Medido num PR real: o aviso saiu as 19:55:52 e a revisao comecou as 19:57:45, com a outra pessoa ainda revisando. Agora a garantia mora no ponto por onde toda revisao passa.', 'Clicar em Revisar volta a valer de verdade: o clique nunca e barrado (voce mandou revisar sabendo que outra pessoa esta la) e agora tambem desfaz a saida de cena, do mesmo jeito que ja acontece com PR que estava aguardando acao manual.', 'As notificacoes do sistema mostravam [object Object] no lugar do motivo, nas tres (aprovado com ressalvas, reprovado e precisa de voce). E a mesma causa do card corrigido na v2.48.3, e a nota daquela versao dizia que a notificacao tambem tinha sido corrigida, o que nao era verdade. Agora o texto do motivo sai de um lugar so, e um teste impede a quarta vez.', 'Clicar na notificacao nao trazia a janela para frente no Windows: o sistema so deixa quem ja esta em primeiro plano tomar o foco, e clicar numa notificacao nao conta, entao o clique nao fazia nada visivel. Agora a janela e trazida ao topo de verdade.']],
  ['2.51.0', ['O Farol passou a ler o CODEOWNERS do repositorio antes de sair de cena. A v2.50.1 tratava aprovacao como se qualquer uma servisse, e nao e assim onde ha dono de codigo: no front o gate exige aprovacao sua ou do Thiago, entao se o Farol de outra pessoa pegasse o PR primeiro, o seu saia de cena e o PR travava sem a aprovacao exigida. Agora ele so sai quando quem pegou cobre a mesma exigencia que voce cobriria, arquivo por arquivo. Sem conseguir ler, ele revisa.', 'Aprovar junto nunca carimba onde voce e a autoridade: se a sua aprovacao e a que filtra o que sobe, ela precisa vir de revisao de verdade e nao de endosso. A chave segue valendo nos PRs em que voce nao e dono do codigo.', 'A atualizacao automatica nao toma mais a tela. O Farol fecha, atualiza e reabre direto na bandeja, sem roubar o foco de quem esta trabalhando; quem avisa que atualizou e uma notificacao. Se a atualizacao falhar no meio, a proxima abertura manual continua normal, com janela.']],
  ['2.50.1', ['Correcao do pulo de revisao da v2.49.0: o Farol dizia no PR que nao ia duplicar a revisao e revisava minutos depois. A label <conta>:revisando so existe enquanto a revisao da outra pessoa roda, entao o que parecia um pulo era um adiamento. Medido num PR real: aviso as 18:50, label da outra pessoa saiu as 18:52, e o Farol aprovou as 18:59. Agora sair de cena vale para aquele estado do PR inteiro, e o comentario descreve o que de fato acontece.', 'Um Farol por PR: com varias pessoas do time usando o Farol, cada uma aprovava o mesmo PR sem perguntar se aquilo ainda era necessario. Agora, quando alguem ja pegou o PR, os outros ficam de fora.', 'Novo em Sistema > Automacao, desligado por padrao: aprovar junto com quem pegou o PR. Ligado, quando a pessoa que assumiu a revisao aprova, o Farol aprova em seu nome sem abrir sessao nem gastar do seu limite. Serve pro caso em que a sua aprovacao continua sendo exigida mesmo com outra pessoa ja tendo revisado. Nasce desligado porque voce endossa uma revisao que nao fez e nao tem como saber com que rigor ela foi feita.', 'Se a revisao de quem pegou o PR nao sair (sessao que morre no meio na maquina do colega), o Farol assume de volta em vez de deixar o PR orfao. Atencao: com a chave de aprovar junto DESLIGADA, um PR onde a sua aprovacao e a exigida pode ficar esperando voce; o botao Revisar continua funcionando e nunca passa por esse gate.']],
  ['2.50.0', ['Teto por dia da semana e por data unica. O teto diario deixou de ser um numero so: da pra ter um valor proprio pra cada dia da semana (sabado mais baixo, sexta mais alto) ou pra uma data especifica. Vale o mais especifico: a data ganha do dia da semana, que ganha do padrao. Dia em branco usa o padrao, e ha atalhos pra aplicar de uma vez aos dias uteis ou ao fim de semana.', 'O campo de teto ja vem com um valor sugerido: o Farol calcula quanto voce costuma gastar num dia util (mediana dos ultimos 30 dias) e oferece esse numero num toque. Ele NAO passa a valer sozinho, so bloqueia depois que voce salvar, e a sugestao some quando ja existe teto configurado.', 'O orcamento virou um bloco unico no card do perfil, com o gasto de hoje, o teto que esta valendo e de onde ele veio. O mesmo painel serve pra qualquer perfil, de assinatura ou de chave (Claude, OpenRouter, o que for), e cada um guarda o seu de forma independente.', 'Na aba Consumo, o medidor diario mostra o teto que vale HOJE e diz se ele veio do padrao, do dia da semana ou daquela data. Antes mostrava o numero do campo padrao mesmo num dia com teto proprio, e parecia defeito.']],
  ['2.49.0', ['PR que outra pessoa ja esta revisando nao recebe uma segunda revisao. A label <conta>:revisando ja existia como aviso pro time e agora vale como decisao: se o PR carrega a label de outra pessoa, o Farol nao abre sessao em cima do mesmo trabalho, comenta no PR que esta deixando com quem pegou (uma vez so) e segue a fila. Ferramenta nao conta como pessoa: a label do Acrity e ignorada de proposito. O clique manual em Revisar continua revisando sempre.', 'Teto de gasto agora vale tambem pro login por assinatura. Antes so perfil de chave de API podia ter orcamento, e o gasto de quem roda por assinatura nem era atribuido ao perfil. Num perfil de assinatura o teto nao fala de fatura, fala de ritmo. O gasto comeca a contar a partir desta versao: o consumo anterior foi gravado sem dono.', 'O teto pergunta se a PROXIMA revisao cabe, nao se a anterior coube. O Farol mede quanto custa uma revisao tipica sua (a mediana das suas revisoes dos ultimos 30 dias) e para antes de comecar uma que nao caberia. Sessao de revisao nao da pra interromper no meio sem perder o que ja foi pago, entao decidir na porta e o unico momento barato. A tela separa "no limite" de "orcamento estourado". Sem historico, a projecao fica desligada.', 'A janela ficava em branco pra sempre quando o processo de renderizacao caia: o app seguia vivo e o motor continuava monitorando, mas a tela nao voltava. Agora ela se recarrega sozinha e a queda vira linha no log.']],
  ['2.48.3', ['O card de "Precisa de você" mostrava [object Object] no lugar dos motivos, desde a 2.48.0. É o card que você lê pra decidir entre aprovar e pedir mudanças, então ele ficou sem informação nenhuma; a notificação do Windows dizia o mesmo. Agora os motivos aparecem agrupados por tipo, como já apareciam em Revisões recentes.', 'As etapas da revisão ficaram mais honestas: "redação" virou "fechamento", porque mede o tempo entre a última atividade e o fim da sessão, não o tempo escrevendo. E "card" só conta quando o Farol de fato consulta o card, em vez de qualquer frase que mencione o Jira. Continuam sem custar tokens.', 'Por dentro: as telas passaram a ser abertas em teste. Até aqui nenhum teste executava a interface, só lia o código como texto, e foi por isso que a tela de reviewers quebrou por duas versões sem ninguém perceber.']],
  ['2.48.2', ['A tela Sistema > Reviewers não abria: um erro introduzido na 2.48.0, ao mover o código do editor de lugar, fazia a tela morrer antes de desenhar. Valia pros dois blocos, ou seja, a tela inteira.', 'PR podia exigir clique manual pra ser revisado, mesmo com a automação ligada. O Farol marca o PR como visto quando LANÇA a revisão, não quando ela termina, então sessão que morria no meio deixava o PR marcado pra sempre e fora da fila. Agora ele confere a cada ciclo e devolve o que ficou preso; o que você marcou como visto de propósito continua de fora.', 'Preferência que não salvava mas dizia que sim: quando a tela mandava algo que o servidor não reconhecia, sumia em silêncio com a mensagem de sucesso na tela. Agora o servidor devolve o que não aceitou e a tela mostra o erro com o nome da preferência.']],
  ['2.48.1', ['Correção de duas brechas no reenvio automático que a 2.48.0 estreou. A primeira: quando a postagem falhava por instabilidade e o Farol reenviava depois, ele não conferia se o PR tinha mudado, então um commit novo do autor no meio do caminho fazia a aprovação guardada ir pro PR assim mesmo, falando de código que não estava mais lá. Agora ele confere antes, e se mudou não posta: avisa na pendência e deixa a revisão nova entrar pelo caminho normal.', 'A segunda: antes de reenviar, o Farol pergunta ao GitHub se aquele review já está lá. Quando não dava pra perguntar (rede ou token fora do ar) ele reenviava mesmo assim, e como a tentativa anterior pode ter chegado antes do erro, dava pra sair review repetido. Agora ele espera o próximo ciclo em vez de arriscar.']],
  ['2.48.0', ['Review que não saiu por instabilidade do GitHub agora vai sozinho depois. Quando a revisão já tinha decidido aprovar (ou pedir mudanças) e só o envio falhou por algo passageiro (rede caindo, API do GitHub fora do ar), o PR ficava parado na sua mesa esperando clique, com a decisão pronta. Agora o Farol reenvia sozinho nos ciclos seguintes, reusando a decisão que já tinha tomado, sem abrir sessão nova nem gastar do seu limite. Ele confere antes se o review já está no PR, então não sai review duplicado; depois de 3 tentativas sem sucesso ele para e avisa na tela que desistiu. Falha que não passa sozinha (credencial recusada, por exemplo) nunca entra nesse retry.', 'Os motivos de um PR ter vindo pra você agora vêm separados por tipo. A lista era plana e misturava o que a revisão achou no código, o que é regra do app (cobertura incompleta, discordância com outro review, política da conta) e falha técnica no envio, então um "GitHub fora do ar" lia igual a uma ressalva técnica e dava pra achar que a aprovação automática tinha quebrado. Agora são blocos com rótulo e cor: falha técnica primeiro (avisando quando o app ainda vai tentar sozinho), regra do app, e por último o que a revisão levantou.', 'Correções do macOS, todas encontradas num Mac real: a atualização automática apagava o Electron e deixava o app sem abrir; a atualização era aplicada mas o app nunca reiniciava sozinho; executar por um caminho com atalho de pasta não subia nada, em silêncio (valia também para os gates de qualidade, que passavam por aprovados sem verificar nada); e o npm test escrevia na instalação real do Farol em vez do temporário dele.', 'Ao atualizar de uma v2.47.0 já instalada no macOS: esta release LEVA a correção do reinício, mas quem a aplica ainda é a cópia antiga, então neste salto o app atualiza os arquivos e não reabre sozinho. Feche e abra uma vez na mão; das próximas em diante é automático.']],
  ['2.47.0', ['Nova chave em Sistema > Automação: "Aprovar sozinho mesmo discordando de outro review". Quando a revisão discorda de um apontamento de outro revisor (Acrity, Sonar, uma pessoa) e prova a discordância, o Farol sempre segurou o PR pra você decidir. Agora é escolha sua: desligada (padrão) nada muda, ligada a discordância deixa de travar e vira só ponto de atenção, com a regra de ressalvas decidindo o resto. A discordância segue nunca sendo escrita no PR, e reprovar sozinho em cima dela continua sempre passando por você.', 'A linha de uma revisão que você aprovou na mão agora diz por que ela veio pra sua mesa. Antes mostrava só "postado por você (APPROVE)" e o motivo (discordância, cobertura incompleta, revisão disparada por você, política da conta) ficava invisível, mesmo já estando gravado.']],
  ['2.46.2', ['Intervalo de checagem com piso de 3 minutos: as opções de 1 e 2 minutos saíram do sistema (curtas demais, só gastavam chamadas do gh); quem estava nelas passa automaticamente pra 3 minutos.', 'O log de falhas (farol.log) agora carimba em horário de Brasília com o fuso explícito na linha, em vez de UTC sem marcador (que ficava 3 horas deslocado do resto do app e confundia o Diagnóstico). Linhas antigas continuam sendo lidas normalmente.']],
  ['2.46.1', ['Clicar em Atualizar durante uma análise não dá mais erro: o update fica agendado e aplica sozinho quando a análise termina. O aviso virou informativo (explica o agendamento), o banner da Visão geral mostra quando há update agendado, e o clique vale mesmo com o "Atualizar sozinho" desligado (pedido explícito, válido por uma vez).']],
  ['2.46.0', ['O Farol agora se atualiza sozinho: com uma atualização disponível nas releases do GitHub, ele aplica sozinho assim que nenhuma análise, chat ou sessão de terminal estiver rodando (espera terminar o que está em andamento, depois baixa, instala, fecha e reabre preservando estado e configurações). O botão "Atualizar agora" continua funcionando igual pra aplicar na hora. Desligue em Sistema > Automação (toggle "Atualizar sozinho") pra voltar ao clique manual.']],
  ['2.45.1', ['Migração pra ESM puro: todo arquivo .js é agora módulo nativo (zero CommonJS), a validação de sintaxe passa a usar node --check, e engines declarado >=22.12 (abaixo disso o require/interop de ESM nos fluxos de teste não é confiável). O código perdeu o truque de carga dupla da UI e ficou mais limpo.', 'Gate de qualidade automático com ratchet: npm run lint compara o código atual contra a baseline gravada, monitora 10 regras (tamanho de arquivo, catch vazio, var, JSON.parse cru, JSON.stringify cru, process.env direto, ternário aninhado, tempo mágico, porta literal e profundidade excedida, com a referência de card como checagem irmã separada), e reprova regressão em qualquer uma. Extração e refino deste ciclo: check() de 297 pra 74 linhas, handler de sessão achatado, e reduções em portaLiteral (6→0), processEnvDireto (19→11), jsonParseCru (32→26), emptyCatch (20→17), tempoMagico (12→10) e profundidadeExcedida (87→82).']],
  ['2.45.0', ['Suporte experimental a Linux: o Farol agora instala (installer/install-linux.sh), abre pelo menu de aplicativos (.desktop), monitora, revisa e se atualiza num Linux ou WSL. Sessões de terminal abrem no emulador disponível (x-terminal-emulator, gnome-terminal, konsole ou xterm), com aviso claro se nenhum existir. Validado num Ubuntu real (WSL): suíte completa verde e app instalado abrindo com o engine no ar. Fora do escopo por enquanto: bandeja, autostart e instalador offline no Linux.']],
  ['2.44.3', ['Revisão completa de suporte a Windows e macOS (auditoria em 4 frentes). No mac: sessão de terminal não fica mais presa quando a porta não está no config, conta sem token aborta com aviso em vez de agir na conta errada, console de login não herda token do profile, instalador offline e auto-update não exigem mais Node, e a validação da instalação confere o binário que o app realmente executa. No Windows: o update passou a remover arquivos que a versão nova deletou, e o desinstalador agora acompanha a instalação. Atalhos e exemplos da interface mostram Cmd/⌘ no mac e Ctrl no Windows. Auditoria do pacote de release passou a varrer também os scripts de mac, e a suite ganhou 8 testes de plataforma (incluindo o cancelamento de sessão posix com processo real).']],
  ['2.44.2', ['Progresso honesto em TODO o app, com régua única: a revisão automática (cards do "Analisando agora") ganhou barra de progresso movida pela atividade real da sessão, e o chat por PR deixou de ficar parado em 25% (mesma família do bug da autoanálise). Os três fluxos usam a mesma régua central, e um teste impede percentual chutado de voltar.']],
  ['2.44.1', ['A barra de progresso da autoanálise (Meus PRs) parou de mentir: ela ficava fixa em 25% e concluía do nada, porque os percentuais eram números chutados. Agora ela acompanha a atividade real da sessão (cada ação do Claude move a barra e vira o texto do passo), avançando até 90% e fechando quando a análise termina de verdade.']],
  ['2.44.0', ['Botão Remover no card do Time: quando alguém sai da equipe, apaga desta máquina o dossiê, os destaques, o perfil e os pushbacks da pessoa, com modal de confirmação explicando o efeito. Nada é alterado no GitHub.', 'Confirmações de "Atualizar agora" e "Zerar log" trocaram o popup nativo do sistema por modais do próprio Farol, com a explicação do que vai acontecer. Não resta popup nativo no app.', 'Créditos com origem: a seção Sobre registra que o Farol nasceu da iniciativa do Thiago (@thiagopcdev), o revisor de PRs em janela de terminal cuja essência o app reconstruiu.']],
  ['2.43.0', ['Seção "Sobre" na aba Sistema: o compromisso de privacidade (o Farol não coleta nem envia nenhum dado a quem o mantém, tudo fica local em ~/.farol), a licença MIT e os créditos do projeto.', 'Créditos sincronizados com o GitHub: idealizador e contribuidores aparecem com foto e link pro perfil, e colaborador novo que entrar no repositório entra na lista sozinho, sem manutenção.']],
  ['2.42.2', ['Sessão registrada antes da v2.42.0 deixou de aparecer com a célula vazia na coluna Farol do Consumo: agora mostra "< 2.42.0", com explicação no tooltip. Regra só de exibição, o registro em disco segue intocado.']],
  ['2.42.1', ['Licença MIT formalizada (arquivo LICENSE) e seção "Privacidade e responsabilidade" no README: o Farol não coleta nem envia dado nenhum ao mantenedor, não há telemetria, tudo fica local em ~/.farol e o tráfego de rede é todo em nome do usuário (GitHub via gh, Anthropic via Claude Code).']],
  ['2.42.0', ['Coluna "Farol" nas Sessões recentes do Consumo: toda sessão fica carimbada com a versão do app que a produziu, junto do modelo e do custo (auditoria de contexto). Sessões antigas aparecem com a célula vazia, sem retro-carimbo.', 'A versão nunca vaza pro review postado: a trava de linguagem bloqueia proveniência com versão ("gerado pelo Farol vX.Y.Z") e continua permitindo menção técnica legítima quando o assunto do PR é o próprio Farol.']],
  ['2.41.4', ['Auto-update espera sessões de terminal também (e sessão esquecida há mais de 12h deixa de segurar a atualização pra sempre).', 'Estacionamento de revisões falhas persiste em disco: reiniciar o app não relança sessão fadada à mesma falha, e a limpeza respeita falha de rede e orgs fora da config.', 'Orçamento re-checado na boca de cada sessão: lote enfileirado antes do estouro não atravessa mais o teto (aviso único por perfil, PRs estacionam e voltam por clique).', 'Autorização de postagem do terminal vale enquanto a sessão viver, com teto de 12h (acabou o "expirada" no meio do almoço).', 'Multi-conta: se o mesmo PR chega por duas contas, a conta capaz (com login e não silenciada) assume.', 'Clique duplo no Merge recusa com aviso discreto; downloads de update com mais de 24h são limpos; e o perfil de assinatura vence credenciais soltas no shell do macOS/Linux (limpeza dentro do próprio login shell).']],
  ['2.41.3', ['Round 2 automático resiliente: reinício do app não queima mais a âncora da re-revisão (o boot poda e o ciclo re-arma), flake do GitHub no início da sessão cai no commit conhecido do relançamento, e queda de rede não rebaixa o round a manual nem deixa o card mentindo "aguardando você".', 'Rascunho não dispara re-revisão automática (push de WIP não queima sessão nem posta em cadência de robô).', 'Pendências sem beco: PR fechado sem merge cancela o card com aviso, aprovar à mão durante a análise reconcilia (ação decisiva no mesmo commit conta, comentário avulso não), e o bloqueio do filtro de linguagem explica o motivo e aponta o chat como saída.', 'Review por clique ancora no commit que a análise leu: push entre a análise e o clique não silencia mais o round novo.']],
  ['2.41.2', ['Review postado agora carrega o commit que a revisão LEU: push do autor durante a sessão deixa o review defasado de verdade e a re-revisão automática arma (antes o GitHub carimbava o head do momento do post e o round novo nunca abria).', 'Decisões concorrentes não se atropelam: o clique re-localiza a pendência pelo id antes de remover, achado de outra revisão não some mais da lista.', 'Merge recusa PR que recebeu commit depois da sua autoanálise.', 'Fim de dois vazamentos de custo: comentário de terceiro não reclassifica mais a mesma thread de pushback a cada ciclo, e seen.txt truncado por queda de energia não dispara mais rajada de re-revisões.', 'Duas contas: a queda de busca de uma preserva PRs, autoanálises e ocultos da outra.']],
  ['2.41.1', ['Revisão automática mais precisa: seis lições medidas em reviews reais (achados verificados um a um e contestações de autor confirmadas) entram no protocolo que toda revisão lê. O revisor passa a checar o diff acumulado da branch (não commit isolado), a listar o que um remédio proposto NÃO cobre, a dimensionar o raio real de cada achado e a distinguir required check configurado de doutrina do time.', 'Menos falso blocker: código que segue padrão já aceito no repo e exigência de processo fora do diff (check obrigatório, branch protection) deixam de bloquear; viram ressalva e sugestão. Nenhum gate afrouxou, muda a pontaria e não o rigor.']],
  ['2.41.0', ['Re-revisão automática: quando você pediu mudanças e o autor empurrou a correção, o PR volta pra fila de revisão sozinho no ciclo seguinte, sem clique. Cada commit é relançado no máximo uma vez e a postagem continua atrás dos gates de sempre.', 'Revisões paralelas por conta (opt-in em Sistema): a mesma conta pode rodar até 4 revisões automáticas ao mesmo tempo. O padrão continua 1, em série, como sempre foi.', 'PRs em rascunho entram no radar e na fila, com selo "rascunho" no card. O merge de rascunho continua bloqueado.']],
  ['2.40.8', ['PR mergeado ou fechado enquanto esperava no retry de rede não gera mais cascata de notificações a cada ciclo de polling. Antes cada ciclo disparava "relançando..." seguido de "já mergeado, cancelei", sem parar. Agora o estado é conferido antes de notificar, e o PR sai do retry em silêncio.']],
  ['2.40.7', ['A caixa de revisão agora mostra somente o contexto técnico útil para o autor: problema, impacto e próximo passo. Motivos operacionais ficam separados em "Por que precisa de você", e registros antigos são limpos apenas na apresentação, sem alterar o histórico salvo.', 'Antes de postar pelos fluxos do Farol, o corpo e todos os comentários inline passam por uma validação determinística que bloqueia linguagem de bastidor e formatos com aparência de template. O caso real que motivou a correção e variações com Markdown, HTML e caracteres invisíveis viraram testes.', 'Análise incompleta ou payload incompatível não aprova nem pede mudanças sozinho. Terminal e chat usam uma autorização temporária limitada ao PR, inclusive quando uma conversa antiga é retomada, e postagens simultâneas não duplicam nem cruzam corpos.']],
  ['2.40.6', ['Na visão por Pessoas, quem tem mais PRs mergeados no período aparece primeiro; merge mais recente e login só desempatam. A ordem acompanha organização, período e busca atuais, enquanto Repositórios continua por recência.', 'Os grupos de Pessoas agora nascem recolhidos. O que você abrir permanece aberto ao buscar ou usar "mostrar mais/menos", e trocar organização ou período começa novamente com a lista compacta.', 'O atalho "@fulano na frente" abre e leva até a pessoa líder, e a seta do cartão finalmente gira junto com o estado aberto.']],
  ['2.40.5', ['Revisão de segunda rodada volta a chegar no PR. Antes de postar, o Farol perguntava "eu já pedi mudanças neste PR alguma vez?"; como a resposta era sim desde a primeira rodada, tudo que a revisão achava depois que o autor empurrava a correção ficava só na sua máquina. Aconteceu duas vezes seguidas no mesmo PR: o Farol concluiu que a correção não tinha fechado o buraco e não postou nenhuma das duas. Agora a pergunta é "eu já me manifestei sobre ESTE commit?", e a mesma rodada continua sem virar review duplicado.', 'O mesmo bloqueio valia pro clique em "Precisa de você": um review de rodada antiga convertia o clique explícito em "já revisado" e nada era postado.', '"Já revisado por você (não repostei)" agora mostra os achados na linha, em "N achados que ficaram só aqui". Era o único status que escondia os achados, justamente aquele em que eles só existem dentro do app.']],
  ['2.40.4', ['Painel vazio agora tem explicação. Sistema → Visão geral ganhou uma linha de monitoramento por conta: conta sem organização cadastrada aparece como problema (era o pior silêncio do app, os 5 itens ficavam verdes, nenhuma busca era feita e o painel ficava vazio pra sempre sem erro nenhum), conta adicional sem gh auth login também, e "todas as contas silenciadas" avisa que nada vai aparecer mesmo com PR esperando. Clicar em qualquer uma leva direto à conta em Contas.']],
  ['2.40.3', ['A revisão de um PR abre direto da tabela de Consumo: cada linha de PR ganhou um atalho ao lado da referência, que mostra veredito, pontos de atenção e o relatório completo ali mesmo. O texto continua abrindo o PR no GitHub, então você escolhe pra onde vai.', 'O histórico de revisões passou de 200 pra 3000. Antes, revisão que saísse das 200 mais recentes sumia, e a tela só alcançava as 30 mais novas; agora qualquer revisão guardada abre pelo atalho, inclusive as antigas e as de outra conta, sem pesar o que o app carrega a cada ciclo.', 'PR sem revisão registrada e falha na busca viraram mensagens diferentes. Antes ficariam idênticas na tela, e "não existe" parecendo "quebrou" faz desconfiar do app inteiro.']],
  ['2.40.2', ['A sessão de ferramenta na tabela de Consumo agora navega por clique: "Kudos" abre a aba Destaques no painel dos kudos compilados, e "Diagnóstico do Farol" abre Sistema → Diagnóstico no relatório. Antes só a referência de PR era clicável e a linha de ferramenta ficava como texto morto.', 'Trava nova no gate de qualidade: destino de navegação interna apontando pra aba, seção ou âncora inexistente passa a reprovar a suíte. Esse defeito não gera erro nenhum, o clique só não faz nada, e é o tipo mais caro de achar.']],
  ['2.40.1', ['Foto de quem abriu o PR no Panorama (e na fila, nas decisões, em Destaques, no Time e na barra de identidade): toda menção de pessoa agora sai do mesmo lugar, com foto e link pro perfil no GitHub.', 'O que a tela menciona leva até a coisa com um clique: nome de pessoa e de repositório abrem o GitHub; a referência do PR na tabela de sessões abre o PR; "Sistema → Plano e chaves", o nome do perfil no cartão de orçamento, "o log em Sistema", "organizações monitoradas", "Automação" e a versão no rodapé abrem a seção exata, já rolada e destacada.', 'Atalhos nos cartões de Entregas: "@fulano na frente" e "repo na frente" levam ao grupo na lista (trocando a visão quando precisa) e "+N hoje" troca o período. Tudo navegável pelo teclado.', 'Correção: título comprido escondia o autor no Panorama (mesmo defeito corrigido em "Revisões recentes" na versão anterior). Agora quem trunca é o texto do título, e a foto com o @login ficam sempre visíveis.']],
  ['2.40.0', ['Consumo com fonte única de verdade: os painéis não se contradizem mais (o cartão de tokens dizia 942k nos 7 dias com a linha do tempo mostrando 43k). O registro antigo, sem quebra por tipo/modelo/conta, aparece como camada cinza "Sem detalhamento", reconciliada dia a dia: os totais de KPI, linha do tempo e matriz agora batem sempre, por construção.', 'Orçamento por perfil ao vivo: o cartão, o selo e o gasto na aba Sistema recalculam a cada atualização, com a mesma conta que pausa a automação, em vez de congelar no último "Verificar agora".', 'Entregas ordenadas pelo mais atual primeiro: quem mergeou por último abre a lista (por repositório e por pessoa), descendo até o grupo parado há mais tempo. O número de ranking saiu; quem mais entrega segue nos cartões "na frente".', 'Entregas sem números fantasma: dia sem merge aparecia como a 2ª barra mais alta do gráfico (colisão de estilo) e os cartões contavam ~50 merges de uma janela maior que a do gráfico (corte UTC). Agora dia zerado é um toco de 2px, "Hoje" começa às 00:00 de verdade, e total, média, pico e barras contam o MESMO período.', 'Registro mais completo: sessão cancelada depois do relatório final registra o gasto (e aparece como "cancelada", não "ok"); sessão com custo e zero tokens também registra; a tabela de sessões declara desde quando o registro individual existe; e o cartão de orçamento avisa que sessão interativa de terminal não entra na medição (o CLI não reporta).', 'KPIs honestos: o subtítulo de Tokens mostra o cache do período (o custo inclui cache), a variação (%) só aparece quando o período anterior tem histórico completo pra comparar, e as células da matriz mostram o valor exato no tooltip.']],
  ['2.39.0', ['Consumo redesenhado: cartões de KPI com tendência, linha do tempo empilhada por tipo/modelo/conta com hover, matriz Tipo × Modelo, orçamento por perfil com medidor, e uma tabela de sessões recentes mostrando o PR (ou chat/ferramenta) de cada uma.', 'Correção: o autor sumia de "Revisões recentes" quando o título do PR era comprido, porque o @login ficava dentro do título, que trunca com reticências. Agora o autor tem linha própria, com a mesma foto de perfil que a fila, "Precisa de você", Destaques e Time já usam.']],
  ['2.38.0', ['Entregas ganhou busca por título, autor ou repositório, período em seleção rápida (Hoje/7/15/30 dias), cartões de estatística, gráfico de merges por dia e paginação "mostrar mais" por grupo, com uma barra mostrando quanto cada repositório ou pessoa representa no período.']],
  ['2.37.1', ['Correção: o "Ocultar" de "Meus PRs" escondia só a autoanálise, nunca o PR, que era justamente o caso que motivou o pedido (PR próprio parado há anos ocupando a aba pra sempre). Agora "Ocultar" oculta o PR, e o botão que existia virou "Ocultar análise".', 'Um rodapé mostra quantos você escondeu, com opção de exibir de novo (card esmaecido e botão "Reexibir"). O contador da sub-aba conta o que está visível, e com tudo oculto a tela explica em vez de ficar em branco.', 'Ocultar não vira ignorar a realidade: o PR volta sozinho se receber commit novo. É só na sua tela, nada é escrito no GitHub, e queda de rede não desoculta nada.']],
  ['2.37.0', ['Diagnóstico agrupado: o log de falhas abre com um resumo por episódio (quantas vezes, de quando até quando, quais PRs, e se a falha se resolve sozinha ou depende de você), em vez de despejar linha crua. O detalhe continua embaixo, limitado às 40 linhas mais recentes. A aba Sistema mostra os três maiores grupos na própria linha do log.', 'Correção: um PR podia entrar em loop infinito de revisão. Falha passageira colocava o PR na lista de "tentar de novo"; se a falha seguinte fosse permanente (credencial recusada, acesso desligado pela organização), o app estacionava o PR mas não o tirava da lista, e o relançamento desfazia o estacionamento no ciclo seguinte. Deu 25 tentativas idênticas do mesmo PR em três horas.', 'Limite do plano Claude agora espera a hora do reset que vem escrita na própria mensagem, em vez de tentar 12 vezes por PR. O aviso passou a dizer o horário ("retomo depois das 21:00").']],
  ['2.36.1', ['Correção: a revisão automática podia postar review num PR que já tinha sido mergeado. Agora uma pendência em "Precisa de você" cancela sozinha quando o PR mergeia enquanto espera sua decisão, e a revisão automática confere o estado do PR antes de começar, pulando sem gastar tokens se já foi mergeado enquanto esperava a vez na fila.']],
  ['2.36.0', ['Checkpoint de verificação: a revisão headless guarda uma memória incremental do que já verificou (afirmação por arquivo:linha), pra não reprocessar tudo do zero se a sessão travar num erro transitório (ex.: 529 de sobrecarga) e precisar recomeçar. Sempre gravado pelo motor do Farol, nunca pela sessão diretamente.', 'Divergência entre duas verificações da mesma afirmação nunca é resolvida em silêncio: vira ponto de atenção e trava a postagem automática (aprovação e reprovação), igual já acontecia com cobertura incompleta. "Revisões recentes" mostra quantas afirmações foram confirmadas e se há divergência pendente.', 'O checkpoint expira sozinho quando o PR ganha commit novo: uma divergência contra código que já mudou deixa de travar a postagem automática pra sempre (o histórico completo continua guardado, só para de contar pro gate).']],
  ['2.35.2', ['Correção: o Panorama mostrava "Revisando…" pra PR que só estava na fila, sem nenhuma revisão rodando de fato. Agora distingue "Revisando…" (sessão rodando) de "Na fila (N)" (esperando a vez), igual "Meus PRs" já fazia.']],
  ['2.35.1', ['"Meus PRs", "Pra mim" e "Panorama" podiam mostrar "você não tem nada" sem nunca ter confirmado: no boot ou quando o primeiro ciclo de verificação falhava, a tela assumia vazio em vez de avisar que ainda está verificando ou que a checagem falhou. Agora as três esperam uma resposta definitiva do motor antes disso.']],
  ['2.35.0', ['Orçamento por perfil de chave de API: cada perfil (Sistema > Plano e chaves) pode ter um teto diário e/ou total, com data de início. Estourar qualquer um pausa a automação de gasto daquele perfil (revisão automática, retentativa pós-falha e scan de pushback), sem bloquear clique manual nem a autoanálise. Card do perfil e aba Consumo mostram o gasto acumulado e o selo de estouro.', 'Uma sessão que gastava tokens e falhava só na última mensagem registrava zero custo. Agora o gasto é sempre contabilizado, mesmo em erro.', 'Um perfil liberado (teto aumentado) podia ficar com o aviso de estouro mudo pro próximo estouro real, se a fila estivesse vazia no meio do caminho. Corrigido: o estado é reconciliado a cada ciclo.']],
  ['2.34.1', ['Form de "Adicionar perfil" (Plano e chaves) ficava colado: o seletor de tipo e a linha de campos abaixo coincidiam sem espaço nenhum. Agora tem respiro entre as duas linhas.']],
  ['2.34.0', ['Perfil de assinatura Claude por chave de API: cada perfil agora pode ser "login por assinatura" (o de sempre) ou "chave de API" (ANTHROPIC_API_KEY + URL base opcional, billing por token). Os dois convivem no mesmo gerenciador (Sistema > Plano e chaves), escolhidos por conta do GitHub, e cobrem tanto as sessões automáticas quanto a sessão de terminal da fila. Perfil de chave não tem fluxo de claude login, a chave já é a credencial.', 'Uma chave de API já configurada na máquina (ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN) deixa de vazar sozinha pras sessões do Farol: agora é sempre limpa antes de aplicar o perfil escolhido.']],
  ['2.33.2', ['Panorama ganhou linha própria, no mesmo padrão de "Revisões recentes": cada PR empilhava título, autor e botão numa coluna só, porque a direita só tinha o horário. Agora horário e ações (conversar, revisar, copiar URL, abrir no GitHub) ficam ancorados à direita, título e autor dividem uma linha, e cada PR ocupa bem menos altura.', '"Conversar" e "copiar URL" chegaram no Panorama: não existia como abrir o chat de um PR direto da linha (o campo "Consultar um PR por URL" era o contorno pra isso). Agora estão na própria linha, junto com abrir no GitHub.']],
  ['2.33.1', ['"Meus PRs" ficava em branco, sem nenhum aviso, quando você não tinha PR aberto: a sub-aba escondia o cabeçalho inteiro e zerava a lista sem mensagem, diferente de "Pra mim" e "Panorama". Agora o cabeçalho continua visível e aparece "Você não tem PRs abertos nas organizações monitoradas" (ou "nesta conta", conforme o escopo).']],
  ['2.33.0', ['"Revisões recentes" mostra o dia, não só a hora: sai "hoje 17:51", "ontem 16:29", "01/08 15:35" e, quando é de outro ano, "24/07/2025 09:12", com data e hora completas no tooltip. Vale também pro card de "Precisa de você", que tinha o mesmo problema ao lado.', 'A linha aproveita a largura toda: a metade direita ficava em branco e agora ancora o carimbo e quatro ações sempre visíveis, conversar, revisar de novo, copiar a URL do PR e abrir no GitHub.', 'Aparece o que já existia e estava escondido: título do PR, autor, a etiqueta da conta (importante em "Todas") e o relatório completo da revisão, expansível ali mesmo.', 'E ficou mais curta, não mais alta: título e autor dividem uma linha, os três expansíveis dividem uma faixa só, e o selo do desfecho ganhou cor (verde aprovado, vermelho mudanças pedidas, azul comentado) pra varrer a lista de olho.']],
  ['2.32.4', ['PR que você resolveu pelo chat continuava aparecendo em "Precisa de você". O review ia pro GitHub, mas o card só saía se você clicasse num dos botões dele; agora o Farol confronta a pendência com os reviews que já são seus no PR e fecha sozinho, na hora ao fim da conversa e no ciclo de checagem pros reviews postados fora do app. Só fecha com review seu postado depois da análise, então re-request continua caindo na sua mesa, e nada desaparece quando não dá pra confirmar.']],
  ['2.32.3', ['A linha "Perfil padrão do Farol" saía esmagada, com uma palavra por linha (bug que a v2.32.2 introduziu): o seletor forçava largura total e comia a coluna de texto.', 'Plano e chaves passou a ocupar a mesma largura das outras telas do Sistema, no formato de Contas. Medido em 900, 1150 e 1280px nas quatro telas.']],
  ['2.32.2', ['Conexões e Plano e chaves ainda tinham espaço vazio à direita mesmo depois da v2.32.1. Agora usam o mesmo padrão de Preferências/Automação: linha cheia, texto à esquerda, controle ancorado à direita.']],
  ['2.32.1', ['Espaço vazio à direita nos cards de Conexões e Plano e chaves: mesma causa da v2.32.0 (card mais largo que o conteúdo), corrigida só nesses dois; Reviewers segue de largura total.', 'Novidades: a rolagem automática virou um botão "Ver mais", clicado por você em vez de carregar sozinho.']],
  ['2.32.0', ['Novidades carrega por rolagem: em vez de listar as 67 versões de uma vez, mostra 5 e carrega mais conforme você desce, até esgotar o histórico.', 'Espaço vazio à direita nos cards de Reviewers por projeto: o card ficava travado em 640px dentro do container de 1150px da aba Sistema. Corrigido pra ocupar a largura real disponível.']],
  ['2.31.0', ['Correção dos 52 gaps lógicos encontrados numa auditoria completa do código, executada em 9 ondas com teste antes de cada mudança: a suite foi de 392 pra 538 testes.', 'Identidade de conta ficou estrita: quando o token de uma conta falha no keyring do gh, o Farol não herda mais a identidade da outra conta. Busca, review postado, chat e autoanálise agora ou usam a conta certa ou avisam que ela está sem token; nunca mais um APPROVE sai assinado pela conta errada.', 'O radar aguenta ciclo ruim: falha só nas buscas de "pedido a mim" preserva a fila e os marcadores do último ciclo bom (antes zerava tudo, ressuscitava PRs ignorados e re-notificava), e o eco do índice do GitHub logo após postar review deixou de disparar re-revisão à toa.', 'Gates de aprovação sem furos: cobertura declarada com zero arquivos lidos não libera mais postagem automática, a identidade do PR nunca vem do texto gerado pela sessão, e a autoanálise carimba o commit lido antes da sessão e re-checa no fim (push no meio da análise invalida o resultado em vez de liberar merge de código não analisado). Autoanálises antigas sem esse carimbo são descartadas e pedem re-análise uma vez.', 'Abrir o app com outro Farol já rodando não deixa mais dois motores revisando em paralelo, e o update ficou seguro: caminho com espaço no perfil do Windows, clique duplo em Atualizar e sessão iniciada durante o download não quebram mais a atualização.', 'Sessões mais robustas: acento não vira mais caractere quebrado no meio do texto, processo que morre no meio vira erro de verdade em vez de resposta sem sentido, cancelar perto do timeout conta como cancelamento, e clique duplo em chat ou ferramenta não roda mais em dobro.', 'A interface parou de prometer o que não fazia: aprovar pela paleta de comandos funciona, o botão Cancelar da autoanálise cancela de verdade, confirmar um pushback sugerido funciona num clique, widgets de erro somem sozinhos em vez de acumular, e trocar filtro rápido nas Entregas não mistura mais os resultados.', 'Persistência ficou atômica: queda de energia no meio de um save não reseta mais a configuração pros padrões (arquivo corrompido é preservado como evidência e o log avisa), e o consumo passou a contar o dia no seu fuso, então o card Hoje não zera mais às 21h.']],
  ['2.30.1', ['Operações assíncronas nunca ficam silenciosas: nove categorias de ação (polling, data loading, análise, merge, chat, ferramentas, update, settings, startup) mostram feedback visual em tempo real com spinner animado, progresso com %, etapa do processamento, e widgets reutilizáveis (operation widget, inline pill, toasts, typing dots).', 'Sistema unificado de operações (showOp, updateOp, closeOp) com um mapa central rastreando tudo que está rodando, atualização de UI em tempo real, ETA quando disponível, cancelamento em operações longas e auto-dismiss após conclusão. Fim da confusão sobre se o app está travado.', 'Três padrões visuais reusáveis: operation widget (completo, com passo a passo) pra ações focadas; inline pill (compacto, discreto) pra background jobs; toasts (transientes, confirmação rápida) pra one-shot. Spinner com CSS animations (spin, bounce, fade), suave até em 3G, progress bar com transição suave de %.', '389 testes green cobrindo slow network, múltiplas operações simultâneas, erro e cancelamento.']],
  ['2.30.0', ['O Radar virou 3 sub-abas: Pra mim, Meus PRs e Panorama. A faixa de atalhos que existia antes rolava de lado em janela estreita e escondia metade dos destinos sem avisar. A busca de PR por URL foi pro Panorama.', 'A borda esquerda dos cards deixou de indicar a CONTA e passou a indicar URGÊNCIA: âmbar pro que espera você, vermelho pro que tem bloqueio, azul pro que está rodando, verde pro aprovável. A conta continua no ponto e na etiqueta. Como a opção Só barra ficaria sem nenhum marcador de conta, as opções de Identidade nos cards viraram Ponto + etiqueta e Só ponto (quem usava a antiga é migrado sozinho).', 'Os 4 botões do card da fila viraram 1 principal, o chat e um menu de três pontos. Ignorar é destrutivo e estava a um toque do Revisar; foi pro menu, junto do terminal. O menu abre dentro do card em vez de flutuar por cima.', 'O título do PR não é mais cortado com reticências: é a informação que faz você decidir se vai revisar.', 'Quando a fila está vazia, a tela passa a confirmar o que o Farol fez sozinho (quantos aprovou hoje, o que monitora, de quanto em quanto tempo) em vez de só dizer que não tem nada. E quando a conexão cai, o aviso aparece no meio da tela com o número da tentativa, não só numa etiqueta no topo que some de vista.', 'A paleta de comandos (Ctrl+K) passou a trazer as decisões pendentes, incluindo aprovar todas de uma vez, e ganhou um botão visível em janela estreita. Antes ela era montada uma vez só ao abrir o app, então as decisões nunca entravam.', 'O app foi ajustado pra janela estreita de verdade: em 380px nada fica abaixo de 11,5px, a ação principal ocupa a linha inteira, a barra de abas quebra em duas linhas e o chat vira uma folha que sobe de baixo.']],
  ['2.29.1', ['Versão de manutenção: nada muda na tela nem no comportamento. As funções de formatação e de escape da interface saíram do arquivo de 2.860 linhas onde moravam e ganharam arquivo próprio, com 45 testes. Era o maior arquivo do projeto e o único sem nenhum teste. Entre elas está a que neutraliza HTML antes de exibir, usada em cerca de 240 lugares do app e que nunca tinha sido verificada.']],
  ['2.29.0', ['Todas as telas passaram a explicar pra que servem: o refino de espaçamento que a v2.28.0 fez só na aba Sistema chegou nas outras cinco. Cada seção agora tem uma frase abaixo do título dizendo o que ela mostra, com a mesma largura de leitura em todo lugar. Eram três tratamentos diferentes pro mesmo tipo de texto, e o Radar não tinha nenhum apesar de ter seis seções.', 'O app ficou usável no celular. Entregas, Destaques e Time não tinham uma linha sequer de regra pra tela estreita: agora os controles de Entregas ocupam a faixa inteira, os cartões viram coluna, os botões dos cards de PR ganham largura em vez de sobrar meio botão fora da tela, e o título do PR quebra em duas linhas em vez de virar reticências.', 'O gráfico do Consumo virou legível no celular. Ele era desenhado sempre com 820px e depois encolhido pra caber, então os rótulos das datas ficavam com 4 pixels. Agora mede o espaço disponível e desenha no tamanho certo, mostrando menos datas quando o espaço é menor.', 'A barra de seções do Radar parou de descolar do topo: o deslocamento estava cravado em 54 pixels, mas a barra do topo muda de altura (encolhe no celular, cresce com mais de uma conta). Agora a altura é medida.', 'Acessibilidade: a página não tinha nenhum título de nível 1 e as abas eram só botões com uma classe, então quem usa leitor de tela não sabia quantas abas existem nem qual está aberta. As duas navegações agora se anunciam certo, os ícones pararam de ser lidos em voz alta, os botões só-ícone e os campos de busca ganharam nome, e os avisos (o toast de configuração salva, a faixa de aviso) passaram a ser anunciados.', 'Correções: o toast podia ficar mais largo que a tela no celular; os controles segmentados tinham estilo declarado duas vezes, com a primeira sendo código morto; uma regra de quebra de linha apontava pra uma classe inexistente enquanto os cards de PR, que precisavam dela, ficavam de fora.']],
  ['2.28.0', ['Novo controle de esforço de raciocínio em Sistema > Automação: cinco níveis (padrão do Claude, baixo, médio, alto e muito alto), cada um explicando o que muda e quanto custa do teu limite. Vale pras sessões autônomas (revisão, autoanálise, pushback, chat e ferramentas); a sessão no terminal não é afetada. O padrão continua deixando o Claude decidir pelo modelo, então quem não mexer não vê diferença. Com Haiku escolhido os cartões desabilitam, porque esse modelo não aceita nível de esforço.', 'O seletor de modelo das revisões foi de 4 pra 6 opções, com o trade-off no rótulo: além de Opus, Sonnet e Haiku, agora tem "Melhor disponível" (o Claude escolhe o topo da tua conta) e Fable (raciocínio longo). O config.json também passa a aceitar o nome completo de um modelo, sem precisar de versão nova do Farol.', 'A revisão em lotes de PR grande nunca tinha funcionado: desde a v2.26.0 o Farol media o PR, decidia fatiar em 2 a 4 lotes e montava o plano, mas o plano era descartado antes de chegar no Claude. Na prática um PR de 8700 linhas era lido parcialmente e aprovado. Agora o fan-out roda de verdade, com um subagente por lote em paralelo: a revisão de PR grande fica bem mais completa, e consome mais do teu limite.', 'A aba Sistema respira: cada configuração virou uma linha com o texto à esquerda, o controle à direita e uma divisória entre elas, no lugar do bloco corrido onde tudo ficava colado. A sidebar se separa do conteúdo por espaço em branco em vez de uma borda encostada, a aba ganhou mais largura, e cada seção tem um título maior com uma frase dizendo pra que serve. Versão e caminho dos dados foram pro rodapé da sidebar.', 'A busca do Sistema devolve uma lista de resultados nomeados, cada um com a seção de onde vem; clicar leva direto pra configuração e pisca a linha. Antes acendia várias seções ao mesmo tempo e empilhava tudo. Funciona sem acento e avisa quando não acha nada. As 9 seções também entraram na paleta de comandos (Ctrl+K).', 'Correções de acabamento: dez divisórias da tela de Sistema não estavam sendo desenhadas (cor usada sem nunca ter sido definida), o texto de ajuda dos campos ficava espremido ao lado em vez de abaixo, o botão "Reviewers" num PR sem configuração levava pra uma seção invisível, e o selo de assinatura do Claude aparecia como texto solto.', 'Modelo inválido no config.json agora é barrado no boot: esse campo entra na linha de comando que o Farol executa e só era validado quando salvo pela tela. A aba Consumo passa a mostrar a versão dos modelos da geração nova (Opus 5, Sonnet 5, Fable 5), que antes apareciam sem número. E a interface pergunta ao motor em qual sistema ele roda, em vez de adivinhar pelo navegador.']],
  ['2.27.0', ['A aba Sistema ganhou uma sidebar de navegação com 9 seções (Visão geral, Contas, Automação, Conexões, Plano e chaves, Reviewers, Preferências, Novidades e Diagnóstico), cada uma com seu grupo de configurações, no lugar da lista corrida anterior. Um campo de busca no topo da sidebar filtra por texto e mostra só as seções que contêm o termo. Em telas estreitas a sidebar vira uma faixa horizontal com os mesmos itens.', 'A assinatura do Claude que o Farol usa agora pode ser diferente por conta GitHub monitorada: crie perfis nomeados (ex.: "BIUD Trabalho", "Pessoal Max"), cada um apontando pro seu diretório de config próprio, e escolha um perfil padrão do Farol e, opcionalmente, um perfil específico por conta (Sistema > Contas). Cada conta e cada perfil mostram um selo com o e-mail logado ali (ou "SEM LOGIN" se faltar o claude login naquele diretório), e esse selo se atualiza sozinho ao salvar. Sem nenhum perfil criado, nada muda.', 'Cada perfil de assinatura Claude (e o padrão do Farol) ganha um botão "Abrir sessão de login": um terminal só com o claude, sem PR, fila ou token do GitHub envolvido.', 'Fechar a sessão de terminal sem terminar a revisão não faz mais o PR sumir da fila: fechar a sessão sempre devolve o PR à fila.', 'Pente-fino nos perfis de assinatura Claude: config.json malformado não derruba mais buscas de PR nem sessões de review; caminho de perfil com aspas ou quebra de linha não consegue mais executar comando nenhum; remover um perfil usado por 2+ contas ao mesmo tempo não deixa mais nenhuma "presa" a ele; migrar o campo antigo pra um perfil novo já marca esse perfil como padrão na hora.']],
  ['2.26.1', ['Atualizar no macOS voltou a funcionar: o pacote era gerado com barras invertidas (Windows) e o unzip do Mac recusava; corrigido, e a auditoria do pacote agora reprova se o defeito voltar. E aviso cosmético do unzip não derruba mais a atualização.']],
  ['2.26.0', ['PR grande agora é revisado em lotes, por vários revisores em paralelo: acima de 1000 linhas ou 20 arquivos, o Farol divide os arquivos em 2 a 4 lotes coesos (por afinidade de pasta) e dispara um revisor por lote ao mesmo tempo, cada um lendo por completo só o lote dele e ciente do que está nos outros, com consolidação num relatório único. Motivo medido em 44 reviews reais: o tamanho dos PRs varia 4359x e o do relatório varia 3x, e nos PRs acima de 2000 linhas 3 de 5 saíram sem nenhuma citação ancorada. A revisão também passa a declarar quantos arquivos do diff realmente cobriu: se ficou algum de fora, o PR vai pra "Precisa da sua atenção" em vez de aprovar sozinho. E aprovando com ressalva, a ressalva agora aparece no PR escrita com naturalidade (o que é assunto interno nosso continua só no app). PR abaixo do limiar segue igual.']],
  ['2.25.0', ['Quando outra ferramenta já revisou o PR (Acrity, Sonar, Snyk, ou um colega), o Farol forma o veredito dele pelo código e pelo card ANTES de ler o review alheio, e adota o apontamento real que passou pela nossa revisão. Discordar virou exceção com barra alta: quatro rótulos (falso positivo, fora do escopo pactuado, pré-existente, critério não vigente), cada um exigindo prova própria (arquivo:linha que refuta, o texto que documenta o adiamento, o diff, ou a contagem medida). Sem prova, ele fica calado e entrega só a análise dele. E contestação nunca sai sozinha: qualquer discordância força "Precisa da sua atenção", com o apontamento e a prova na tela, mesmo com aprovação automática ligada.']],
  ['2.24.2', ['Re-request de review (autor pede sua revisão de novo num PR que você já revisou) agora é identificado de forma confiável e volta a ser revisado sozinho, sem precisar de clique. A detecção comparava dois resultados de busca diferentes do GitHub, e a segunda tem indexação assíncrona, então às vezes ficava atrasada e o re-request nunca era reconhecido. Agora o sinal vem do histórico local do próprio Farol, instantâneo.']],
  ['2.24.1', ['Mini-navegação no topo do Radar: barra de âncoras só com as seções que têm algo agora (com contagem), clique rola suave até lá. E a paleta de comando (Ctrl+K / Cmd+K): busca central pra ir a qualquer aba/seção, disparar Verificar agora ou Alternar tema, e reconhece URL ou key (org/repo#NN) de PR pra abrir a conversa na hora. Navega com as setas, Enter confirma, Esc fecha.']],
  ['2.24.0', ['Fluidez: clicar num alerta de revisão agora leva direto ao card do PR (a tela rola e destaca com um pulso); o ícone na barra de tarefas ganha uma bolinha (Windows) ou número no Dock (macOS) enquanto houver decisão esperando, com a contagem no tooltip da bandeja; e chegaram atalhos de teclado (J/K navegam nas decisões, A aprova, M pede mudanças, C comenta, P pula, / consulta PR por URL, 1 a 6 trocam de aba, ? mostra a lista). Com a janela em foco, o aviso fica só no app, sem duplicar na notificação do sistema.']],
  ['2.23.8', ['Os alertas de revisão agora dizem o desfecho e o motivo, sem o tom de "sem você": "Aprovado sem ressalvas" (revisão completa, nenhum ponto de atenção), "Aprovado com ressalvas" (mostra a primeira ressalva e aponta pra Revisões recentes), "Reprovado" (com o motivo) e "Precisa da sua atenção" (lidera com o motivo, não com uma contagem). Vale pra notificação do sistema, pros avisos dentro do app e pra notificação do navegador.']],
  ['2.23.7', ['O pushback (detecção automática de contestação do autor) agora só aparece quando o seu review de fato apontou algo: PR que você bloqueou (pediu mudanças) ou aprovou com ressalva. Aprovação limpa, sem nenhum ponto de atenção, deixa de gerar pushback (antes qualquer review seu entrava no scan). A resposta do autor depois do review continua sendo condição. Esta aba Novidades também voltou a listar todas as versões (tinha parado na 2.23.4).']],
  ['2.23.6', ['Correções do macOS. O Farol agora abre de verdade pelo Finder, Spotlight e Launchpad (o lançador executa o binário nativo do Electron direto, sem depender de node no PATH; antes, aberto pelo Finder com PATH mínimo, morria em silêncio, sem janela e sem log). A janela sobe na frente e com foco, na abertura e no clique seguinte no ícone (antes subia atrás de tudo e sem foco, parecendo que não tinha aberto). E o ícone do Farol aparece certo no Finder/Spotlight (o .icns vem no pacote) e no Dock em execução (antes era o ícone cru do Electron). Primeira correção validada num Mac de verdade (Apple Silicon), vinda do PR #3 de @thiagocarvalho-dev.']],
  ['2.23.5', ['Acabou o "terminal piscando": aquela janela de console que abria e fechava sozinha de tempos em tempos enquanto o Farol rodava. A causa não era um comando do Farol (todos já rodam com janela oculta), era a telemetria do GitHub CLI, que dispara um processo próprio desanexado (gh send-telemetry) e, sem console herdado, faz o Windows abrir um console novo visível. O Farol agora desliga a telemetria do gh em tudo o que dispara (GH_TELEMETRY=false, o desligamento oficial documentado pelo GitHub CLI), cobrindo os comandos diretos, os gh de dentro das revisões e as sessões de terminal.']],
  ['2.23.4', ['Quando o autor pede sua revisão de novo (re-request) num PR que você já revisou, o Farol volta a mostrar o PR na sua fila como "pedida de novo" (com botão "Re-revisar"), em vez de deixá-lo preso no Panorama como "aguardando o autor". Antes, por já ter sido visto na 1ª revisão, a re-solicitação não reaparecia na sua tela. Também: novo interruptor "Registrar processos (diagnóstico)" em Sistema, pra caçar "terminal piscando" (loga em spawns.log cada comando que o Farol dispara, com horário, sem token).']],
  ['2.23.3', ['A interface responde melhor a janelas estreitas (o app já tem bastante aba e painel): em telas menores a barra de abas encolhe e rola em vez de estourar o topo, o botão "Verificar agora" vira só o ícone, e as linhas de lista e barras de ação quebram em vez de cortar botão ou texto. Em telas largas nada muda.']],
  ['2.23.2', ['A aba Consumo não mostra mais a barra de filtro por conta no topo: ali a medição é do Farol como um app (uso total de tokens), não de uma conta, então o filtro não se aplicava e só dava sensação de bug (trocar a conta e o número não mudar). A quebra "Por conta", que é explícita, continua, e o texto da tela deixa claro que mede o Farol como um todo.']],
  ['2.23.1', ['Ajuste do Consumo de tokens (da v2.23.0): virou uma tela própria (aba Consumo, saiu da Sistema), dedicada a acompanhar o uso das sessões autônomas do Claude. Agora com gráficos: uma linha do tempo (barras por dia) com métrica selecionável (total, input, output, cache) e janela selecionável (7, 30, 90 dias), e uma quebra por tipo, conta ou modelo. Continua sendo só rastreio pessoal, não influencia nenhuma decisão. E o registro ficou permanente: saiu o botão de zerar.']],
  ['2.23.0', ['Novo painel Consumo de tokens (aba Sistema): mostra quanto as sessões autônomas do Claude gastaram (revisão, autoanálise, pushback, ferramentas e chat), com total, hoje e últimos 7 dias, e quebras por tipo, por conta e por modelo. É só rastreio pra você ter noção do gasto no dia a dia, não muda nada na automação: a qualidade segue sendo o único critério das decisões. Registro local, sem custo extra. Também: "Revisões recentes" passa a mostrar 30 na tela (era 8) e guardar 200 no histórico (era 30).']],
  ['2.22.0', ['Nova aba Entregas: veja os PRs mergeados (por qualquer pessoa, não só o que o Farol revisou), agrupados por repositório ou por responsável, com o período escolhível (hoje, 7, 15 ou 30 dias). A visão é por organização: a sua principal já vem selecionada e você troca pra outra org num clique (com mais de uma conta, cada org aparece com a conta dona). É a visão de atualização dos projetos e de quem está entregando. Só leitura.']],
  ['2.21.0', ['As revisões que o Farol posta passam a parecer escritas por você, não por um bot. Saíram os carimbos de automação ("aprovado automaticamente pelo Farol", "por isso não auto-aprovei") e o formato rígido de template (caixas de alerta, Placar, checklist de critérios, prefixos "suggestion (non-blocking)"). O review sai no seu tom, direto e sem travessão, e o formato se adapta à senioridade do autor: estágio/júnior vira prosa de mentor; pleno/sênior/arquiteto fica enxuto e direto. Usa todo o perfil da pessoa pra personalizar, sem mudar a decisão nem o rigor. As ressalvas de um PR auto-aprovado seguem visíveis em Revisões recentes, só não vão mais coladas no PR.']],
  ['2.20.0', ['Dá pra consultar a conversa de qualquer PR pela URL. Um campo discreto embaixo de "Revisões recentes": cole a URL do PR e o Farol abre o chat salvo daquele review, mesmo que o PR já tenha saído da lista (pelo limite de 30 recentes ou por estar numa conta que não é a selecionada). Reusa o painel de chat de sempre, o resto do fluxo não muda, e as conversas ficam guardadas mesmo depois que a revisão sai do histórico.']],
  ['2.19.1', ['Qualidade de volta como padrão. Na v2.19.0 eu tinha posto Sonnet e o pushback desligado como padrão (mirando economia); revertido. O padrão volta a ser o Opus (melhor) e o pushback automático ligado. As opções de economia (Sonnet/Haiku, desligar pushback) seguem em Sistema pra quem quiser, mas não são o padrão. E o conserto que importa fica: se o limite do plano estourar, o Farol retoma sozinho no reset, sem largar o PR sem análise.']],
  ['2.19.0', ['O Farol passa a gastar bem menos do teu limite do Claude. As revisões automáticas agora rodam em Sonnet por padrão (consome muito menos do teto do plano que o Opus); dá pra trocar o modelo em Sistema, e a sessão de terminal não muda. A detecção automática de pushback virou opt-in (roda uma sessão do Claude por PR contestado, então vem desligada; a marcação manual segue sempre). E quando uma revisão falha por algo transitório (limite do plano atingido, rede, claude indisponível), o Farol retoma sozinho no próximo ciclo em vez de largar o PR na fila sem análise.']],
  ['2.18.0', ['Dá pra escolher qual assinatura do Claude o Farol usa. No campo "Assinatura do Claude" (Sistema), aponte um diretório de config próprio logado noutra conta, e as sessões do Farol (automáticas e de terminal) passam a usar aquela assinatura, sem mexer no seu login principal do claude (o de codar). Útil pra não deixar as revisões e a classificação de pushback comendo a sua conta de trabalho. Faça claude login nesse diretório uma vez; a aba Saúde mostra a conta em uso e avisa se faltar login. Alternar de assinatura é só trocar o caminho (vazio volta pra padrão da máquina).']],
  ['2.17.0', ['O pushback passou a ser detectado sozinho, direto do PR. Quando o autor contesta um review seu (responde, rebate, re-pede review), o Farol percebe e classifica o desfecho (autor tinha razão, você tinha, ou meio-termo) sem você marcar à mão. Funciona assim: um gatilho barato vê se o autor teve atividade depois do seu review; só aí o Farol lê a thread (leitura pura, nunca posta) pra julgar. Desfecho claro entra sozinho; em dúvida, aparece um "confirmar?" em Revisões recentes com o desfecho sugerido, pra você resolver num toque só os ambíguos. Isso calibra o tom dos reviews futuros da pessoa, sem mexer na decisão técnica. A marcação manual segue como correção quando você discordar do que o Farol inferiu.']],
  ['2.16.1', ['Pente-fino de uma revisão do projeto. Correções: não duplica mais a revisão de um PR que já estava em análise (clique ou dois cliques rápidos); aprovação por conta mais segura (se os PRs impecáveis aguardam sua ação, os com ressalva também aguardam, corrigindo um caso de configuração invertida); o seletor de papel no card do PR não fecha mais sozinho no meio da escolha; e o kudos sempre mostra a conta certa ao abrir Destaques. Esta lista de novidades também recuperou as versões 2.0.0 e 1.19.0 que tinham sido puladas.']],
  ['2.16.0', ['O Farol passa a lembrar dos pushbacks. Quando um review seu é contestado, você registra na linha de "Revisões recentes" o desfecho (o autor tinha razão, nós tínhamos razão, ou meio-termo) e uma nota curta opcional. Nas próximas revisões automáticas daquela pessoa, o Farol leva esse histórico em conta pra calibrar a postura: onde ela já mostrou que estava certa, afirma com mais humildade antes de apontar algo parecido; onde você estava certo, mantém a posição. Mexe só no tom e na postura, nunca na decisão técnica.']],
  ['2.15.0', ['A senioridade virou um perfil de verdade, com dois eixos. O papel cobre carreira e posição (Estágio, Júnior, Pleno, Sênior, mais Tech Lead, Arquiteto e Especialista) e dá o tom-base. A matriz por domínio (Backend, Frontend, Dados, Infra, de Básico a Autoridade) reconhece que a pessoa pode ser autoridade numa área e estar começando em outra: onde é autoridade o review defere e foca no alto nível; onde está começando, explica mais e cuida dos fundamentos. Segue mexendo só no tom e na postura, nunca na decisão técnica. O papel se marca no card do PR e na aba Time; a matriz fica na aba Time. Quem já estava marcado como Estágio/Júnior/Pleno/Sênior migra sozinho pro papel.']],
  ['2.14.0', ['Agora dá pra marcar a senioridade de alguém direto do card do PR (na fila e em "Precisa de você"), não só na aba Time. Antes, como a aba Time só lista quem já foi revisado ao menos uma vez, o primeiro PR de alguém novo saía sempre no tom neutro; agora você marca no momento em que vê o PR e a revisão já sai no tom certo. É a mesma marcação por pessoa, só com mais um lugar pra fazer.']],
  ['2.13.0', ['Contas diferentes agora são revisadas em paralelo: cada conta roda a sua revisão ao mesmo tempo (a BIUD e a pessoal juntas, por exemplo), em vez de uma por vez no total. Dentro da mesma conta segue uma de cada vez, pra não sobrecarregar a máquina. Assim, uma análise demorada de uma conta não segura mais a fila das outras.']],
  ['2.12.1', ['Correção: "Analisando agora" e a fila do Radar agora respeitam a conta selecionada. Antes, a revisão em andamento aparecia igual em qualquer conta (misturava trabalho e pessoal enquanto o Farol analisava um PR); agora filtra pela conta escolhida, e em "Todas" mostra tudo. As outras seções já respeitavam.']],
  ['2.12.0', ['Senioridade por pessoa, na aba Time: marque cada pessoa como Estágio, Júnior, Pleno ou Sênior, e a revisão automática ajusta o TOM e a forma de comunicar o veredito de acordo. Com um estágio, reconhece a iniciativa e enquadra os ajustes como aprendizado (sem desanimar, mesmo pedindo mudança); com uma pessoa sênior, vai direto ao ponto. Muda só a linguagem: a decisão técnica (aprovar, pedir mudanças, o card, o gate) continua igual pra todo mundo, pelos fatos do código. Quem você não marcar recebe o tom neutro de antes. Vale na revisão que o Farol posta sozinho; a sessão de terminal segue como está.']],
  ['2.11.0', ['A automação por conta ficou mais fiel ao que você pediu. (1) "Revisa na hora" agora vale pros PRs que JÁ estavam na fila da conta, não só os que acabaram de chegar (era o "configurei e não agiu"); PRs cancelados ou que falharam sem ser rede ficam de fora até você reabrir. (2) Quando um aprovável fica esperando por causa da sua política (ex.: aprovável com ressalvas e a conta manda aguardar), o motivo agora diz isso claramente, em vez de mostrar só os pontos técnicos. (3) Nova alavanca opt-in por conta "quando tem bloqueios": por padrão espera você, mas dá pra ligar "reprova sozinho", aí num review pedido a você e com bloqueios reais o Farol posta o "pedir mudanças" com os pontos anexados (marcado como automático). Desligada por padrão; clique no panorama nunca posta; não re-pede mudanças se você já pediu.']],
  ['2.10.0', ['Os Kudos compilados agora respeitam a conta selecionada: cada conta tem a sua compilação, gerada só com os destaques daquela conta, e o painel some quando a conta ainda não tem kudos (em "Todas" compila tudo). Antes o mesmo resumo aparecia em qualquer conta, misturando trabalho e pessoal. Junto, os rótulos da automação por conta foram reescritos pra ficarem óbvios ("quando chega um PR pra você", "quando fica aprovável sem/com ressalvas", "revisa na hora", "aprova e destaca as ressalvas", "espera você aprovar"), com uma linha lembrando que o que você não escolher segue o padrão geral.']],
  ['2.9.0', ['Política automática por conta, no painel Contas (aba Sistema): cada conta do GitHub decide sozinha como o Farol age. São três controles próprios por conta, quando chega revisão (revisa sozinho, só põe na fila ou herda o padrão global), PR aprovável sem ressalva (aprova sozinho ou aguarda você) e PR aprovável com ressalva (aprova ressaltando os pontos de atenção ou aguarda sua ação). A conta do trabalho pode revisar e aprovar sozinha o que é seguro, a pessoal só põe na fila e espera você, sem misturar as regras. O que você não configurar por conta herda o padrão global (os dois toggles gerais em Sistema).']],
  ['2.8.3', ['Confirmação com impacto nas ações que escrevem no GitHub: Merge, Merge como admin e Pedir mudanças agora abrem a caixa de confirmação (como o Remover conta), explicando o que a ação faz e o que ela mexe, no lugar do aviso genérico do navegador. O Merge admin, que fura o gate de review do time, ganha o aviso mais forte.']],
  ['2.8.2', ['Instalador BETA de macOS (Apple Silicon) anexado à release: o Farol-Instalar-mac.command foi montado aqui mesmo, sem um Mac, embutindo o Electron pra o próprio Mac descompactar (assim os symlinks do app ficam intactos). Como o suporte a macOS nunca rodou num Mac de verdade, é beta: instale (1ª vez: botão direito > Abrir), e se algo quebrar, use "Exportar diagnóstico" (Saúde) e mande. Com esse retorno a gente corrige e libera a versão final.']],
  ['2.8.1', ['Preparação do suporte a macOS: o install.sh passou a garantir o bit de execução do Electron na instalação (robustez pra instalador montado fora do Mac).']],
  ['2.8.0', ['Exportar diagnóstico (Sistema > Saúde): um clique gera um relatório sem segredos (ambiente, contas, config, estado e o log de falhas) pra você copiar e mandar pra quem mantém o Farol. É o jeito de coletar o que precisa pra corrigir um problema, especialmente útil pra destravar o suporte a macOS.', 'Remover conta agora abre uma caixa de confirmação que explica o impacto (o que para de ser monitorado, o que não é apagado, que dá pra readicionar), no lugar do aviso genérico do navegador.']],
  ['2.7.0', ['Editor de contas na aba Sistema: dá pra adicionar e remover conta, e editar o rótulo, a cor, o tipo (Trabalho/Pessoal) e as orgs de cada uma, sem precisar mexer no config.json na mão. O tipo é o que faz a faixa dizer "1 de trabalho e 1 pessoal".', '"Aprovar sozinho tudo que for aprovável" agora vem DESLIGADO por padrão (você liga em Sistema se quiser): mais seguro agora que o app é público e cada pessoa decide o próprio nível de automação.', 'A barra de contas não mostra mais o contador de PRs pendentes fora do Radar (lá ele não tinha a ver com o conteúdo da aba).']],
  ['2.6.1', ['O seletor de reviewers agora lista só quem faz parte daquela organização: antes, ao configurar os reviewers de um projeto, o dropdown misturava as pessoas de todas as orgs monitoradas (na conta pessoal aparecia gente do trabalho, o que não fazia sentido). Cada org passa a oferecer só os próprios membros e times. Org sem membros enumeráveis vira um campo pra digitar o handle na mão.']],
  ['2.6.0', ['Destaques e Time separados por conta: quando você monitora mais de uma conta do GitHub, cada aba agrupa por conta (com a barra de contas de volta pra filtrar), em vez de misturar trabalho e pessoal no mesmo balaio. A partir desta versão a memória do time guarda a org de cada review pra atribuir a conta; registros antigos (sem essa marca) aparecem num grupo "Geral" até o autor ser re-revisado.']],
  ['2.5.0', ['Reviewers por projeto reinventado, o fim da repetição: agora você define um grupo padrão por organização (aplicado a TODOS os repos dela no botão Reviewers), e só os projetos que fogem do padrão aparecem, como um diff enxuto ("padrão − fulano" / "padrão + ciclano"). Os demais colapsam numa linha só. Quem já tinha listas repetidas ganha um botão "Criar padrão" que detecta o grupo comum e recolhe tudo num clique. E o botão "👥 Reviewers" passa a funcionar em qualquer repo da org, mesmo sem config própria, usando o padrão.']],
  ['2.4.2', ['A barra de contas agora aparece só no Radar, onde ela realmente filtra. Nas abas Sistema, Time e Destaques ela sumiu (lá trocar de conta não mudava nada e só confundia): Sistema é global, e Time/Destaques são memória do time.']],
  ['2.4.1', ['Diagnóstico de atualização honesto: quando o Farol não consegue ler as releases (repo sem acesso pra sua conta, sem release ainda, ou rede), a aba Sistema diz isso claramente, em vez de mostrar "você está na versão mais recente" e te deixar sem saber que havia update.']],
  ['2.4.0', ['Aprova sozinho tudo que for aprovável, sem depender do seu clique: quando a revisão conclui que o PR está aprovável, o Farol posta o APPROVE na hora e deixa os pontos de atenção claros (anexados ao próprio PR e visíveis em Revisões recentes). Vale só pros reviews pedidos a você (clique no panorama nunca posta). Dá pra desligar em Sistema > Configurações e voltar a ser chamado nos casos com ressalva.']],
  ['2.3.0', ['Panorama: um PR que você já aprovou volta a mostrar "Re-revisar" quando (e só quando) entra commit novo depois da sua review; sem commit novo, segue como "nada a fazer". O Farol compara o commit da sua última review com o topo atual do PR.']],
  ['2.2.0', ['Reviewers por projeto agora agrupados por conta: cada projeto aparece sob a conta dona (Pessoal, BIUD, etc.), acabando com a lista misturada quando você monitora mais de uma conta']],
  ['2.1.0', ['Separação de contas: barra no topo pra alternar entre Todas e cada conta do GitHub (trabalho, pessoal, mais de um emprego), cada uma com cor e identidade próprias', 'De quem e por quem: cada card mostra o autor do PR (@quem escreveu) separado da sua conta (cor e etiqueta), e ao focar uma conta a faixa diz "revisando e postando como @você"', 'Contas silenciadas: aquele PR-teste antigo que nunca fecha sai do painel e dos avisos sem ser perdido (aparece ao selecionar a conta); ajuste em Sistema > Contas', 'Painel de contas em Sistema pra silenciar/reativar, e reviewers por projeto mais enxuto', 'Panorama: PR que você já aprovou não mostra mais "Re-revisar" (só quando entra commit novo)']],
  ['2.0.0', ['A cara nova do Farol: navegação lateral (Radar, Destaques, Time e Sistema numa barra à esquerda, com a conta sempre à vista e um aviso no Radar quando alguma decisão espera por você), um resumo do dia no topo do Radar (quantas decisões precisam de você, o tamanho da fila, o que está sendo analisado agora e quantos PRs você já revisou hoje, tudo do estado real), e cards e listas mais legíveis, mantendo exatamente os mesmos fluxos.']],
  ['1.19.0', ['Multi-conta: o Farol passa a observar mais de uma conta do GitHub ao mesmo tempo (a do trabalho e a pessoal, por exemplo) e junta os PRs das duas no mesmo painel. Cada PR sabe de qual conta veio, e toda ação (buscar, revisar, comentar, pedir reviewers, mergear) usa o token certo daquela conta, sem misturar identidade. Quem usa uma conta só não muda nada. Ative preenchendo o bloco accounts no ~/.farol/config.json.']],
  ['1.18.0', ['A autoanálise de um PR é descartada quando entra commit novo: o card volta a "não analisado", pra não mostrar veredito velho que já não vale', '"Merge (admin)" só aparece quando realmente resolve (some quando o repo usa ruleset que o admin não fura)', 'Times enterprise saíram do seletor de reviewers (o GitHub não os aceita como reviewer de PR)']],
  ['1.17.0', ['Reviewers por projeto agora é um seletor de pessoas e times da organização (chips), sem digitar handle na mão', 'Copiar o grupo de reviewers pra outros repos de uma vez ("copiar pra…")', 'Clicar em "Reviewers" num repo sem config leva pra tela de configuração, em vez de dar erro']],
  ['1.16.0', ['Instalador de arquivo único no Windows: um .exe, duplo clique instala e abre (sem extrair zip nem escolher arquivo)', 'Cada PR em "Meus PRs" mostra de qual branch pra qual branch vai (origem → destino)', 'Botão "Reviewers": configure os reviewers por projeto (Sistema) e, num clique, o Farol te atribui e pede review dessa lista']],
  ['1.15.0', ['Atualização automática: as cópias instaladas checam as releases do GitHub e se atualizam sozinhas (o update é leve, só troca os arquivos do app)']],
  ['1.14.0', ['Instalador offline: Windows (zip com Electron embutido, extrai e dá duplo clique) e macOS (arquivo único autoextraível). Sem Node, sem npm, sem download']],
  ['1.13.0', ['Auto-merge só é oferecido quando o repo tem "Allow auto-merge" ligado; senão sobra o Merge (admin), com aviso claro', 'Repo sem auto-merge deixou de poluir o log como erro (vira aviso)']],
  ['1.12.0', ['Aba Sistema mostra as novidades de cada versão (esta lista)']],
  ['1.11.0', ['Merge só fica disponível quando dá pra mergear de verdade (lê a mergeabilidade real do PR no GitHub)']],
  ['1.10.0', ['Quando a proteção de branch bloqueia, oferece Auto-merge (espera os requisitos) ou Merge como admin (bypassa, só se você for admin)']],
  ['1.9.0', ['Botão pra copiar um prompt de correção/melhoria a partir da revisão, pronto pra colar no chat']],
  ['1.8.0', ['Botão Merge nos Meus PRs aprováveis: só os seus, atribui você se preciso, deleta a branch descartável e respeita a lista de repos bloqueados']],
  ['1.7.0', ['Nível do agente (Opus/Sonnet) visível na análise', 'Fila de análise transparente: um por vez, com a posição de cada PR']]
];
const REL_NOTES_BATCH = 5;
let relNotesShown = REL_NOTES_BATCH;
function renderReleaseNotes() {
  const box = $('#relNotes');
  if (!box) return;
  const cur = (estado().app && estado().app.version) || '';
  const total = RELEASE_NOTES.length;
  const shown = Math.min(relNotesShown, total);
  const resto = total - shown;
  box.innerHTML = RELEASE_NOTES.slice(0, shown).map(([v, items]) => `
    <div class="relnote">
      <div class="relnote-ver">v${esc(v)}${v === cur ? ' <span class="badge">atual</span>' : ''}</div>
      <ul class="dec-reasons">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`).join('') + (resto > 0 ? `<button id="relNotesMore" class="btn sm">Ver mais ${Math.min(REL_NOTES_BATCH, resto)} versões (${resto} restantes)</button>` : '');
}
$('#relNotes').addEventListener('click', (e) => {
  if (e.target.closest('#relNotesMore')) { relNotesShown += REL_NOTES_BATCH; renderReleaseNotes(); }
});

/* ---------- Sistema > Sobre: privacidade, licença e créditos ---------- */
// Créditos vêm do snapshot (engine busca os contribuidores do repo do update no
// GitHub, cache de 24h): a lista se mantém sozinha quando entra colaborador novo.
// O link da licença aponta pro LICENSE do MESMO repo, então fork continua certo.
function renderAbout() {
  const box = $('#creditsBox');
  if (!box) return;
  // crédito de ORIGEM é fixo de propósito: a inspiração não está no git (o código
  // atual foi reconstruído do zero), então a lista sincronizada nunca a capturaria,
  // e história não muda, logo não há manutenção. Decisão do Wanderson, 15/08/2026.
  $('#aboutOrigem').innerHTML = `<span class="origem-label">Origem</span> O Farol nasceu de uma iniciativa do Thiago (${personMention('thiagopcdev', 'xs')}): um revisor de PRs que rodava numa janela de terminal e dependia de ação manual. O app atual foi reconstruído do zero em cima dessa essência.`;
  box.innerHTML = creditsHtml(estado().credits);
  const repo = ((estado().config && estado().config.updateRepo) || '').trim();
  const link = $('#aboutLicenseLink');
  if (link && /^[^\s/]+\/[^\s/]+$/.test(repo)) link.href = `https://github.com/${repo}/blob/main/LICENSE`;
}

/* ---------- editor de reviewers: padrão por org + exceções por repo ---------- */
let reviewerCands = {}; // { org: { members, teams } } (candidatos POR organização)
let reviewerCandsLoaded = false;
const openExceptions = new Set(); // repos (owner/repo) com o editor de exceção aberto
const foldedOpen = new Set();     // orgs com a lista "seguem o padrão" expandida
const pendingExc = new Set();     // repos novos sendo criados como exceção

async function loadReviewerCands(force) {
  if (reviewerCandsLoaded && !force) return;
  const r = await get('/api/reviewer-candidates');
  if (r) { reviewerCands = r; reviewerCandsLoaded = true; }
  renderReviewersEditor();
}

/* ---- helpers do modelo padrão/exceção ---- */
function cfgDefaults() { return (estado().config || {}).defaultReviewers || {}; }
function cfgProjects() { return (estado().config || {}).projectReviewers || {}; }
// ctx do editor de reviewers: uma leitura so por renderizacao. Mesmo motivo do
// peopleOf, do primeiro passo da onda: os blocos de uma mesma passada tem que
// enxergar o mesmo estado, senao um SSE no meio do render faz duas orgs da mesma
// tela discordarem. Os Sets viajam por referencia de proposito, porque quem os
// muta sao os handlers aqui embaixo, e o render seguinte ja le o valor novo.
const revCtx = () => ({
  defaults: cfgDefaults(), projects: cfgProjects(),
  cands: reviewerCands, candsLoaded: reviewerCandsLoaded,
  abertas: openExceptions, pendentes: pendingExc, expandidas: foldedOpen,
  prKeys: [...(estado().myPRs || []).map(p => p.key), ...(estado().panorama || []).map(p => p.key)],
  owner2user: OWNER2USER, ghUser: (estado().config || {}).ghUser || '',
});

// reviewers presentes na maioria das exceções da org: sugestão pra virar padrão
// seletor de adicionar reviewer, SÓ com os candidatos da org. Quando a org não
// tem membros enumeráveis (ex.: conta pessoal, namespace sem org no GitHub), cai
// num campo pra digitar o handle na mão (Enter adiciona).

/* ---- persistência otimista ---- */
function applyDefaults(map) {
  const clean = {};
  for (const k of Object.keys(map)) if ((map[k] || []).length) clean[k] = map[k];
  if (!estado().config) estado().config = {};
  estado().config.defaultReviewers = clean;
  // pruna exceções que passaram a igualar o padrão (viram "segue o padrão")
  const pr = { ...cfgProjects() }; let prChanged = false;
  for (const repo of Object.keys(pr)) {
    if (openExceptions.has(repo) || pendingExc.has(repo)) continue;
    const d = clean[repo.split('/')[0]] || clean[repo.split('/')[0].toLowerCase()] || [];
    if (sameSet(pr[repo], d)) { delete pr[repo]; prChanged = true; }
  }
  if (prChanged) estado().config.projectReviewers = pr;
  renderReviewersEditor();
  api('/api/settings', { defaultReviewers: clean });
  if (prChanged) api('/api/settings', { projectReviewers: pr });
}
function applyProjects(map, keepRepo) {
  const clean = {};
  for (const k of Object.keys(map)) {
    const list = map[k] || []; if (!list.length) continue;
    // dropa exceção idêntica ao padrão (salvo a que está aberta em edição)
    if (k !== keepRepo && !openExceptions.has(k) && !pendingExc.has(k) && sameSet(list, defaultFor(k.split('/')[0], revCtx()))) continue;
    clean[k] = list;
  }
  if (!estado().config) estado().config = {};
  estado().config.projectReviewers = clean;
  renderReviewersEditor();
  api('/api/settings', { projectReviewers: clean });
}
function seedException(repo) {
  pendingExc.add(repo); openExceptions.add(repo);
  const map = { ...cfgProjects() };
  const ctx = revCtx();
  if (!overrideFor(repo, ctx)) map[repo] = [...defaultFor(repo.split('/')[0], ctx)];
  applyProjects(map, repo);
}

/* ---- render de um bloco de org (padrão + exceções + colapsado) ---- */

function renderReviewersEditor() {
  const box = $('#reviewersEditor'); if (!box) return;
  const parts = [];
  const seen = new Set();
  const orgToUser = {};
  Object.keys(OWNER2USER).forEach(o => { orgToUser[o] = OWNER2USER[o]; });
  // um ctx pra TODA a tela: o laço por conta e o bloco das órfãs lá embaixo têm que
  // enxergar o mesmo estado, e o `const` dentro do laço não alcançava as órfãs
  const ctxRev = revCtx();
  for (const a of (estado().accounts || [])) {
    const meta = ACCT[a.user.toLowerCase()] || {};
    const orgs = [...new Set((a.owners || []).map(String))];
    [...Object.keys(cfgDefaults()), ...Object.keys(cfgProjects()).map(r => r.split('/')[0])].forEach(o => {
      if (OWNER2USER[o.toLowerCase()] === a.user && !orgs.some(x => x.toLowerCase() === o.toLowerCase())) orgs.push(o);
    });
    const blocks = orgs.filter(Boolean).sort().map(o => { seen.add(o.toLowerCase()); return renderOrgBlock(o, meta.color || 'var(--accent)', ctxRev); }).join('');
    if (!blocks) continue;
    if (multiAccount()) parts.push(`<div class="rev-group-head" style="--ac:${meta.color}"><span class="g-dot"></span>${esc(meta.label || a.user)}</div>`);
    parts.push(blocks);
  }
  // orgs de config sem conta dona conhecida
  const orphans = [...new Set([...Object.keys(cfgDefaults()), ...Object.keys(cfgProjects()).map(r => r.split('/')[0])])].filter(o => o && !seen.has(o.toLowerCase())).sort();
  if (orphans.length) {
    if (multiAccount()) parts.push('<div class="rev-group-head" style="--ac:var(--muted)"><span class="g-dot"></span>Outros</div>');
    parts.push(orphans.map(o => renderOrgBlock(o, 'var(--muted)', ctxRev)).join(''));
  }
  box.innerHTML = parts.join('') || '<div class="rev-empty">Nenhuma organização monitorada ainda. Configure as organizações no campo acima.</div>';
}

$('#reviewersEditor').addEventListener('change', (e) => {
  const defAdd = e.target.closest('.rev-def-add');
  if (defAdd) {
    const val = (defAdd.value || '').trim(); if (!val) return;
    const org = defAdd.dataset.org, cur = defaultFor(org, revCtx());
    if (cur.some(x => x.toLowerCase() === val.toLowerCase())) return;
    const map = { ...cfgDefaults() }; map[org] = [...cur, val];
    applyDefaults(map); return;
  }
  const excAdd = e.target.closest('.rev-exc-add');
  if (excAdd) {
    const val = (excAdd.value || '').trim(); if (!val) return;
    const repo = excAdd.dataset.repo;
    const c = revCtx(); const cur = overrideFor(repo, c) || (pendingExc.has(repo) ? [...defaultFor(repo.split('/')[0], c)] : []);
    if (cur.some(x => x.toLowerCase() === val.toLowerCase())) return;
    const map = { ...cfgProjects() }; map[repo] = [...cur, val];
    applyProjects(map, repo); return;
  }
});
// campo manual (org sem membros): Enter adiciona (dispara o change)
$('#reviewersEditor').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('rev-manual')) { e.preventDefault(); e.target.blur(); }
});
$('#reviewersEditor').addEventListener('click', (e) => {
  const defX = e.target.closest('.rev-def-x');
  if (defX) { const org = defX.dataset.org, map = { ...cfgDefaults() }; map[org] = defaultFor(org, revCtx()).filter(r => r !== defX.dataset.rv); applyDefaults(map); return; }
  const mkDef = e.target.closest('.rev-make-default');
  if (mkDef) { const org = mkDef.dataset.org, map = { ...cfgDefaults() }; map[org] = suggestDefault(org, revCtx()); applyDefaults(map); toast('ok', 'Padrão criado. Projetos iguais colapsaram; os diferentes viraram exceção.', 5000); return; }
  const excX = e.target.closest('.rev-exc-x');
  if (excX) { const repo = excX.dataset.repo, map = { ...cfgProjects() }; const cur = overrideFor(repo, revCtx()) || [...defaultFor(repo.split('/')[0])]; map[repo] = cur.filter(r => r !== excX.dataset.rv); applyProjects(map, repo); return; }
  const excToggle = e.target.closest('.rev-exc-toggle');
  if (excToggle) {
    const repo = excToggle.dataset.repo;
    if (openExceptions.has(repo)) {
      openExceptions.delete(repo); pendingExc.delete(repo);
      const o = overrideFor(repo, revCtx());
      if (o && sameSet(o, defaultFor(repo.split('/')[0], revCtx()))) { const map = { ...cfgProjects() }; delete map[repo]; delete map[repo.toLowerCase()]; applyProjects(map); }
      else renderReviewersEditor();
    } else { openExceptions.add(repo); renderReviewersEditor(); }
    return;
  }
  const excReset = e.target.closest('.rev-exc-reset');
  if (excReset) { const repo = excReset.dataset.repo; openExceptions.delete(repo); pendingExc.delete(repo); const map = { ...cfgProjects() }; delete map[repo]; delete map[repo.toLowerCase()]; applyProjects(map); toast('info', `${repoShort(repo)} voltou ao padrão da org.`, 3000); return; }
  const foldToggle = e.target.closest('.rev-fold-toggle');
  if (foldToggle) { const org = foldToggle.dataset.org; if (foldedOpen.has(org)) foldedOpen.delete(org); else foldedOpen.add(org); renderReviewersEditor(); return; }
  const mkExc = e.target.closest('.rev-mk-exc');
  if (mkExc) { seedException(mkExc.dataset.repo); return; }
  const newExcGo = e.target.closest('.rev-newexc-go');
  if (newExcGo) {
    const org = newExcGo.dataset.org;
    const inp = newExcGo.closest('.rev-newexc').querySelector('.rev-newexc-input');
    let repo = (inp.value || '').trim();
    if (!repo) return;
    if (!repo.includes('/')) repo = `${org}/${repo}`;
    if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) { toast('error', 'Informe no formato owner/repo.'); return; }
    seedException(repo); return;
  }
});

let AUTOMATION_PROVIDER = null;

function providerInicial(c) {
  const profiles = Array.isArray(c.claudeProfiles) ? c.claudeProfiles : [];
  const padrao = profiles.find(p => p.id === c.claudeProfileId);
  return padrao && padrao.kind === 'codex' ? 'codex' : 'claude';
}

function addCustomOption(select, value) {
  if (!value || !select || !select.options) return;
  if (Array.from(select.options).some(o => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = `${value} (config.json)`;
  select.appendChild(opt);
}

/* Cartões de esforço: marca o que está salvo e explica o estado. Valor desconhecido
   cai no cartão do padrão, em vez de deixar nenhum marcado. */
function renderEffortBox(box, eff) {
  if (!box) return;
  const alvo = box.querySelector(`input[value="${CSS.escape(eff)}"]`) || box.querySelector('input[value=""]');
  if (alvo) alvo.checked = true;
}

function renderAutomationSettings(c) {
  if (!AUTOMATION_PROVIDER) AUTOMATION_PROVIDER = providerInicial(c);
  const codex = AUTOMATION_PROVIDER === 'codex';
  const botoes = [...document.querySelectorAll('#setAutomationProvider .seg-btn')];
  marcarSeg(botoes, b => b.dataset.provider === AUTOMATION_PROVIDER);
  $('#setReviewModel').hidden = codex;
  $('#setCodexReviewModel').hidden = !codex;
  $('#setReviewEffort').hidden = codex;
  $('#setCodexReviewEffort').hidden = !codex;

  const claudeModel = String(c.reviewModel || '');
  const codexModel = String(c.codexReviewModel || '');
  addCustomOption($('#setReviewModel'), claudeModel);
  addCustomOption($('#setCodexReviewModel'), codexModel);
  $('#setReviewModel').value = claudeModel;
  $('#setCodexReviewModel').value = codexModel;
  renderEffortBox($('#setReviewEffort'), String(c.reviewEffort || ''));
  renderEffortBox($('#setCodexReviewEffort'), String(c.codexReviewEffort || ''));

  const semEsforco = claudeModel === 'haiku' || claudeModel === 'auto';
  $('#setReviewEffort').classList.toggle('disabled', semEsforco);
  if (codex) {
    $('#reviewModelHint').textContent = 'Modelo usado pelo Codex nas revisões, pushback, autoanálise e ferramentas. O padrão acompanha a seleção do CLI e costuma ser a opção mais compatível com o teu plano.';
    $('#effortHint').textContent = 'Quanto o Codex raciocina nas sessões autônomas. O CLI aceita minimal, low, medium, high e xhigh; o último depende do modelo.';
  } else {
    $('#reviewModelHint').textContent = 'Modelo usado pelo Claude nas revisões, pushback, autoanálise e ferramentas. O padrão herda a tua assinatura; Auto (custo-benefício) escolhe Haiku ou Sonnet pelo tamanho do PR só na revisão headless; Sonnet e Haiku poupam o limite do plano.';
    let effortHint = 'Quanto o Claude pensa nas sessões autônomas. Mais esforço aumenta profundidade e consumo do limite.';
    if (claudeModel === 'haiku') {
      effortHint = 'O Haiku não aceita nível de esforço, então o Farol não passa a flag enquanto ele estiver escolhido.';
    } else if (claudeModel === 'auto') {
      effortHint = 'No modo Auto o Farol escolhe modelo e esforço pelo tamanho do PR; o nível fixo desta seção não entra.';
    }
    $('#effortHint').textContent = effortHint;
  }
}

$('#setAutomationProvider').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  AUTOMATION_PROVIDER = btn.dataset.provider;
  renderAutomationSettings((estado() && estado().config) || {});
});

function renderSettings() {
  renderReleaseNotes();
  renderAbout();
  const c = estado().config;
  const setIf = (el, val) => { if (document.activeElement !== el) el.value = val; };
  setIf($('#setUser'), c.ghUser);
  setIf($('#setOwners'), (c.owners || []).join(', '));
  setIf($('#setMergeBlocked'), (c.mergeBlockedRepos || []).join(', '));
  renderReviewersEditor();
  renderClaudeProfiles();
  renderJiraSites();
  renderSync();
  $('#setInterval').value = String(c.intervalSeconds);
  $('#setParallelReviews').value = String(c.parallelReviews || 1);
  // teto global: 0 = desligado, e o `|| 0` do default cai certo nele de propósito
  $('#setGlobalParallelReviews').value = String(c.globalParallelReviews || 0);
  renderAutomationSettings(c);
  $('#setAutoReview').checked = !!c.autoReview;
  $('#setAutoApproveAll').checked = c.autoApproveAll !== false;
  $('#setAutoApproveContested').checked = c.autoApproveContested === true;
  $('#setReviewFast').checked = c.reviewFast === true;
  $('#setCoAssinarReview').checked = c.coAssinarReview === true;
  $('#setReReviewResume').checked = c.reReviewResume === true;
  $('#setAutoPushback').checked = !!c.autoPushback;
  $('#setAutoUpdate').checked = c.autoUpdate !== false;
  $('#setDebugSpawns').checked = !!c.debugSpawns;
  $('#setSkipPerms').checked = !!c.skipPermissions;
  $('#setSound').checked = !!c.soundEnabled;
  $('#setTeamHighlights').checked = c.teamHighlights === true;
  $('#setDeliveriesEnabled').checked = c.deliveriesEnabled === true;
  $('#setAutostart').checked = !!c.autostart;
  // autostart: só no Windows (no macOS o login item abriria o Electron sem os args do app,
  // ver applyAutostart em main.js). A plataforma vem do engine, não do userAgent.
  // autostart só existe de verdade no Windows (setLoginItemSettings é no-op no
  // Linux e desabilitado por decisão no mac); mostrar a opção seria mentira
  $('#rowAutostart').style.display = isElectron && ehWin() ? '' : 'none';
}

/* ---------- ações ---------- */
$('#btnCheck').onclick = () => api('/api/check');
$('#btnReviewAll').onclick = () => {
  // revisa só o que está visível no escopo atual; a lista vai SEMPRE explícita
  // (mandar {} fazia o servidor revisar a fila INTEIRA, achado B22)
  const urls = (estado().queue || []).filter(scopeVisible).map(p => p.url);
  if (!urls.length) { toast('info', 'Nada visível pra revisar agora (a fila mudou embaixo do botão).'); return; }
  revisarUrls(urls);
};

/* tweaks de exibição (guardados no navegador, não vão pro engine) */
function initTweaks() {
  const mh = $('#setMutedHandling'), is = $('#setIdentityStyle');
  if (mh) { mh.value = TWEAK.muted; mh.onchange = () => { TWEAK.muted = mh.value; localStorage.setItem('farol-muted-handling', mh.value); rerenderScope(); }; }
  if (is) { is.value = TWEAK.ident; is.onchange = () => { TWEAK.ident = is.value; localStorage.setItem('farol-identity-style', is.value); rerenderScope(); }; }
}
initTweaks();
$('#btnKudos').onclick = async () => {
  const btn = $('#btnKudos');
  const opId = 'tool-kudos';
  showOp(opId, { type: 'tool', title: 'Gerando kudos', inline: true, container: btn.parentElement });
  const r = await api('/api/tool', { name: 'kudos', scope: kudosScopeKey() });
  if (r?.ok) closeOp(opId, 'done', 'Kudos gerado');
  else { closeOp(opId, 'error', r?.error || 'não consegui gerar'); toast('info', r?.error || 'não consegui gerar'); }
};
$('#btnHealth').onclick = async () => {
  const btn = $('#btnHealth');
  const opId = 'tool-health';
  showOp(opId, { type: 'tool', title: 'Diagnosticando', inline: true, container: btn.parentElement });
  const r = await api('/api/tool', { name: 'health' });
  if (r?.ok) closeOp(opId, 'done', 'Diagnóstico completo');
  else closeOp(opId, 'error', r?.error || 'falha no diagnóstico');
};
$('#btnDoctor').onclick = async () => { await get('/api/doctor'); };
$('#btnUpdateCheck').onclick = async () => {
  const btn = $('#btnUpdateCheck');
  const opId = 'sys-update-check';
  btn.disabled = true;
  btn.textContent = '↑ Verificando…';
  showOp(opId, { type: 'update', title: 'Verificando atualizações', inline: true, container: $('#updateBox') || document.body });
  await get('/api/doctor');
  closeOp(opId, 'done', 'Verificação concluída');
  setTimeout(() => { btn.disabled = false; btn.textContent = '↑ Verificar agora'; }, 1000);
  toast('ok', 'Verificação de atualização feita.', 2500);
};
$('#btnLogRefresh').onclick = loadLog;

$('#panorama').addEventListener('click', async (e) => {
  const btn = e.target.closest('.pano-review');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Revisando…';
    revisarUrls([btn.dataset.url]);
    return;
  }
  // .act-chat é ouvido globalmente (document); só o copiar precisa de listener aqui,
  // mesmo padrão de "cada seção escuta o seu" usado em Revisões recentes (#resolved).
  const cp = e.target.closest('.rr-copy');
  if (cp) {
    const ok = await copyToClipboard(cp.dataset.url || cp.dataset.key || '');
    toast(ok ? 'ok' : 'error', ok ? 'URL do PR copiada.' : 'Não consegui copiar (permissão do navegador).', 2500);
  }
});

$('#activeSessions').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-cancel');
  if (!btn) return;
  btn.disabled = true;
  api('/api/cancel', { id: btn.dataset.id });
});

$('#queue').addEventListener('click', (e) => {
  const rev = e.target.closest('.act-review');
  if (rev) { revisarUrls([rev.dataset.url]); return; }
  const term = e.target.closest('.act-terminal');
  if (term) { revisarUrls([term.dataset.url], {}, 'terminal'); return; }
  const ign = e.target.closest('.act-ignore');
  if (ign) {
    const key = ign.dataset.key;
    api('/api/ignore', { key });
    let undo;
    const t = toastRich('info', (el) => {
      const message = document.createElement('span');
      message.textContent = `${key} ignorado.`;
      undo = document.createElement('button');
      undo.className = 'undo';
      undo.textContent = 'Desfazer';
      el.appendChild(message);
      el.appendChild(undo);
    }, 8000);
    undo.onclick = () => { api('/api/restore', { key }); t.remove(); };
  }
});

$('#decisions').addEventListener('click', async (e) => {
  // revisar de novo: mesma rota do Revisar da fila. O .act-review NÃO tem listener
  // global (cada seção escuta o seu, ver #resolved), e o card bloqueado por head
  // velho é o único caso em que ele aparece aqui: o round novo substitui este card.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; revisarUrls([rev.dataset.url]); return; }
  const btn = e.target.closest('.dec-act');
  if (!btn) return;
  const id = btn.closest('.decision').dataset.id;
  const action = btn.dataset.action;
  if (action === 'request_changes') {
    const ref = (btn.closest('.decision').querySelector('.dec-ref')?.textContent || 'este PR').trim();
    const ok = await confirmModal({
      title: `Pedir mudanças em ${ref}?`, danger: true, confirmLabel: 'Pedir mudanças', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>posta um REQUEST CHANGES no GitHub</b>, visível pra todo mundo do PR, com os pontos que a revisão levantou.</p>
        <p>O PR fica <b>bloqueado</b> até o autor tratar e você reavaliar. Pra reverter, é só dispensar o seu review depois.</p>`
    });
    if (!ok) return;
  }
  btn.disabled = true;
  const r = await decide(id, action);
  if (!r?.ok) btn.disabled = false;
});

/* configurações: aplica na mudança */
const settingsMap = [
  ['#setUser', 'ghUser', el => el.value],
  ['#setOwners', 'owners', el => el.value],
  ['#setMergeBlocked', 'mergeBlockedRepos', el => el.value],
  ['#setInterval', 'intervalSeconds', el => parseInt(el.value, 10)],
  ['#setReviewModel', 'reviewModel', el => el.value],
  ['#setCodexReviewModel', 'codexReviewModel', el => el.value],
  ['#setParallelReviews', 'parallelReviews', el => parseInt(el.value, 10)],
  ['#setGlobalParallelReviews', 'globalParallelReviews', el => parseInt(el.value, 10)],
  // radio: o change borbulha até o container, então e.target já é o rádio marcado
  ['#setReviewEffort', 'reviewEffort', el => el.value],
  ['#setCodexReviewEffort', 'codexReviewEffort', el => el.value],
  ['#setAutoPushback', 'autoPushback', el => el.checked],
  ['#setAutoUpdate', 'autoUpdate', el => el.checked],
  ['#setDebugSpawns', 'debugSpawns', el => el.checked],
  ['#setAutoReview', 'autoReview', el => el.checked],
  ['#setAutoApproveAll', 'autoApproveAll', el => el.checked],
  ['#setAutoApproveContested', 'autoApproveContested', el => el.checked],
  ['#setReviewFast', 'reviewFast', el => el.checked],
  ['#setCoAssinarReview', 'coAssinarReview', el => el.checked],
  ['#setReReviewResume', 'reReviewResume', el => el.checked],
  ['#setSkipPerms', 'skipPermissions', el => el.checked],
  ['#setSound', 'soundEnabled', el => el.checked],
  ['#setTeamHighlights', 'teamHighlights', el => el.checked],
  ['#setDeliveriesEnabled', 'deliveriesEnabled', el => el.checked],
  ['#setAutostart', 'autostart', el => el.checked]
];
for (const [sel, key, read] of settingsMap) {
  $(sel).addEventListener('change', async (e) => {
    const r = await api('/api/settings', { [key]: read(e.target) });
    // o servidor devolve o que NÃO aceitou. Dizer "salva" sem olhar isso foi o que
    // fez preferência sumir em silêncio: a tela confirmava, o config não guardava.
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes(key)) {
      toast('error', `"${key}" não foi salva: o servidor não reconhece essa preferência.`, 6000);
      return;
    }
    toast('ok', 'Configuração salva.', 2500);
  });
}

/* ---------- SSE ---------- */
let TENTATIVAS_RECONEXAO = 0;

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; definirEstado(d);
    aplicaPlataforma(estado().app && estado().app.platform);   // engine manda; o userAgent era só o palpite inicial
    syncOptionalTabsVisibility();
    rebuildAccounts();
    renderStatus(); renderAccountBar(); renderIdentity();
    renderActive(); renderDecisions(); renderQueue(); renderMyPRs(); renderPanorama(); renderSilenced();
    renderRadarNav();
    syncAnalysisOps();
    renderSettings(); renderTools(); renderUpdate(); tickCountdown();
    for (const tela of telasRegistradas()) if (tela.aoEstado) tela.aoEstado();
  });
  es.addEventListener('activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { id, item } = d;
    if (estado()?.activity) (estado().activity[id] = estado().activity[id] || []).push(item);
    const feed = document.querySelector(`.activity-feed[data-id="${CSS.escape(id)}"]`);
    if (feed) {
      const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
      feed.insertAdjacentHTML('beforeend', feedLine(item));
      if (stick) feed.scrollTop = feed.scrollHeight;
    }
    // progresso honesto (régua única sessionProgress, ui/pure.js): a atividade
    // real move a barra do card da sessão no "Analisando agora"...
    updateSessionBar(id);
    updateStageFlow(id);
    // ...e, se for autoanálise, também o widget do card em Meus PRs
    const selfKey = selfSessionKey(estado()?.activeSessions, id);
    if (selfKey) {
      const op = ACTIVE_OPS.get(`analysis-${selfKey}`);
      if (op && op.status === 'running') {
        const n = (estado()?.activity?.[id] || []).length;
        updateOp(op.id, {
          step: (item && item.text) || op.step,
          progress: Math.max(op.progress || 0, sessionProgress(n))
        });
      }
    }
  });
  es.addEventListener('chat', (e) => {
    const c = safeJsonParse(e.data); if (!c) return;
    const chatKey = chatKeyAtual();
    if (chatKey && c.key === chatKey) renderChat(c);
  });
  es.addEventListener('chat-activity', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { key, text } = d;
    const chatKey = chatKeyAtual();
    if (chatKey && key === chatKey) {
      const el = $('#chatActivity');
      el.hidden = false;
      const opId = `chat-${key}`;
      // o texto vivo vira o step da MESMA pill que o renderChat cria; escrever
      // textContent no container destruia a pill e orfanava a op (B16). Se a
      // atividade chegar antes do primeiro snapshot de chat, cria a op aqui.
      if (!ACTIVE_OPS.has(opId)) showOp(opId, { type: 'chat', title: 'Claude respondendo', inline: true, container: el });
      // o chat nao acumula feed em estado().activity; a contagem de eventos vive
      // na propria op, e o percentual sai da MESMA regua dos outros fluxos
      const op = ACTIVE_OPS.get(opId);
      const n = (op.chatEvents = (op.chatEvents || 0) + 1);
      updateOp(opId, { step: text, progress: Math.max(op.progress || 0, sessionProgress(n)) });
    }
  });
  es.addEventListener('toast', (e) => {
    const t = safeJsonParse(e.data); if (!t) return;
    toast(t.kind || 'info', t.text);
  });
  es.addEventListener('new-prs', (e) => { const d = safeJsonParse(e.data); if (d) notifyNewPRs(d); });
  es.addEventListener('auto-approved', () => ping());
  es.addEventListener('auto-rejected', () => ping());
  es.addEventListener('needs-decision', (e) => {
    ping();
    const d = safeJsonParse(e.data); if (!d) return; const { pr, item } = d;
    if (!isElectron && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('Farol · precisa da sua atenção', { body: `${pr.key}: ${reasonText((item.reasons || [])[0]) || 'ver relatório'}` });
      n.onclick = () => { window.focus(); focusPr(pr.url); };
    }
  });
  es.addEventListener('focus-pr', (e) => {
    const d = safeJsonParse(e.data); if (!d) return; const { url } = d;
    focusPr(url);
  });
  // A pill do topo sozinha não bastava: em janela estreita ela fica fora de vista atrás
  // das abas, e o app parece só ter parado de atualizar. A faixa entra NO FLUXO, onde
  // você está olhando, e conta as tentativas.
  es.onerror = () => {
    $('#statusPill').className = 'pill err';
    $('#statusPill').textContent = 'reconectando…';
    TENTATIVAS_RECONEXAO++;
    const f = $('#connLost');
    if (f) {
      f.hidden = false;
      const t = f.querySelector('.cl-try');
      if (t) t.textContent = TENTATIVAS_RECONEXAO > 1 ? `tent. ${TENTATIVAS_RECONEXAO}` : '';
    }
  };
  es.addEventListener('open', () => { TENTATIVAS_RECONEXAO = 0; const f = $('#connLost'); if (f) f.hidden = true; });
}

// A aba 'sistema' ainda mora neste arquivo; o resto já levou o próprio registro
// pra dentro do módulo. O que muda AQUI é só quem conhece quem: o switchTab e o
// connect() percorrem o registro em vez de listar nome de aba.
//
// 'entregas', 'destaques' e 'time' já se registraram sozinhos ao serem importados
// (import estático roda antes deste ponto, na ordem em que aparecem lá em cima).
// 'consumo' só pode registrar DEPOIS de 'sistema': ele mora em módulo próprio
// (ui/telas/consumo.js), mas se registrasse ao ser importado ficaria na frente de
// 'sistema', que só se registra agora, no corpo do app.js (a ordem de
// telasRegistradas() é a ordem em que registrarTela roda, e precisa continuar
// entregas, destaques, time, sistema, consumo).
registrarTela({
  id: 'sistema',
  aoEntrar: () => { switchSistemaSection(); loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); loadReviewerCands(); },
  aoEstado: () => { if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); } },
});
registrarTelaConsumo();

connect();
