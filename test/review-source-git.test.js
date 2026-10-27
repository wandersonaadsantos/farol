import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import io from '../lib/io.js';
import { envGitLimpo } from './helpers/git-limpo.js';
import { SourceStore } from '../lib/review-source/store.js';
import { GitSource } from '../lib/review-source/git.js';
import { releaseMaterialReference } from '../lib/review-source/index.js';
import { DEFAULTS } from '../lib/review-source/contract.js';

async function gitFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-source-git-'));
  const origin = path.join(root, 'origin'), materials = path.join(root, 'materials');
  await fs.mkdir(origin); await fs.mkdir(materials);
  const git = args => execFileSync('git', args, { cwd: origin, env: envGitLimpo(), encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  await fs.writeFile(path.join(origin, 'source.js'), 'export const x = 1;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'base']); const base = git(['rev-parse', 'HEAD']);
  await fs.writeFile(path.join(origin, 'source.js'), 'export const x = 2;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'head']); const head = git(['rev-parse', 'HEAD']);
  const original = io.run; let fetches = 0;
  io.run = async (cmd, args, opts) => {
    if (cmd !== 'git') throw new Error('Nenhuma rede externa permitida na fixture.');
    const localArgs = args.map(arg => arg === 'https://github.com/org/repo.git' ? origin : arg);
    if (args.includes('fetch')) fetches++;
    return original(cmd, localArgs, { ...opts, env: envGitLimpo() });
  };
  t.after(async () => { io.run = original; await fs.rm(root, { recursive: true, force: true }); });
  const scope = { host: 'github.com', account: 'fixture', repo: 'org/repo', repositoryId: 123 };
  const options = { root: path.join(root, 'cache'), limits: { reserveBytes: 1 } };
  const store = await new SourceStore(scope, options).initialize();
  const make = async name => {
    const leaseId = await store.acquire({ H: head, B: base, M: base });
    const source = new GitSource({ ghEnv: () => ({}) }, store, leaseId, { head, base, mergeBase: base }, { materialRoot: materials });
    const destination = path.join(materials, 'review-' + name); await fs.mkdir(destination);
    return { source, destination, leaseId, reference: { schema: 1, scope, leaseId } };
  };
  return { root, origin, store, make, git, options, fetches: () => fetches };
}
test('dois materiais compartilham objetos sem alternates e liberar um preserva o outro', async t => {
  const fx = await gitFixture(t), first = await fx.make('one'), second = await fx.make('two');
  await first.source.materialize(first.destination); await second.source.materialize(second.destination);
  assert.equal(fx.fetches(), 1);
  assert.equal(await fs.readFile(path.join(second.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
  await assert.rejects(fs.access(path.join(fx.store.root, 'repository.git/objects/info/alternates')));
  await fs.rm(first.destination, { recursive: true, force: true });
  await releaseMaterialReference(first.reference, first.destination, fx.options);
  assert.equal((await fx.store.lease(first.leaseId)).state, 'released');
  assert.equal((await fx.store.lease(second.leaseId)).state, 'active');
  assert.equal(await fs.readFile(path.join(second.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
  await second.source.prepare(); assert.equal(fx.fetches(), 1);
  const list = await second.source.run(['worktree', 'list', '--porcelain']);
  assert.ok(!list.includes(first.destination.replaceAll('\\', '/')));
  await fs.rm(second.destination, { recursive: true, force: true });
  await releaseMaterialReference(second.reference, second.destination, fx.options);
  await releaseMaterialReference(second.reference, second.destination, fx.options);
});
// Sem ref nenhuma entre aquisições, o fetch seguinte não anunciava o que o cache tinha e baixava o
// histórico inteiro (179 MB e 153 s no biud-frontend, acima do teto de 120 s).
test('refs conhecidas sobrevivem à liberação para o próximo fetch negociar', async t => {
  const fx = await gitFixture(t), first = await fx.make('known');
  await first.source.materialize(first.destination);
  await fs.rm(first.destination, { recursive: true, force: true });
  await releaseMaterialReference(first.reference, first.destination, fx.options);
  const refs = (await first.source.run(['for-each-ref', '--format=%(refname) %(objectname)'], { cleanup: true })).trim().split(/\r?\n/);
  const [base, head] = [fx.git(['rev-parse', 'HEAD~1']), fx.git(['rev-parse', 'HEAD'])];
  assert.deepEqual(refs.sort(), [`refs/farol/known/base ${base}`, `refs/farol/known/head ${head}`]);
});
test('fetch usa teto próprio para o cache frio e os demais comandos seguem com o teto comum', async t => {
  const fx = await gitFixture(t), first = await fx.make('cold'), inner = io.run, tetos = {};
  io.run = async (cmd, args, opts) => { tetos[args.includes('fetch') ? 'fetch' : 'outro'] = opts.timeout; return inner(cmd, args, opts); };
  await first.source.materialize(first.destination);
  io.run = inner;
  assert.equal(tetos.fetch, DEFAULTS.fetchTimeoutMs);
  assert.equal(tetos.outro, DEFAULTS.timeoutMs);
  assert.ok(DEFAULTS.fetchTimeoutMs > DEFAULTS.timeoutMs);
});
test('material existente não libera refs e aquisição repetida mantém o consumidor', async t => {
  const fx = await gitFixture(t), first = await fx.make('active');
  await first.source.materialize(first.destination);
  await assert.rejects(releaseMaterialReference(first.reference, first.destination, fx.options), /ainda existe/);
  assert.equal((await fx.store.lease(first.leaseId)).state, 'active');
  await fs.rm(first.destination, { recursive: true, force: true });
  await releaseMaterialReference(first.reference, first.destination, fx.options);
});
test('destino fora da raiz privada é recusado antes de buscar objetos', async t => {
  const fx = await gitFixture(t), first = await fx.make('escape');
  await assert.rejects(first.source.materialize(path.join(fx.root, 'review-outside')), /fora da raiz/);
  assert.equal(fx.fetches(), 0);
});

test('limpeza por ancestral alias remove somente o registro canônico do destino já removido', async t => {
  const fx = await gitFixture(t), first = await fx.make('aliased'), second = await fx.make('preserved');
  await first.source.materialize(first.destination); await second.source.materialize(second.destination);
  const registered = await fs.realpath(first.destination), other = await fs.realpath(second.destination);
  const alias = path.join(fx.root, 'materials-alias');
  await fs.symlink(path.dirname(first.destination), alias, 'junction');
  const absentAlias = path.join(alias, path.basename(first.destination));
  assert.notEqual(path.resolve(absentAlias), registered, 'a regressão precisa de caminhos diferentes para o mesmo material');
  await fs.rm(first.destination, { recursive: true, force: true });
  await first.source.removeWorktreeRegistration(absentAlias);
  const list = await second.source.run(['worktree', 'list', '--porcelain']);
  assert.ok(!list.includes(registered.replaceAll('\\', '/')), 'registro canônico removido');
  assert.ok(list.includes(other.replaceAll('\\', '/')), 'outro registro preservado');
  assert.equal(await fs.readFile(path.join(second.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
});

test('falha ao remover registro Git conserva lease e refs; retry conclui sem tocar outro material', async t => {
  const fx = await gitFixture(t), material = await fx.make('cleanup-failure'), other = await fx.make('cleanup-preserved');
  await material.source.materialize(material.destination); await other.source.materialize(other.destination);
  await fs.rm(material.destination, { recursive: true, force: true });
  const original = io.run;
  io.run = (command, args, options) => args.includes('worktree') && args.includes('remove')
    ? Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'falha de limpeza injetada' })
    : original(command, args, options);
  try { await assert.rejects(releaseMaterialReference(material.reference, material.destination, fx.options), /objetos Git/); }
  finally { io.run = original; }
  assert.equal((await fx.store.lease(material.leaseId)).state, 'active');
  const refs = await material.source.run(['show-ref']);
  assert.ok(refs.includes(material.source.ref('head')));
  assert.equal((await fx.store.lease(other.leaseId)).state, 'active');
  assert.equal(await fs.readFile(path.join(other.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
  await releaseMaterialReference(material.reference, material.destination, fx.options);
  assert.equal((await fx.store.lease(material.leaseId)).state, 'released');
  const after = await other.source.run(['show-ref']);
  assert.ok(!after.includes(material.source.ref('head')));
  assert.ok(after.includes(other.source.ref('head')));
  assert.equal((await fx.store.lease(other.leaseId)).state, 'active');
  assert.equal(await fs.readFile(path.join(other.destination, 'source.js'), 'utf8'), 'export const x = 2;\n');
});
