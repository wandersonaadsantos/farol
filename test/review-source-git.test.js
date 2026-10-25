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
