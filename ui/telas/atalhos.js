/* Farol · UI: atalhos de teclado do Radar (navegar nas decisões, agir, trocar de
   aba, abrir a lista de atalhos). Não é aba (não passa por registrarTela): o
   bootstrap (ui/app.js) chama initAtalhos(switchTab) no mesmo ponto em que o
   listener de keydown morava, passando a navegação de que a seção precisa. */

import { ehMac } from './estado.js';
import { $ } from './infra.js';

/* ---------- atalhos de teclado ---------- */
// J/K navegam nas decisões pendentes; A aprova, M pede mudanças, C comenta, P pula;
// / foca a consulta de PR; 1-6 trocam de aba; ? mostra esta lista.
const KBD_ACTIONS = { a: 'approve', m: 'request_changes', c: 'comment', p: 'skip' };
function kbdCards() { return [...document.querySelectorAll('#decisions .decision')]; }
function kbdSelected() { return document.querySelector('#decisions .decision.kbd-sel'); }
function kbdMove(delta, switchTab) {
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

// registrada pelo bootstrap no mesmo ponto relativo em que o listener morava, pra
// não mudar a ordem dos handlers de keydown do document. switchTab é a navegação
// que a seção precisa (dígitos, '/', J/K); o resto (agir na selecionada, '?') é
// autocontido.
function initAtalhos(switchTab) {
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
    if (low === 'j') { kbdMove(1, switchTab); e.preventDefault(); return; }
    if (low === 'k') { kbdMove(-1, switchTab); e.preventDefault(); return; }
    if (KBD_ACTIONS[low]) {
      const card = kbdSelected();
      const btn = card && card.querySelector(`.dec-act[data-action="${KBD_ACTIONS[low]}"]`);
      if (btn) { btn.click(); e.preventDefault(); }
    }
  });
}

export { kbdHelp, initAtalhos };
