// Limites do parser e cache por autorização/blob. O conteúdo do projeto não é executado.
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { safeStringify } from '../io.js';
import { sourceWork } from '../review-source/work.js';

const VERSION = 'v8-imports-2';
const MAX_QUEUE = 16;
const WORKER_TIMEOUT_MS = 8000;
const CACHE_LIMIT_BYTES = 4 * 1024 * 1024;
const cache = new Map();
let cacheBytes = 0;
const hash = value => createHash('sha256').update(safeStringify(value)).digest('hex');

function workerParse(files, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      execArgv: ['--experimental-vm-modules', '--no-warnings'],
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate().catch(reject);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error('Mapeamento cancelado.'));
    const timer = setTimeout(() => finish(new Error('Parser excedeu o tempo permitido.')), WORKER_TIMEOUT_MS);
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`Parser encerrou antes do resultado (${code}).`)); });
    worker.once('message', result => finish(null, result));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else worker.postMessage(files);
  });
}

function remember(key, analysis) {
  const bytes = Buffer.byteLength(safeStringify(analysis));
  if (bytes > CACHE_LIMIT_BYTES) return;
  if (cache.has(key)) cacheBytes -= cache.get(key).bytes;
  cache.set(key, { analysis, bytes });
  cacheBytes += bytes;
  while (cacheBytes > CACHE_LIMIT_BYTES) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).bytes;
    cache.delete(oldest);
  }
}

async function parseScoped(files, scope, signal) {
  const hits = [], missing = [], locations = new Map();
  for (const file of files) {
    // A extensão participa da interpretação do mesmo blob (JS e TS podem coincidir).
    const name = hash([scope, VERSION, file.blob, path.extname(file.path)]);
    const old = cache.get(name)?.analysis;
    if (old) hits.push({ ...old, path: file.path });
    else { missing.push(file); locations.set(file.path, name); }
  }
  if (!missing.length) return { analyses: hits, parses: 0, hits: hits.length };
  const analyses = await workerParse(missing, signal);
  for (const analysis of analyses) {
    remember(locations.get(analysis.path), analysis);
  }
  return { analyses: [...hits, ...analyses], parses: analyses.length, hits: hits.length, cacheBytes };
}

async function parseSources(files, scope, signal) {
  return sourceWork({ concurrency: 1, maxQueued: MAX_QUEUE }, signal, () => parseScoped(files, scope, signal));
}

export { parseSources, VERSION };
