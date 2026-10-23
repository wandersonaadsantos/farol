// Forma do conhecimento curado. Texto do repositório continua sendo dado não confiável.
import crypto from 'node:crypto';
import { safeStringify } from '../io.js';
import { mascararSegredos } from '../engine/falhas.js';

const KINDS = ['architecture', 'contract', 'convention', 'critical', 'lesson'];
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-f0-9]{32}$/;
const MAX_ENTRIES = 50, MAX_PATHS = 20;
const MAX_CONTEXT_BYTES = 64 * 1024;
const digest = value => crypto.createHash('sha256').update(safeStringify(value)).digest('hex');
function check(ok, message) { if (!ok) throw new Error(message); }

function identityOf(raw) {
  check(raw && typeof raw === 'object', 'Informe conta, repositório e branch.');
  const { account, repo } = raw;
  check(typeof account === 'string' && /^[\w-]{1,39}$/.test(account), 'Conta inválida.');
  check(typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && repo.length <= 200, 'Repositório inválido.');
  return { account: account.toLowerCase(), repo: repo.toLowerCase() };
}
function scopeOf(raw) {
  const identity = identityOf(raw), { branch } = raw;
  check(typeof branch === 'string' && branch.length > 0 && branch.length <= 240 && branch !== '@'
    && !/[\s\x00-\x1f~^:?*\[\\]/.test(branch) && !/\.\.|@\{|\/\//.test(branch)
    && branch.split('/').every(s => s && !s.startsWith('.') && !s.endsWith('.') && !s.endsWith('.lock')), 'Branch inválida.');
  return { ...identity, branch };
}

function sourceRef(raw) {
  const p = raw?.path;
  check(typeof p === 'string' && p.length <= 400 && !/[\x00-\x1f\\]/.test(p)
    && p.split('/').every(s => s && s !== '.' && s !== '..'), 'Caminho de fonte inválido.');
  check(!/(^|\/)(?:\.env[^/]*|\.git|\.ssh|\.aws|\.codex|node_modules|credentials?[^/]*|secrets?[^/]*|id_rsa)(\/|$)/i.test(p)
    && !/\.(?:key|pem|p12|pfx|kdbx)$/i.test(p), 'Fonte sensível não pode entrar no especialista.');
  check(Number.isInteger(raw.start) && raw.start >= 1 && Number.isInteger(raw.end)
    && raw.end >= raw.start && raw.end - raw.start < 20, 'Selecione de 1 a 20 linhas por evidência.');
  return { path: p, start: raw.start, end: raw.end };
}

function safeText(value, max, label) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label} inválido ou acima do limite (${max}).`);
  check(mascararSegredos(value) === value && !/(?:password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*["']?[^\s"']{6,}/i.test(value)
    && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    && !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)
    && !/(?:[A-Z]:\\Users\\|\/(?:Users|home)\/)/i.test(value), `${label} contém possível credencial ou dado pessoal. Remova antes de continuar.`);
  return value.trim();
}

function entryInput(raw) {
  check(raw && KINDS.includes(raw.kind), 'Tipo de conhecimento inválido.');
  check(Array.isArray(raw.sources) && raw.sources.length > 0 && raw.sources.length <= 8, 'Informe entre 1 e 8 evidências.');
  const sources = raw.sources.map(sourceRef);
  check(new Set(sources.map(s => `${s.path}:${s.start}:${s.end}`)).size === sources.length, 'Evidência duplicada.');
  return { kind: raw.kind, title: safeText(raw.title, 140, 'Título'), text: safeText(raw.text, 2000, 'Conclusão'), sources };
}

function storedEntry(raw) {
  const entry = entryInput(raw);
  check(ID.test(raw.id) && Number.isFinite(raw.curatedAt) && raw.curatedAt > 0 && typeof raw.enabled === 'boolean', 'Curadoria inválida.');
  entry.sources = raw.sources.map(s => {
    const ref = sourceRef(s);
    check(SHA.test(s.commit) && SHA.test(s.blob), 'Revisão da fonte inválida.');
    return { ...ref, commit: s.commit, blob: s.blob, excerpt: safeText(s.excerpt, 4000, 'Evidência') };
  });
  const origin = raw.origin;
  check(origin?.type === 'manual' || (origin?.type === 'pushback' && typeof origin.key === 'string' && /^[\w.-]+\/[\w.-]+#[1-9]\d*$/.test(origin.key)
    && /^[a-f0-9]{64}$/.test(origin.fingerprint)), 'Origem inválida.');
  const provenance = { type: origin.type };
  if (origin.type === 'pushback') Object.assign(provenance, { key: origin.key, fingerprint: origin.fingerprint });
  return { ...entry, id: raw.id, curatedAt: raw.curatedAt, enabled: raw.enabled, origin: provenance };
}

function validateEntries(entries, scope) {
  check(Array.isArray(entries) && entries.length <= MAX_ENTRIES, `Limite de ${MAX_ENTRIES} conclusões; nada será truncado.`);
  const result = entries.map(storedEntry);
  check(new Set(result.map(e => e.id)).size === result.length, 'Conclusão duplicada.');
  check(new Set(result.flatMap(e => e.sources.map(s => s.path))).size <= MAX_PATHS, `Limite de ${MAX_PATHS} arquivos distintos.`);
  check(result.every(e => e.origin.type !== 'pushback' || e.origin.key.toLowerCase().startsWith(scope.repo + '#')), 'Lição de outro repositório.');
  check(Buffer.byteLength(safeStringify(result.filter(e => e.enabled)), 'utf8') <= MAX_CONTEXT_BYTES, 'Contexto ativo acima de 64 KiB. Reduza os trechos ou desative conclusões antes de continuar; nada foi truncado.');
  return result;
}
export { KINDS, SHA, ID, MAX_ENTRIES, MAX_PATHS, digest, check, identityOf, scopeOf, sourceRef, safeText, entryInput, storedEntry, validateEntries };
