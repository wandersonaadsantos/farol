// Identidade e limites das fontes. Disponibilidade nunca equivale a leitura.
import crypto from 'node:crypto';
import { safeStringify } from '../io.js';

const SHA = /^[a-f0-9]{40}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const SOURCE_TIMEOUT_MS = 120000;
const DEFAULTS = Object.freeze({ maxBytes: 2 * 1024 ** 3, reserveBytes: 512 * 1024 ** 2,
  maxFileBytes: 1024 ** 2, maxFiles: 20000, concurrency: 1, maxQueued: 8,
  timeoutMs: SOURCE_TIMEOUT_MS, lockWaitMs: 5000, maxTreeDepth: 64, maxReleasedLeases: 64 });
const digest = value => crypto.createHash('sha256').update(safeStringify(value)).digest('hex');
function check(ok, message) { if (!ok) throw new Error(message); }
function aborted(signal) { check(!signal?.aborted, 'Preparação de fontes cancelada.'); }
function limitsFor(raw = {}) {
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (Number.isSafeInteger(raw[key]) && raw[key] > 0) result[key] = raw[key];
  }
  result.concurrency = Math.min(2, result.concurrency);
  return result;
}
function sourcePath(value, allowSensitive = false) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !/[\x00-\x1f\\:]/.test(value) && value.split('/').every(s => s && s !== '.' && s !== '..'), 'Caminho de fonte inválido.');
  if (!allowSensitive) check(!/(^|\/)(?:\.git|\.env[^/]*|\.ssh|\.aws|node_modules|credentials?[^/]*|secrets?[^/]*|id_rsa)(\/|$)/i.test(value)
    && !/\.(?:pem|key|p12|pfx|kdbx)$/i.test(value), 'Fonte sensível excluída.');
  return value;
}
function identity(pr, account) {
  check(REPO.test(pr?.repo || '') && Number.isSafeInteger(pr?.number) && pr.number > 0, 'Identidade do PR inválida.');
  check(typeof account === 'string' && /^[\w-]{1,39}$/.test(account), 'Conta da fonte inválida.');
  if (pr.url) check(pr.url.toLowerCase() === `https://github.com/${pr.repo}/pull/${pr.number}`.toLowerCase(), 'Host ou identidade do PR incompatível.');
  return { host: 'github.com', repo: pr.repo.toLowerCase(), account: account.toLowerCase(), authAccount: account, number: pr.number };
}
function blobHash(bytes) { return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
export { SHA, REPO, DEFAULTS, digest, check, aborted, limitsFor, sourcePath, identity, blobHash };
