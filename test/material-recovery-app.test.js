import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-material-app-recovery-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');
const life = await import('../lib/technical-review/cleanup.js');
const records = await import('../lib/technical-review/material-record.js');
const { processProbe } = await import('../lib/technical-review/material-process.js');
const { materialReferenceState } = await import('../lib/technical-review/material-session-proof.js');
const originalProbe = processProbe.read;
const root = path.join(STATE_DIR, 'technical-review'), H = 'a'.repeat(40);
after(() => { life.pararManutencaoMaterial(); processProbe.read = originalProbe; fs.rmSync(home, { recursive: true, force: true }); });
function interrupted() {
  const snapshot = life.criarMaterial(root, { repo: 'org/repo', prKey: 'org/repo#7', account: 'fixture', head: H });
  fs.writeFileSync(path.join(snapshot, 'source.js'), 'durável somente até liberação');
  fs.writeFileSync(snapshot + '-result.json', 'resultado durável');
  records.updateRecord(snapshot, r => ({ ...r, createdAt: 100, owner: { ...r.owner, instance: 'previous', pid: 99999999, birth: 'old' } }));
  return snapshot;
}
function concluded(extra = {}) {
  return { key: 'org/repo#7', pr: { repo: 'org/repo', number: 7, account: 'fixture' }, headSha: H,
    status: 'posted', resolvedAt: 200, ...extra };
}
async function startApp(decisions = []) {
  life.pararManutencaoMaterial();
  const engine = new Engine();
  engine.decisions = { pending: [], resolved: decisions };
  engine.migrarIgnorados = () => {};
  engine.checkUpdate = engine.doctor = engine.check = async () => {};
  engine.inflightRecuperado = [];
  await engine.start();
  return engine;
}
async function collect() { for (let i = 0; i < 3; i++) await life.maintainMaterials(); }

test('boot real conecta prova de decisão final e coleta interrupção sem apagar resultado durável', async () => {
  processProbe.read = async () => ({ status: 'absent' });
  const snapshot = interrupted();
  await startApp([concluded()]); await collect();
  assert.equal(fs.existsSync(snapshot), false);
  assert.equal(records.readRecord(snapshot).state, 'removed');
  assert.equal(fs.readFileSync(snapshot + '-result.json', 'utf8'), 'resultado durável');
});
test('sessão ativa, fila e retomada continuam protegendo material mesmo com decisão concluída', async () => {
  processProbe.read = async () => ({ status: 'absent' });
  const engine = await startApp([concluded()]);
  const snapshot = interrupted();
  engine.activeReviews.set('running', { id: 'running', keys: ['org/repo#7'] });
  await collect(); assert.equal(fs.existsSync(snapshot), true);
  engine.activeReviews.clear(); engine.headlessQueue.push({ key: 'org/repo#7' });
  await collect(); assert.equal(fs.existsSync(snapshot), true);
  engine.headlessQueue.length = 0; engine.retomadas.set('org/repo#7', { knownHead: H });
  await collect(); assert.equal(fs.existsSync(snapshot), true);
  engine.retomadas.clear(); await collect(); assert.equal(fs.existsSync(snapshot), false);
});
test('ausência de desfecho inclusive autoanálise não rastreada permanece desconhecida', async () => {
  processProbe.read = async () => ({ status: 'absent' });
  const snapshot = interrupted(); await startApp(); await collect();
  assert.equal(fs.existsSync(snapshot), true);
});
test('prova positiva exige mesmo PR, head, conta e desfecho posterior à preparação', async () => {
  const engine = await startApp();
  const record = records.readRecord(interrupted());
  const invalid = [concluded({ key: 'org/repo#8' }), concluded({ headSha: 'b'.repeat(40) }),
    concluded({ pr: { repo: 'org/repo', number: 7, account: 'outra' } }), concluded({ resolvedAt: 99 }),
    concluded({ status: 'superseded' }), concluded({ status: 'skipped' })];
  for (const item of invalid) {
    engine.decisions.resolved = [item];
    assert.equal(materialReferenceState(engine, record), 'unknown');
  }
  engine.decisions.resolved = [concluded()]; assert.equal(materialReferenceState(engine, record), 'ended');
});
test('decisão final nunca dispensa prova do SO sobre proprietário e consumidores', async () => {
  processProbe.read = async () => ({ status: 'unknown' });
  const snapshot = interrupted(); await startApp([concluded()]); await collect();
  assert.equal(fs.existsSync(snapshot), true);
  processProbe.read = async () => ({ status: 'absent' }); await collect(); assert.equal(fs.existsSync(snapshot), false);
  const other = life.criarMaterial(root, { repo: 'org/repo', prKey: 'org/repo#7', account: 'fixture', head: H });
  processProbe.read = async () => ({ status: 'found', birth: 'child-birth' });
  records.launchConsumer(other, 'child'); await records.bindConsumer(other, 'child');
  records.updateRecord(other, r => ({ ...r, createdAt: 100, owner: { ...r.owner, instance: 'previous', pid: 99999999, birth: 'old' } }));
  processProbe.read = async pid => pid === 99999999 ? { status: 'absent' } : { status: 'found', birth: 'child-birth' };
  await collect(); assert.equal(fs.existsSync(other), true);
  processProbe.read = async () => ({ status: 'absent' }); await collect(); assert.equal(fs.existsSync(other), false);
});
test('manifesto anterior aproveita PR do sourceReference e referências inválidas falham fechadas', async () => {
  const engine = await startApp([concluded()]), record = records.readRecord(interrupted());
  delete record.context.prKey;
  assert.equal(materialReferenceState(engine, record), 'unknown');
  record.sourceReference = { scope: { repo: 'org/repo', number: 7 } };
  assert.equal(materialReferenceState(engine, record), 'ended');
  engine.retomadas = null; assert.equal(materialReferenceState(engine, record), 'unknown');
});
