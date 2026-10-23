// Diário local imutável. Um lock cobre admissão, reserva e avaliação humana.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { parseJson } from '../io.js';
import { writeOnce } from '../engine/review-round-store.js';
import { check, ID, digest } from './contract.js';

const ROOT = path.join(STATE_DIR, 'review-audits');
function directory(id) { check(ID.test(id), 'Auditoria inválida.'); return path.join(ROOT, id); }
function write(id, name, data) { return writeOnce(path.join(directory(id), name + '.json'), { ...data, integrity: digest(data) }); }
function read(id, name) {
  const file = path.join(directory(id), name + '.json');
  if (!fs.existsSync(file)) return null;
  const value = parseJson(fs.readFileSync(file, 'utf8'));
  check(value && value.schema === 1, 'Registro de auditoria corrompido ou incompatível; arquivos preservados.');
  const { integrity, ...data } = value;
  check(integrity === digest(data), 'Integridade da auditoria inválida; arquivo preservado.');
  return data;
}
function jobs() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
    check(ID.test(e.name), 'Diretório de auditoria incompatível.');
    const job = read(e.name, 'job');
    check(job && job.id === e.name && job.target && Array.isArray(job.usageIds) && job.usageIds.length === 2
      && job.usageIds.every(id => /^f-[a-f0-9-]{36}$/.test(id)) && Number.isFinite(job.at) && ['manual', 'automatic'].includes(job.mode), 'Registro de auditoria inválido.');
    return job;
  });
}
function lock(name = 'write') {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const file = path.join(ROOT, name + '.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch { throw new Error('Auditoria ocupada ou lock de execução interrompida; confira antes de repetir.'); }
  return () => { fs.closeSync(fd); fs.unlinkSync(file); };
}
function assessments(id) {
  const dir = path.join(directory(id), 'human');
  if (!fs.existsSync(dir)) return [];
  const values = fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => {
    const v = parseJson(fs.readFileSync(path.join(dir, n), 'utf8'));
    check(v?.schema === 1 && v.id + '.json' === n, 'Avaliação humana corrompida.');
    const { id: eventId, ...content } = v;
    check(digest(content).slice(0, 32) === eventId, 'Integridade da avaliação humana inválida.'); return v;
  }).sort((a, b) => a.revision - b.revision);
  for (const [i, v] of values.entries()) check(v.revision === i + 1 && v.parent === (values[i - 1]?.id || null), 'Histórico humano divergente.');
  return values;
}
function assess(id, expected, item, verdict, note) {
  const history = assessments(id), last = history.at(-1);
  check((last?.id || null) === expected, 'Avaliação mudou. Recarregue antes de salvar.');
  const value = { schema: 1, revision: history.length + 1, parent: expected, item, verdict, note, at: Date.now() };
  value.id = digest(value).slice(0, 32);
  return writeOnce(path.join(directory(id), 'human', value.id + '.json'), value);
}
export { ROOT, write, read, jobs, lock, assessments, assess };
