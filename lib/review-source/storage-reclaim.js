// Recuperação conservadora: só envelopes catalogados sem consumidor ativo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, check } from './contract.js';
import { read, atomic, contained } from './files.js';
import { tryWithLock } from './lock-file.js';

async function releasedScope(root) {
  if (await read(path.join(root, 'operation-pending.json'))) return false;
  for (const name of await fs.readdir(path.join(root, 'leases'))) {
    const lease = await read(path.join(root, 'leases', name));
    if (lease?.schema !== 1 || lease.state !== 'released' || lease.gitProcessPending || lease.terminationUnconfirmed) return false;
  }
  return true;
}
async function reclaimScope(base, root) {
  await contained(base, root);
  const file = path.join(root, 'writer.lock');
  return tryWithLock(file, () => 0, async () => {
    if (!await releasedScope(root)) return 0;
    const catalogue = await read(path.join(root, 'catalogue.json'));
    if (!catalogue) return 0;
    check(catalogue.schema === 1 && Number.isSafeInteger(catalogue.bytes) && catalogue.entries, 'Contabilidade para recuperação não verificável.');
    return await reclaimEntries(base, root, catalogue);
  });
}
async function reclaimEntries(base, root, catalogue) {
  let recovered = 0;
  for (const [id, entry] of Object.entries(catalogue.entries)) {
    if (entry.pending) continue;
    check(typeof entry.key === 'string' && digest(entry.key) === id && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0, 'Objeto para recuperação não verificável.');
    const file = path.join(root, 'objects', id + '.json');
    await contained(base, file);
    await fs.rm(file, { force: true });
    recovered += entry.bytes;
    catalogue.bytes = Math.max(0, catalogue.bytes - entry.bytes);
    delete catalogue.entries[id];
    await atomic(path.join(root, 'catalogue.json'), catalogue);
  }
  return recovered;
}
async function reclaimInactiveObjects(base, scopes) {
  let recovered = 0;
  for (const scope of Object.keys(scopes)) recovered += await reclaimScope(base, path.join(base, scope));
  return recovered;
}
export { reclaimInactiveObjects };
