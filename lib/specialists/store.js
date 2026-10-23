// Versões locais imutáveis e CAS sob lock exclusivo. Não há exclusão automática.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { parseJson, safeStringify } from '../io.js';
import { identityOf, scopeOf, digest, check, ID, validateEntries } from './contract.js';

const ROOT = path.join(STATE_DIR, 'specialists');
const repoDir = (identity, root = ROOT) => path.join(root, digest(identityOf(identity)));
const scopeDir = (scope, root = ROOT) => path.join(repoDir(scope, root), digest(scopeOf(scope)));
function readVersions(scope, root = ROOT) {
  const normalized = scopeOf(scope), dir = scopeDir(normalized, root);
  if (!fs.existsSync(dir)) return { ok: true, current: null, versions: [] };
  try {
    const versions = fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => {
      check(ID.test(n.slice(0, -5)), 'Nome de versão inválido.');
      const data = parseJson(fs.readFileSync(path.join(dir, n), 'utf8'));
      check(data?.schema === 1 && data.id + '.json' === n && digest(scopeOf(data.scope)) === digest(normalized)
        && Number.isInteger(data.revision) && data.revision > 0 && Number.isFinite(data.createdAt), 'Versão inválida.');
      return { schema: 1, id: data.id, scope: normalized, revision: data.revision, parent: data.parent,
        createdAt: data.createdAt, entries: validateEntries(data.entries, normalized) };
    }).sort((a, b) => a.revision - b.revision);
    for (const [i, v] of versions.entries()) check(v.revision === i + 1 && v.parent === (versions[i - 1]?.id || null), 'Histórico divergente ou incompleto.');
    return { ok: true, current: versions.at(-1) || null, versions };
  } catch { return { ok: false, error: 'Memória de especialista corrompida ou incompatível; os arquivos foram preservados.' }; }
}

function writeVersion(scope, expected, entries, root = ROOT) {
  const normalized = scopeOf(scope), dir = scopeDir(normalized, root);
  const checked = validateEntries(entries, normalized);
  check(expected === null || (typeof expected === 'string' && ID.test(expected)), 'Versão esperada inválida.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, 'write.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch { return { ok: false, error: 'Especialista ocupado. Recarregue antes de repetir.' }; }
  try {
    const previous = readVersions(normalized, root);
    if (!previous.ok) return previous;
    if ((previous.current?.id || null) !== expected) return { ok: false, error: 'Versão mudou. Recarregue e confira as alterações antes de salvar.' };
    const id = randomBytes(16).toString('hex');
    const version = { schema: 1, id, scope: normalized, parent: expected, revision: (previous.current?.revision || 0) + 1,
      createdAt: Date.now(), entries: checked };
    const temp = path.join(dir, id + '.tmp'), final = path.join(dir, id + '.json');
    const output = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(output, safeStringify(version)); fs.fsyncSync(output); } finally { fs.closeSync(output); }
    try { fs.linkSync(temp, final); } finally { fs.unlinkSync(temp); }
    return { ok: true, current: version };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
export { ROOT, repoDir, scopeDir, readVersions, writeVersion };
