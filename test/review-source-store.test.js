import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SourceStore } from '../lib/review-source/store.js';

const scope = { host: 'github.com', repo: 'org/repo', account: 'one', repositoryId: 1 };
async function fixture(t, limits = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-source-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await new SourceStore(scope, { root, limits: { reserveBytes: 1, ...limits } }).initialize();
  return { root, store };
}
test('cache isola fontes privadas entre contas e identidades de repositório', async t => {
  const { root, store } = await fixture(t), lease = await store.acquire({ H: 'fixture' });
  await store.put('same', { code: 'one' }, lease);
  const other = await new SourceStore({ ...scope, account: 'two' }, { root }).initialize();
  const renamed = await new SourceStore({ ...scope, repositoryId: 2 }, { root }).initialize();
  assert.notEqual(store.root, other.root); assert.notEqual(store.root, renamed.root);
  assert.equal(await other.get('same'), null); assert.equal(await renamed.get('same'), null);
});
test('quota não remove objeto de consumidor ativo; liberação torna-o elegível', async t => {
  const { store } = await fixture(t, { maxBytes: 4500 }), first = await store.acquire({});
  await store.put('first', { code: 'x'.repeat(1000) }, first);
  const second = await store.acquire({});
  await assert.rejects(store.put('second', { code: 'y'.repeat(3000) }, second), /ativos.*preservados/);
  assert.ok(await store.get('first'));
  await store.release(first); await store.release(first);
  await store.put('second', { code: 'y'.repeat(3000) }, second);
  assert.equal(await store.get('first'), null); assert.ok(await store.get('second'));
});
test('cache corrompido não vira contabilidade vazia ou fonte válida', async t => {
  const { store } = await fixture(t), lease = await store.acquire({});
  await store.put('first', { code: 'correct' }, lease);
  await fs.writeFile(store.objectPath('first'), '{broken');
  await assert.rejects(store.get('first'), /corrompido/);
  await fs.writeFile(path.join(store.root, 'catalogue.json'), '{broken');
  await assert.rejects(store.usage(), /corrompido/);
});
test('escritor interrompido permanece diagnosticável e não é removido por prazo', async t => {
  const { store } = await fixture(t);
  await fs.writeFile(path.join(store.root, 'writer.lock'), 'unknown owner');
  await assert.rejects(store.acquire({}), /interrompido/);
  assert.equal(await fs.readFile(path.join(store.root, 'writer.lock'), 'utf8'), 'unknown owner');
});
test('consumidor antigo sem prova de liberação protege conteúdo mesmo sem processo atual', async t => {
  const { store } = await fixture(t, { maxBytes: 4500 }), lease = await store.acquire({});
  await store.put('old', { code: 'x'.repeat(1000) }, lease);
  const file = path.join(store.root, 'leases', lease + '.json');
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...value, pid: 999999999, instance: 'old', createdAt: 1 }));
  const fresh = await store.acquire({});
  await assert.rejects(store.put('new', { code: 'y'.repeat(3000) }, fresh), /ativos.*preservados/);
});
test('caminho de objetos com junction externo é recusado sem ler o destino', async t => {
  const { root, store } = await fixture(t), outside = path.join(root, 'outside');
  await fs.mkdir(outside); await fs.rm(path.join(store.root, 'objects'), { recursive: true });
  await fs.symlink(outside, path.join(store.root, 'objects'), 'junction');
  await assert.rejects(store.get('anything'), /link externo/);
  assert.deepEqual(await fs.readdir(outside), []);
});
