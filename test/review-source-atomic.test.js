import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomic, read } from '../lib/review-source/files.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-source-atomic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'lease.json');
  const previous = { state: 'active', terminationUnconfirmed: true };
  await atomic(file, previous);
  return { root, file, previous };
}

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`troca atômica recupera ${code} transitório sem perder proteção anterior`, async t => {
    const { root, file, previous } = await fixture(t);
    const rename = fs.rename.bind(fs);
    let calls = 0;
    t.mock.method(fs, 'rename', async (source, destination) => {
      calls++;
      assert.equal(destination, file);
      assert.deepEqual(await read(file), previous);
      assert.deepEqual(await read(source), { state: 'released' });
      if (calls <= 2) throw Object.assign(new Error('transitório'), { code });
      return rename(source, destination);
    });
    await atomic(file, { state: 'released' });
    assert.equal(calls, 3);
    assert.deepEqual(await read(file), { state: 'released' });
    assert.deepEqual(await fs.readdir(root), ['lease.json']);
  });
}

for (const code of ['EPERM', 'EIO']) {
  test(`falha ${code} permanente preserva bytes antigos e limpa somente temporário`, async t => {
    const { root, file } = await fixture(t);
    const previousBytes = await fs.readFile(file);
    const snapshot = path.join(root, 'snapshot.json');
    await fs.copyFile(file, snapshot);
    const failure = Object.assign(new Error('permanente'), { code });
    let calls = 0;
    t.mock.method(fs, 'rename', async () => { calls++; throw failure; });
    await assert.rejects(atomic(file, { state: 'released' }), error => error === failure);
    assert.equal(calls, code === 'EPERM' ? 5 : 1);
    assert.deepEqual(await fs.readFile(file), previousBytes);
    assert.deepEqual(await fs.readFile(snapshot), previousBytes);
    assert.deepEqual((await fs.readdir(root)).sort(), ['lease.json', 'snapshot.json']);
  });
}

test('falha de limpeza fica visível sem substituir erro primário do rename', async t => {
  const { root, file, previous } = await fixture(t);
  const primary = Object.assign(new Error('rename'), { code: 'EIO' });
  const cleanup = Object.assign(new Error('cleanup'), { code: 'EBUSY' });
  const remove = fs.rm.bind(fs);
  t.mock.method(fs, 'rename', async () => { throw primary; });
  t.mock.method(fs, 'rm', async (target, options) => {
    if (target.endsWith('.tmp')) throw cleanup;
    return remove(target, options);
  });
  await assert.rejects(atomic(file, { state: 'released' }), error => {
    assert.equal(error, primary);
    assert.equal(error.code, 'EIO');
    assert.deepEqual(error.cause.errors, [cleanup]);
    return true;
  });
  assert.deepEqual(await read(file), previous);
  assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.tmp')).length, 1);
});

test('sync, close e limpeza simultâneos preservam primeiro erro e todas as causas', async t => {
  const { file, previous } = await fixture(t);
  const syncError = Object.assign(new Error('sync'), { code: 'EIO' });
  const closeError = Object.assign(new Error('close'), { code: 'EBADF' });
  const cleanupError = Object.assign(new Error('cleanup'), { code: 'EBUSY' });
  const open = fs.open.bind(fs), remove = fs.rm.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    t.mock.method(handle, 'sync', async () => { throw syncError; });
    t.mock.method(handle, 'close', async () => { await close(); throw closeError; });
    return handle;
  });
  t.mock.method(fs, 'rm', async (target, options) => {
    if (target.endsWith('.tmp')) throw cleanupError;
    return remove(target, options);
  });
  await assert.rejects(atomic(file, { state: 'released' }), error => {
    assert.equal(error, syncError);
    assert.equal(error.code, 'EIO');
    assert.deepEqual(error.cause.errors[0].errors, [closeError]);
    assert.equal(error.cause.errors[1], cleanupError);
    return true;
  });
  assert.deepEqual(await read(file), previous);
});

test('limpeza que falha sozinha é propagada após troca bem sucedida', async t => {
  const { file } = await fixture(t);
  const cleanup = Object.assign(new Error('cleanup'), { code: 'EACCES' });
  const remove = fs.rm.bind(fs);
  t.mock.method(fs, 'rm', async (target, options) => {
    if (target.endsWith('.tmp')) throw cleanup;
    return remove(target, options);
  });
  await assert.rejects(atomic(file, { state: 'released' }), error => error === cleanup);
  assert.deepEqual(await read(file), { state: 'released' });
});
