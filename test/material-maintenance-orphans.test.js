// Os três vazamentos da manutenção de materiais medidos em 06/11/2026 (252 checkouts na raiz
// `technical-review`): legado sem registro, registro preso de dono morto, `sourceProcessPending`
// eterno, e o rodízio do `discover` gasto com lápides.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-material-orfaos-'));
process.env.FAROL_HOME = home;
const { STATE_DIR, HOME } = await import('../lib/paths.js');
const life = await import('../lib/technical-review/cleanup.js');
const records = await import('../lib/technical-review/material-record.js');
const { manager, POLICY } = await import('../lib/technical-review/material-maintenance.js');
const { processProbe } = await import('../lib/technical-review/material-process.js');
const { recoveryProcesses } = await import('../lib/review-source/recovery-owner.js');
const root = path.join(STATE_DIR, 'technical-review');
const originalProbe = processProbe.read, originalGit = recoveryProcesses.list;
const DIA = 24 * 60 * 60 * 1000;
after(() => { processProbe.read = originalProbe; recoveryProcesses.list = originalGit; fs.rmSync(home, { recursive: true, force: true }); });
beforeEach(() => {
  processProbe.read = async () => ({ status: 'absent' });
  recoveryProcesses.list = async () => [];
  manager().referenceState = () => 'unknown';
  manager().legacyAt = 0;
});

async function collectAll(rootDir = root) { for (let i = 0; i < 6; i++) await life.maintainMaterials({ root: rootDir }); }
function legado(diasAtras) {
  fs.mkdirSync(root, { recursive: true });
  const target = fs.mkdtempSync(path.join(root, 'review-'));
  fs.writeFileSync(path.join(target, 'codigo.js'), 'x');
  const when = new Date(Date.now() - diasAtras * DIA);
  fs.utimesSync(target, when, when);
  return target;
}
function leaseCitando(destination, extra = {}) {
  const dir = path.join(HOME, 'source-cache', 'a'.repeat(64), 'leases');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${path.basename(destination)}.json`);
  fs.writeFileSync(file, JSON.stringify({ schema: 1, id: path.basename(destination), state: 'active', destination, ...extra }));
  return file;
}
function deDonoMorto(state, extra = {}) {
  const target = life.criarMaterial(root, { repo: 'org/repo', account: 'eu', head: 'a'.repeat(40) });
  fs.writeFileSync(path.join(target, 'codigo.js'), 'x');
  records.updateRecord(target, r => ({ ...r, state, createdAt: Date.now() - 60 * 60 * 1000,
    owner: { ...r.owner, instance: 'anterior', pid: 99999999, birth: 'antigo' }, ...extra }));
  return target;
}

test('legado antigo sem lease sai pela fila com evidência no ledger', async () => {
  const target = legado(8);
  const before = await life.diagnosticoLegados();
  assert.equal(before.items.find(i => i.id === path.basename(target)).state, 'eligible');
  await collectAll();
  assert.equal(fs.existsSync(target), false);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'legacy-removals.json'), 'utf8'));
  const entry = ledger.items.find(i => i.id === path.basename(target));
  assert.equal(entry.proof, 'legacy-unreferenced');
  assert.ok(entry.modifiedAt <= Date.now() - 7 * DIA);
});
test('legado novo e legado citado por lease ficam', async () => {
  const novo = legado(6), citado = legado(30);
  const lease = leaseCitando(citado);
  try {
    const diag = await life.diagnosticoLegados();
    assert.equal(diag.items.find(i => i.id === path.basename(novo)).state, 'recent');
    assert.equal(diag.items.find(i => i.id === path.basename(citado)).state, 'referenced');
    await collectAll();
    assert.equal(fs.existsSync(novo), true);
    assert.equal(fs.existsSync(citado), true);
  } finally { fs.rmSync(lease, { force: true }); }
});
test('lease ilegível deixa o legado sem prova', async () => {
  const target = legado(30);
  const dir = path.join(HOME, 'source-cache', 'b'.repeat(64), 'leases');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'quebrada.json'), '{nao é json');
  try {
    assert.equal((await life.diagnosticoLegados()).items.find(i => i.id === path.basename(target)).state, 'unverified');
    await collectAll(); assert.equal(fs.existsSync(target), true);
  } finally { fs.rmSync(path.join(HOME, 'source-cache', 'b'.repeat(64)), { recursive: true, force: true }); }
  manager().legacyAt = 0; await collectAll(); assert.equal(fs.existsSync(target), false);
});
test('legado que ganhou registro depois da descoberta não é apagado', async () => {
  const target = legado(30), original = life.remocao.rm;
  const saved = POLICY.batchSize; POLICY.batchSize = 0; // descobre sem remover neste ciclo
  try {
    await life.maintainMaterials();
    assert.equal(manager().legacy.has(target), true);
    fs.writeFileSync(target + '-material.json', '{}');
    POLICY.batchSize = saved;
    await collectAll(); assert.equal(fs.existsSync(target), true);
  } finally { POLICY.batchSize = saved; life.remocao.rm = original; }
});
test('in-use e preparing de dono morto saem com evidência quando não há Git posterior', async () => {
  for (const state of ['in-use', 'preparing']) {
    const target = deDonoMorto(state);
    await collectAll();
    assert.equal(fs.existsSync(target), false, state);
    const record = records.readRecord(target);
    assert.equal(record.state, 'removed');
    assert.equal(record.recovered.proof, 'owner-ended-without-git');
    assert.equal(record.recovered.ownerPid, 99999999);
  }
});
test('dono vivo, dono sem resposta e referência ativa nunca liberam', async () => {
  const vivo = deDonoMorto('in-use');
  processProbe.read = async () => ({ status: 'found', birth: 'antigo' });
  await collectAll(); assert.equal(fs.existsSync(vivo), true);
  processProbe.read = async () => ({ status: 'unknown' });
  await collectAll(); assert.equal(fs.existsSync(vivo), true);
  processProbe.read = async () => ({ status: 'absent' });
  manager().referenceState = () => 'active';
  await collectAll(); assert.equal(fs.existsSync(vivo), true);
  manager().referenceState = () => 'unknown';
  await collectAll(); assert.equal(fs.existsSync(vivo), false);
});
test('material deste processo nunca é tocado pela prova de dono morto', async () => {
  const target = life.criarMaterial(root, { repo: 'org/repo', account: 'eu', head: 'a'.repeat(40) });
  records.updateRecord(target, r => ({ ...r, createdAt: 1 }));
  await collectAll();
  assert.equal(fs.existsSync(target), true);
  assert.equal(records.readRecord(target).recovered, undefined);
});
test('Git vivo nascido depois do corte, sem início ou sem lista seguram; Git anterior não', async () => {
  const target = deDonoMorto('in-use'), createdAt = records.readRecord(target).createdAt;
  for (const list of [async () => [{ name: 'git.exe', born: createdAt + 1000 }],
    async () => [{ name: 'git.exe', born: createdAt - 1000 }], // dentro da folga de 2 s
    async () => [{ name: 'git.exe', born: NaN }], async () => null]) {
    recoveryProcesses.list = list;
    await collectAll(); assert.equal(fs.existsSync(target), true);
    assert.equal(records.readRecord(target).state, 'in-use');
  }
  recoveryProcesses.list = async () => [{ name: 'git.exe', born: createdAt - 10_000 }];
  await collectAll(); assert.equal(fs.existsSync(target), false);
});
test('sourceProcessPending de dono morto é destravado com evidência e o material sai', async () => {
  const target = deDonoMorto('released', { consumers: [], sourceProcessPending: true });
  const createdAt = records.readRecord(target).createdAt;
  recoveryProcesses.list = async () => [{ name: 'git', born: createdAt + 5000 }];
  await collectAll();
  assert.equal(records.readRecord(target).sourceProcessPending, true);
  const lease = leaseCitando(target, { gitProcessPending: true });
  recoveryProcesses.list = async () => [];
  await collectAll();
  assert.equal(records.readRecord(target).sourceProcessPending, true, 'lease pendente fica com a recuperação do cache');
  fs.rmSync(lease, { force: true });
  await collectAll();
  const record = records.readRecord(target);
  assert.equal(fs.existsSync(target), false);
  assert.equal(record.sourceProcessPending, false);
  assert.equal(record.recovered.proof, 'owner-ended-without-git');
});
test('sourceProcessPending de dono vivo continua preso', async () => {
  const target = deDonoMorto('released', { consumers: [], sourceProcessPending: true });
  processProbe.read = async () => ({ status: 'found', birth: 'antigo' });
  await collectAll();
  assert.equal(fs.existsSync(target), true);
  assert.equal(records.readRecord(target).sourceProcessPending, true);
});
test('lápides não gastam o rodízio do discover', async () => {
  const other = path.join(STATE_DIR, 'tr-lapides');
  fs.mkdirSync(other, { recursive: true });
  for (let i = 0; i < 64; i++) {
    const t = life.criarMaterial(other, {});
    records.updateRecord(t, r => ({ ...r, state: 'removed' }));
    fs.rmSync(t, { recursive: true, force: true });
  }
  for (let i = 0; i < 4; i++) await life.maintainMaterials({ root: other });
  assert.equal(manager(other).removed.size, 64);
  const target = life.criarMaterial(other, {});
  records.updateRecord(target, r => ({ ...r, state: 'released', consumers: [], owner: { ...r.owner, instance: 'anterior' } }));
  await life.maintainMaterials({ root: other }); // um ciclo só: o rodízio vê apenas o que não é lápide
  assert.equal(fs.existsSync(target), false);
});
