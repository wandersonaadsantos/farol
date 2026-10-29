// Leitura verificável e busca de caminhos na mesma versão das fontes.
import { TextDecoder } from 'node:util';
import { request } from './github.js';
import { SHA, sourcePath, isSourceTemplate, blobHash, check, aborted } from './contract.js';
import { assertSourceProjection } from './projection.js';
import { projectedTextCache } from './projected-text-cache.js';
import { withinQueue } from './store.js';
import { mascararSegredos } from '../engine/falhas.js';

function sideCommit(manifest, side) {
  const aliases = { head: 'H', base: 'B', mergeBase: 'M' };
  const key = aliases[side];
  check(key && SHA.test(manifest[key] || ''), 'Lado da fonte indisponível.');
  return manifest[key];
}
function treeEntry(entry) {
  check(SHA.test(entry?.sha || '') && typeof entry.path === 'string', 'Entrada de árvore inválida.');
  check(['blob', 'tree', 'commit'].includes(entry.type) && ['100644', '100755', '120000', '040000', '160000'].includes(entry.mode), 'Tipo de árvore não suportado.');
  check(entry.size == null || (Number.isSafeInteger(entry.size) && entry.size >= 0), 'Tamanho da fonte inválido.');
  const path = sourcePath(entry.path, true);
  let readable = true;
  try { sourcePath(path); } catch { readable = false; }
  return { path, blob: entry.sha, type: entry.type, mode: entry.mode, size: entry.size ?? null,
    readable: readable && entry.type === 'blob' && ['100644', '100755'].includes(entry.mode) };
}
async function acquireTree(engine, scope, commit, options) {
  const revision = await request(engine, scope, `repos/${scope.repo}/git/commits/${commit}`, '{sha, tree: .tree.sha}', options);
  check(revision.sha === commit && SHA.test(revision.tree || ''), 'Commit da árvore não confirmado.');
  const raw = await request(engine, scope, `repos/${scope.repo}/git/trees/${revision.tree}?recursive=1`,
    '{sha, truncated, tree: [.tree[] | {path, mode, type, sha, size}]}', options);
  check(raw.sha === revision.tree && Array.isArray(raw.tree) && typeof raw.truncated === 'boolean', 'Árvore da fonte inválida.');
  const entries = raw.tree.map(treeEntry);
  check(new Set(entries.map(e => e.path)).size === entries.length, 'Árvore com caminhos duplicados.');
  return { commit, tree: raw.sha, entries, truncated: raw.truncated };
}
function publicTemplate(entry, projection) {
  return !!projection && entry.type === 'blob' && ['100644', '100755'].includes(entry.mode) && isSourceTemplate(entry.path);
}
function projectedEntry(entry, projection, blockedPaths) {
  if (blockedPaths.has(entry.path)) return { ...entry, readable: false };
  return publicTemplate(entry, projection) ? { ...entry, readable: true, template: true } : entry;
}
function readPathAllowed(path, projection, blockedPaths) {
  if (blockedPaths.has(path)) return false;
  try { sourcePath(path); return true; } catch { return !!projection && isSourceTemplate(path); }
}
function makeReader(engine, scope, manifest, store, lease, options) {
  const projection = options.projection && assertSourceProjection(options.projection);
  const projected = projection ? projectedTextCache() : null;
  const blockedPaths = new Set(manifest.files.filter(file => file.sensitivity?.path)
    .flatMap(file => [file.path, file.previousPath].filter(Boolean)));
  const templatePaths = new Set(projection ? manifest.files.filter(file => file.sensitivity?.template)
    .flatMap(file => [file.path, file.previousPath].filter(Boolean)) : []);
  const trees = new Map(), inflight = new Map();
  async function cached(key, acquire) {
    aborted(options.signal);
    if (inflight.has(key)) return inflight.get(key);
    const promise = withinQueue(`acquire:${store.root}:${key}`, async () => {
      aborted(options.signal);
      const found = await store.get(key, lease);
      if (found) return found;
      const data = await acquire();
      aborted(options.signal);
      store.metrics.acquisitions++;
      if (data.cacheable !== false) await store.put(key, data, lease, options.signal);
      return data;
    });
    inflight.set(key, promise);
    try { return await promise; } finally { inflight.delete(key); }
  }
  async function tree(side = 'head') {
    const commit = sideCommit(manifest, side);
    if (trees.has(commit)) return trees.get(commit);
    const key = `tree:${commit}`;
    try {
      const data = await cached(key, () => acquireTree(engine, scope, commit, options));
      const withinLimit = data.entries.length <= options.limits.maxFiles;
      const entries = data.entries.slice(0, options.limits.maxFiles).map(entry => projectedEntry(entry, projection, blockedPaths));
      const complete = !data.truncated && withinLimit;
      let reason = '';
      if (data.truncated) reason = 'Árvore truncada pelo GitHub; ausência no mapa não comprova ausência de uso.';
      if (!withinLimit) reason = 'Limite de arquivos do mapa atingido; caminhos restantes não foram examinados.';
      const result = { commit, entries, complete, reason, excludedCount: entries.filter(e => !e.readable && e.type === 'blob').length };
      trees.set(commit, result);
      return result;
    } catch (error) { return { commit, entries: [], complete: false, reason: error.message }; }
  }
  async function read(path, side = 'head') {
    const commit = sideCommit(manifest, side);
    if (!readPathAllowed(path, projection, blockedPaths)) return { status: 'excluded', path, commit, text: null, blob: null, reason: 'Fonte sensível ou caminho não suportado.' };
    try {
      aborted(options.signal);
      const listing = await tree(side), entry = listing.entries.find(e => e.path === path);
      if (!entry) return { status: listing.complete ? 'missing' : 'unavailable', path, commit, text: null, blob: null, reason: listing.reason };
      if (!entry.readable) return { status: 'unsupported', path, commit, blob: entry.blob, text: null, reason: 'Link, submódulo ou diretório não é fonte textual.' };
      if (entry.size > options.limits.maxFileBytes) return { status: 'limited', path, commit, blob: entry.blob, size: entry.size, text: null, reason: 'Fonte acima do limite de tamanho.' };
      return await readBlob(entry, commit);
    } catch (error) { return { status: 'unavailable', path, commit, text: null, blob: null, reason: error.message }; }
  }
  async function readBlob(entry, commit) {
    aborted(options.signal);
    const template = !!projection && (publicTemplate(entry, projection) || templatePaths.has(entry.path));
    const key = `${entry.blob}:${template ? 'template' : 'text'}`;
    const found = projected?.get(key);
    if (found) return { status: 'available', path: entry.path, commit, blob: entry.blob, mode: entry.mode, ...found };
    const value = await cached(`blob:${entry.blob}`, async () => {
      const raw = await request(engine, scope, `repos/${scope.repo}/git/blobs/${entry.blob}`, '{sha, encoding, size, content}', options);
      check(raw.sha === entry.blob && raw.encoding === 'base64' && Number.isInteger(raw.size)
        && raw.size >= 0 && raw.size <= options.limits.maxFileBytes && typeof raw.content === 'string', 'Blob indisponível ou acima do limite.');
      const bytes = Buffer.from(raw.content.replace(/\s/g, ''), 'base64');
      check(bytes.length === raw.size && blobHash(bytes) === entry.blob, 'Blob recebido não confere com a fonte.');
      const text = bytes.toString('utf8');
      const cacheable = !projection
        && !text.includes('\0') && !text.includes('\uFFFD') && mascararSegredos(text) === text;
      return { blob: raw.sha, size: raw.size, content: raw.content.replace(/\s/g, ''), cacheable };
    });
    const bytes = Buffer.from(value.content, 'base64');
    check(value.blob === entry.blob && bytes.length === value.size && blobHash(bytes) === entry.blob, 'Conteúdo não confere com a identidade do blob.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return { status: 'binary', path: entry.path, commit, blob: entry.blob, size: bytes.length, text: null }; }
    if (text.includes('\0')) return { status: 'binary', path: entry.path, commit, blob: entry.blob, size: bytes.length, text: null };
    const representation = template ? projection.projectTemplate(text) : projection?.project(text);
    const result = { status: 'available', path: entry.path, commit, blob: entry.blob, mode: entry.mode, size: bytes.length,
      text: representation?.text ?? text,
      representation: representation ? { projectionId: projection.id, version: projection.version, kind: representation.kind || 'source-text',
        digest: representation.digest, redactions: representation.redactions } : null };
    if (projected) projected.put(key, result);
    return result;
  }
  return { tree, read };
}
export { makeReader, sideCommit, treeEntry };
