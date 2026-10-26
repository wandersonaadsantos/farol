import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { instalarDom } from './helpers/dom-stub.js';
import { activityReport } from '../lib/usage/report.js';

const NOW = Date.parse('2026-10-26T16:00:00Z');
const row = n => ({ id: `a-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, at: NOW,
  kind: 'review', status: 'ok', ref: 'org/repo#1', account: 'dev', model: 'Sonnet', inputTokens: 10, outputTokens: 5 });

test('atualização periódica repinta indicadores, recursos e modelos quando chegam execuções', async t => {
  const { doc } = instalarDom();
  let clock = NOW;
  const rows = [row(1)];
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', async url => ({ json: async () => activityReport([{ device: 'local', rows }],
    Object.fromEntries(new URL(url, 'http://localhost').searchParams), clock) }));
  const { renderActivity } = await import('../ui/telas/consumo-atividade.js?refresh');
  await renderActivity({ window: 30, scope: 'local' });
  assert.match(doc.querySelector('#activityBody').innerHTML, /Reviews concluídas.*?<b>1<\/b>/s);
  rows.push(row(2));
  clock += 31000;
  await renderActivity({ window: 30, scope: 'local' });
  const body = doc.querySelector('#activityBody').innerHTML;
  assert.match(body, /Reviews concluídas.*?<b>2<\/b>/s);
  assert.match(body, /Tokens registrados · entrada \+ saída<\/span><b>30<\/b>/);
  assert.match(body, /Sonnet<\/span><span>2 execuções/);
  assert.match(doc.querySelector('#activityHistory').innerHTML, /de 2 operações/);
});

test('trocar a fonte limpa filtros incompatíveis nos dois sentidos', async t => {
  const { doc } = instalarDom();
  const listeners = new Map();
  doc.querySelector('#usageActivity').addEventListener = (name, fn) => listeners.set(name, fn);
  const requests = [];
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', async url => {
    const query = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
    requests.push(query);
    return { json: async () => activityReport([{ device: 'local', rows: [row(1)] }], query, NOW) };
  });
  const { renderActivity } = await import('../ui/telas/consumo-atividade.js?scope');
  await renderActivity({ window: 30, scope: 'local' });
  listeners.get('change')({ target: { dataset: { activityFilter: 'repo' }, value: 'org/repo' } });
  await setImmediate();
  assert.equal(requests.at(-1).repo, 'org/repo');
  await renderActivity({ window: 30, scope: 'all' });
  assert.equal(requests.at(-1).repo, 'all');
  listeners.get('change')({ target: { dataset: { activityFilter: 'account' }, value: 'a'.repeat(64) } });
  await setImmediate();
  assert.equal(requests.at(-1).account, 'a'.repeat(64));
  await renderActivity({ window: 30, scope: 'local' });
  assert.equal(requests.at(-1).account, 'all');
  assert.match(doc.querySelector('#activityBody').innerHTML, /Reviews concluídas.*?<b>1<\/b>/s);
});
