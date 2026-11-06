// A amostra do monitor mede só o próprio escopo, fora da trava global, e o inventário usa o tamanho
// gravado do material pronto. Medido em 06/11/2026: o scan completo sob a trava, a cada 250 ms, fazia as
// sessões prepararem em fila.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = fsSync.mkdtempSync(path.join(os.tmpdir(), 'farol-amostra-home-'));
process.env.FAROL_HOME = home;
after(() => fsSync.rmSync(home, { recursive: true, force: true }));
const { SourceStore } = await import('../lib/review-source/store.js');
const { storageInventory } = await import('../lib/review-source/storage-inventory.js');
const { createRecord, readRecord, ready, recordBytes, updateRecord } = await import('../lib/technical-review/material-record.js');

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-amostra-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = path.join(root, 'cache'), materialRoot = path.join(root, 'materials');
  await fs.mkdir(materialRoot);
  const limits = { maxBytes: 200000, globalMaxBytes: 300000, reserveBytes: 1, globalReserveBytes: 1,
    acquisitionReserveBytes: 10000, monitorIntervalMs: 10, ...overrides };
  const make = account => new SourceStore({ host: 'github.com', account, repo: 'org/repo', repositoryId: 1 }, { root: base, materialRoot, limits }).initialize();
  return { base, materialRoot, first: await make('first'), second: await make('second') };
}
// Conta as chamadas e, em cada uma, se a trava global existia naquele instante.
function espiar(budget, base) {
  const lock = path.join(base, 'storage-budget.lock');
  const calls = { scan: [], scanScope: [] };
  for (const name of ['scan', 'scanScope']) {
    const original = budget[name].bind(budget);
    budget[name] = async () => { calls[name].push(fsSync.existsSync(lock)); return original(); };
  }
  return calls;
}
async function editarEstado(base, change) {
  const file = path.join(base, 'storage-budget.json');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  change(state);
  await fs.writeFile(file, JSON.stringify(state));
}

test('amostra com inventário anterior válido mede só o escopo, fora da trava global', async t => {
  const { base, first, second } = await fixture(t);
  const id = await first.budget.reserve('git-acquisition', 10000);
  const calls = espiar(first.budget, base);
  await fs.writeFile(path.join(first.root, 'crescendo.tmp'), Buffer.alloc(4000));
  const inventory = await first.budget.sample(id);
  assert.deepEqual(calls.scan, [], 'o scan completo não roda na amostra');
  assert.deepEqual(calls.scanScope, [false], 'a medida do escopo acontece sem a trava global');
  assert.equal(inventory.scopes[path.basename(first.root)].acquisitionTemporaryBytes, 4000);
  assert.ok(path.basename(second.root) in inventory.scopes, 'os outros escopos vêm do inventário anterior');
  await first.budget.finish(id, false);
});

test('composição trata como estrangeiro o Git pendente de outro escopo gravado por outro processo', async t => {
  const { base, first, second } = await fixture(t);
  const id = await first.budget.reserve('git-acquisition', 10000);
  const outro = path.basename(second.root);
  // O processo que mediu era o dono do Git pendente e gravou foreignGitProcess falso; para este
  // processo o Git é alheio, e o órfão precisa da folga até o teto, como no scan completo.
  await editarEstado(base, state => Object.assign(state.lastInventory.scopes[outro], { pendingGitProcess: true, foreignGitProcess: false }));
  const state = JSON.parse(await fs.readFile(path.join(base, 'storage-budget.json'), 'utf8'));
  const composto = first.budget.composeInventory(state, await first.budget.scanScope());
  assert.equal(composto.scopes[outro].foreignGitProcess, true);
  assert.ok(first.budget.unconfirmedScopes(state, composto).has(outro));
  assert.equal(composto.scopes[path.basename(first.root)].foreignGitProcess, undefined, 'o próprio escopo vem da medida fresca');
  await first.budget.finish(id, false);
});

test('amostra recompõe managedBytes com o escopo fresco e o crescimento ainda reprova a quota', async t => {
  const { base, first } = await fixture(t, { globalMaxBytes: 70000 });
  const id = await first.budget.reserve('git-acquisition', 10000);
  const before = JSON.parse(await fs.readFile(path.join(base, 'storage-budget.json'), 'utf8')).lastInventory;
  const calls = espiar(first.budget, base);
  await fs.writeFile(path.join(first.root, 'grande.tmp'), Buffer.alloc(80000));
  await assert.rejects(first.budget.sample(id), /Quota global/);
  assert.deepEqual(calls.scan, [true], 'a recusa por espaço é conferida com o scan completo antes de valer');
  const after = await first.budget.inventory();
  assert.ok(after.managedBytes >= before.managedBytes + 80000);
  await first.budget.finish(id, true);
});

test('inventário anterior defasado para mais não derruba a aquisição: o scan completo confere', async t => {
  const { base, first } = await fixture(t, { globalMaxBytes: 70000 });
  const id = await first.budget.reserve('git-acquisition', 10000);
  // Outra admissão limpou espaço depois do último inventário gravado.
  await editarEstado(base, state => { state.lastInventory.unclassifiedBytes += 60000; });
  const calls = espiar(first.budget, base);
  const inventory = await first.budget.sample(id);
  assert.deepEqual(calls.scan, [true]);
  assert.ok(inventory.managedBytes < 60000);
  await first.budget.finish(id, false);
});

for (const [caso, change] of [
  ['sem inventário anterior', state => { delete state.lastInventory; }],
  ['com inventário ilegível', state => { state.lastInventory = { scopes: [] }; }],
  ['com inventário sem um dos totais', state => { delete state.lastInventory.controlBytes; }],
  ['com escopo de tamanho inválido', state => { Object.values(state.lastInventory.scopes)[0].bytes = 'muito'; }],
]) {
  test(`amostra ${caso} cai no scan completo, sob a trava`, async t => {
    const { base, first } = await fixture(t);
    const id = await first.budget.reserve('git-acquisition', 10000);
    await editarEstado(base, change);
    const calls = espiar(first.budget, base);
    const inventory = await first.budget.sample(id);
    assert.deepEqual(calls.scan, [true], 'o scan completo roda com a trava, como antes');
    assert.equal(typeof inventory.managedBytes, 'number');
    const saved = JSON.parse(await fs.readFile(path.join(base, 'storage-budget.json'), 'utf8'));
    assert.equal(saved.lastInventory.managedBytes, inventory.managedBytes, 'a amostra devolve o inventário íntegro ao estado');
    await first.budget.finish(id, false);
  });
}

test('reserva grava o inventário completo como base das amostras', async t => {
  const { base, first } = await fixture(t);
  assert.equal(fsSync.existsSync(path.join(base, 'storage-budget.json')), false);
  const id = await first.budget.reserve('git-acquisition', 10000);
  const saved = JSON.parse(await fs.readFile(path.join(base, 'storage-budget.json'), 'utf8'));
  assert.equal(typeof saved.lastInventory.managedBytes, 'number');
  assert.ok(path.basename(first.root) in saved.lastInventory.scopes);
  await first.budget.finish(id, false);
});

// Registro mínimo que o inventário reconhece como material gerenciado.
async function materialRegistrado(materialRoot, name, state, extra = {}) {
  const target = path.join(materialRoot, name);
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'codigo.js'), 'x'.repeat(500));
  await fs.writeFile(target + '-material.json', JSON.stringify({ schema: 1, id: name, state,
    owner: { instance: 'outra', pid: 1, birth: null }, consumers: [], ...extra }));
  return target;
}
test('material pronto com tamanho gravado não é percorrido; sem o campo, é', async t => {
  const { base, materialRoot } = await fixture(t);
  const pronto = await materialRegistrado(materialRoot, 'review-pronto', 'in-use', { bytes: 123456 });
  const antigo = await materialRegistrado(materialRoot, 'review-antigo', 'in-use');
  const removendo = await materialRegistrado(materialRoot, 'review-removendo', 'removal-pending', { bytes: 999999 });
  const preparando = await materialRegistrado(materialRoot, 'review-preparando', 'preparing', { bytes: 777777 });
  const inventory = await storageInventory(base, materialRoot);
  // 123456 do registro, e 500 percorridos de cada um dos outros três (o campo só vale em estado imutável).
  assert.equal(inventory.unregisteredManagedBytes, 123456 + 500 * 3);
  // Sem leitura da árvore: um arquivo novo no material pronto não muda a conta.
  await fs.writeFile(path.join(pronto, 'novo.js'), 'y'.repeat(100));
  await fs.writeFile(path.join(antigo, 'novo.js'), 'y'.repeat(100));
  assert.equal((await storageInventory(base, materialRoot)).unregisteredManagedBytes, 123456 + 500 * 3 + 100);
  assert.ok(removendo && preparando);
});
test('material anexado a lease usa o tamanho gravado; tamanho inválido cai na árvore', async t => {
  const { base, materialRoot, first } = await fixture(t);
  const lease = await first.acquire({});
  const pronto = await materialRegistrado(materialRoot, 'review-anexado', 'in-use', { bytes: 4242 });
  await first.attach(lease, pronto);
  let scope = (await storageInventory(base, materialRoot)).scopes[path.basename(first.root)];
  assert.equal(scope.activeMaterialBytes, 4242);
  await fs.writeFile(pronto + '-material.json', JSON.stringify({ schema: 1, id: 'review-anexado', state: 'in-use',
    owner: { instance: 'outra', pid: 1, birth: null }, consumers: [], bytes: -1 }));
  scope = (await storageInventory(base, materialRoot)).scopes[path.basename(first.root)];
  assert.equal(scope.activeMaterialBytes, 500);
});

test('ready grava o tamanho lógico do material; remoção iniciada impede a gravação', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-amostra-registro-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'review-tamanho');
  await fs.mkdir(path.join(target, 'src'), { recursive: true });
  await fs.writeFile(path.join(target, 'src', 'a.js'), 'a'.repeat(300));
  await fs.writeFile(path.join(target, 'b.js'), 'b'.repeat(200));
  createRecord(target, { repo: 'org/repo' });
  ready(target);
  assert.equal(await recordBytes(target), 500);
  const record = readRecord(target);
  assert.equal(record.state, 'in-use'); assert.equal(record.bytes, 500);
  assert.equal(typeof record.bytesMeasuredAt, 'number');
  updateRecord(target, r => ({ ...r, state: 'removal-pending', bytes: undefined }));
  await fs.writeFile(path.join(target, 'c.js'), 'c'.repeat(50));
  assert.equal(await recordBytes(target), null);
  assert.equal(readRecord(target).bytes, undefined);
});
