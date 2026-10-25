import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-bounded-records-'));
process.env.FAROL_HOME = home;
const records = await import('../lib/technical-review/material-record.js');
const { queryPrepared } = await import('../lib/review-context/query.js');
const { diagnoseLegacy } = await import('../tools/diagnosticar-legados.js');
const root = path.join(home, 'workspace/state/technical-review');
fs.mkdirSync(root, { recursive: true });
after(() => fs.rmSync(home, { recursive: true, force: true }));
let sequence = 0;
function material() {
  const target = path.join(root, 'review-bounded' + sequence++);
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'snapshot'), 'preservado');
  records.createRecord(target, {});
  return target;
}
function substituteOnOpen(file, run) {
  const original = fs.openSync;
  fs.openSync = function (current, ...args) {
    const descriptor = original.call(this, current, ...args);
    if (current === file) { fs.renameSync(file, file + '.old'); fs.writeFileSync(file, '{}'); }
    return descriptor;
  };
  try { return run(); }
  finally { fs.openSync = original; }
}

test('registro de material acima do limite ou substituído não autoriza coleta do snapshot', () => {
  const target = material(), file = records.recordFile(target);
  substituteOnOpen(file, () => assert.equal(records.readRecord(target), null));
  fs.writeFileSync(file, ' '.repeat(65537));
  assert.equal(records.readRecord(target), null);
  assert.equal(fs.readFileSync(path.join(target, 'snapshot'), 'utf8'), 'preservado');
});

test('lease substituído e conclusão acima do limite são recusados sem liberar consumidor', () => {
  const target = material(); records.launchConsumer(target, 'worker');
  const record = records.readRecord(target), file = path.join(records.leaseDir(target), 'worker.json');
  substituteOnOpen(file, () => assert.deepEqual(records.consumerRecords(target, record), [null]));
  fs.writeFileSync(file, ' '.repeat(4097));
  assert.throws(() => records.finishBoundConsumer(target, 'worker'), /limite/);
  assert.ok(records.readRecord(target).consumers.includes('worker'));
  assert.equal(fs.existsSync(target), true);
});

test('consulta rejeita manifesto alterado antes de procurar fontes ou autorização', async () => {
  const file = path.join(home, 'query-source.json');
  fs.writeFileSync(file, '{"schema":1}');
  const result = substituteOnOpen(file, () => queryPrepared('tree', file));
  await assert.rejects(result, /substituído/);
  fs.writeFileSync(file, ' '.repeat(4 * 1024 ** 2 + 1));
  await assert.rejects(queryPrepared('tree', file), /limite/);
});

test('diagnóstico legado ignora arquivo de controle substituído sem remover a árvore', async () => {
  const target = path.join(root, 'review-legacy'), file = target + '-request.json';
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'snapshot'), 'legado preservado');
  fs.writeFileSync(file, '{"repo":"org/repo","head":"abc"}');
  const pending = substituteOnOpen(file, () => diagnoseLegacy(home, 0));
  const result = await pending;
  const item = result.items.find(item => item.id === 'review-legacy');
  assert.equal(item.requestIdentityAvailable, false);
  assert.equal(item.eligibleForRemoval, false);
  assert.equal(result.cleanupExecuted, false);
  assert.equal(fs.readFileSync(path.join(target, 'snapshot'), 'utf8'), 'legado preservado');
});
