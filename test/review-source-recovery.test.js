import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { SourceStore } from '../lib/review-source/store.js';
import { recoveryBoot } from '../lib/review-source/recovery-boot.js';
import { criarMaterial } from '../lib/technical-review/cleanup.js';
import { readRecord, updateRecord } from '../lib/technical-review/material-record.js';
import { atomic, read } from '../lib/review-source/files.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-git-recovery-'));
  const original = recoveryBoot.read;
  t.after(async () => { recoveryBoot.read = original; await fs.rm(root, { recursive: true, force: true }); });
  const materialRoot = path.join(root, 'materials');
  const options = { root: path.join(root, 'cache'), materialRoot,
    limits: { globalMaxBytes: 500000, maxBytes: 400000, reserveBytes: 1, globalReserveBytes: 1, acquisitionReserveBytes: 10000 } };
  const scope = { host: 'github.com', account: 'fixture', repo: 'org/frontend', repositoryId: 1 };
  const store = await new SourceStore(scope, options).initialize(), lease = await store.acquire({});
  const destination = criarMaterial(materialRoot, {}), ownerPid = 123456;
  await store.attach(lease, destination);
  updateRecord(destination, r => ({ ...r, state: 'released', consumers: [], owner: { ...r.owner, pid: ownerPid },
    sourceReference: { schema: 1, scope, leaseId: lease } }));
  const leaseFile = path.join(store.root, 'leases', lease + '.json');
  await atomic(leaseFile, { ...await store.lease(lease), pid: ownerPid });
  const reservation = await store.budget.reserve('git-acquisition', 10000);
  await store.protectedGit(lease, true); await store.markUnconfirmed(lease);
  await store.budget.finish(reservation, { sourceTerminationUnconfirmed: true });
  const leaseValue = await store.lease(lease), oldBoot = Date.now() - 10000;
  await atomic(leaseFile, { ...leaseValue, createdAt: oldBoot - 2000 });
  const pendingFile = path.join(store.root, 'operation-pending.json');
  await atomic(pendingFile, { ...await read(pendingFile), at: oldBoot - 1000 });
  updateRecord(destination, r => ({ ...r, createdAt: oldBoot - 2000 }));
  const budgetState = await store.budget.state();
  budgetState.reservations[reservation].createdAt = oldBoot - 2000;
  await atomic(store.budget.file, budgetState);
  const partial = path.join(store.root, 'repository.git', 'objects', 'pack', 'tmp_pack');
  await fs.mkdir(path.dirname(partial), { recursive: true }); await fs.writeFile(partial, 'preserved-partial');
  const second = await new SourceStore({ ...scope, repo: 'org/messaging', repositoryId: 2 }, options).initialize();
  recoveryBoot.read = async () => oldBoot;
  return { root, store, second, lease, destination, partial, ownerPid, leaseFile, bootAt: oldBoot };
}

test('aquisição de outro repositório recupera operação encerrada sem apagar material ou parcial', async t => {
  const { store, second, lease, destination, partial } = await fixture(t);
  await second.put('new-source', { code: 'reviewable' });
  assert.deepEqual(await second.get('new-source'), { code: 'reviewable' });
  assert.equal(await fs.readFile(partial, 'utf8'), 'preserved-partial');
  assert.equal((await store.lease(lease)).gitProcessPending, false);
  assert.equal(readRecord(destination).sourceTerminationUnconfirmed, null);
  const inventory = await second.budget.inventory();
  assert.equal(inventory.reservations, 0);
  assert.equal(inventory.scopes[path.basename(store.root)].terminationUnconfirmed, false);
  assert.ok(inventory.scopes[path.basename(store.root)].acquisitionTemporaryBytes > 0);
  await store.assertConfirmed(lease);
  assert.equal(await store.budget.recover(), 0, 'recuperação é idempotente');
});

for (const pending of ['same-boot', 'unknown', 'future-boot', 'consumer', 'writer', 'identity']) {
  test(`recuperação preserva bloqueio quando falta prova: ${pending}`, async t => {
    const f = await fixture(t);
    if (pending === 'same-boot') recoveryBoot.read = async () => 1;
    if (pending === 'unknown') recoveryBoot.read = async () => null;
    if (pending === 'future-boot') recoveryBoot.read = async () => Date.now() + 10000;
    if (pending === 'consumer') updateRecord(f.destination, r => ({ ...r, consumers: ['session'] }));
    if (pending === 'writer') await fs.writeFile(path.join(f.store.root, 'writer.lock'), 'active-writer');
    if (pending === 'identity') updateRecord(f.destination, r => ({ ...r, sourceReference: { ...r.sourceReference, leaseId: 'other' } }));
    await assert.rejects(f.second.put('new-source', { code: 'unsafe' }), /não confirmado/);
    assert.equal((await f.store.lease(f.lease)).gitProcessPending, true);
    assert.equal((await f.store.budget.inventory()).reservations, 1);
    assert.equal(await fs.readFile(f.partial, 'utf8'), 'preserved-partial');
  });
}

test('reconciliação retoma depois de marcador persistido e flags já atualizadas', async t => {
  const { store, second, leaseFile, destination } = await fixture(t);
  await atomic(leaseFile, { ...await read(leaseFile), terminationUnconfirmed: null, gitProcessPending: false,
    recovered: { at: Date.now(), proof: 'previous-system-boot' } });
  updateRecord(destination, r => ({ ...r, sourceTerminationUnconfirmed: null, sourceProcessPending: false }));
  await second.put('new-source', { resumed: true });
  assert.deepEqual(await second.get('new-source'), { resumed: true });
  assert.equal((await store.budget.inventory()).reservations, 0);
});

test('consulta de boot pausada permite outro processo confirmar término Git', async t => {
  const { store, second, bootAt } = await fixture(t);
  const live = await second.acquire({});
  await second.protectedGit(live, true);
  const moduleUrl = pathToFileURL(path.resolve('lib/review-source/store.js')).href;
  const script = `import { SourceStore } from ${JSON.stringify(moduleUrl)};
    const store = await new SourceStore(JSON.parse(process.argv[1]), JSON.parse(process.argv[2])).initialize();
    await store.protectedGit(process.argv[3], false);`;
  recoveryBoot.read = async () => {
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script,
      JSON.stringify(second.scope), JSON.stringify({ root: second.base, materialRoot: second.budget.materialRoot }), live],
    { windowsHide: true, timeout: 10000 });
    return bootAt;
  };
  await second.put('parallel-source', { ready: true });
  assert.equal((await second.lease(live)).gitProcessPending, false);
  assert.deepEqual(await second.get('parallel-source'), { ready: true });
  assert.equal((await store.budget.inventory()).reservations, 0);
});

test('mudança do consumidor durante consulta de boot é revalidada antes de recuperar', async t => {
  const { store, second, destination, bootAt, lease } = await fixture(t);
  recoveryBoot.read = async () => {
    updateRecord(destination, r => ({ ...r, consumers: ['new-session'] }));
    return bootAt;
  };
  await assert.rejects(second.put('source', { ready: false }), /não confirmado/);
  assert.equal((await store.lease(lease)).gitProcessPending, true);
  assert.equal((await store.budget.inventory()).reservations, 1);
});
