/* Farol · UI: a aba Sistema, sub-navegação e busca (SYS_INDEX), o formulário de
   configurações (renderSettings) e o registro da tela. */

import { esc, sysNorm } from '../pure.js';
import { estado, ehWin, ehElectron } from './estado.js';
import { $, sysFlash } from './infra.js';
import { registrarTela } from './registro.js';
import { loadLog } from './ferramentas.js';
import { loadReviewerCands, renderReviewersEditor } from './reviewers.js';
import { renderReleaseNotes } from './novidades.js';
import { renderAccountsManager } from './sistema-contas.js';
import { renderClaudeProfiles } from './sistema-perfis.js';
import { renderJiraSites } from './sistema-jira.js';
import { renderSync } from './sistema-sync.js';
import { renderAparelhos, carregarAparelhos } from './sistema-aparelhos.js';
import { renderGrupos } from './sistema-grupos.js';
import { renderDoctor } from './sistema-ambiente.js';
import { renderAbout } from './sistema-sobre.js';
import { renderAutomationSettings } from './sistema-automacao.js';

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
  { sec: 'devices', at: '#devicesManager', title: 'Aparelhos e administração', hint: 'aparelho, admin, aposentar, renomear, política, pausar, navegador pareado, limpeza, revogar, garantia' },
  { sec: 'groups', at: '#groupsManager', title: 'Grupos de consumo', hint: 'grupo, teto, orçamento, vincular perfil, codex, custo somado' },
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
  aoEntrar: () => { switchSistemaSection(); loadLog(); renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); carregarAparelhos(); renderGrupos(); loadReviewerCands(); },
  aoEstado: () => { if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderClaudeProfiles(); renderJiraSites(); renderSync(); renderAparelhos(); renderGrupos(); } },
});

export { switchSistemaSection, sysSearchFilter, sysGoTo, renderSettings };
