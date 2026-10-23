// Curadoria explícita via API local. Saída de modelo/pushback nunca ativa lição sozinha.
import { randomBytes } from 'node:crypto';
import { scopeOf, entryInput, digest, check, ID, safeText, validateEntries } from './contract.js';
import { readVersions, writeVersion } from './store.js';
import { proposals, inspect } from './context.js';
import * as github from './github.js';

const previews = new WeakMap();
const PREVIEW_TTL_MS = 600_000; // dez minutos para conferir e curar uma prévia
function previewCache(engine) {
  if (!previews.has(engine)) previews.set(engine, new Map());
  const cache = previews.get(engine);
  for (const [id, value] of cache) if (Date.now() - value.at > PREVIEW_TTL_MS) cache.delete(id);
  return cache;
}
function knownScope(engine, input) {
  const scope = scopeOf(input);
  check(engine.accountList().some(a => a.user?.toLowerCase() === scope.account), 'Conta não configurada neste engine.');
  return scope;
}
function savedFor(scope) {
  const saved = readVersions(scope);
  check(saved.ok, saved.error || 'Memória indisponível.');
  return saved;
}

async function view(engine, scope) {
  const saved = savedFor(scope);
  let statuses = [], checkedHead = null, verificationError = '';
  if (saved.current) {
    try { checkedHead = await github.branchHead(engine, scope); statuses = await inspect(engine, scope, saved.current, checkedHead); }
    catch { verificationError = 'Não foi possível verificar a branch agora.'; statuses = saved.current.entries.map(e => ({ id: e.id, status: e.enabled ? 'unavailable' : 'disabled' })); }
  }
  const items = proposals(engine, scope).map(p => {
    // A nota é só proposta. Não duplique possível segredo em uma resposta nova.
    try { return { ...p, text: safeText(p.text, 2000, 'Proposta') }; }
    catch { return { key: p.key, fingerprint: p.fingerprint, text: '(Nota omitida: conteúdo sensível ou acima do limite.)' }; }
  });
  return { ok: true, scope, current: saved.current, statuses, checkedHead, verificationError, proposals: items,
    versions: saved.versions.map(v => ({ id: v.id, revision: v.revision, createdAt: v.createdAt, count: v.entries.length })) };
}

async function preview(engine, scope, body) {
  const saved = savedFor(scope), input = entryInput(body.entry);
  check(body.replaceId === undefined || (typeof body.replaceId === 'string' && ID.test(body.replaceId) && saved.current?.entries.some(e => e.id === body.replaceId)), 'Conclusão a reconstruir não existe.');
  let origin = { type: 'manual' };
  if (body.originKey) {
    const originProposal = proposals(engine, scope).find(p => p.key === body.originKey && p.text === input.text);
    check(originProposal, 'A proposta mudou ou pertence a outro repositório.');
    origin = { type: 'pushback', key: originProposal.key, fingerprint: originProposal.fingerprint };
  }
  const commit = await github.branchHead(engine, scope), source = await github.reader(engine, scope, commit);
  const sources = [];
  for (const ref of input.sources) sources.push(await source.evidence(ref));
  const draft = { ...input, sources, origin };
  const id = body.replaceId || digest([scope, draft]).slice(0, 32);
  validateEntries([...(saved.current?.entries || []).filter(e => e.id !== id), { ...draft, id, enabled: true, curatedAt: Date.now() }], scope);
  const token = randomBytes(16).toString('hex');
  const cache = previewCache(engine);
  check(cache.size < 100, 'Muitas prévias abertas. Conclua ou aguarde a expiração.');
  cache.set(token, { scope, entry: { ...draft, id, enabled: true }, expected: saved.current?.id || null, commit, at: Date.now() });
  return { ok: true, previewId: token, draft: { ...draft, id }, expected: saved.current?.id || null, commit };
}

async function curate(engine, scope, body) {
  check(body.confirmed === true, 'Confirme a curadoria da prévia.');
  const value = previewCache(engine).get(body.previewId);
  check(value && digest(value.scope) === digest(scope), 'Prévia expirada ou de outro escopo. Gere outra.');
  const saved = savedFor(scope), existing = saved.current?.entries.find(e => e.id === value.entry.id);
  const entry = { ...value.entry, curatedAt: Date.now() };
  if (value.applied || (existing?.enabled && digest({ ...existing, curatedAt: 0 }) === digest({ ...entry, curatedAt: 0 }))) return { ok: true, current: saved.current, repeated: true };
  check((saved.current?.id || null) === value.expected, 'Versão mudou. Gere outra prévia.');
  check(await github.branchHead(engine, scope) === value.commit, 'Branch mudou. Gere outra prévia.');
  if (entry.origin.type === 'pushback') check(proposals(engine, scope).some(p => p.key === entry.origin.key && p.fingerprint === entry.origin.fingerprint), 'Origem da lição mudou. Gere outra prévia.');
  const entries = (saved.current?.entries || []).filter(e => e.id !== entry.id);
  const result = writeVersion(scope, value.expected, [...entries, entry]);
  if (result.ok) value.applied = true;
  return result;
}

async function command(engine, body) {
  try {
    const scope = knownScope(engine, body?.scope);
    if (body.action === 'view') return await view(engine, scope);
    if (body.action === 'preview') return await preview(engine, scope, body);
    if (body.action === 'curate') return await curate(engine, scope, body);
    const saved = savedFor(scope);
    check(body.expected === (saved.current?.id || null), 'Versão mudou. Recarregue.');
    check(body.confirmed === true, 'Confirme a alteração.');
    if (body.action === 'toggle') {
      check(typeof body.enabled === 'boolean' && saved.current?.entries.some(e => e.id === body.id), 'Conclusão inválida.');
      // Reativar exige nova prévia e curação das fontes; desativar funciona offline.
      check(body.enabled === false, 'Para reativar, reconstrua e confirme as fontes.');
      return writeVersion(scope, body.expected, saved.current.entries.map(e => e.id === body.id ? { ...e, enabled: false } : e));
    }
    if (body.action === 'restore') {
      const old = saved.versions.find(v => v.id === body.version);
      check(old, 'Versão não encontrada neste escopo.');
      // Restaura o conteúdo como inativo: cada conclusão precisa de nova curadoria.
      return writeVersion(scope, body.expected, old.entries.map(e => ({ ...e, enabled: false })));
    }
    throw new Error('Operação de especialista inválida.');
  } catch (error) {
    // Erros de IO não expõem caminho de perfil, stdout ou stderr ao cliente.
    const message = String(error.message || '');
    if (error.code) { engine.log('WARN', 'Especialista: falha de armazenamento local.'); return { ok: false, error: 'Falha de armazenamento local; nenhuma curadoria foi confirmada.' }; }
    return { ok: false, error: message };
  }
}
export { command, view, preview, curate };
