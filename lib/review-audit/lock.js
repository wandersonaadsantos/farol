// Cada concorrente publica sua intenção e um ticket; nunca apaga o nome de outro
// dono vivo. A morte do processo libera sua intenção sem depender de um TTL.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseJson, writeJsonAtomic } from '../io.js';
import { writeOnce } from '../engine/review-round-store.js';
import { check } from './contract.js';

const OWNER = /^[a-f0-9-]{36}\.json$/;
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return true; }
}
function remove(file) {
  try { fs.unlinkSync(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function owners(dir) {
  const values = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.tmp')) continue;
    check(OWNER.test(name), 'Lock de auditoria incompatível; arquivos preservados.');
    const file = path.join(dir, name);
    let value;
    try { value = parseJson(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    check(value?.schema === 1 && Number.isSafeInteger(value.pid) && value.pid > 0
      && Number.isSafeInteger(value.ticket) && value.ticket >= 0
      && Object.keys(value).every(k => ['schema', 'pid', 'ticket'].includes(k)), 'Dono do lock não verificável; arquivo preservado.');
    if (!alive(value.pid)) { remove(file); continue; }
    values.push({ ...value, name });
  }
  return values;
}
function acquire(root, name) {
  check(['run', 'write'].includes(name), 'Lock de auditoria inválido.');
  check(!fs.existsSync(path.join(root, name + '.lock')), 'Lock antigo sem identidade verificável; confira o escritor antes de migrar.');
  const dir = path.join(root, '.locks', name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const own = randomUUID() + '.json', file = path.join(dir, own);
  try {
    writeOnce(file, { schema: 1, pid: process.pid, ticket: 0 });
    const ticket = Math.max(0, ...owners(dir).map(v => v.ticket)) + 1;
    check(Number.isSafeInteger(ticket), 'Ticket de auditoria incompatível.');
    writeJsonAtomic(file, { schema: 1, pid: process.pid, ticket });
    const blocked = owners(dir).some(v => v.name !== own
      && (v.ticket === 0 || v.ticket < ticket || (v.ticket === ticket && v.name < own)));
    check(!blocked, 'Auditoria ocupada por outro escritor.');
    return () => remove(file);
  } catch (error) { remove(file); throw error; }
}
export { acquire };
