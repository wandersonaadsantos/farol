import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SourceStore } from '../lib/review-source/store.js';

test('escrita de cache conhecida cabe na quota mesmo quando o monitor observa o conteúdo persistido', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-cache-write-monitor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new SourceStore({ host: 'github.com', repo: 'org/repo', account: 'one', repositoryId: 1 },
    { root, limits: { maxBytes: 4500, reserveBytes: 1, monitorIntervalMs: 10 } }).initialize();
  const write = store.writeObject.bind(store);
  store.writeObject = async args => {
    await write(args);
    // Mantém a operação aberta até uma amostra real do monitor, sem depender
    // da velocidade do disco do executor para alcançar esse ponto.
    const [id] = Object.keys((await store.budget.state()).reservations);
    await store.budget.sample(id);
  };
  const lease = await store.acquire({});
  await store.put('bounded', { code: 'x'.repeat(1000) }, lease);
  assert.deepEqual(await store.get('bounded'), { code: 'x'.repeat(1000) });
  assert.equal((await store.budget.inventory()).reservations, 0);
  await store.release(lease);
  const next = await store.acquire({});
  await store.put('replacement', { code: 'y'.repeat(3000) }, next);
  assert.equal(await store.get('bounded'), null);
  assert.deepEqual(await store.get('replacement'), { code: 'y'.repeat(3000) });
  await assert.rejects(store.put('over-quota', { code: 'z'.repeat(5000) }, next), /ativos.*preservados/);
  assert.deepEqual(await store.get('replacement'), { code: 'y'.repeat(3000) });
});
