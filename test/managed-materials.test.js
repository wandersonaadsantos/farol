import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { envGitLimpo } from './helpers/git-limpo.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-managed-materials-'));
process.env.FAROL_HOME = home;
const { STATE_DIR, IS_WIN } = await import('../lib/paths.js');
const root = path.join(STATE_DIR, 'technical-review');
const life = await import('../lib/technical-review/cleanup.js');
const records = await import('../lib/technical-review/material-record.js');
const { manager, enqueue } = await import('../lib/technical-review/material-maintenance.js');
const { processProbe } = await import('../lib/technical-review/material-process.js');
after(() => { life.pararManutencaoMaterial(); fs.rmSync(home, { recursive: true, force: true }); });

function material() {
  const target = life.criarMaterial(root, { repo: 'org/repo', account: 'eu', head: 'a'.repeat(40), base: 'b'.repeat(40), sessionId: 'review-fixture' });
  fs.writeFileSync(path.join(target, 'codigo.js'), 'export const x = 1;');
  return target;
}
async function collectAll(now = Date.now()) {
  for (let i = 0; i < 5; i++) await life.maintainMaterials({ now });
}
test('conclusão libera idempotentemente e preserva evidências duráveis', async () => {
  const snapshot = material();
  fs.writeFileSync(snapshot + '-request.json', '{}');
  fs.writeFileSync(snapshot + '-result.json', 'evidência');
  const before = records.readRecord(snapshot);
  assert.equal(before.schema, 1); assert.equal(before.context.repo, 'org/repo');
  assert.equal(before.owner.sessionId, 'review-fixture');
  await life.cleanup({ snapshot }); await life.cleanup({ snapshot });
  assert.equal(fs.existsSync(snapshot), false);
  assert.equal(fs.existsSync(snapshot + '-request.json'), false);
  assert.equal(fs.readFileSync(snapshot + '-result.json', 'utf8'), 'evidência');
  assert.equal(records.readRecord(snapshot).state, 'removed');
});
test('cancelamento não remove material enquanto houver consumidor de processo', async () => {
  const snapshot = material();
  records.launchConsumer(snapshot, 'worker');
  await life.cleanup({ snapshot }); await collectAll();
  assert.equal(fs.existsSync(path.join(snapshot, 'codigo.js')), true);
  assert.equal(records.readRecord(snapshot).consumers.includes('worker'), true);
  records.releaseConsumer(snapshot, 'worker'); enqueue(snapshot);
  await collectAll(); assert.equal(fs.existsSync(snapshot), false);
});
test('retenção repetida do mesmo consumidor não duplica referências', async () => {
  const snapshot = material();
  life.retain(snapshot, 'leitor'); life.retain(snapshot, 'leitor');
  assert.deepEqual(records.readRecord(snapshot).consumers, ['session', 'leitor']);
  await life.cleanup({ snapshot });
  assert.equal(fs.existsSync(snapshot), true);
  records.release(snapshot, 'leitor'); enqueue(snapshot);
  await collectAll(); assert.equal(fs.existsSync(snapshot), false);
});
test('aquisição repetida da mesma sessão é estável e rejeita mudança de identidade', async () => {
  const snapshot = material();
  const again = life.criarMaterial(root, { sessionId: 'review-fixture', repo: 'org/repo', head: 'a'.repeat(40) });
  assert.equal(again, snapshot);
  assert.throws(() => life.criarMaterial(root, { sessionId: 'review-fixture', head: 'c'.repeat(40) }), /identidade/);
  await life.cleanup({ snapshot });
});
test('arquivo preso gera retry persistido e coleta posterior sem outra revisão', async () => {
  const snapshot = material(), original = life.remocao.rm;
  let blocked = true;
  life.remocao.rm = async (target, options) => {
    if (target === snapshot && blocked) throw Object.assign(new Error('preso'), { code: 'EPERM' });
    return original(target, options);
  };
  try {
    await life.cleanup({ snapshot });
    const pending = records.readRecord(snapshot);
    assert.equal(pending.state, 'removal-pending'); assert.equal(pending.lastFailure.code, 'EPERM');
    assert.ok(pending.retryAt > Date.now()); assert.equal(fs.existsSync(snapshot), true);
    manager().queue.clear(); // Simula perda da fila volátil, mantendo a prova durável.
    blocked = false; await collectAll(pending.retryAt + 1);
    assert.equal(fs.existsSync(snapshot), false); assert.equal(records.readRecord(snapshot).state, 'removed');
  } finally { life.remocao.rm = original; }
});
test('arquivo realmente aberto sem compartilhamento de exclusão no Windows é preservado até liberar', { skip: !IS_WIN }, async () => {
  const snapshot = material(), locked = path.join(snapshot, 'codigo.js');
  const entered = path.join(home, 'lock-ready'), resume = path.join(home, 'lock-release');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `$ErrorActionPreference='Stop';$f=[IO.File]::Open(${quote(locked)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[IO.File]::WriteAllText(${quote(entered)},'ok');while(-not [IO.File]::Exists(${quote(resume)})){Start-Sleep -Milliseconds 10}}finally{$f.Dispose()}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' });
  const finished = new Promise(resolve => child.once('exit', resolve));
  try {
    const limit = Date.now() + 10000;
    while (!fs.existsSync(entered) && child.exitCode === null && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.existsSync(entered), true);
    await life.cleanup({ snapshot });
    assert.equal(fs.existsSync(locked), true); assert.equal(records.readRecord(snapshot).state, 'removal-pending');
    const retryAt = records.readRecord(snapshot).retryAt;
    fs.writeFileSync(resume, 'ok'); assert.equal(await finished, 0);
    await collectAll(retryAt + 1); assert.equal(fs.existsSync(snapshot), false);
  } finally { if (child.exitCode === null) child.kill(); }
});
test('remoção extensa é aguardada sem bloquear o loop e consumidor novo é recusado após liberação', async () => {
  const snapshot = material(), original = life.remocao.rm;
  let finish, begun;
  const started = new Promise(resolve => { begun = resolve; });
  life.remocao.rm = async (target, options) => {
    if (target === snapshot) { begun(); await new Promise(resolve => { finish = resolve; }); }
    return original(target, options);
  };
  try {
    const pending = life.cleanup({ snapshot }); await started;
    let ticked = false; await new Promise(resolve => setImmediate(() => { ticked = true; resolve(); }));
    assert.equal(ticked, true); assert.equal(fs.existsSync(snapshot), true);
    assert.throws(() => life.retain(snapshot, 'novo'), /não aceita/);
    finish(); await pending; assert.equal(fs.existsSync(snapshot), false);
  } finally { life.remocao.rm = original; }
});
test('reinício não presume preparação interrompida abandonada por PID ou prazo', async () => {
  const snapshot = material(), original = processProbe.read;
  records.updateRecord(snapshot, r => ({ ...r, owner: { ...r.owner, instance: 'anterior', pid: 99999999, birth: 'antigo' }, createdAt: 1 }));
  processProbe.read = async () => ({ status: 'absent' });
  try {
    await collectAll(Number.MAX_SAFE_INTEGER);
    assert.equal(fs.existsSync(snapshot), true);
    manager().referenceState = () => 'ended';
    await collectAll(); assert.equal(fs.existsSync(snapshot), false);
  } finally { processProbe.read = original; manager().referenceState = () => 'unknown'; }
});
test('PID reutilizado não se confunde com proprietário vivo e referências ainda protegem a sessão', async () => {
  const snapshot = material(), original = processProbe.read;
  records.updateRecord(snapshot, r => ({ ...r, owner: { ...r.owner, instance: 'anterior', pid: 1234, birth: 'antes' } }));
  processProbe.read = async () => ({ status: 'found', birth: 'depois' });
  try {
    manager().referenceState = () => 'active'; await collectAll(); assert.equal(fs.existsSync(snapshot), true);
    manager().referenceState = () => 'ended'; await collectAll(); assert.equal(fs.existsSync(snapshot), false);
  } finally { processProbe.read = original; manager().referenceState = () => 'unknown'; }
});
test('filho ainda vivo ou não identificável protege material após morte do proprietário', async () => {
  const snapshot = material(), original = processProbe.read;
  records.launchConsumer(snapshot, 'filho');
  processProbe.read = async () => ({ status: 'unknown' });
  await records.bindConsumer(snapshot, 'filho');
  records.updateRecord(snapshot, r => ({ ...r, owner: { ...r.owner, instance: 'anterior', pid: 1234, birth: 'antigo' } }));
  processProbe.read = async pid => pid === 1234 ? { status: 'absent' } : { status: 'unknown' };
  try {
    manager().referenceState = () => 'ended'; await collectAll(); assert.equal(fs.existsSync(snapshot), true);
    processProbe.read = async () => ({ status: 'absent' });
    // A consulta inicial sem identidade de criação não vira prova de morte do filho.
    await collectAll(); assert.equal(fs.existsSync(snapshot), true);
    records.finishBoundConsumer(snapshot, 'filho');
    await collectAll(); assert.equal(fs.existsSync(snapshot), false);
  } finally { processProbe.read = original; manager().referenceState = () => 'unknown'; }
});
test('consumidor com identidade viva protege árvore após morte do proprietário', async () => {
  const snapshot = material(), original = processProbe.read;
  processProbe.read = async () => ({ status: 'found', birth: 'filho-atual' });
  records.launchConsumer(snapshot, 'filho-vivo'); await records.bindConsumer(snapshot, 'filho-vivo');
  records.updateRecord(snapshot, r => ({ ...r, owner: { ...r.owner, instance: 'anterior', pid: 1234, birth: 'dono-antigo' } }));
  try {
    processProbe.read = async pid => pid === 1234 ? { status: 'absent' } : { status: 'found', birth: 'filho-atual' };
    manager().referenceState = () => 'ended'; await collectAll(); assert.equal(fs.existsSync(snapshot), true);
    processProbe.read = async () => ({ status: 'absent' });
    await collectAll(); assert.equal(fs.existsSync(snapshot), false);
  } finally { processProbe.read = original; manager().referenceState = () => 'unknown'; }
});
test('legados sem manifesto são diagnosticados e nunca apagados automaticamente', async () => {
  const legacy = fs.mkdtempSync(path.join(root, 'review-'));
  fs.writeFileSync(path.join(legacy, 'preservar'), 'dados');
  const diagnostic = await life.diagnosticoLegados({ references: [legacy] });
  assert.equal(diagnostic.items.find(i => i.id === path.basename(legacy)).state, 'referenced');
  assert.equal(await life.cleanup({ snapshot: legacy }), false); await collectAll();
  assert.equal(fs.readFileSync(path.join(legacy, 'preservar'), 'utf8'), 'dados');
});
test('manutenção inicia sem outra revisão e recupera remoção pendente', async () => {
  const snapshot = material();
  records.release(snapshot);
  const stop = life.iniciarManutencaoMaterial({ intervalMs: 5 });
  try {
    const limit = Date.now() + 2000;
    while (fs.existsSync(snapshot) && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(fs.existsSync(snapshot), false);
  } finally { stop(); }
});
test('worker real registra consumo e liberação espera sua conclusão', async () => {
  const snapshot = material(), id = 'worker-real';
  const fixture = fs.mkdtempSync(path.join(home, 'avaliador-'));
  fs.mkdirSync(path.join(fixture, 'dist'));
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
  const entered = path.join(fixture, 'entrou'), resume = path.join(fixture, 'continuar');
  fs.writeFileSync(path.join(fixture, 'dist/index.js'), `import fs from 'node:fs';
export const parseDeclaration=async()=>({scopes:[]});export const loadBundledCatalog=async()=>({});
export const validarAssessment=x=>x;export const renderExcerpt=()=>'';
export async function runAudit(){fs.writeFileSync(${JSON.stringify(entered)},'ok');
 await new Promise(resolve=>{const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(resume)})){clearInterval(t);resolve();}},5)});
 return {catalogFingerprint:'fixture',rules:[]};}`);
  records.launchConsumer(snapshot, id);
  const request = snapshot + '-request.json';
  fs.writeFileSync(request, JSON.stringify({ snapshot, toolHome: fixture, profile: { declaration: {} }, materialConsumer: id, repo: 'org/repo', head: 'a'.repeat(40), base: 'b'.repeat(40) }));
  const child = spawn(process.execPath, ['lib/technical-review/worker.js', request], { cwd: process.cwd(), env: { ...process.env, FAROL_HOME: home }, windowsHide: true, stdio: 'pipe' });
  const finished = new Promise(resolve => child.once('exit', code => resolve(code)));
  try {
    const limit = Date.now() + 10000;
    while (!fs.existsSync(entered) && child.exitCode === null && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.existsSync(entered), true);
    const consumer = records.consumerRecords(snapshot, records.readRecord(snapshot))[0];
    assert.equal(consumer.pid, child.pid); assert.equal(consumer.pending, false);
    await life.cleanup({ snapshot }); assert.equal(fs.existsSync(snapshot), true);
    fs.writeFileSync(resume, 'ok'); assert.equal(await finished, 0);
    assert.equal(records.consumerRecords(snapshot, records.readRecord(snapshot))[0].ended, true);
    records.releaseConsumer(snapshot, id); enqueue(snapshot); await collectAll();
    assert.equal(fs.existsSync(snapshot), false);
  } finally { if (child.exitCode === null) child.kill(); }
});
test('material técnico usa lease próprio e liberar sua árvore mantém a fonte da review', async () => {
  const { SourceStore } = await import('../lib/review-source/store.js');
  const { GitSource } = await import('../lib/review-source/git.js');
  const { snapshotFor } = await import('../lib/technical-review/material.js');
  const io = (await import('../lib/io.js')).default;
  const origin = fs.mkdtempSync(path.join(home, 'git-local-'));
  const git = args => execFileSync('git', args, { cwd: origin, env: envGitLimpo(), encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  fs.writeFileSync(path.join(origin, 'codigo.js'), 'export const x = 1;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'base']); const base = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(origin, 'codigo.js'), 'export const x = 2;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'head']); const head = git(['rev-parse', 'HEAD']);
  const original = io.run, scope = { host: 'github.com', account: 'fixture', repo: 'org/repo', repositoryId: 123 };
  const store = await new SourceStore(scope, { limits: { reserveBytes: 1 } }).initialize();
  const parentLease = await store.acquire({ H: head, B: base, M: base });
  const engine = { accountForPr: () => 'fixture', ghEnv: () => ({}) };
  let technicalLease, fetches = 0;
  io.run = async (command, args, options) => {
    if (command !== 'git') return original(command, args, options);
    if (args.includes('fetch')) fetches++;
    return original(command, args.map(a => a === 'https://github.com/org/repo.git' ? origin : a), { ...options, env: envGitLimpo() });
  };
  try {
    const parentGit = new GitSource(engine, store, parentLease, { head, base, mergeBase: base });
    await parentGit.prepare();
    const sources = { status: 'complete', retain: async () => {
      technicalLease = await store.acquire({ H: head, B: base, M: base });
      const source = new GitSource(engine, store, technicalLease, { head, base, mergeBase: base });
      return { status: 'complete', manifest: { H: head, B: base, M: base, scope }, reference: { schema: 1, scope, leaseId: technicalLease },
        materialize: destination => source.materialize(destination), release: async () => {} };
    } };
    const snapshot = await snapshotFor(engine, { repo: 'org/repo', number: 1 }, { head, base }, { sources, sessionId: 'source-integration' });
    assert.equal(fs.readFileSync(path.join(snapshot, 'codigo.js'), 'utf8'), 'export const x = 2;\n');
    assert.equal(fetches, 1); assert.equal(records.readRecord(snapshot).sourceReference.leaseId, technicalLease);
    await life.cleanup({ snapshot });
    assert.equal(fs.existsSync(snapshot), false);
    assert.equal((await store.lease(technicalLease)).state, 'released');
    assert.equal((await store.lease(parentLease)).state, 'active');
    assert.equal((await parentGit.run(['show', `${head}:codigo.js`])).trim(), 'export const x = 2;');
    await parentGit.release(); await store.release(parentLease);
  } finally { io.run = original; }
});
test('abort do avaliador sem confirmação de término conserva lease e material', async () => {
  const { audit } = await import('../lib/technical-review/runtime.js');
  const snapshot = material(), controller = new AbortController();
  const fixture = fs.mkdtempSync(path.join(home, 'avaliador-abort-'));
  fs.mkdirSync(path.join(fixture, 'dist')); fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
  const entered = path.join(fixture, 'entrou');
  fs.writeFileSync(path.join(fixture, 'dist/index.js'), `import fs from 'node:fs';
export const parseDeclaration=async()=>({scopes:[]});export const loadBundledCatalog=async()=>({});
export const validarAssessment=x=>x;export const renderExcerpt=()=>'';
export async function runAudit(){fs.writeFileSync(${JSON.stringify(entered)},'ok');await new Promise(resolve=>setTimeout(resolve,20000));return {catalogFingerprint:'fixture',rules:[]};}`);
  const evaluating = audit({ snapshot, toolHome: fixture, profile: { declaration: {} }, repo: 'org/repo',
    head: 'a'.repeat(40), base: 'b'.repeat(40), signal: controller.signal });
  const caught = evaluating.catch(error => error);
  const limit = Date.now() + 10000;
  while (!fs.existsSync(entered) && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(entered), true);
  controller.abort(); assert.match((await caught).message, /não concluiu/);
  await life.cleanup({ snapshot });
  assert.equal(fs.existsSync(snapshot), true);
  const record = records.readRecord(snapshot);
  assert.equal(record.consumers.length, 1); assert.equal(record.lastFailure.code, 'CONSUMER_TERMINATION_UNVERIFIED');
  await collectAll(); assert.equal(fs.existsSync(snapshot), true);
});
test('link de material para diretório externo é recusado e link interno não remove seu destino', async () => {
  const external = fs.mkdtempSync(path.join(home, 'externo-'));
  fs.writeFileSync(path.join(external, 'preservar'), 'externo');
  const target = path.join(root, 'review-link');
  fs.symlinkSync(external, target, 'junction');
  assert.throws(() => life.cleanup({ snapshot: target }), /não corresponde/);
  const snapshot = material(); fs.symlinkSync(external, path.join(snapshot, 'link'), 'junction');
  await life.cleanup({ snapshot });
  assert.equal(fs.readFileSync(path.join(external, 'preservar'), 'utf8'), 'externo');
  assert.throws(() => life.cleanup({ snapshot: home }), /fora da área/);
});
