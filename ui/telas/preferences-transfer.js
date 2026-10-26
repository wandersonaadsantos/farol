import { $, api, baixarArquivo } from './infra.js';
import { esc, safeJsonParse, safeJsonStringify } from '../pure/comum.js';
import { applyTheme } from './tema.js';
import { MAX_PREFERENCES_BYTES, PREFERENCE_LABELS, preferenceValue } from '../pure/preferences.js';
let pending = null, busy = false, generation = 0;

function message(text) { $('#preferencesMessage').textContent = text; }
async function request(body) {
  const result = await api('/api/preferences/transfer', body);
  if (!result?.ok) { message(result?.error || 'Operação indisponível; tente novamente.'); return null; }
  return result;
}
function invalidate() { generation++; pending = null; $('#preferencesApply').disabled = true; $('#preferencesPreview').replaceChildren(); }
function preferenceRow(change) {
  const disabled = change.blocked ? ' disabled' : '';
  const reason = change.blocked ? `<small class="set-desc">${esc(change.blocked)}</small>` : '';
  return `<label class="diff-row"><input type="checkbox" data-preference-key="${esc(change.key)}"${disabled}><span>${esc(PREFERENCE_LABELS[change.key])}${reason}</span><span class="was preferences-value">${esc(preferenceValue(change.key, change.current))}</span><span class="new preferences-value">${esc(preferenceValue(change.key, change.incoming))}</span></label>`;
}
async function preview() {
  invalidate();
  const attempt = generation;
  const file = $('#preferencesFile').files[0];
  if (!file || file.size > MAX_PREFERENCES_BYTES) { message('Selecione um JSON de preferências com até 1 MiB.'); return; }
  let document;
  try { document = safeJsonParse(await file.text()); } catch { message('Arquivo ilegível ou JSON inválido.'); return; }
  const result = await request({ action: 'preview', document }); if (!result) return;
  if (attempt !== generation) return;
  pending = { ...result, document };
  const legacyNotice = result.missing.length ? ` Arquivo parcial: ${result.missing.length} preferências não estão no arquivo e serão preservadas. Exporte novamente para incluir todas.` : '';
  if (!result.changes.length) {
    message('Nenhuma diferença encontrada nas preferências do arquivo. Nenhuma alteração foi salva.' + legacyNotice);
    return;
  }
  const rows = result.changes.map(preferenceRow).join('');
  $('#preferencesPreview').innerHTML = `<div class="set-block"><h4 class="set-subtitle">Diferenças encontradas</h4><div class="diff" role="group" aria-label="Preferências a aplicar"><div class="diff-row head" aria-hidden="true"><span></span><span>Preferência</span><span>Atual</span><span>No arquivo</span></div>${rows}</div></div>`;
  message('Confira as diferenças e selecione o que aplicar. Nenhuma alteração foi salva.' + legacyNotice);
}
async function apply() {
  if (!pending) return;
  const keys = [...document.querySelectorAll('[data-preference-key]:checked')].map(el => el.dataset.preferenceKey);
  const result = await request({ action: 'apply', document: pending.document, token: pending.token, keys });
  if (result) { if (result.applied.includes('theme')) applyTheme(result.values.theme); invalidate(); message('Preferências selecionadas salvas. Credenciais não são transferidas.'); }
}
async function act(operation) {
  if (busy) return; busy = true;
  $('#preferencesTransfer').setAttribute('aria-busy', 'true');
  for (const id of ['preferencesApply', 'preferencesInspect', 'preferencesExport', 'preferencesFile']) $('#' + id).disabled = true;
  try { await operation(); } catch { message('Operação não concluída. Confira o arquivo e tente novamente.'); }
  finally {
    busy = false; $('#preferencesTransfer').setAttribute('aria-busy', 'false');
    for (const id of ['preferencesInspect', 'preferencesExport', 'preferencesFile']) $('#' + id).disabled = false;
    $('#preferencesApply').disabled = !pending || !document.querySelector('[data-preference-key]:checked');
  }
}
function initPreferencesTransfer() {
  $('#preferencesFile').onchange = () => { invalidate(); message('Arquivo selecionado; gere a prévia antes de aplicar.'); };
  $('#preferencesInspect').onclick = () => act(preview);
  $('#preferencesPreview').onchange = () => { $('#preferencesApply').disabled = !document.querySelector('[data-preference-key]:checked'); };
  $('#preferencesApply').onclick = () => act(apply);
  $('#preferencesExport').onclick = () => act(async () => {
    const result = await request({ action: 'export' });
    if (result) message(baixarArquivo('farol-preferences.json', safeJsonStringify(result.document, 2), 'application/json') ? 'Arquivo de preferências gerado.' : 'Download indisponível neste navegador.');
  });
}
export { initPreferencesTransfer };
