import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-technical-life-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { STATE_DIR } = await import('../lib/paths.js');
const { cleanup } = await import('../lib/technical-review/cleanup.js');
const { finishTechnicalReview } = await import('../lib/technical-review/runtime.js');
const { snapshotFor } = await import('../lib/technical-review/material.js');
const { reviewSnapshot } = await import('../lib/technical-review/reviews.js');
const { setup } = await import('../lib/technical-review/setup.js');
const { TOOL } = await import('../lib/technical-review/verdict.js');
const io = (await import('../lib/io.js')).default;
after(() => fs.rmSync(root, { recursive: true, force: true }));
const snapshots = path.join(STATE_DIR, 'technical-review');

test('falha de materialização apaga a cópia parcial e não retém objetos Git', async () => {
  const original = io.run;
  io.run = async (_command, args) => ({ ok: !args.includes('fetch'), stdout: '' });
  try {
    await assert.rejects(snapshotFor({ accountForPr: () => 'eu', ghEnv: () => ({}) }, { repo: 'org/repo' }, { base: 'base', head: 'head' }), /preparar/);
    assert.deepEqual(fs.readdirSync(snapshots), []);
  } finally { io.run = original; }
});

test('avaliação que falha remove a árvore e o pedido, preservando só a evidência', async () => {
  fs.mkdirSync(snapshots, { recursive: true });
  const snapshot = fs.mkdtempSync(path.join(snapshots, 'review-'));
  fs.writeFileSync(path.join(snapshot, 'privado.js'), 'material privado');
  fs.writeFileSync(`${snapshot}-request.json`, '{}');
  fs.writeFileSync(`${snapshot}-result.json`, '{}');
  const result = await finishTechnicalReview({ snapshot, toolHome: path.join(root, 'ausente') }, []);
  assert.equal(result.verdict, 'not-run');
  assert.equal(fs.existsSync(snapshot), false);
  assert.equal(fs.existsSync(`${snapshot}-request.json`), false);
  assert.equal(fs.existsSync(`${snapshot}-result.json`), true);
  cleanup({ snapshot }); // Reentrada do finally da sessão é segura.
  assert.throws(() => cleanup({ snapshot: root }), /fora da área/);
  assert.equal(fs.existsSync(root), true);
});

test('intervenção da própria conta e achado de ferramenta invalidam o histórico', async () => {
  const original = io.run;
  let entries = [];
  io.run = async () => ({ ok: true, stdout: JSON.stringify([entries]) });
  const engine = { accountForPr: () => 'eu', ghEnv: () => ({}) };
  const pr = { repo: 'org/repo', number: 1 };
  try {
    const initial = await reviewSnapshot(engine, pr);
    entries = [{ id: 1, user: { login: 'eu', type: 'User' }, state: 'CHANGES_REQUESTED', body: 'A alteração viola o contrato.' }];
    const manual = await reviewSnapshot(engine, pr);
    assert.notEqual(manual.fingerprint, initial.fingerprint);
    assert.equal(manual.reviews[0].author, 'eu');
    entries.push({ id: 2, user: { login: 'checker[bot]', type: 'Bot' }, body: 'Contraprova reproduzível.' });
    const automated = await reviewSnapshot(engine, pr);
    assert.notEqual(automated.fingerprint, manual.fingerprint);
    assert.equal(automated.comments.length, 2);
  } finally { io.run = original; }
});

test('instalação interrompida pode ser refeita e preserva a cópia anterior', async () => {
  const home = path.join(root, 'toolchains', 'eng-behaviour@0.17.0');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'anterior.txt'), 'preservar');
  const verify = async directory => {
    assert.equal(fs.readFileSync(path.join(directory, TOOL.buildStamp), 'utf8').trim(), TOOL.commit);
    return directory;
  };
  let fail = true;
  const run = (binary, args, cwd) => {
    if (binary === 'pnpm' && fail) throw new Error('download interrompido');
    if (args.includes('build')) fs.mkdirSync(path.join(cwd, 'dist'), { recursive: true });
  };
  await assert.rejects(setup(['--source', 'fixture'], { home, run, verify }), /download interrompido/);
  assert.equal(fs.readFileSync(path.join(home, 'anterior.txt'), 'utf8'), 'preservar');
  assert.equal(fs.readdirSync(path.dirname(home)).some(name => name.startsWith('.install-')), false);
  fail = false;
  assert.equal(await setup(['--source', 'fixture'], { home, run, verify }), home);
  const backup = fs.readdirSync(path.dirname(home)).find(name => name.includes('.incomplete-'));
  assert.equal(fs.readFileSync(path.join(path.dirname(home), backup, 'anterior.txt'), 'utf8'), 'preservar');
  let reran = false;
  await setup([], { home, verify, run: () => { reran = true; } });
  assert.equal(reran, false, 'a instalação completa não é refeita');
});
