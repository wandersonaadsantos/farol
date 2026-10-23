// Diário imutável por PR e conta. Um arquivo por análise evita atualização perdida.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeFindings } from './review-findings.js';
import { STATE_DIR } from '../paths.js';
import { ensureDir, parseJson, safeStringify } from '../io.js';

const SCHEMA = 1;
const ID = /^[a-f0-9]{32}$/;
const FIELDS = new Set(['schema', 'id', 'ordinal', 'scope', 'parents', 'headSha', 'baseSha', 'at', 'executor', 'decision', 'verdict', 'findingsStatus', 'findings', 'unresolved', 'files', 'integrity']);
function scopeFor(prKey, account) { return `${String(account || '').toLowerCase()}|${prKey}`; }
function roundsPath(scope) { return path.join(STATE_DIR, 'review-rounds', encodeURIComponent(scope)); }
function contentHash(value) { return createHash('sha256').update(safeStringify(value, '')).digest('hex'); }

function validRound(r, scope) {
  return r?.schema === SCHEMA && Object.keys(r).every(k => FIELDS.has(k)) && r.scope === scope && ID.test(r.id) && Array.isArray(r.parents)
    && r.parents.every(id => ID.test(id) && id !== r.id) && typeof r.headSha === 'string' && typeof r.baseSha === 'string'
    && Number.isFinite(r.at) && Array.isArray(r.findings) && Array.isArray(r.unresolved) && Array.isArray(r.files)
    && r.unresolved.every(f => f?.severity === 'blocking' && typeof f.id === 'string')
    && r.findings.every(f => f && typeof f.id === 'string')
    && normalizeFindings(r.findings).status === 'complete' && normalizeFindings(r.unresolved).status === 'complete'
    && r.files.every(f => typeof f?.path === 'string' && typeof f.sha === 'string');
}

function writeOnce(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, safeStringify(value, '')); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const existing = parseJson(fs.readFileSync(file, 'utf8'), null);
    if (contentHash(existing) !== contentHash(value)) throw new Error('conflito no registro imutável da rodada');
  } finally { fs.unlinkSync(temp); }
  return value;
}

function saveRound(round) {
  if (!validRound(round, round?.scope)) throw new Error('rodada inválida');
  return writeOnce(path.join(roundsPath(round.scope), `${round.id}.json`), round);
}

function readRounds(scope) {
  const dir = roundsPath(scope);
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (e) { return { ok: e.code === 'ENOENT', rounds: [], reason: e.code === 'ENOENT' ? '' : 'memória local ilegível' }; }
  const rounds = [], issues = entries.filter(n => n.endsWith('.json') && !/^[a-f0-9]{32}\.json$/.test(n));
  for (const name of entries.filter(n => /^[a-f0-9]{32}\.json$/.test(n))) {
    try {
      const round = parseJson(fs.readFileSync(path.join(dir, name), 'utf8'), null);
      if (!validRound(round, scope) || name !== `${round.id}.json`) { issues.push(name); continue; }
      rounds.push(round);
    } catch { issues.push(name); }
  }
  return { ok: !issues.length, rounds, reason: issues.length ? 'memória local corrompida ou incompatível; arquivos preservados' : '' };
}

function frontier(rounds) {
  const ancestors = new Set(rounds.flatMap(r => r.parents));
  return rounds.filter(r => !ancestors.has(r.id)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function historyIssues(rounds) {
  const byId = new Map(rounds.map(r => [r.id, r]));
  const issues = [];
  const reached = new Set();
  const visiting = new Set();
  const visit = id => {
    if (visiting.has(id)) { issues.push('memória contém ciclo de referências'); return; }
    if (reached.has(id)) return;
    reached.add(id);
    const round = byId.get(id);
    if (!round) { issues.push('ancestral de rodada indisponível'); return; }
    visiting.add(id);
    for (const parent of round.parents) visit(parent);
    visiting.delete(id);
  };
  for (const tip of frontier(rounds)) visit(tip.id);
  if (rounds.some(r => !reached.has(r.id))) issues.push('memória contém ciclo de referências');
  return issues;
}

function recordOutcome(scope, roundId, outcome) {
  if (!ID.test(roundId)) return;
  const id = contentHash(outcome);
  writeOnce(path.join(roundsPath(scope), 'outcomes', roundId, `${id}.json`), { schema: SCHEMA, roundId, ...outcome });
}

export { SCHEMA, scopeFor, roundsPath, contentHash, validRound, writeOnce, saveRound, readRounds, frontier, historyIssues, recordOutcome };
