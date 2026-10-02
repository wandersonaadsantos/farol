/* Farol · UI: novidades por versão (Sistema > Novidades). */

import { RELEASE_NOTES } from './release-notes.js';
import { esc } from '../pure.js';
import { estado } from './estado.js';
import { $ } from './infra.js';

// Novidades por versão (mostradas na aba Sistema; a versão atual vem marcada).
// Ao cortar uma release, some uma linha aqui no topo.
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

export { renderReleaseNotes };
