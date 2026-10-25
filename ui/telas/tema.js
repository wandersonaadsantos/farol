/* Farol · UI: tema claro/escuro (troca, persiste no localStorage e avisa o
   engine). Não é aba (não passa por registrarTela): o bootstrap (ui/app.js)
   chama initTema() no mesmo ponto em que este bloco morava. */

import { $, api, toast } from './infra.js';

/* ---------- tema ---------- */
function applyTheme(theme) {
  theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('farol-theme', theme); } catch { /* tema continua disponível nesta janela */ }
  $('#iconMoon').style.display = theme === 'dark' ? '' : 'none';
  $('#iconSun').style.display = theme === 'dark' ? 'none' : '';
  $('#btnTheme').setAttribute('aria-label', 'Tema claro');
  $('#btnTheme').setAttribute('aria-pressed', String(theme === 'light'));
}
let engineTheme;
function syncTheme(config) {
  if (!['light', 'dark'].includes(config?.theme) || config.theme === engineTheme) return;
  engineTheme = config.theme;
  applyTheme(engineTheme);
}

function initTema() {
  let initial = 'dark';
  try { initial = localStorage.getItem('farol-theme') || initial; } catch { /* primeiro uso sem armazenamento */ }
  applyTheme(initial);
  $('#btnTheme').onclick = async () => {
    const previous = document.documentElement.dataset.theme;
    const next = previous === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const button = $('#btnTheme'); button.disabled = true;
    try {
      const result = await api('/api/settings', { theme: next });
      if (!result?.ok) { applyTheme(previous); toast('error', 'Não foi possível salvar o tema. Tente novamente.'); }
    } finally { button.disabled = false; }
  };
}

export { initTema, applyTheme, syncTheme };
