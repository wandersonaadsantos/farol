import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import io from '../lib/io.js';
import { SourceStore } from '../lib/review-source/store.js';
import { GitSource } from '../lib/review-source/git.js';
import { criarMaterial } from '../lib/technical-review/cleanup.js';
import { readRecord, release, updateRecord } from '../lib/technical-review/material-record.js';
import { enqueue, maintainMaterials, remocao, pendentes } from '../lib/technical-review/material-maintenance.js';

async function waitFor(file) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { await fs.access(file); return; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  throw new Error('Fixture process did not reach its synchronization point');
}

async function waitForExit(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture process did not exit; owned material was preserved');
}
async function setup(root) {
  const materialRoot = path.join(root, 'materials'); await fs.mkdir(materialRoot);
  const scope = { host: 'github.com', account: 'fixture', repo: 'org/repo', repositoryId: 1 };
  const options = { root: path.join(root, 'cache'), materialRoot,
    limits: { globalMaxBytes: 500000, maxBytes: 400000, reserveBytes: 1, globalReserveBytes: 1, acquisitionReserveBytes: 10000, monitorIntervalMs: 10 } };
  const store = await new SourceStore(scope, options).initialize(), lease = await store.acquire({});
  return { materialRoot, scope, options, store, lease };
}
test('descendente ainda escrevendo conserva reserva, lease e material antes de qualquer rm', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-unconfirmed-git-'));
  const original = io.run, originalRm = remocao.rm, controller = new AbortController();
  const stop = path.join(root, 'stop'), stopped = path.join(root, 'stopped'), ready = path.join(root, 'ready');
  t.after(async () => {
    controller.abort(); io.run = original; remocao.rm = originalRm;
    await fs.writeFile(stop, 'stop');
    let started = false;
    try { await fs.access(ready); started = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (started) {
      await waitFor(stopped);
      await waitForExit(Number(await fs.readFile(ready, 'utf8')));
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const { store, lease, materialRoot, scope } = await setup(root);
  const destination = criarMaterial(materialRoot, {}), written = path.join(destination, 'heartbeat');
  await store.attach(lease, destination);
  updateRecord(destination, record => ({ ...record, sourceReference: { schema: 1, scope, leaseId: lease } }));
  const childCode = "const fs=require('node:fs');const [written,ready,stop,stopped]=process.argv.slice(1);fs.writeFileSync(ready,String(process.pid));const tick=setInterval(()=>{if(fs.existsSync(stop)){clearInterval(tick);fs.writeFileSync(stopped,'ended');return;}fs.appendFileSync(written,'x');},10)";
  const parentCode = "const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e',process.argv[1],...process.argv.slice(2)],{stdio:'ignore',windowsHide:true,detached:true});child.unref();setInterval(()=>{},1000)";
  io.run = async (_command, _args, opts) => {
    const pending = original(process.execPath, ['-e', parentCode, childCode, written, ready, stop, stopped], opts);
    await waitFor(ready); await waitFor(written); controller.abort();
    return pending;
  };
  const git = new GitSource({ ghEnv: () => ({}) }, store, lease, {}, { signal: controller.signal });
  await assert.rejects(store.withBudget('git-acquisition', 10000, controller.signal, signal => git.run(['fetch'], { signal })), /não confirmado/);
  const before = (await fs.stat(written)).size;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok((await fs.stat(written)).size > before, 'descendant continues after execFile callback');
  const inventory = await store.budget.inventory();
  assert.equal(inventory.reservations, 1);
  assert.equal(inventory.scopes[path.basename(store.root)].terminationUnconfirmed, true);
  assert.ok((await store.lease(lease)).terminationUnconfirmed);
  assert.ok(readRecord(destination).sourceTerminationUnconfirmed);
  await assert.rejects(store.release(lease), /não confirmado/);
  await assert.rejects(store.budget.reserve('next', 1), /não confirmado/);
  release(destination); assert.equal(enqueue(destination), false);
  let removals = 0; remocao.rm = async () => { removals++; };
  await maintainMaterials({ root: materialRoot });
  assert.equal(removals, 0); assert.equal(pendentes.has(destination), true);
  assert.ok((await fs.stat(written)).size > 0);
});
test('erro Git comum com exit128 não mantém reserva ou bloqueio permanente', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-git-exit128-')), original = io.run;
  t.after(async () => { io.run = original; await fs.rm(root, { recursive: true, force: true }); });
  const { store, lease } = await setup(root);
  io.run = async () => ({ ok: false, code: 128, stdout: '', stderr: 'fixture ordinary error' });
  const git = new GitSource({ ghEnv: () => ({}) }, store, lease, {}, {});
  await assert.rejects(store.withBudget('git-acquisition', 10000, undefined, signal => git.run(['fetch'], { signal })), /Não foi possível/);
  assert.equal((await store.budget.inventory()).reservations, 0);
  await store.release(lease);
  assert.equal((await store.lease(lease)).state, 'released');
});
for (const code of [null, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']) {
  test(`encerramento Git não comprovado (${code}) preserva reserva e impede nova admissão`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-git-unconfirmed-')), original = io.run;
    t.after(async () => { io.run = original; await fs.rm(root, { recursive: true, force: true }); });
    const { store, lease } = await setup(root);
    io.run = async () => ({ ok: false, code, stdout: '', stderr: '' });
    const git = new GitSource({ ghEnv: () => ({}) }, store, lease, {}, {});
    await assert.rejects(store.withBudget('git-acquisition', 10000, undefined, signal => git.run(['fetch'], { signal })), /não confirmado/);
    assert.equal((await store.budget.inventory()).reservations, 1);
    await assert.rejects(store.budget.reserve('next', 1), /não confirmado/);
  });
}
test('proteção anterior ao spawn impede limpeza mesmo se diagnóstico posterior não puder ser gravado', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-git-diagnostic-failure-')), original = io.run;
  t.after(async () => { io.run = original; await fs.rm(root, { recursive: true, force: true }); });
  const { store, lease, materialRoot } = await setup(root), destination = criarMaterial(materialRoot, {});
  await store.attach(lease, destination);
  io.run = async () => ({ ok: false, code: 'ABORT_ERR', stdout: '', stderr: '' });
  store.markUnconfirmed = async () => { throw new Error('fixture diagnostic disk full'); };
  const git = new GitSource({ ghEnv: () => ({}) }, store, lease, {}, {});
  await assert.rejects(store.withBudget('git-acquisition', 10000, undefined, signal => git.run(['fetch'], { signal })), /não confirmado/);
  assert.equal((await store.lease(lease)).gitProcessPending, true);
  assert.equal(readRecord(destination).sourceProcessPending, true);
  assert.equal((await store.budget.inventory()).reservations, 1);
  release(destination); assert.equal(enqueue(destination), false);
  await assert.rejects(store.budget.reserve('next', 1), /não confirmado/);
  const otherLease = await store.acquire({});
  assert.ok((await store.gitConsumers(otherLease)).includes(lease));
  const gitDir = path.join(store.root, 'repository.git'); await fs.mkdir(gitDir);
  const sentinel = path.join(gitDir, 'partial'); await fs.writeFile(sentinel, 'descendant-owned');
  const otherGit = new GitSource({ ghEnv: () => ({}) }, store, otherLease, {}, {});
  await assert.rejects(otherGit.evictInactive(), /ativos.*removidos/);
  await assert.rejects(git.evictInactive(), /não confirmado/);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'descendant-owned');
});
