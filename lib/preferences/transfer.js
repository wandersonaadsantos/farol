// Exportação, comparação e aplicação seletiva das preferências do Sistema.
import { isDeepStrictEqual } from 'node:util';
import { contentHash } from '../engine/review-round-store.js';
import { safeStringify } from '../io.js';
import { MAX_PREFERENCES_BYTES, PREFERENCE_LABELS } from '../../ui/pure/preferences.js';
import { KEYS, values, validValue, dependencyReason, localValue, missingProfile } from './values.js';
import { effectiveValue, dependencyNote, completePatch } from './dependencies.js';
class PreferencesError extends Error {}
const LEGACY_KEYS = ['theme', 'soundEnabled', 'interventionReminderMinutes', 'intervalSeconds'];
const MAX_BYTES = MAX_PREFERENCES_BYTES;
function validate(engine, document) {
  if (!document || Buffer.byteLength(safeStringify(document)) > MAX_BYTES || document.type !== 'farol-preferences' || ![1, 2].includes(document.schema)
    || Object.keys(document).some(k => !['type', 'schema', 'values'].includes(k))) throw new PreferencesError('Arquivo de preferências inválido ou incompatível.');
  const incoming = document.values;
  const allowed = document.schema === 1 ? LEGACY_KEYS : KEYS;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || !Object.keys(incoming).length || Object.keys(incoming).some(key => !allowed.includes(key))) throw new PreferencesError('O arquivo contém campos não portáveis ou não contém preferências.');
  for (const [key, value] of Object.entries(incoming)) {
    if (!validValue(engine, key, value)) throw new PreferencesError(`Valor inválido para ${PREFERENCE_LABELS[key]}.`);
  }
  return structuredClone(incoming);
}
function preview(engine, document) {
  const incoming = validate(engine, document), current = values(engine);
  const matchingAccounts = Object.hasOwn(incoming, 'accounts') && isDeepStrictEqual(current.accounts, incoming.accounts);
  const changes = Object.entries(incoming).filter(([key, value]) => !isDeepStrictEqual(current[key], effectiveValue(engine.config, key, value))).map(([key, value]) => {
    const blocked = dependencyReason(engine.config, key, value);
    const note = dependencyNote(engine.config, key, value, matchingAccounts);
    const change = { key, current: current[key], incoming: value, changed: true };
    if (blocked) change.blocked = blocked;
    if (note) change.note = note;
    return change;
  });
  return { ok: true, token: contentHash({ current, incoming }), changes, missing: KEYS.filter(key => !Object.hasOwn(incoming, key)) };
}
function apply(engine, body) {
  const before = preview(engine, body.document);
  if (body.token !== before.token) throw new PreferencesError('As preferências mudaram; gere outra prévia.');
  const keys = body.keys;
  if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some(key => !before.changes.some(change => change.key === key && !change.blocked))) throw new PreferencesError('Selecione apenas diferenças disponíveis na prévia.');
  const incoming = validate(engine, body.document);
  const patch = Object.fromEntries(keys.map(key => [key, localValue(engine.config, key, incoming[key])]));
  if (missingProfile(engine.config, patch)) throw new PreferencesError('Selecione também os perfis referenciados, ou cadastre-os neste aparelho antes de aplicar.');
  const completed = completePatch(engine.config, patch, Object.hasOwn(incoming, 'accounts') && isDeepStrictEqual(values(engine).accounts, incoming.accounts), incoming);
  if (completed.error) throw new PreferencesError(completed.error);
  const previous = engine.config;
  try { engine.updateSettings(completed.patch, 'importação de preferências'); }
  catch {
    if (engine.config === previous) throw new PreferencesError('Não foi possível salvar; preferências anteriores preservadas.');
    throw new PreferencesError('Não foi possível concluir a aplicação; confira as preferências atuais e gere outra prévia.');
  }
  return { ok: true, applied: keys, values: values(engine) };
}
async function command(engine, body) {
  try {
    if (body?.action === 'export') {
      const document = { type: 'farol-preferences', schema: 2, values: values(engine) };
      validate(engine, document);
      return { ok: true, document };
    }
    if (body?.action === 'preview') return preview(engine, body.document);
    if (body?.action === 'apply') return apply(engine, body);
    throw new PreferencesError('Operação de preferências inválida.');
  } catch (error) { return { ok: false, error: error instanceof PreferencesError ? error.message : 'Não foi possível processar as preferências.' }; }
}
export { command, preview, MAX_BYTES };
