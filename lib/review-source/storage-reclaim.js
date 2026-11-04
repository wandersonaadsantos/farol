// Recuperação conservadora: só envelopes catalogados sem consumidor ativo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, check } from './contract.js';
import { read, atomic, contained } from './files.js';
import { tryWithLock } from './lock-file.js';
import { TEMPOS } from '../constants.js';

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
// O Git de um escopo sem consumidor: só custa um fetch cheio na próxima revisão daquele repositório.
// Renomeia antes de apagar: rm pela metade deixaria um repositório sem objetos que o init não cura e o
// fsck reprova para sempre. Sobra da pasta renomeada sai na próxima passada.
const GIT_DESPEJADO = 'repository.git.despejado.tmp';
async function reclaimScopeGit(base, root) {
  await contained(base, root);
  return tryWithLock(path.join(root, 'writer.lock'), () => false, async () => {
    if (!await releasedScope(root)) return false;
    const despejado = path.join(root, GIT_DESPEJADO);
    try {
      await fs.rm(despejado, { recursive: true, force: true });
      await fs.rename(path.join(root, 'repository.git'), despejado);
      await atomic(path.join(root, 'git-usage.json'), { bytes: 0, materialBytes: 0, estimate: true, measuredAt: Date.now() });
      await fs.rm(despejado, { recursive: true, force: true });
    } catch (error) { return error.code !== 'ENOENT' && await existe(despejado); }
    return true;
  });
}
const existe = alvo => fs.access(alvo).then(() => true, () => false);
const usoDoGit = scopeRoot => read(path.join(scopeRoot, 'git-usage.json')).catch(() => null);
// Do uso mais antigo para o mais novo. Fica de fora o escopo que pediu, o de Git sem término confirmado
// e o usado há pouco: dois repositórios acima do teto não podem se despejar em ciclo a cada revisão.
async function scopesWithIdleGit(base, scopes, own, agora = Date.now()) {
  const candidates = [];
  for (const [scope, value] of Object.entries(scopes)) {
    if (scope === own || !value.gitBytes || value.pendingGitProcess || value.terminationUnconfirmed || value.foreignGitProcess) continue;
    const usedAt = Number((await usoDoGit(path.join(base, scope)))?.measuredAt) || 0;
    if (agora - usedAt >= TEMPOS.GIT_OCIOSO_PARA_DESPEJO_MS) candidates.push({ scope, usedAt, gitBytes: value.gitBytes });
  }
  return candidates.sort((a, b) => a.usedAt - b.usedAt);
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
export { reclaimInactiveObjects, reclaimScopeGit, scopesWithIdleGit };
