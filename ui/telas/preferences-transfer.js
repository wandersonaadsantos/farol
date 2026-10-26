import { $, api, baixarArquivo } from './infra.js';
import { esc, safeJsonParse, safeJsonStringify } from '../pure/comum.js';
import { applyTheme } from './tema.js';
let pending = null, busy = false, generation = 0;
const LABELS = { intervalSeconds: 'Intervalo de checagem', theme: 'Tema', soundEnabled: 'Toque sonoro', interventionReminderMinutes: 'Lembrete de intervenção (minutos)' };
function message(text) { $('#preferencesMessage').textContent = text; }
async function request(body) {
  const result = await api('/api/preferences/transfer', body);
  if (!result?.ok) { message(result?.error || 'Operação indisponível; tente novamente.'); return null; }
  return result;
}
function invalidate() { generation++; pending = null; $('#preferencesApply').disabled = true; $('#preferencesPreview').replaceChildren(); }
function preferenceValue(key, value) {
  if (key === 'theme') return value === 'light' ? 'Claro' : 'Escuro';
  if (key === 'soundEnabled') return value ? 'Ligado' : 'Desligado';
  if (key === 'intervalSeconds') return `${Number(value) / 60} minutos`;
  return Number(value) === 0 ? 'Desligado' : `${value} minutos`;
}
async function preview() {
  invalidate();
  const attempt = generation;
  const file = $('#preferencesFile').files[0];
  if (!file || file.size > 16 * 1024) { message('Selecione um JSON de preferências com até 16 KiB.'); return; }
  let document;
  try { document = safeJsonParse(await file.text()); } catch { message('Arquivo ilegível ou JSON inválido.'); return; }
  const result = await request({ action: 'preview', document }); if (!result) return;
  if (attempt !== generation) return;
  pending = { ...result, document };
  const legacyNotice = Object.hasOwn(document.values, 'intervalSeconds') ? '' : ' Este arquivo não contém o intervalo de checagem; exporte novamente para incluí-lo.';
  if (!result.changes.length) {
    message('Nenhuma diferença encontrada nas preferências do arquivo. Nenhuma alteração foi salva.' + legacyNotice);
    return;
  }
  const rows = result.changes.map(c =>
    `<label class="diff-row"><input type="checkbox" data-preference-key="${esc(c.key)}"><span>${esc(LABELS[c.key])}</span><span class="was">${esc(preferenceValue(c.key, c.current))}</span><span class="new">${esc(preferenceValue(c.key, c.incoming))}</span></label>`
  ).join('');
  $('#preferencesPreview').innerHTML = `<div class="set-block"><h4 class="set-subtitle">Diferenças encontradas</h4><div class="diff" role="group" aria-label="Preferências a aplicar"><div class="diff-row head" aria-hidden="true"><span></span><span>Preferência</span><span>Atual</span><span>No arquivo</span></div>${rows}</div></div>`;
  message('Confira as diferenças e selecione o que aplicar. Nenhuma alteração foi salva.' + legacyNotice);
}
async function apply() {
  if (!pending) return;
  const keys = [...document.querySelectorAll('[data-preference-key]:checked')].map(el => el.dataset.preferenceKey);
  const result = await request({ action: 'apply', document: pending.document, token: pending.token, keys });
  if (result) { if (result.applied.includes('theme')) applyTheme(result.values.theme); invalidate(); message('Preferências selecionadas salvas. Contas, voz e autorização não são importadas.'); }
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
