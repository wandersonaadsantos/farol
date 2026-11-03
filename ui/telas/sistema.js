/* Farol · UI: a aba Sistema, sub-navegação e busca (SYS_INDEX), o formulário de
   configurações (renderSettings) e o registro da tela. */

import { esc, sysNorm, SYS_INDEX, buscarNoSistema, secoesOcultasDoSistema } from '../pure.js';
import { estado, ehWin, ehMac, ehElectron } from './estado.js';
import { $, sysFlash } from './infra.js';
import { registrarTela } from './registro.js';
import { loadLog } from './ferramentas.js';
import { loadReviewerCands, renderReviewersEditor } from './reviewers.js';
import { renderReleaseNotes } from './novidades.js';
import { renderAccountsManager } from './sistema-contas.js';
import { renderClaudeProfiles } from './sistema-perfis.js';
import { renderJiraSites } from './sistema-jira.js';
import { renderReposBloqueados } from './merge-bloqueado.js';
import { renderSync } from './sistema-sync.js';
import { renderAparelhos, carregarAparelhos } from './sistema-aparelhos.js';
import { renderGrupos } from './sistema-grupos.js';
import { renderDoctor } from './sistema-ambiente.js';
import { renderAbout } from './sistema-sobre.js';
import { renderInterventionSettings } from './intervention-settings.js';
import { initSpecialists, renderSpecialistAccounts } from './specialists.js';
import { initReviewAudits } from './review-audits.js';
import { initCapacity } from './capacity.js';
import { initSetup, renderSetup } from './setup.js';
import { initPreferencesTransfer } from './preferences-transfer.js';
import { initReviewLabels } from './review-labels.js';
import { syncTheme } from './tema.js';
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

// a seção à mostra, para o endereço da página (ui/telas/rota.js)
function secaoDoSistema() { return SISTEMA_SECTION; }

/* Aparelhos e Grupos somem do menu com a sincronização desligada (só mostravam o aviso
   de que ela está desligada). Se a pessoa estava numa delas, volta para Sincronização. */
function ocultarSecoesInertes() {
  const ocultas = secoesOcultasDoSistema(estado()?.config);
  document.querySelectorAll('.sys-nav-item').forEach(b => {
    b.hidden = ocultas.includes(b.dataset.section);
  });
  if (ocultas.includes(SISTEMA_SECTION)) switchSistemaSection('sync');
}

$('#sysNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.sys-nav-item');
  if (!btn) return;
  const q = $('#sysSearch');
  if (q.value) { q.value = ''; sysSearchFilter(''); }
  switchSistemaSection(btn.dataset.section);
});


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
  const ocultas = secoesOcultasDoSistema(estado()?.config);
  const hits = buscarNoSistema(SYS_INDEX, query, sysSecName).filter(h => !ocultas.includes(h.sec));
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
  syncTheme(c);
  if (!document.activeElement || !$('#setupSteps').contains(document.activeElement)) renderSetup();
  renderReposBloqueados();
  renderReviewersEditor();
  renderClaudeProfiles();
  renderJiraSites();
  renderSync();
  $('#setInterval').value = String(c.intervalSeconds);
  $('#setParallelReviews').value = String(c.parallelReviews || 1);
  // teto total do aparelho: 0 = sem teto, e o `|| 0` do default cai certo nele de propósito
  $('#setGlobalParallelReviews').value = String(c.globalParallelReviews || 0);
  renderAutomationSettings(c);
  $('#setReviewFast').checked = c.reviewFast === true;
  $('#setCoAssinarReview').checked = c.coAssinarReview === true;
  // revisar junto ligado tira o efeito de "Aprovar junto": não há saída de cena para co-assinar.
  // O valor salvo de "Aprovar junto" fica como está; só a linha avisa e o switch esmaece.
  const revisarJunto = c.revisarComOutrosRevisando === true;
  $('#setRevisarJunto').checked = revisarJunto;
  $('#notaAprovarJuntoSemEfeito').hidden = !revisarJunto;
  $('#sys-row-coassinar').classList.toggle('sem-efeito', revisarJunto);
  $('#setAguardarCi').checked = c.aguardarCiParaRevisar === true;
  $('#setReReviewResume').checked = c.reReviewResume === true;
  $('#setAutoPushback').checked = !!c.autoPushback;
  $('#setAutoUpdate').checked = c.autoUpdate !== false;
  $('#setDebugSpawns').checked = !!c.debugSpawns;
  $('#setSkipPerms').checked = !!c.skipPermissions;
  $('#setSound').checked = !!c.soundEnabled;
  renderInterventionSettings(c); renderSpecialistAccounts();
  $('#setTeamHighlights').checked = c.teamHighlights === true;
  $('#setDeliveriesEnabled').checked = c.deliveriesEnabled === true;
  $('#setAutostart').checked = !!c.autostart;
}

// A plataforma não depende da pintura adiada dos formulários da aba Sistema.
function renderPlatformSettings() {
  // autostart existe no Windows (login item) e no mac (LaunchAgent; ver applyAutostart
  // em main.js); no Linux setLoginItemSettings é no-op. Só faz sentido dentro do
  // Electron (fora dele não há app pra logar no login do SO). ehWin()/ehMac() são a
  // PLATAFORMA reconciliada com o engine; ehElectron() é do PRÓPRIO processo desta
  // página, lido do userAgent (as leituras moram em telas/estado.js).
  $('#rowAutostart').style.display = ehElectron() && (ehWin() || ehMac()) ? '' : 'none';
  $('#rowAutostart .set-title').textContent = ehMac() ? 'Iniciar com o macOS' : 'Iniciar com o Windows';
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
initSpecialists();
initReviewAudits();
initCapacity();
initSetup();
initPreferencesTransfer();
initReviewLabels();
registrarTela({
  id: 'sistema',
  aoEntrar: () => { switchSistemaSection(); loadLog(); carregarAparelhos(); loadReviewerCands(); },
  aoEstado: () => { ocultarSecoesInertes(); if ($('#tab-sistema').classList.contains('active')) { renderDoctor(); renderAccountsManager(); renderAparelhos(); renderGrupos(); } },
});

export { switchSistemaSection, secaoDoSistema, sysSearchFilter, sysGoTo, renderSettings, renderPlatformSettings };
