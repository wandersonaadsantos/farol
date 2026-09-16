/* Farol · UI: a aba Sistema, o shell dela (sub-navegação, busca) e o que não ganhou
   módulo próprio (saúde do ambiente, atualização, automação, preferências, sobre). */

import { esc, sysNorm, fmtClock, escAttrSelector, operationChecks, runtimeChecks, creditsHtml, personMention } from '../pure.js';
import { estado, ehWin, ehElectron } from './estado.js';
import { $, api, toast, confirmModal, marcarSeg, sysFlash, origemLocal } from './infra.js';
import { registrarTela } from './registro.js';
import { loadLog } from './ferramentas.js';
import { loadReviewerCands, renderReviewersEditor } from './reviewers.js';
import { renderReleaseNotes } from './novidades.js';
import { renderAccountsManager } from './sistema-contas.js';
import { renderClaudeProfiles } from './sistema-perfis.js';
import { renderJiraSites } from './sistema-jira.js';
import { renderSync } from './sistema-sync.js';

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
  // autostart só existe de verdade no Windows (setLoginItemSettings é no-op no Linux e
  // desabilitado por decisão no mac; ver applyAutostart em main.js), e só faz sentido
  // dentro do Electron (fora dele não há app pra logar no login do SO). ehWin() é a
  // PLATAFORMA reconciliada com o engine; ehElectron() é do PRÓPRIO processo desta
  // página, lido do userAgent (as duas leituras moram em telas/estado.js).
  $('#rowAutostart').style.display = ehElectron() && ehWin() ? '' : 'none';
}

// Import estático roda ANTES do corpo do app.js: assim como telas/time.js registra
// 'destaques'/'time' e telas/entregas.js registra 'entregas' ao serem importados, este
// módulo registra 'sistema' ao ser importado. A ÚNICA restrição real de ordem
// (telasRegistradas() devolve na ordem de registro, e precisa continuar entregas,
// destaques, time, sistema, consumo) é a de 'consumo': telas/consumo.js não se
// registra ao ser importado, e sim quando o app.js chama registrarTelaConsumo() no
// corpo, depois do import deste módulo — se consumo se registrasse ao ser importado,
// ele poderia passar à frente de 'sistema' dependendo da ordem dos imports. 'sistema'
// não tem essa restrição: só precisa que o IMPORT deste módulo, no app.js, venha
// depois do import de telas/time.js.
registrarTela({
  id: 'sistema',
  aoEntrar: () => { switchSistemaSection(); loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); loadReviewerCands(); },
  aoEstado: () => { if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); } },
});

export { switchSistemaSection, sysSearchFilter, sysGoTo, renderSettings, renderUpdate };
