// Operações privadas de arquivos compartilhadas pelo cache e pela quota.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseJson, safeStringify } from '../io.js';
import { check } from './contract.js';

const serial = new Map();
async function contained(root, target) {
  const resolved = path.resolve(target), base = path.resolve(root);
  check(resolved === base || resolved.startsWith(base + path.sep), 'Cache fora da raiz privada.');
  const relative = path.relative(base, resolved).split(path.sep).filter(Boolean);
  let current = base;
  for (const part of ['', ...relative]) {
    if (part) current = path.join(current, part);
    try { check(!(await fs.lstat(current)).isSymbolicLink(), 'Cache com link externo foi preservado.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}
async function read(file) {
  try { const value = parseJson(await fs.readFile(file, 'utf8')); check(value && typeof value === 'object', 'Arquivo do cache corrompido; dados preservados.'); return value; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomic(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try { await handle.writeFile(safeStringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tmp, file);
}
async function withinQueue(key, work) {
  const previous = serial.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  serial.set(key, next);
  try { return await next; } finally { if (serial.get(key) === next) serial.delete(key); }
}
export { contained, read, atomic, withinQueue };
