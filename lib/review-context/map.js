// Mapa navegável por snapshot, sem afirmar completude semântica ou ausência de impacto.
import path from 'node:path';
import { parseSources } from './parser.js';
import { sourceRef } from '../specialists/contract.js';
import { parseJson } from '../io.js';

const DEFAULT_LIMITS = { files: 600, bytes: 8 * 1024 * 1024, fileBytes: 256 * 1024, timeMs: 30000, depth: 2, paths: 120 };
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx', '.json', '/index.js', '/index.ts', '/index.tsx', '/index.jsx', '/index.mjs', '/index.cjs'];
function eligible(p) {
  try { sourceRef({ path: p, start: 1, end: 1 }); return true; }
  catch { return false; }
}
function bounded(raw = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits)) {
    if (Number.isFinite(raw[key]) && raw[key] > 0) limits[key] = Math.min(DEFAULT_LIMITS[key] * 4, Math.floor(raw[key]));
  }
  return limits;
}

async function aliasesFor(source, side, paths, limitations) {
  for (const file of ['tsconfig.json', 'jsconfig.json']) {
    if (!paths.has(file)) continue;
    const data = await source.reader.read(file, side);
    const config = data?.status === 'available' ? parseJson(data.text) : null;
    if (!config) { limitations.push(`${file}: configuração JSON não interpretada; aliases exigem busca adicional.`); continue; }
    if (config.extends) limitations.push(`${file}: extends não expandido; resolução de aliases é parcial.`);
    const options = config.compilerOptions || {};
    const entries = Object.entries(options.paths || {});
    const supported = entries.filter(([pattern, targets]) => pattern.split('*').length <= 2
      && Array.isArray(targets) && targets.every(target => typeof target === 'string' && target.split('*').length <= 2));
    if (supported.length !== entries.length) limitations.push(`${file}: aliases inválidos ou com mais de um curinga exigem investigação adicional.`);
    return { base: options.baseUrl || '.', paths: Object.fromEntries(supported), file };
  }
  return { base: '.', paths: {} };
}

function resolutionCandidates(from, specifier, aliases) {
  if (specifier.startsWith('.')) return [{ target: path.posix.join(path.posix.dirname(from), specifier), method: 'relative-path' }];
  const result = [];
  for (const [pattern, targets] of Object.entries(aliases.paths).slice(0, 64)) {
    if (!Array.isArray(targets)) continue;
    const [prefix, suffix = ''] = pattern.split('*');
    const wildcard = pattern.includes('*');
    const match = wildcard ? specifier.startsWith(prefix) && specifier.endsWith(suffix) : specifier === pattern;
    if (!match) continue;
    const middle = wildcard ? specifier.slice(prefix.length, specifier.length - suffix.length) : '';
    for (const target of targets.slice(0, 8)) if (typeof target === 'string') {
      result.push({ target: path.posix.join(aliases.base, target.replaceAll('*', () => middle)), method: 'configuration-candidate', config: aliases.file });
    }
  }
  return result;
}

function resolveImports(analyses, paths, aliases) {
  const relations = [], unresolved = [];
  for (const file of analyses) {
    unresolved.push(...(file.unresolved || []).map(item => ({ from: file.path, ...item })));
    for (const item of file.imports) {
    const candidates = resolutionCandidates(file.path, item.specifier, aliases);
    const found = candidates.flatMap(candidate => EXTENSIONS.map(ext => ({ ...candidate, path: path.posix.normalize(candidate.target + ext) })))
      .find(candidate => eligible(candidate.path) && paths.has(candidate.path));
    if (found) relations.push({ from: file.path, to: found.path, specifier: item.specifier, origin: item.origin,
      confidence: resolvedConfidence(item, found), kind: item.kind || 'unknown', form: item.form || 'import',
      resolution: found.method, config: found.config || null });
    else unresolved.push({ from: file.path, specifier: item.specifier, reason: 'dependência externa, dinâmica ou não resolvida' });
  }
  }
  return { relations, unresolved };
}
function resolvedConfidence(item, found) {
  if (item.confidence === 'syntax' && found.method === 'relative-path'
    && found.path === path.posix.normalize(found.target)) return 'syntax-path';
  return 'candidate';
}

async function mapSide(source, side, scope, limits, signal) {
  const tree = await source.reader.tree(side);
  const entries = Array.isArray(tree?.entries) ? tree.entries : [];
  const paths = new Set(entries.filter(e => e.type === 'blob' && eligible(e.path)).map(e => e.path));
  const files = [], limitations = [];
  if (!tree?.complete) limitations.push(tree?.reason || 'Árvore incompleta.');
  const aliases = await aliasesFor(source, side, paths, limitations);
  const started = Date.now();
  let bytes = 0, omitted = 0;
  for (const entry of entries.filter(e => CODE.test(e.path) && paths.has(e.path)).sort((a, b) => a.path.localeCompare(b.path))) {
    if (signal?.aborted) throw new Error('Mapeamento cancelado.');
    if (files.length >= limits.files || Date.now() - started >= limits.timeMs || bytes >= limits.bytes) { omitted++; continue; }
    if (entry.size > limits.fileBytes) { omitted++; continue; }
    const data = await source.reader.read(entry.path, side);
    if (data?.status !== 'available' || typeof data.text !== 'string' || !data.blob) { omitted++; continue; }
    const size = Buffer.byteLength(data.text);
    if (size > limits.fileBytes || bytes + size > limits.bytes) { omitted++; continue; }
    files.push({ path: entry.path, blob: data.blob, text: data.text }); bytes += size;
  }
  if (omitted) limitations.push(`${omitted} arquivo(s) fora do levantamento por limite ou indisponibilidade.`);
  const parsed = await parseSources(files, scope, signal);
  const resolved = resolveImports(parsed.analyses, paths, aliases);
  if (resolved.unresolved.length) limitations.push(`${resolved.unresolved.length} dependência(s) não resolvida(s); ausência de relação não comprova ausência de impacto.`);
  limitations.push(...parsed.analyses.flatMap(file => file.limitations.map(reason => `${file.path}: ${reason}`)));
  return { side, paths: [...paths], files: parsed.analyses, ...resolved,
    complete: tree?.complete === true && omitted === 0 && limitations.length === 0
      && parsed.analyses.every(file => file.backend !== 'textual' && file.limitations.length === 0),
    limitations, metrics: { files: files.length, bytes, omitted, parses: parsed.parses, parserHits: parsed.hits,
      parserCacheBytes: parsed.cacheBytes || 0, worker: parsed.workerMetrics || null } };
}

async function buildMap(source, options = {}) {
  const limits = bounded(options.limits);
  const identity = source.manifest.scope;
  const scope = { host: identity.host, account: identity.account, repo: identity.repo, repositoryId: identity.repositoryId };
  const head = await mapSide(source, 'head', scope, limits, options.signal);
  const previous = await mapSide(source, 'mergeBase', scope, limits, options.signal);
  return { schema: 1, head, previous, limits,
    complete: head.complete && previous.complete,
    limitations: [...head.limitations, ...previous.limitations, 'Imports indicam dependências de arquivos, não um grafo completo de chamadas. Ausência no mapa não prova ausência de uso.'] };
}

function impactPaths(map, files) {
  const initial = files.flatMap(f => [f.path, f.previousPath, f.previous_filename].filter(Boolean));
  const affected = new Set(initial);
  const relations = [...map.head.relations, ...map.previous.relations];
  const configurationChanged = initial.some(p => /(^|\/)(?:tsconfig|jsconfig|package)[^/]*\.json$/.test(p));
  if (configurationChanged) for (const p of [...map.head.paths, ...map.previous.paths]) affected.add(p);
  let frontier = new Set(affected);
  for (let depth = 0; depth < map.limits.depth && frontier.size; depth++) {
    const next = new Set();
    for (const edge of relations) if (frontier.has(edge.to) && !affected.has(edge.from)) { affected.add(edge.from); next.add(edge.from); }
    frontier = next;
  }
  return { affected: [...affected], configurationChanged, truncated: frontier.size > 0 };
}

export { buildMap, impactPaths, bounded, eligible, resolveImports, DEFAULT_LIMITS };
