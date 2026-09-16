/* Farol · UI: paleta de comando (Ctrl+K / Cmd+K). Ir a qualquer lugar rápido:
   abas, seções do Radar, ou colar/digitar URL/key de PR (org/repo#NN) pra abrir a
   conversa salva, sem precisar do mouse. Não é aba (não passa por registrarTela):
   o bootstrap (ui/app.js) chama initPaleta(switchTab) no mesmo ponto em que a
   ligação do #btnCmdK e o listener de Ctrl+K moravam. */

import { esc } from '../pure.js';
import { estado, ehMac } from './estado.js';
import { $, toast } from './infra.js';
import { scopeVisible } from './contas.js';
import { decide, decideComConfirmacao } from './acoes.js';
import { switchSistemaSection } from './sistema.js';
import { openChat } from './chat.js';
import { kbdHelp } from './atalhos.js';

/* ---------- paleta de comando (Ctrl+K / Cmd+K) ----------
   Os handlers moram no TOPO do módulo, na mesma profundidade que tinham
   quando viviam no ui/app.js: só a navegação (switchTab) precisa vir de fora,
   e por isso fica numa variável de módulo com dono único de escrita
   (_switchTab, preenchida por initPaleta), o mesmo desenho de estado.js.
   initPaleta faz só duas coisas: guarda a dependência e registra os
   handlers nomeados abaixo. */
let _switchTab = null;

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
  ...[...document.querySelectorAll('.nav-item')].filter(b => !b.hidden).map(b => ({ kind: 'tab', label: `Ir para ${b.textContent}`, hint: 'aba', run: () => _switchTab(b.dataset.tab) })),
  // as 9 seções do Sistema, lidas do DOM: seção nova entra aqui sozinha.
  // .trim() porque o botão tem um <svg aria-hidden="true"> antes do texto e sobra espaço em branco.
  ...[...document.querySelectorAll('.sys-nav-item')].map(b => ({
    kind: 'section', label: `Sistema: ${b.textContent.trim()}`, hint: 'sistema',
    run: () => { _switchTab('sistema'); switchSistemaSection(b.dataset.section); }
  })),
  { kind: 'section', label: 'Ir para Precisa de você', hint: 'seção', run: () => { _switchTab('radar'); document.getElementById('decisionsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Sua fila', hint: 'seção', run: () => { _switchTab('radar'); document.getElementById('queueSection')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Meus PRs', hint: 'seção', run: () => { _switchTab('radar'); document.getElementById('myPRsWrap')?.scrollIntoView({ behavior: 'smooth' }); } },
  { kind: 'section', label: 'Ir para Panorama', hint: 'seção', run: () => { _switchTab('radar'); document.getElementById('panoramaSection')?.scrollIntoView({ behavior: 'smooth' }); } },
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
// fecha ANTES de rodar: um run() que lança não pode travar a paleta aberta,
// e a rejeição vira toast em vez de sumir no console
function cmdItemClick(items, idx) {
  cmdClose(); Promise.resolve().then(() => items[idx].run()).catch(err => toast('error', (err && err.message) || 'a ação falhou'));
}
function cmdRenderList(input, list) {
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
  [...list.querySelectorAll('.cmd-item')].forEach((el, idx) => { el.onclick = () => cmdItemClick(items, idx); });
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
  const renderList = () => cmdRenderList(input, list);
  input.addEventListener('input', renderList);
  ov.addEventListener('click', (e) => { if (e.target === ov) cmdClose(); });
  document.addEventListener('keydown', cmdOnKey, true);
  renderList();
  setTimeout(() => input.focus(), 20);
}
function onBtnCmdKClick() { cmdOpen(); }
function onCtrlKKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdOpen(); }
}

// o botão da paleta é estático no HTML e misturava as duas convenções (⌘K com
// tooltip Ctrl+K); aqui ele fica coerente com o SO real do engine. Chamada por
// aplicaPlataforma (ui/app.js) sempre que a plataforma é reconciliada com o
// snapshot do engine (fonte única do rótulo: quem pinta o botão é quem é dono
// dele, a própria paleta).
function rotularBtnCmdK() {
  const cmdBtn = document.getElementById('btnCmdK');
  if (!cmdBtn) return;
  cmdBtn.textContent = ehMac() ? '⌘K' : 'Ctrl+K';
  cmdBtn.title = `Paleta de comandos (${ehMac() ? 'Cmd' : 'Ctrl'}+K)`;
}

// registrada pelo bootstrap no mesmo ponto relativo em que o listener e a ligação
// do botão moravam, pra não mudar a ordem dos handlers de click/keydown do
// document. switchTab é a navegação que a paleta precisa pra levar às abas e
// seções do próprio app; guardada em _switchTab pros handlers de cima lerem.
function initPaleta(switchTab) {
  _switchTab = switchTab;
  $('#btnCmdK').addEventListener('click', onBtnCmdKClick);
  document.addEventListener('keydown', onCtrlKKeydown);
}

export { initPaleta, rotularBtnCmdK };
