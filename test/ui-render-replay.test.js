import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { instalarDom } from './helpers/dom-stub.js';
import { controlarQuadros } from './helpers/quadros-ui.js';
const current = path.resolve(import.meta.dirname, '..');
const target = path.resolve(process.env.FAROL_UI_REPLAY_ROOT || current);
const output = process.env.FAROL_UI_REPLAY_OUTPUT;
const { doc, emitir, listeners } = instalarDom();
const quadros = controlarQuadros();
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => null, text: async () => '' });
const counts = {};
for (const selector of ['#resolved', '#queue', '#reviewersEditor', '#myPRs', '#panorama']) {
  counts[selector] = 0;
  const el = doc.querySelector(selector); let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: value => { html = String(value); counts[selector] = (counts[selector] || 0) + 1; } });
}
await import(pathToFileURL(path.join(target, 'ui/app.js')).href);
const { estado } = await import(pathToFileURL(path.join(target, 'ui/telas/estado.js')).href);
for (let i = 0; i < 50 && !listeners.has('state'); i++) await new Promise(resolve => setTimeout(resolve, 1));
const fixture = { app: { platform: 'win32', version: 'fixture' }, status: 'idle', account: { user: 'dev', tokenOk: true }, accounts: [],
  config: { accounts: [], intervalSeconds: 300, parallelReviews: 1, people: {}, claudeProfiles: [], defaultReviewers: {}, projectReviewers: {}, theme: 'dark' },
  queue: [], panorama: [], myPRs: [], decisions: { pending: [], resolved: [] }, activeSessions: [], activity: {}, selfAnalyses: {},
  usage: {}, toolRuns: {}, paths: { home: '/fixture', workspace: '/fixture/workspace' } };
emitir('state', fixture); quadros.pintar();
function phase(run) {
  for (const key of Object.keys(counts)) counts[key] = 0;
  const start = performance.now(); run(); quadros.pintar();
  return { writes: { ...counts }, elapsedMs: performance.now() - start };
}
test('replay controlado de deltas, janela oculta e atividade', () => {
  const radarUsage = phase(() => { for (let n = 0; n < 100; n++) emitir('state-patch', { campos: { usage: { n } }, removidos: [] }); });
  assert.equal(estado().usage.n, 99);
  doc.hidden = true;
  const hiddenQueue = phase(() => { for (let n = 0; n < 100; n++) emitir('state-patch', { campos: { queue: [], nextCheckAt: 1000 + n }, removidos: [] }); });
  assert.equal(estado().nextCheckAt, 1099);
  doc.hidden = false;
  emitir('state-patch', { campos: { status: 'idle' }, removidos: [] }); quadros.pintar();
  const activity = phase(() => { for (let n = 0; n < 1500; n++) emitir('activity', { id: 'fixture', item: { t: 1000 + n, s: 'leitura', text: 'evento sintético', k: 'info' } }); });
  const result = { target, node: process.version, method: 'Replay de dados sintéticos no DOM stub. Mesmo traço e relógio de quadros nas duas versões. Contagens de escrita HTML, não CPU/GPU/latência de produção.',
    deltasPerPhase: 100, radarUsage, hiddenQueue, activity, retainedActivity: estado().activity.fixture.length };
  if (target === current) {
    assert.equal(radarUsage.writes['#queue'], 1);
    assert.equal(radarUsage.writes['#resolved'], 0);
    assert.equal(radarUsage.writes['#reviewersEditor'] || 0, 0);
    assert.equal(hiddenQueue.writes['#queue'], 0);
    assert.equal(result.retainedActivity, 300);
  }
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2));
});
