import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, releaseLock, withLock, lockIo, lockLog } from '../lib/review-source/lock-file.js';
import { INSTANCE } from '../lib/review-source/instance.js';
import { recoveryBoot } from '../lib/review-source/recovery-boot.js';
import { processProbe } from '../lib/technical-review/material-process.js';
import { SourceStore } from '../lib/review-source/store.js';

const original = { boot: recoveryBoot.read, probe: processProbe.read, unlink: lockIo.unlink, link: lockIo.link, log: lockLog.write };
const DEAD = 999999;
async function fixture(t, { probe } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-lock-'));
  const logs = [];
  recoveryBoot.read = async () => 1;
  processProbe.read = probe || (async pid => (pid === process.pid ? { status: 'found', birth: 'eu' } : { status: 'absent' }));
  lockLog.write = (level, text) => logs.push({ level, text });
  t.after(async () => {
    Object.assign(recoveryBoot, { read: original.boot });
    Object.assign(processProbe, { read: original.probe });
    Object.assign(lockIo, { unlink: original.unlink, link: original.link });
    lockLog.write = original.log;
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, file: path.join(root, 'storage-budget.lock'), logs };
}
const owner = value => JSON.stringify({ schema: 1, instance: 'outra', pid: DEAD, birth: 'antes', at: Date.now(), ...value });

test('a trava nasce com o dono escrito e sai ao liberar', async t => {
  const { file } = await fixture(t);
  const lock = await acquireLock(file);
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(value.instance, INSTANCE);
  assert.equal(value.pid, process.pid);
  assert.ok(Number.isSafeInteger(value.at));
  assert.equal(await releaseLock(lock), true);
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(n => n.endsWith('.tmp')), []);
});

test('trava segurada por este processo não é tomada de dentro dele', async t => {
  const { file } = await fixture(t);
  const lock = await acquireLock(file);
  assert.equal(await acquireLock(file), null);
  await releaseLock(lock);
});

test('sobra deste processo (unlink recusado) é retomada na aquisição seguinte, sem mascarar o trabalho', async t => {
  const { file, logs } = await fixture(t);
  lockIo.unlink = async () => { const e = new Error('negado'); e.code = 'EPERM'; throw e; };
  assert.equal(await withLock(file, () => 'ocupado', async () => 'feito'), 'feito');
  assert.ok(logs.some(l => l.level === 'ERROR' && /EPERM/.test(l.text)), 'a causa do unlink recusado fica no log');
  await fs.access(file);
  lockIo.unlink = original.unlink;
  assert.equal(await withLock(file, () => 'ocupado', async () => 'de novo'), 'de novo');
  const evidence = JSON.parse(await fs.readFile(`${file}-recovered.json`, 'utf8'));
  assert.equal(evidence.proof, 'own-leftover');
  assert.ok(logs.some(l => l.level === 'WARN' && /own-leftover/.test(l.text)));
});

test('unlink recusado por instantes é repetido até sair', async t => {
  const { file } = await fixture(t);
  let tries = 0;
  lockIo.unlink = async target => { if (++tries < 3) { const e = new Error('ocupado'); e.code = 'EBUSY'; throw e; } return original.unlink(target); };
  const lock = await acquireLock(file);
  assert.equal(await releaseLock(lock), true);
  assert.equal(tries, 3);
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
});

test('dono de outro processo já encerrado tem a trava retomada com evidência', async t => {
  const { file } = await fixture(t);
  await fs.writeFile(file, owner());
  const lock = await acquireLock(file);
  assert.ok(lock);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).instance, INSTANCE);
  const evidence = JSON.parse(await fs.readFile(`${file}-recovered.json`, 'utf8'));
  assert.equal(evidence.proof, 'owner-ended');
  assert.equal(evidence.owner.pid, DEAD);
  await releaseLock(lock);
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter(n => n.includes('.orfa-')), []);
});

test('dono antigo sem nascimento registrado vale pelo pid ausente (writer.lock da 2.78.7)', async t => {
  const { file } = await fixture(t);
  await fs.writeFile(file, JSON.stringify({ schema: 1, instance: 'outra', pid: DEAD }));
  const lock = await acquireLock(file);
  assert.ok(lock);
  await releaseLock(lock);
});

for (const [caso, probe] of [
  ['vivo', async pid => (pid === process.pid ? { status: 'found', birth: 'eu' } : { status: 'found', birth: 'antes' })],
  ['sem resposta do SO', async pid => (pid === process.pid ? { status: 'found', birth: 'eu' } : { status: 'unknown' })],
]) {
  test(`dono de outro processo ${caso} mantém a trava intacta`, async t => {
    const { file } = await fixture(t, { probe });
    const raw = owner();
    await fs.writeFile(file, raw);
    assert.equal(await acquireLock(file), null);
    assert.equal(await fs.readFile(file, 'utf8'), raw);
    await assert.rejects(fs.access(`${file}-recovered.json`), { code: 'ENOENT' });
  });
}

test('trava sem dono legível só sai com boot posterior a ela, nunca por prazo', async t => {
  const { file } = await fixture(t);
  await fs.writeFile(file, '');
  const old = new Date(Date.now() - 3 * 3600e3);
  await fs.utimes(file, old, old);
  assert.equal(await acquireLock(file), null);
  assert.equal(await fs.readFile(file, 'utf8'), '');
  recoveryBoot.read = async () => Date.now() - 3600e3;
  const lock = await acquireLock(file);
  assert.ok(lock);
  assert.equal(JSON.parse(await fs.readFile(`${file}-recovered.json`, 'utf8')).proof, 'previous-system-boot');
  await releaseLock(lock);
});

test('sistema de arquivos sem link cai no open exclusivo com o dono escrito', async t => {
  const { file } = await fixture(t);
  lockIo.link = async () => { const e = new Error('sem link'); e.code = 'ENOTSUP'; throw e; };
  const lock = await acquireLock(file);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).pid, process.pid);
  assert.equal(await acquireLock(file), null);
  await releaseLock(lock);
});

test('quota global travada por processo morto não para a análise de outro repositório (27/10/2026)', async t => {
  const { root } = await fixture(t);
  const base = path.join(root, 'cache'), materialRoot = path.join(root, 'materials');
  await fs.mkdir(materialRoot, { recursive: true });
  const limits = { maxBytes: 200000, globalMaxBytes: 300000, reserveBytes: 1, globalReserveBytes: 1, acquisitionReserveBytes: 10000, monitorIntervalMs: 10 };
  const store = await new SourceStore({ host: 'github.com', account: 'a', repo: 'org/repo', repositoryId: 1 }, { root: base, materialRoot, limits }).initialize();
  await fs.writeFile(path.join(base, 'storage-budget.lock'), owner());
  await fs.writeFile(path.join(store.root, 'writer.lock'), JSON.stringify({ schema: 1, instance: 'outra', pid: DEAD }));
  await store.put('fonte', { code: 'ok' });
  assert.deepEqual(await store.get('fonte'), { code: 'ok' });
  await assert.rejects(fs.access(path.join(base, 'storage-budget.lock')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(store.root, 'writer.lock')), { code: 'ENOENT' });
});
