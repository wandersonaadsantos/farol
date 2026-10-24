import { $ } from './infra.js';
import { estado } from './estado.js';
import { setupHtml } from '../pure/setup.js';
let selected = 'accounts', open = null, rendered = false;
try {
  const saved = localStorage.getItem('farol-setup-step');
  if (['accounts', 'plans', 'automation'].includes(saved)) selected = saved;
  const expanded = localStorage.getItem('farol-setup-open');
  if (expanded !== null) open = expanded === 'true';
} catch { /* sem persistência local */ }
function renderSetup() {
  if (!rendered) {
    if (open === null) open = !(estado()?.accounts || []).length;
    $('#setupManager').open = open;
    rendered = true;
  }
  $('#setupSteps').innerHTML = setupHtml(estado(), selected);
}
function initSetup() {
  $('#setupManager').ontoggle = event => {
    open = event.target.open;
    try { localStorage.setItem('farol-setup-open', String(open)); } catch { /* escolha vale nesta janela */ }
  };
  $('#setupSteps').onclick = event => {
    const step = event.target.closest('[data-setup-step]'); if (!step) return;
    selected = step.dataset.setupStep;
    try { localStorage.setItem('farol-setup-step', selected); } catch { /* escolha vale nesta janela */ }
    renderSetup();
    $('#setupSteps').querySelector(`[data-setup-step="${selected}"]`).focus();
  };
}
export { initSetup, renderSetup };
