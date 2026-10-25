// Diagnóstico sob demanda, com cache. Não altera concorrência nem encerra processo.
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { readProcesses, classifyProcesses } from './processes.js';
import { memoriaLivreMb } from '../engine/admissao.js';
import { persistenceMetrics } from '../persistence-metrics.js';

const state = new WeakMap();
function cpuTicks(cpus) {
  return cpus.reduce((n, cpu) => ({ idle: n.idle + cpu.times.idle,
    total: n.total + Object.values(cpu.times).reduce((sum, v) => sum + v, 0) }), { idle: 0, total: 0 });
}
function processUsage(rows, previous, elapsed, cores) {
  if (!rows) return { count: null, rssBytes: null, cpuPercent: null, status: 'unavailable' };
  if (!rows.length) return { count: 0, rssBytes: 0, cpuPercent: null, status: 'empty' };
  let cpu = 0, complete = true;
  for (const row of rows) {
    const old = previous?.find(r => r.pid === row.pid && r.born === row.born);
    if (!old || elapsed <= 0 || row.cpuMs < old.cpuMs) complete = false;
    else cpu += row.cpuMs - old.cpuMs;
  }
  return { count: rows.length, rssBytes: rows.reduce((n, r) => n + r.rss, 0), cpuPercent: complete ? Math.min(100, cpu / elapsed / cores * 100) : null, status: 'measured' };
}
function liveSessions(engine) {
  return [...engine.running.entries()].flatMap(([id, run]) => {
    const session = engine.activeReviews.get(id);
    return run.child?.pid && session && run.child.exitCode === null ? [{ id, pid: run.child.pid, startedAt: session.startedAt }] : [];
  });
}
async function collect(engine, previous) {
  const start = performance.now(), measuredAt = Date.now(), cpus = os.cpus(), machine = cpuTicks(cpus);
  const rows = await readProcesses();
  const elapsed = previous ? start - previous.start : 0;
  let cpuPercent = null;
  if (previous && machine.total > previous.machine.total && machine.idle >= previous.machine.idle) cpuPercent = (1 - (machine.idle - previous.machine.idle) / (machine.total - previous.machine.total)) * 100;
  let groups = { farol: null, clis: null, missing: [], bySession: [] };
  if (rows?.some(r => r.pid === process.pid)) groups = classifyProcesses(rows, process.pid, liveSessions(engine));
  const farol = processUsage(groups.farol, previous?.rows, elapsed, cpus.length || 1);
  const clis = processUsage(groups.clis, previous?.rows, elapsed, cpus.length || 1);
  if (groups.missing.length) clis.status = 'partial';
  const availableMb = memoriaLivreMb();
  const alerts = [];
  if (availableMb !== null && availableMb < 1024) alerts.push('Pouca memória disponível para o processo (menos de 1 GiB); observação, sem ajuste automático.');
  if (cpuPercent !== null && cpuPercent >= 90) alerts.push('CPU da máquina acima de 90% nesta amostra; isso não identifica a causa.');
  if (!rows) alerts.push('Métricas dos processos indisponíveis; nenhuma suficiência foi presumida.');
  const intervalMs = previous ? elapsed : null;
  return { start, rows, machine, at: Date.now(), data: { measuredAt, intervalMs,
    machine: { cores: cpus.length, cpuPercent, totalBytes: os.totalmem(), freeBytes: os.freemem(), availableToProcessMb: availableMb },
    farol, clis, main: { rssBytes: process.memoryUsage().rss }, sessions: engine.activeReviews.size, runningClis: engine.running.size,
    cliSessions: groups.bySession.map(s => ({ id: s.id, ...processUsage(s.rows, previous?.rows, elapsed, cpus.length || 1) })),
    queue: engine.headlessQueue.length, missingCliCount: groups.missing.length,
    persistence: persistenceMetrics(), sourceCache: engine.sourceCacheStatus || { status: 'not-measured' }, alerts } };
}
async function resources(engine) {
  let current = state.get(engine);
  if (current?.pending) return current.pending;
  if (current?.sample && Date.now() - current.sample.at < 5000) return current.sample.data;
  if (!current) { current = {}; state.set(engine, current); }
  current.pending = collect(engine, current.sample).then(sample => { current.sample = sample; return sample.data; }).finally(() => { current.pending = null; });
  return current.pending;
}
export { resources, processUsage, cpuTicks };
