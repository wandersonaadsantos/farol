// Medição reproduzível só de texto sintético; nenhum código analisado é executado.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseSources, VERSION } from '../lib/review-context/parser.js';
import { safeStringify } from '../lib/io.js';
const files = Array.from({ length: 120 }, (_, index) => {
  const text = `import type {Props} from './contract.ts'; import {useItem} from './useItem.ts';
export const Item${index}=(props:Props)=> <div>{useItem(props.id).label}</div>;`;
  return { path: `src/Item${index}.tsx`, blob: createHash('sha1').update(text).digest('hex'), text };
});
const scope = { host: 'github.com', account: 'fixture', repo: 'synthetic/frontend', repositoryId: 1 };
async function measure(label, batch, authorization) {
  const start = performance.now(), cpu = process.cpuUsage(), before = process.memoryUsage();
  const result = await parseSources(batch, authorization);
  const used = process.cpuUsage(cpu), after = process.memoryUsage();
  return { label, files: batch.length, inputBytes: batch.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0),
    parses: result.parses, hits: result.hits, cacheSerializedBytes: result.cacheBytes,
    elapsedMs: performance.now() - start, cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000,
    processRssBeforeBytes: before.rss, processRssAfterBytes: after.rss, processHeapAfterBytes: after.heapUsed,
    worker: result.workerMetrics };
}
const cold = await measure('cold-process', files, scope);
const anotherAnalysis = await measure('distinct-analysis-same-authorized-blobs', files.map(file => ({ ...file, path: file.path.replace('src/', 'renamed/') })), scope);
const anotherAccount = await measure('different-authorization', files, { ...scope, account: 'another-fixture' });
console.log(safeStringify({ runtime: process.version, arch: process.arch, platform: process.platform, parser: VERSION,
  measuredAt: new Date().toISOString(), cold, anotherAnalysis, anotherAccount,
  maxProcessRssKiB: process.resourceUsage().maxRSS,
  limitations: ['RSS e CPU são do processo inteiro, incluindo threads; heap do worker é somente seu isolate.',
    'Heap antes/depois não é pico; RSS máximo é amostragem acumulada do processo.',
    '4 MiB limita serialização UTF-8 do cache sintático, não RAM total.',
    'Sem índice persistido: outro processo começa frio. Conteúdo analisado é sintético, não uma review de IA.'] }));
