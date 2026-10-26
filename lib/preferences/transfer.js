// Portabilidade explícita de preferências, sem identidade, credenciais ou autorização.
import { SETTINGS, sanear } from '../settings.js';
import { contentHash } from '../engine/review-round-store.js';
import { safeStringify } from '../io.js';
class PreferencesError extends Error {}
const KEYS = ['theme', 'soundEnabled', 'interventionReminderMinutes', 'intervalSeconds'];
const MAX_BYTES = 16 * 1024;
function values(config) {
  return Object.fromEntries(KEYS.map(key => [key, config[key] ?? SETTINGS.find(s => s.key === key).def]));
}
function validate(document) {
  if (!document || Buffer.byteLength(safeStringify(document)) > MAX_BYTES || document.type !== 'farol-preferences' || document.schema !== 1
    || Object.keys(document).some(k => !['type', 'schema', 'values'].includes(k))) throw new PreferencesError('Arquivo de preferências inválido ou incompatível.');
  const incoming = document.values;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || !Object.keys(incoming).length || Object.keys(incoming).some(k => !KEYS.includes(k))) throw new PreferencesError('O arquivo contém campos não portáveis ou não contém preferências.');
  if ('theme' in incoming && !['dark', 'light'].includes(incoming.theme)) throw new PreferencesError('Tema inválido.');
  if ('soundEnabled' in incoming && typeof incoming.soundEnabled !== 'boolean') throw new PreferencesError('Som inválido.');
  if ('interventionReminderMinutes' in incoming && (!Number.isInteger(incoming.interventionReminderMinutes) || incoming.interventionReminderMinutes < 0 || incoming.interventionReminderMinutes > 1440)) throw new PreferencesError('Intervalo de lembrete inválido.');
  if ('intervalSeconds' in incoming && (!Number.isInteger(incoming.intervalSeconds) || sanear('intervalSeconds', incoming.intervalSeconds) !== incoming.intervalSeconds)) throw new PreferencesError('Intervalo de checagem inválido.');
  return Object.fromEntries(Object.entries(incoming));
}
function preview(engine, document) {
  const incoming = validate(document), current = values(engine.config);
  return { ok: true, token: contentHash({ current, incoming }), changes: Object.entries(incoming).map(([key, value]) => ({ key, current: current[key], incoming: value, changed: current[key] !== value })).filter(change => change.changed) };
}
function apply(engine, body) {
  const before = preview(engine, body.document);
  if (body.token !== before.token) throw new PreferencesError('As preferências mudaram; gere outra prévia.');
  const keys = body.keys;
  if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some(key => !before.changes.some(c => c.key === key && c.changed))) throw new PreferencesError('Selecione apenas diferenças apresentadas na prévia.');
  const previous = engine.config;
  const incoming = validate(body.document);
  engine.config = { ...previous, ...Object.fromEntries(keys.map(key => [key, incoming[key]])) };
  try { engine.saveConfig(); }
  catch { engine.config = previous; throw new PreferencesError('Não foi possível salvar; preferências anteriores preservadas.'); }
  if (keys.includes('intervalSeconds')) engine.checkNow();
  engine.pushState();
  return { ok: true, applied: keys, values: values(engine.config) };
}
async function command(engine, body) {
  try {
    if (body?.action === 'export') return { ok: true, document: { type: 'farol-preferences', schema: 1, values: values(engine.config) } };
    if (body?.action === 'preview') return preview(engine, body.document);
    if (body?.action === 'apply') return apply(engine, body);
    throw new PreferencesError('Operação de preferências inválida.');
  } catch (error) { return { ok: false, error: error instanceof PreferencesError ? error.message : 'Não foi possível processar as preferências.' }; }
}
export { command, preview, MAX_BYTES };
