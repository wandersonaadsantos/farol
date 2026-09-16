/* Farol · UI: tema claro/escuro (troca, persiste no localStorage e avisa o
   engine). Não é aba (não passa por registrarTela): o bootstrap (ui/app.js)
   chama initTema() no mesmo ponto em que este bloco morava. */

import { $, api } from './infra.js';

/* ---------- tema ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('farol-theme', theme);
  $('#iconMoon').style.display = theme === 'dark' ? '' : 'none';
  $('#iconSun').style.display = theme === 'dark' ? 'none' : '';
}

function initTema() {
  applyTheme(localStorage.getItem('farol-theme') || 'dark');
  $('#btnTheme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    api('/api/settings', { theme: next });
  };
}

export { initTema };
