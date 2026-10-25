// Worker só interpreta texto; não importa nem executa fontes do repositório.
import { parentPort } from 'node:worker_threads';
import { parseFile } from './syntax.js';
parentPort.on('message', files => {
  const started = performance.now(), cpu = process.cpuUsage(), before = process.memoryUsage();
  const analyses = files.map(parseFile), after = process.memoryUsage(), used = process.cpuUsage(cpu);
  parentPort.postMessage({ analyses, metrics: { elapsedMs: performance.now() - started,
    cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000,
    workerHeapBeforeBytes: before.heapUsed, workerHeapAfterBytes: after.heapUsed,
    processRssBeforeBytes: before.rss, processRssAfterBytes: after.rss } });
});
