// Observações de admissão, não uma atribuição exclusiva do consumo da janela.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { parseJson } from '../io.js';
import { writeOnce, contentHash } from '../engine/review-round-store.js';
import { quotaFor, refresh, policyFor } from './quota.js';

const ROOT = path.join(STATE_DIR, 'quota-admissions');
function save(dir, name, data) { return writeOnce(path.join(dir, name + '.json'), { ...data, integrity: contentHash(data) }); }
function read(file) {
  const value = parseJson(fs.readFileSync(file, 'utf8'));
  if (!value || value.schema !== 1) throw new Error('Histórico de cota incompatível.');
  const { integrity, ...data } = value;
  if (integrity !== contentHash(data)) throw new Error('Histórico de cota corrompido.');
  return data;
}
async function observeAdmission(engine, opts, auth, execute) {
  const policy = policyFor(engine, auth), before = quotaFor(engine, auth);
  const dir = path.join(ROOT, `${Date.now()}-${randomUUID()}`);
  try { save(dir, 'start', { schema: 1, sessionId: opts.id || null, at: Date.now(), profileId: auth.id, before, policy }); }
  catch { engine.log('WARN', 'Observação de cota não pôde ser preservada; a política de admissão continua valendo.'); }
  let outcome = 'failed';
  try { const result = await execute(); outcome = 'finished'; return result; }
  finally {
    const profile = (engine.config.claudeProfiles || []).find(p => p.id === auth.id);
    try {
      await refresh(engine, profile, true);
      const after = quotaFor(engine, auth);
      const aboveMax = after.known ? after.windows.some(w => w.usedPercent + 1e-9 >= policy.maxUsedPercent) : null;
      save(dir, 'end', { schema: 1, at: Date.now(), outcome, after, aboveMax });
    } catch { engine.log('WARN', 'Cota após a sessão indisponível; resultado da sessão preservado.'); }
  }
}
function history() {
  if (!fs.existsSync(ROOT)) return { ok: true, items: [] };
  try {
    const names = fs.readdirSync(ROOT).filter(n => /^\d{13}-[a-f0-9-]{36}$/.test(n)).sort().slice(-30).reverse();
    const items = names.map(name => {
      const dir = path.join(ROOT, name), start = read(path.join(dir, 'start.json'));
      const end = fs.existsSync(path.join(dir, 'end.json')) ? read(path.join(dir, 'end.json')) : null;
      return { id: name, start, end };
    });
    return { ok: true, items };
  } catch { return { ok: false, items: [], reason: 'Histórico de cota ilegível; arquivos preservados.' }; }
}
export { observeAdmission, history, ROOT };
