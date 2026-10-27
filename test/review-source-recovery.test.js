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
import { recoveryProcesses, windowsGit, posixGit } from '../lib/review-source/recovery-owner.js';
import { processProbe } from '../lib/technical-review/material-process.js';
import { criarMaterial } from '../lib/technical-review/cleanup.js';
import { readRecord, updateRecord } from '../lib/technical-review/material-record.js';
import { atomic, read } from '../lib/review-source/files.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-git-recovery-'));
  const original = recoveryBoot.read, originalGit = recoveryProcesses.list, originalProbe = processProbe.read;
  t.after(async () => {
    recoveryBoot.read = original; recoveryProcesses.list = originalGit; processProbe.read = originalProbe;
    await fs.rm(root, { recursive: true, force: true });
  });
  // Por padrão o dono segue vivo: só a prova de boot destrava, como antes do mesmo boot.
  const ownerBirth = 'Mon Oct 26 16:38:46 2026';
  processProbe.read = async () => ({ status: 'found', birth: ownerBirth });
  recoveryProcesses.list = async () => [];
  const materialRoot = path.join(root, 'materials');
  const options = { root: path.join(root, 'cache'), materialRoot,
    limits: { globalMaxBytes: 500000, maxBytes: 400000, reserveBytes: 1, globalReserveBytes: 1, acquisitionReserveBytes: 10000 } };
  const scope = { host: 'github.com', account: 'fixture', repo: 'org/frontend', repositoryId: 1 };
  const store = await new SourceStore(scope, options).initialize(), lease = await store.acquire({});
  const destination = criarMaterial(materialRoot, {}), ownerPid = 123456;
  await store.attach(lease, destination);
  updateRecord(destination, r => ({ ...r, state: 'released', consumers: [], owner: { ...r.owner, pid: ownerPid, birth: ownerBirth },
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
  return { root, store, second, lease, destination, partial, ownerPid, leaseFile, bootAt: oldBoot, interruptedAt: oldBoot - 1000 };
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

// Mesmo boot (biud-frontend#1551, 26/10/2026): o Farol dono reiniciou sem reiniciar o Windows, e a trava nunca expirava.
for (const [caso, owner] of [['dono encerrado', { status: 'absent' }], ['PID reaproveitado', { status: 'found', birth: 'Mon Oct 26 18:27:52 2026' }]]) {
  test(`mesmo boot recupera quando o dono acabou e não há Git anterior vivo: ${caso}`, async t => {
    const f = await fixture(t);
    recoveryBoot.read = async () => 1;
    processProbe.read = async () => owner;
    recoveryProcesses.list = async () => [{ name: 'git.exe', born: Date.now() }];
    await f.second.put('new-source', { code: 'reviewable' });
    const lease = await f.store.lease(f.lease);
    assert.equal(lease.gitProcessPending, false);
    assert.equal(lease.recovered.proof, 'owner-ended-without-git');
    assert.equal(lease.recovered.ownerState, owner.status === 'absent' ? 'ended' : 'reused');
    assert.equal(readRecord(f.destination).sourceRecovery.proof, 'owner-ended-without-git');
    assert.equal((await f.store.budget.inventory()).reservations, 0);
    assert.equal(await fs.readFile(f.partial, 'utf8'), 'preserved-partial');
  });
}

for (const caso of ['dono vivo', 'dono desconhecido', 'Git anterior vivo', 'Git sem início', 'lista indisponível']) {
  test(`mesmo boot preserva bloqueio quando falta prova: ${caso}`, async t => {
    const f = await fixture(t);
    recoveryBoot.read = async () => 1;
    processProbe.read = async () => ({ status: 'absent' });
    if (caso === 'dono vivo') processProbe.read = async () => ({ status: 'found', birth: 'Mon Oct 26 16:38:46 2026' });
    if (caso === 'dono desconhecido') processProbe.read = async () => ({ status: 'unknown' });
    if (caso === 'Git anterior vivo') recoveryProcesses.list = async () => [{ name: 'git.exe', born: f.interruptedAt - 5000 }];
    if (caso === 'Git sem início') recoveryProcesses.list = async () => [{ name: 'git.exe', born: NaN }];
    if (caso === 'lista indisponível') recoveryProcesses.list = async () => null;
    await assert.rejects(f.second.put('new-source', { code: 'unsafe' }), /não confirmado/);
    assert.equal((await f.store.lease(f.lease)).gitProcessPending, true);
    assert.equal((await f.store.budget.inventory()).reservations, 1);
  });
}

test('mesmo boot revalida a interrupção sob a trava antes de recuperar', async t => {
  const f = await fixture(t);
  recoveryBoot.read = async () => 1;
  processProbe.read = async () => ({ status: 'absent' });
  recoveryProcesses.list = async () => {
    const pendingFile = path.join(f.store.root, 'operation-pending.json');
    await atomic(pendingFile, { ...await read(pendingFile), at: f.interruptedAt + 1 });
    return [];
  };
  await assert.rejects(f.second.put('source', { ready: false }), /não confirmado/);
  assert.equal((await f.store.lease(f.lease)).gitProcessPending, true);
});

test('lista de Git do SO reconhece só a família git e marca início desconhecido', () => {
  const win = windowsGit(['git.exe|10|1793043600000', 'GitHubDesktop.exe|11|1', 'git-remote-https.exe|12|-1', ''].join('\r\n'));
  assert.deepEqual(win.map(r => r.name), ['git.exe', 'git-remote-https.exe']);
  assert.equal(win[0].born, 1793043600000);
  assert.ok(Number.isNaN(win[1].born));
  const now = 1793050000000;
  const posix = posixGit(['  10 01:05 /usr/bin/git', '  11 1-02:00:00 /Applications/GitHub Desktop.app/x/github',
    '  12 00:03 git-remote-https', ''].join('\n'), now);
  assert.deepEqual(posix.map(r => r.name), ['git', 'git-remote-https']);
  assert.equal(posix[0].born, now - 65000);
});
