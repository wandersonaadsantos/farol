import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import io from '../lib/io.js';
import { prepareSources, openPreparedSources } from '../lib/review-source/index.js';
import { blobHash } from '../lib/review-source/contract.js';
import { sourceWork, sourceWorkStatus } from '../lib/review-source/work.js';

const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40), TREE = 'd'.repeat(40);
const PR = { repo: 'org/project', number: 42, url: 'https://github.com/org/project/pull/42' };
const text = 'export function getValue() { return 1; }\n', blob = blobHash(Buffer.from(text));
const file = { path: 'src/value.js', sha: blob, status: 'modified', lines: 2, patch: '@@ -1 +1 @@\n-old\n+new' };
const meta = { number: 42, url: PR.url, changedFiles: 1, head: H, base: B, headRepo: 'fork/project', headRepositoryId: 2, baseRepo: PR.repo, baseRepositoryId: 1 };
const engine = { config: {}, accountForPr: () => 'owner', tokenFor: () => 'synthetic', ghEnv: () => ({}) };
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-sources-'));
  const handles = [];
  t.after(async () => { for (const handle of handles) await handle.release(); await fs.rm(root, { recursive: true, force: true }); });
  const calls = [], original = io.run; let snapshots = 0;
  t.after(() => { io.run = original; });
  io.run = async (_cmd, args) => {
    const endpoint = args[3]; calls.push(endpoint);
    let data;
    if (endpoint === 'user') data = { login: options.login || 'owner' };
    else if (endpoint === `repos/${PR.repo}`) data = options.revoked ? null : { id: 1, full_name: PR.repo, private: true };
    else if (endpoint === `repos/${PR.repo}/pulls/42`) {
      snapshots++;
      data = { ...meta, ...options.before };
      if (snapshots > 1) data = { ...data, ...options.after };
    } else if (endpoint.includes('/files?')) data = options.pages || [[file]];
    else if (endpoint.includes('/compare/')) data = { mergeBase: M };
    else if (endpoint.includes('/git/commits/')) data = { sha: endpoint.split('/').at(-1), tree: endpoint.endsWith(H) ? TREE : 'e'.repeat(40) };
    else if (endpoint.includes('/git/trees/')) data = { sha: endpoint.split('/').at(-1).split('?')[0], truncated: options.truncated === true,
      tree: (endpoint.includes(TREE) && options.headTree) || options.tree || [{ path: file.path, sha: blob, type: 'blob', mode: '100644', size: Buffer.byteLength(text) },
        { path: 'test/consumer.test.js', sha: blob, type: 'blob', mode: '100644', size: Buffer.byteLength(text) }] };
    else if (endpoint.includes('/git/blobs/')) data = { sha: blob, encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') };
    return { ok: data !== null && data !== undefined, stdout: JSON.stringify(data), stderr: '' };
  };
  return { root, calls, prepare: async extra => { const handle = await prepareSources(engine, PR, { root, expectedHead: H, limits: { reserveBytes: 1 }, ...extra }); handles.push(handle); return handle; } };
}
test('prepara sem clone pessoal ou perfil, distingue H/B/M e mantém patches paginados', async t => {
  const fx = await fixture(t, { before: { changedFiles: 2 }, pages: [[file], [{ ...file, path: 'src/renamed.js', status: 'renamed', previousPath: 'old.js' }]] });
  const source = await fx.prepare(); t.after(source.release);
  assert.equal(source.status, 'complete');
  assert.deepEqual([source.manifest.H, source.manifest.B, source.manifest.M], [H, B, M]);
  assert.equal(source.manifest.files.length, 2);
  assert.equal(source.manifest.files[1].previousPath, 'old.js');
  assert.equal(source.manifest.files[0].patch, file.patch);
  assert.equal(source.manifest.fork.repositoryId, 2);
});
test('páginas brutas do GitHub preservam filename, renomeação e contagens', async t => {
  const fx = await fixture(t, { before: { changedFiles: 2 }, pages: [[{ filename: file.path, sha: blob, status: 'modified', additions: 1, deletions: 1, patch: file.patch }],
    [{ filename: 'new.js', previous_filename: 'old.js', sha: blob, status: 'renamed', additions: 0, deletions: 0 }]] });
  const source = await fx.prepare(); t.after(source.release);
  assert.equal(source.status, 'complete'); assert.equal(source.manifest.files[0].lines, 2);
  assert.equal(source.manifest.files[1].previousPath, 'old.js');
});
for (const after of [{ head: 'e'.repeat(40) }, { base: 'f'.repeat(40) }, { changedFiles: 2 }]) {
  test(`mudança durante coleta não vira fonte atual (${Object.keys(after)[0]})`, async t => {
    const fx = await fixture(t, { after });
    const source = await fx.prepare();
    assert.equal(source.status, 'unavailable');
    assert.match(source.reason, /mudou/);
  });
}
test('páginas duplicadas e quantidade divergente permanecem incompletas', async t => {
  const fx = await fixture(t, { before: { changedFiles: 2 }, pages: [[file], [file]] });
  const source = await fx.prepare();
  assert.equal(source.status, 'incomplete');
  assert.equal(source.reader, undefined);
});
test('diff vazio é completo, distinto de fonte indisponível', async t => {
  const fx = await fixture(t, { before: { changedFiles: 0 }, pages: [[]] });
  const source = await fx.prepare(); t.after(source.release);
  assert.equal(source.status, 'complete'); assert.equal(source.inventory.files.length, 0);
});
test('árvore contém consumidores fora do diff e leitura confere o blob', async t => {
  const fx = await fixture(t), source = await fx.prepare(); t.after(source.release);
  const tree = await source.reader.tree('head');
  assert.equal(tree.complete, true); assert.equal(tree.entries.length, 2);
  const value = await source.reader.read('test/consumer.test.js');
  assert.equal(value.status, 'available'); assert.equal(value.text, text); assert.equal(value.blob, blob); assert.equal(value.commit, H);
  const old = await source.reader.read(file.path, 'mergeBase'); assert.equal(old.commit, M);
});
test('diretórios sem tamanho continuam no mapa sem serem lidos como blobs', async t => {
  const fx = await fixture(t, { tree: [{ path: 'src', sha: TREE, type: 'tree', mode: '040000', size: null }] });
  const source = await fx.prepare();
  assert.equal((await source.reader.tree()).complete, true);
  assert.equal((await source.reader.read('src')).status, 'unsupported'); await source.release();
});
test('patch truncado fica parcial mesmo quando o inventário tem todos os caminhos', async t => {
  const fx = await fixture(t, { pages: [[{ ...file, additions: 20, deletions: 20 }]] }), source = await fx.prepare();
  assert.equal(source.inventory.status, 'complete'); assert.equal(source.manifest.files[0].patchStatus, 'partial');
  assert.equal(source.manifest.limitations.length, 1); await source.release();
});
test('segunda análise reaproveita árvore e blob, mas revalida acesso', async t => {
  const fx = await fixture(t), first = await fx.prepare();
  await first.reader.read(file.path); await first.release();
  const previous = fx.calls.filter(x => x.includes('/git/')).length;
  const second = await fx.prepare(); t.after(second.release);
  const value = await second.reader.read(file.path);
  assert.equal(value.status, 'available');
  assert.equal(fx.calls.filter(x => x.includes('/git/')).length, previous);
  assert.equal(fx.calls.filter(x => x === 'user').length, 2);
});
test('consulta posterior abre manifesto fixado sem obter novamente os patches', async t => {
  const fx = await fixture(t), first = await fx.prepare(); await first.reader.read(file.path);
  const manifest = first.manifest; await first.release();
  const before = fx.calls.length;
  const opened = await openPreparedSources(engine, manifest, { root: fx.root, limits: { reserveBytes: 1 } });
  assert.equal((await opened.reader.read(file.path)).commit, H); await opened.release();
  assert.deepEqual(fx.calls.slice(before), ['user', `repos/${PR.repo}`]);
  await assert.rejects(openPreparedSources(engine, { ...manifest, H: 'main' }, { root: fx.root }), /incompatível/);
});
test('consumidores simultâneos deduplicam aquisição do mesmo blob e liberação é independente', async t => {
  const fx = await fixture(t), first = await fx.prepare(), second = await first.retain();
  const [one, two] = await Promise.all([first.reader.read(file.path), second.reader.read(file.path)]);
  assert.equal(one.text, two.text); assert.equal(fx.calls.filter(x => x.includes('/git/blobs/')).length, 1);
  await first.release();
  assert.equal((await second.reader.read(file.path)).status, 'available'); await second.release();
});
test('binário não é interpretado como texto ou ausência de fonte', async t => {
  const bytes = Buffer.from([0, 1, 2, 3]), binaryBlob = blobHash(bytes);
  const fx = await fixture(t, { tree: [{ path: 'image.bin', type: 'blob', mode: '100644', sha: binaryBlob, size: bytes.length }] });
  const original = io.run;
  io.run = async (cmd, args, options) => args[3]?.includes('/git/blobs/')
    ? { ok: true, stdout: JSON.stringify({ sha: binaryBlob, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') }) }
    : original(cmd, args, options);
  const source = await fx.prepare(), value = await source.reader.read('image.bin');
  assert.equal(value.status, 'binary'); assert.equal(value.text, null); await source.release();
});
test('blob com conteúdo incompatível é recusado antes da persistência', async t => {
  const fx = await fixture(t), source = await fx.prepare(), original = io.run;
  io.run = async (cmd, args, options) => args[3]?.includes('/git/blobs/')
    ? { ok: true, stdout: JSON.stringify({ sha: blob, encoding: 'base64', size: 3, content: Buffer.from('bad').toString('base64') }) }
    : original(cmd, args, options);
  const value = await source.reader.read(file.path);
  assert.equal(value.status, 'unavailable'); assert.match(value.reason, /não confere/); await source.release();
});
test('revogação impede nova operação mesmo com blobs privados em cache', async t => {
  const fx = await fixture(t), first = await fx.prepare(); await first.reader.read(file.path); await first.release();
  const original = io.run;
  io.run = async (cmd, args, opts) => args[3] === `repos/${PR.repo}` ? { ok: false, stdout: '' } : original(cmd, args, opts);
  const second = await fx.prepare();
  assert.equal(second.status, 'unavailable'); assert.equal(second.reader, undefined);
});
test('conta autenticada incompatível não utiliza fontes de outra conta', async t => {
  const fx = await fixture(t, { login: 'somebody' });
  assert.equal((await fx.prepare()).status, 'unavailable');
  assert.equal(fx.calls.length, 1);
});
test('normalização do escopo preserva o nome exato usado no chaveiro da conta', async t => {
  const fx = await fixture(t), exact = { ...engine, accountForPr: () => 'Owner',
    tokenFor: account => account === 'Owner' ? 'synthetic' : null,
    ghEnv: account => { assert.equal(account, 'Owner'); return {}; } };
  const source = await prepareSources(exact, PR, { root: fx.root, limits: { reserveBytes: 1 } });
  await source.release(); assert.equal(source.status, 'complete'); assert.equal(source.manifest.scope.account, 'owner');
});
test('árvore truncada não prova que um consumidor ausente não existe', async t => {
  const fx = await fixture(t, { truncated: true }), source = await fx.prepare(); t.after(source.release);
  assert.equal((await source.reader.tree()).complete, false);
  assert.equal((await source.reader.read('missing.js')).status, 'unavailable');
});
test('arquivo sem patch mantém lacuna explícita, incluindo exclusão', async t => {
  const fx = await fixture(t, { pages: [[{ ...file, status: 'removed', patch: null }]], headTree: [] }), source = await fx.prepare(); t.after(source.release);
  assert.equal(source.manifest.files[0].headBlob, null); assert.equal(source.manifest.files[0].patchStatus, 'unavailable');
  assert.equal(source.manifest.limitations.length, 1);
});
test('caminhos sensíveis mantêm inventário sem persistir patch ou conteúdo', async t => {
  const fx = await fixture(t, { pages: [[{ ...file, path: '.env', patch: 'not stored' }]] }), source = await fx.prepare(); t.after(source.release);
  assert.equal(source.manifest.files[0].patch, null);
  assert.equal((await source.reader.read('.env')).status, 'excluded');
  assert.equal(fx.calls.filter(x => x.includes('/git/blobs')).length, 0);
});
test('patch com possível credencial não é persistido no escopo preparado', async t => {
  const fx = await fixture(t, { pages: [[{ ...file, patch: '+GH_TOKEN=ghp_' + 'z'.repeat(30) }]] }), source = await fx.prepare();
  assert.equal(source.manifest.files[0].patch, null); assert.equal(source.manifest.files[0].sensitive, true); await source.release();
});
test('cancelamento antes da operação não faz aquisição nem ocupa vaga', async t => {
  const fx = await fixture(t), controller = new AbortController(); controller.abort();
  const source = await fx.prepare({ signal: controller.signal });
  assert.equal(source.status, 'unavailable'); assert.equal(fx.calls.length, 0);
  assert.deepEqual(sourceWorkStatus(), { active: 0, queued: 0 });
});
test('fila libera vaga após falha e cancelamento de aguardante', async () => {
  const limits = { concurrency: 1, maxQueued: 2 }; let finish;
  const first = sourceWork(limits, null, () => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const waiting = sourceWork(limits, controller.signal, () => assert.fail('cancelado não executa'));
  controller.abort(); await assert.rejects(waiting, /cancelada/);
  await new Promise(resolve => setImmediate(resolve)); finish(); await first;
  await assert.rejects(sourceWork(limits, null, () => { throw new Error('fixture'); }), /fixture/);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(sourceWorkStatus(), { active: 0, queued: 0 });
});
