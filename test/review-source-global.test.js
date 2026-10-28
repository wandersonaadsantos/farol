import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SourceStore } from '../lib/review-source/store.js';
import { StorageBudget } from '../lib/review-source/storage-budget.js';
import { scopeInventory } from '../lib/review-source/storage-inventory.js';
import { envGitLimpo } from './helpers/git-limpo.js';
import io from '../lib/io.js';
import { recoveryProcesses } from '../lib/review-source/recovery-owner.js';
import { processProbe } from '../lib/technical-review/material-process.js';

// SO simulado por teste: dono de outro PID ausente e lista de Git controlada.
function soSimulado(t, git) {
  const original = { list: recoveryProcesses.list, read: processProbe.read };
  recoveryProcesses.list = async () => git;
  processProbe.read = async pid => (pid === process.pid ? { status: 'found', birth: new Date(Math.round(performance.timeOrigin)).toISOString() } : { status: 'absent' });
  t.after(() => { recoveryProcesses.list = original.list; processProbe.read = original.read; });
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', env: envGitLimpo(), windowsHide: true }).trim();
const runtime = { head, node: process.version, arch: process.arch, platform: process.platform, concurrency: 1 };
async function fixture(t, overrides = {}) {
  t.diagnostic(JSON.stringify(runtime));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-global-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = path.join(root, 'cache'), materialRoot = path.join(root, 'materials');
  await fs.mkdir(materialRoot);
  const limits = { maxBytes: 200000, globalMaxBytes: 300000, reserveBytes: 1, globalReserveBytes: 1,
    acquisitionReserveBytes: 10000, monitorIntervalMs: 10, ...overrides };
  const make = account => new SourceStore({ host: 'github.com', account, repo: 'org/repo', repositoryId: 1 }, { root: base, materialRoot, limits }).initialize();
  const first = await make('first'), second = await make('second');
  return { root, base, materialRoot, limits, first, second };
}
test('quota agregada impede dois escopos de gastar a mesma capacidade', async t => {
  const { first, second } = await fixture(t, { globalMaxBytes: 180000 });
  const lease = await first.acquire({});
  await first.put('active', { text: 'a'.repeat(90000) }, lease);
  await assert.rejects(second.put('other', { text: 'b'.repeat(90000) }), /Quota global/);
  assert.ok(await first.get('active'));
  const result = await first.budget.inventory();
  assert.ok(result.managedBytes < 180000);
  assert.equal(result.reservations, 0);
  assert.ok(result.scopes[path.basename(first.root)].objectCacheBytes > 90000);
});
test('admissões simultâneas reservam disco livre uma única vez', async t => {
  const { first, second } = await fixture(t);
  first.budget.diskFree = second.budget.diskFree = async () => 120000;
  const results = await Promise.allSettled([first.budget.reserve('unknown', 70000), second.budget.reserve('unknown', 70000)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /Reserva global/);
  const owner = results[0].status === 'fulfilled' ? first : second;
  await owner.budget.finish(results.find(r => r.status === 'fulfilled').value, false);
});
test('admissão recupera cache liberado em outro escopo sem tocar material ativo', async t => {
  const { first, second } = await fixture(t, { globalMaxBytes: 180000 });
  const lease = await first.acquire({});
  await first.put('released', { text: 'a'.repeat(90000) }, lease);
  await first.release(lease);
  await second.put('new', { text: 'b'.repeat(90000) });
  assert.equal(await first.get('released'), null);
  assert.ok(await second.get('new'));
  assert.equal((await first.lease(lease)).state, 'released');
});
test('reserva global é durável entre processos e não depende da fila em memória', async t => {
  const { base, first, second, limits, materialRoot } = await fixture(t, { globalMaxBytes: 150000 });
  const moduleUrl = pathToFileURL(path.resolve('lib/review-source/storage-budget.js')).href;
  const code = `import {StorageBudget} from ${JSON.stringify(moduleUrl)};
    const b = new StorageBudget(process.argv[1],process.argv[2],JSON.parse(process.argv[3]),{materialRoot:process.argv[4]});
    try { const id=await b.reserve('child',100000); console.log('admitted');
      await new Promise(resolve=>process.stdin.once('data',resolve).once('end',resolve)); await b.finish(id,false);
    } catch(e) { console.log('deferred:'+e.message); }`;
  const start = store => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, base, store.root, JSON.stringify(limits), materialRoot], { windowsHide: true });
    let output = '';
    const firstLine = new Promise((resolve, reject) => {
      child.stdout.on('data', data => { output += data; if (output.includes('\n')) resolve(output); });
      child.on('error', reject);
    });
    const exit = new Promise(resolve => child.on('exit', resolve));
    return { child, firstLine, exit };
  };
  const one = start(first), two = start(second);
  const lines = await Promise.all([one.firstLine, two.firstLine]);
  assert.equal(lines.filter(line => line.startsWith('admitted')).length, 1);
  assert.equal(lines.filter(line => line.startsWith('deferred:')).length, 1);
  for (const [index, item] of [one, two].entries()) {
    if (lines[index].startsWith('admitted')) item.child.stdin.end('\n');
    else item.child.stdin.end();
  }
  assert.deepEqual(await Promise.all([one.exit, two.exit]), [0, 0]);
  assert.equal((await first.budget.inventory()).reservations, 0);
});
test('monitor interrompe crescimento desconhecido e mantém parcial contabilizado', async t => {
  const { first } = await fixture(t, { globalMaxBytes: 70000 });
  const partial = path.join(first.root, 'repository.git', 'objects', 'pack', 'tmp_pack');
  await fs.mkdir(path.dirname(partial), { recursive: true });
  let interrupted = false;
  await assert.rejects(first.budget.run('git-acquisition', 10000, undefined, async signal => {
    await fs.writeFile(partial, Buffer.alloc(80000));
    await new Promise(resolve => signal.addEventListener('abort', () => { interrupted = true; resolve(); }, { once: true }));
  }), /Quota global/);
  assert.equal(interrupted, true);
  const result = await first.budget.inventory();
  assert.ok(result.managedBytes >= 80000);
  assert.equal(result.reservations, 0);
  await assert.rejects(first.budget.reserve('next', 1), /Quota global/);
  assert.equal((await fs.stat(partial)).size, 80000);
});
test('falha parcial e cancelamento liberam reserva sem ocultar arquivos escritos', async t => {
  const { first } = await fixture(t);
  const partial = path.join(first.root, 'partial.tmp');
  await assert.rejects(first.budget.run('partial', 10000, undefined, async () => {
    await fs.writeFile(partial, Buffer.alloc(5000)); throw new Error('fixture failed');
  }), /fixture failed/);
  assert.equal((await first.budget.inventory()).reservations, 0);
  assert.equal((await scopeInventory(first.root)).acquisitionTemporaryBytes, 5000);
  const controller = new AbortController();
  await assert.rejects(first.budget.run('cancel', 10000, controller.signal, async signal => {
    controller.abort(); assert.equal(signal.aborted, true);
  }), /cancelada/);
  assert.equal((await first.budget.inventory()).reservations, 0);
});
test('monitor propaga AbortSignal ao subprocesso sem encerrar outro consumidor', async t => {
  const { first } = await fixture(t, { globalMaxBytes: 70000 });
  const partial = path.join(first.root, 'process.tmp');
  let code;
  const script = "require('node:fs').writeFileSync(process.argv[1],Buffer.alloc(80000));setInterval(()=>{},1000)";
  await assert.rejects(first.budget.run('subprocess', 10000, undefined, async signal => {
    const result = await io.run(process.execPath, ['-e', script, partial], { signal });
    code = result.code;
  }), /Quota global/);
  assert.equal(code, 'ABORT_ERR');
  assert.equal((await fs.stat(partial)).size, 80000);
  assert.equal((await first.budget.inventory()).reservations, 0);
});
test('inventário separa Git, material ativo, limpeza pendente e legado observado', async t => {
  const { first, materialRoot } = await fixture(t);
  const lease = await first.acquire({});
  const active = path.join(materialRoot, 'review-active'); await fs.mkdir(active);
  await fs.writeFile(path.join(active, 'source.js'), 'active'); await first.attach(lease, active);
  const pending = path.join(materialRoot, 'review-pending'); await fs.mkdir(pending);
  await fs.writeFile(path.join(pending, 'source.js'), 'pending');
  await fs.writeFile(pending + '-material.json', JSON.stringify({ sourceReference: { schema: 1 } }));
  const legacy = path.join(materialRoot, 'review-legacy'); await fs.mkdir(legacy);
  await fs.writeFile(path.join(legacy, 'old.js'), 'old');
  const pack = path.join(first.root, 'repository.git', 'objects', 'pack'); await fs.mkdir(pack, { recursive: true });
  await fs.writeFile(path.join(pack, 'fixture.pack'), Buffer.alloc(999));
  const inventory = await first.budget.inventory(), scope = inventory.scopes[path.basename(first.root)];
  assert.equal(scope.gitBytes, 999); assert.equal(scope.activeMaterialBytes, 6);
  assert.equal(inventory.unregisteredManagedBytes, 7);
  assert.equal(inventory.legacy.bytes, 3); assert.equal(inventory.legacy.removable, false);
  assert.equal(inventory.legacy.includedInManagedBytes, false);
  await fs.writeFile(active + '-material.json', JSON.stringify({ state: 'removal-pending' }));
  const pendingInventory = await first.budget.inventory();
  assert.equal(pendingInventory.scopes[path.basename(first.root)].pendingMaterialBytes, 6);
  assert.ok(pendingInventory.externalManagedMetadataBytes > 0);
  await assert.rejects(first.budget.run('over', 400000, undefined, async () => {}), /Quota global/);
  assert.equal(await fs.readFile(path.join(active, 'source.js'), 'utf8'), 'active');
  assert.equal(await fs.readFile(path.join(legacy, 'old.js'), 'utf8'), 'old');
});
test('reserva de disco tem precedência e consumidor interrompido não é recolhido por idade', async t => {
  const { first } = await fixture(t);
  first.budget.diskFree = async () => 100;
  await assert.rejects(first.budget.reserve('disk', 100), /Reserva global/);
  first.budget.diskFree = async () => 500000;
  await first.budget.reserve('interrupted-owner', 170000);
  const recovered = new StorageBudget(first.base, first.root, first.limits, { diskFree: async () => 500000 });
  assert.equal((await recovered.inventory()).reservations, 1);
  await assert.rejects(recovered.reserve('new', 170000), /Quota global/);
});

// Farol encerrado no meio do fetch (revisão do PR da v2.78.7): a lease fica com gitProcessPending, sem marcador
// e sem monitor estendendo a reserva. Esse escopo entra na folga; o Git em curso deste processo não entra.
for (const [caso, dono, admite] of [['de outro processo', 'outro', false], ['deste processo', 'este', true]]) {
  test(`Git pendente ${caso} ${admite ? 'não ' : ''}entra na folga dos outros escopos`, async t => {
    const { first, second } = await fixture(t, { maxBytes: 200000, globalMaxBytes: 150000 });
    // Git anterior ainda vivo: o dono morto não basta para recuperar, e a folga continua
    soSimulado(t, [{ name: 'git.exe', born: Date.now() - 60000 }]);
    const lease = await first.acquire({});
    await first.protectedGit(lease, true);
    const leaseFile = path.join(first.root, 'leases', lease + '.json');
    if (dono === 'outro') await fs.writeFile(leaseFile, JSON.stringify({ ...JSON.parse(await fs.readFile(leaseFile, 'utf8')), pid: 999999 }));
    const inventory = await scopeInventory(first.root);
    assert.equal(inventory.pendingGitProcess, true);
    assert.equal(Boolean(inventory.foreignGitProcess), dono === 'outro');
    if (admite) await second.put('other', { text: 'b' });
    else await assert.rejects(second.put('other', { text: 'b' }), /Quota global/);
  });
}

// Dono morto sem marcador e sem Git anterior vivo (27/10/2026, atualização das 19:19): a lease sai da
// folga com evidência e a reserva que ele deixou some do livro global.
test('lease e reserva de dono encerrado sem Git anterior vivo são recuperadas sem marcador', async t => {
  const { first, second } = await fixture(t, { maxBytes: 200000, globalMaxBytes: 150000 });
  soSimulado(t, [{ name: 'git.exe', born: Date.now() + 60000 }]);
  const lease = await first.acquire({});
  await first.protectedGit(lease, true);
  const leaseFile = path.join(first.root, 'leases', lease + '.json');
  const value = JSON.parse(await fs.readFile(leaseFile, 'utf8'));
  assert.ok(Number.isSafeInteger(value.gitProcessAt) && Number.isSafeInteger(value.startedAt));
  await fs.writeFile(leaseFile, JSON.stringify({ ...value, pid: 999999 }));
  const budgetFile = path.join(first.base, 'storage-budget.json');
  const budget = JSON.parse(await fs.readFile(budgetFile, 'utf8').catch(() => '{"schema":1,"reservations":{}}'));
  budget.reservations.morta = { scope: path.basename(first.root), kind: 'git-materialization', bytes: 140000, baselineBytes: 0,
    createdAt: Date.now() - 1000, owner: { instance: 'outra', pid: 999999, startedAt: Date.now() - 3600e3 } };
  budget.reservations.semDono = { scope: path.basename(first.root), kind: 'object-cache', bytes: 1, baselineBytes: 0, createdAt: Date.now() - 1000 };
  await fs.writeFile(budgetFile, JSON.stringify(budget));
  await second.put('other', { text: 'b' });
  assert.deepEqual(await second.get('other'), { text: 'b' });
  const depois = JSON.parse(await fs.readFile(leaseFile, 'utf8'));
  assert.equal(depois.gitProcessPending, false);
  assert.equal(depois.recovered.proof, 'owner-ended-without-git');
  const livro = JSON.parse(await fs.readFile(budgetFile, 'utf8'));
  assert.equal(livro.reservations.morta, undefined);
  assert.ok(livro.reservations.semDono, 'reserva sem dono gravado só sai com boot posterior');
});

test('reserva de dono vivo e lease deste processo não são tocadas', async t => {
  const { first } = await fixture(t);
  soSimulado(t, []);
  const lease = await first.acquire({});
  await first.protectedGit(lease, true);
  const budgetFile = path.join(first.base, 'storage-budget.json');
  const budget = JSON.parse(await fs.readFile(budgetFile, 'utf8').catch(() => '{"schema":1,"reservations":{}}'));
  budget.reservations.viva = { scope: path.basename(first.root), kind: 'object-cache', bytes: 1, baselineBytes: 0, createdAt: Date.now(),
    owner: { instance: 'outra', pid: process.pid, startedAt: Math.round(performance.timeOrigin) } };
  await fs.writeFile(budgetFile, JSON.stringify(budget));
  await first.budget.reserve('nova', 1).catch(() => {});
  assert.ok(JSON.parse(await fs.readFile(budgetFile, 'utf8')).reservations.viva);
  assert.equal(JSON.parse(await fs.readFile(path.join(first.root, 'leases', lease + '.json'), 'utf8')).gitProcessPending, true);
});
