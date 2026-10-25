// Preparação comum de review e autoanálise; não decide cobertura ou publicação.
import { SourceStore } from './store.js';
import { GitSource } from './git.js';
import { makeReader } from './reader.js';
import { SHA, identity, limitsFor, check, aborted } from './contract.js';
import * as github from './github.js';

const running = new Set();
async function sourceBlobs(handle) {
  const [head, before] = await Promise.all([handle.reader.tree('head'), handle.reader.tree('mergeBase')]);
  const heads = new Map(head.entries.map(e => [e.path, e.blob])), bases = new Map(before.entries.map(e => [e.path, e.blob]));
  for (const file of handle.manifest.files) {
    const previousPath = file.previousPath || file.path;
    file.headBlob = heads.get(file.path) || null;
    file.mergeBaseBlob = bases.get(previousPath) || null;
    file.baseBlob = file.mergeBaseBlob;
    file.baseBlobRevision = 'M';
    file.headBlobStatus = head.complete ? 'checked' : 'unavailable';
    file.baseBlobStatus = before.complete ? 'checked' : 'unavailable';
    file.references = { head: { commit: handle.manifest.H, path: file.path },
      base: { commit: handle.manifest.B, path: previousPath }, mergeBase: { commit: handle.manifest.M, path: previousPath } };
  }
  handle.manifest.sourceCompleteness = { headTree: head.complete, mergeBaseTree: before.complete,
    limitations: [head.reason, before.reason].filter(Boolean) };
}
async function makeHandle(engine, scope, manifest, inventory, store, options) {
  aborted(options.signal);
  const lease = await store.acquire({ H: manifest.H, B: manifest.B, M: manifest.M, number: scope.number });
  const reader = makeReader(engine, scope, manifest, store, lease, options);
  const git = new GitSource(engine, store, lease, { head: manifest.H, base: manifest.B, mergeBase: manifest.M }, options);
  const reference = { schema: 1, scope, leaseId: lease };
  let released = false;
  const release = async () => {
    if (released) return;
    const consumer = await store.lease(lease);
    if (consumer?.destination) return;
    await git.release(); await store.release(lease); released = true;
  };
  return { status: manifest.status, reason: manifest.reason, manifest, inventory, reader, reference, release,
    retain: () => makeHandle(engine, scope, manifest, inventory, store, options),
    materialize: destination => git.materialize(destination), usage: () => store.usage() };
}
async function prepareSources(engine, pr, options = {}) {
  const limits = limitsFor({ ...engine.config?.sourceCacheLimits, ...options.limits });
  const opts = { ...options, limits };
  let store, handle;
  const token = {};
  try {
    check(running.size < limits.maxQueued, 'Fila de preparação de fontes cheia; tarefa adiada.');
    running.add(token);
    const requested = identity(pr, engine.accountForPr(pr));
    const scope = await github.authorize(engine, requested, opts);
    const before = await github.snapshot(engine, scope, opts);
    check(!options.expectedHead || before.head === options.expectedHead, 'Head mudou antes da preparação da fonte.');
    check(!options.expectedBase || before.base === options.expectedBase, 'Base mudou antes da preparação da fonte.');
    const files = await github.files(engine, scope, opts);
    const M = await github.mergeBase(engine, scope, before, opts);
    const after = await github.snapshot(engine, scope, opts);
    check(github.sameTarget(before, after), 'Head ou base mudou durante a preparação da fonte.');
    const complete = new Set(files.map(f => f.path)).size === files.length && files.length === before.changedFiles;
    const status = complete ? 'complete' : 'incomplete';
    const reason = complete ? '' : 'Páginas duplicadas ou quantidade de arquivos divergente; inventário incompleto.';
    const manifest = { schema: 1, scope, H: before.head, B: before.base, M,
      fork: { repo: before.headRepo || null, repositoryId: before.headRepositoryId || null },
      status, reason, files, limitations: files.filter(f => f.patchStatus !== 'available').map(f => ({ path: f.path, reason: 'Patch indisponível; conteúdo exige leitura na versão fixada.' })) };
    const inventory = { status, reason, headSha: before.head, baseSha: before.base, mergeBaseSha: M, changedFiles: before.changedFiles, files };
    if (!complete) return { status, reason, manifest, inventory, release: async () => {} };
    store = await new SourceStore(scope, { root: options.root, limits }).initialize();
    handle = await makeHandle(engine, scope, manifest, inventory, store, opts);
    await sourceBlobs(handle);
    aborted(options.signal);
    return handle;
  } catch (error) {
    if (handle) await handle.release().catch(() => {});
    return { status: 'unavailable', reason: error.message, manifest: null,
      inventory: { status: 'unavailable', reason: error.message, headSha: '', baseSha: '', changedFiles: null, files: [] }, release: async () => {} };
  } finally { running.delete(token); }
}
async function releaseMaterialReference(reference, destination, options = {}) {
  check(reference?.schema === 1 && /^[a-f0-9-]{36}$/.test(reference.leaseId || ''), 'Referência do cache inválida.');
  check(reference.scope?.host === 'github.com' && Number.isSafeInteger(reference.scope?.repositoryId), 'Escopo do cache inválido.');
  identity({ repo: reference.scope.repo, number: reference.scope.number || 1 }, reference.scope.account);
  const store = await new SourceStore(reference.scope, options).initialize();
  await store.releaseAfterRemoval(reference.leaseId, destination);
  const git = new GitSource({ ghEnv: () => ({}) }, store, reference.leaseId, {}, {});
  await git.release(destination);
}
async function openPreparedSources(engine, manifest, options = {}) {
  check(manifest?.schema === 1 && manifest.status === 'complete' && manifest.scope?.host === 'github.com'
    && [manifest.H, manifest.B, manifest.M].every(sha => SHA.test(sha || '')), 'Manifesto de fontes incompatível.');
  const requested = identity({ repo: manifest.scope.repo, number: manifest.scope.number }, manifest.scope.authAccount || manifest.scope.account);
  const opts = { ...options, limits: limitsFor({ ...engine.config?.sourceCacheLimits, ...options.limits }) };
  const scope = await github.authorize(engine, requested, opts);
  check(scope.repositoryId === manifest.scope.repositoryId && scope.account === manifest.scope.account, 'Autorização ou repositório difere do manifesto.');
  const store = await new SourceStore(scope, { root: options.root, limits: opts.limits }).initialize();
  const inventory = { status: 'complete', reason: '', headSha: manifest.H, baseSha: manifest.B,
    mergeBaseSha: manifest.M, changedFiles: manifest.files?.length ?? null, files: manifest.files || [] };
  return makeHandle(engine, scope, manifest, inventory, store, opts);
}
export { prepareSources, openPreparedSources, releaseMaterialReference };
