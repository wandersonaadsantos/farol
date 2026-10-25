import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import io from '../lib/io.js';
import { queryPrepared } from '../lib/review-context/query.js';
import { searchSources } from '../lib/review-context/search.js';
import { blobHash } from '../lib/review-source/contract.js';
import { SourceStore } from '../lib/review-source/store.js';
import { CONFIG_FILE } from '../lib/paths.js';
import { preparedPatchScope } from '../lib/engine/analysis-source.js';
import { mascararSegredos } from '../lib/engine/falhas.js';

const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40), TREE = 'd'.repeat(40);
let repositoryId = 0;
async function fixture(t, text = 'export const value = "needle";\n') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-query-'));
  const manifestFile = path.join(root, 'source.json');
  const id = ++repositoryId, repo = 'org/query', blob = blobHash(Buffer.from(text));
  const manifest = { schema: 1, status: 'complete', scope: { host: 'github.com', account: 'owner', authAccount: 'Owner', repo, number: id, repositoryId: id },
    H, B, M, files: [{ path: 'src/value.js', status: 'modified', headBlob: blob, patchStatus: 'available' }] };
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  const original = io.run, calls = []; let denied = false, login = 'owner';
  io.run = async (cmd, args) => {
    assert.equal(cmd, 'gh');
    const endpoint = args[3]; calls.push({ args: [...args], endpoint });
    if (endpoint === 'user') return { ok: true, stdout: JSON.stringify({ login }) };
    if (endpoint === `repos/${repo}`) return { ok: !denied, stdout: JSON.stringify({ id, full_name: repo, private: true }) };
    if (endpoint.includes('/git/commits/')) return { ok: true, stdout: JSON.stringify({ sha: endpoint.split('/').at(-1), tree: TREE }) };
    if (endpoint.includes('/git/trees/')) return { ok: true, stdout: JSON.stringify({ sha: TREE, truncated: false,
      tree: [{ path: 'src/value.js', sha: blob, type: 'blob', mode: '100644', size: Buffer.byteLength(text) }] }) };
    if (endpoint.includes('/git/blobs/')) return { ok: true, stdout: JSON.stringify({ sha: blob, encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') }) };
    assert.fail(`Consulta não autorizada pela fixture: ${endpoint}`);
  };
  t.after(async () => { io.run = original; await fs.rm(root, { recursive: true, force: true }); });
  return { manifest, manifestFile, calls, deny: () => { denied = true; }, wrongAccount: () => { login = 'another'; } };
}
test('CLI de leitura revalida identidade/acesso e reutiliza fonte fixada sem patches', async t => {
  const fx = await fixture(t);
  const first = await queryPrepared('read', fx.manifestFile, 'src/value.js');
  assert.equal(first.status, 'available'); assert.equal(first.commit, H); assert.match(first.text, /needle/);
  const previous = fx.calls.length;
  const second = await queryPrepared('read', fx.manifestFile, 'src/value.js', 'head');
  assert.equal(second.text, first.text);
  assert.deepEqual(fx.calls.slice(previous).map(c => c.endpoint), ['user', 'repos/org/query']);
  assert.equal(fx.calls.some(c => c.endpoint.includes('/pulls/') || c.endpoint.includes('/files')), false);
});
test('CLI lê M e B explicitamente, sem substituição por branch atual', async t => {
  const fx = await fixture(t);
  assert.equal((await queryPrepared('read', fx.manifestFile, 'src/value.js', 'mergeBase')).commit, M);
  assert.equal((await queryPrepared('read', fx.manifestFile, 'src/value.js', 'base')).commit, B);
  assert.equal(fx.calls.some(c => c.args.some(arg => arg === 'main' || arg === 'master')), false);
});
test('manifesto compacto do escopo preparado continua utilizável pela consulta adicional', async t => {
  const fx = await fixture(t), session = { mode: 'review' }, id = 'query-fixture';
  const source = { status: 'complete', manifest: { ...fx.manifest, files: [{ ...fx.manifest.files[0], patch: '@@ -1 +1 @@\n-old\n+new' }] } };
  const scope = preparedPatchScope({ activeReviews: new Map([[id, session]]) }, { key: 'org/query#' + fx.manifest.scope.number }, id, { source });
  t.after(async () => { await fs.rm(scope.root, { recursive: true, force: true }); await fs.rm(scope.root + '.source.json', { force: true }); });
  const compact = JSON.parse(await fs.readFile(scope.root + '.source.json', 'utf8'));
  assert.equal(compact.files[0].patch, undefined); assert.deepEqual([compact.H, compact.B, compact.M], [H, B, M]);
  const value = await queryPrepared('read', scope.root + '.source.json', 'src/value.js');
  assert.equal(value.status, 'available'); assert.equal(value.commit, H);
});
test('CLI nega cache privado após revogação ou troca da identidade efetiva', async t => {
  const fx = await fixture(t); await queryPrepared('read', fx.manifestFile, 'src/value.js');
  fx.deny(); await assert.rejects(queryPrepared('read', fx.manifestFile, 'src/value.js'), /indisponível/);
  fx.wrongAccount(); await assert.rejects(queryPrepared('read', fx.manifestFile, 'src/value.js'), /identidade/);
});
test('CLI não retorna segredo recuperado nem o coloca em argumentos/URL', async t => {
  const secret = 'ghp_' + 'a'.repeat(30), text = `export const token = "${secret}";\n`, fx = await fixture(t, text);
  const result = await queryPrepared('read', fx.manifestFile, 'src/value.js');
  assert.equal(result.redacted, true); assert.ok(!result.text.includes(secret));
  assert.ok(fx.calls.every(c => c.args.every(arg => !arg.includes(secret))));
  const store = await new SourceStore(fx.manifest.scope).initialize();
  assert.equal(await store.get('blob:' + blobHash(Buffer.from(text))), null);
});
test('CLI respeita limites locais e não converte configuração corrompida em defaults', async t => {
  const fx = await fixture(t); let previous = null;
  try { previous = await fs.readFile(CONFIG_FILE); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  t.after(async () => { if (previous) await fs.writeFile(CONFIG_FILE, previous); else await fs.rm(CONFIG_FILE, { force: true }); });
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify({ sourceCacheLimits: { maxFileBytes: 1, reserveBytes: 1 } }));
  const limited = await queryPrepared('read', fx.manifestFile, 'src/value.js');
  assert.equal(limited.status, 'limited');
  const calls = fx.calls.length;
  await fs.writeFile(CONFIG_FILE, '{broken');
  await assert.rejects(queryPrepared('read', fx.manifestFile, 'src/value.js'), /não verificáveis/);
  assert.equal(fx.calls.length, calls);
});
test('CLI rejeita operação/lado/manifesto inválidos antes de consultar rede', async t => {
  const fx = await fixture(t);
  await assert.rejects(queryPrepared('write', fx.manifestFile, 'src/value.js'), /inválida/);
  await assert.rejects(queryPrepared('read', fx.manifestFile, 'src/value.js', 'main'), /inválida/);
  await fs.writeFile(fx.manifestFile, JSON.stringify({ ...fx.manifest, H: 'main' }));
  await assert.rejects(queryPrepared('read', fx.manifestFile, 'src/value.js'), /incompatível/);
  assert.equal(fx.calls.length, 0);
});
function memorySource({ complete = true, status = 'available', text = 'needle\n' } = {}) {
  return { reader: { tree: async () => ({ complete, entries: [{ path: 'src/value.js', type: 'blob', size: Buffer.byteLength(text) }] }),
    read: async (_path, side) => ({ status, text, path: 'src/value.js', blob: 'e'.repeat(40), commit: side === 'base' ? B : H }) } };
}
test('busca textual conserva referências e marca confiança apenas candidata', async () => {
  const result = await searchSources(memorySource(), 'needle', { side: 'base' });
  assert.equal(result.complete, true); assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0], { path: 'src/value.js', line: 1, blob: 'e'.repeat(40), commit: B, text: 'needle', lineTruncated: false, origin: 'textual', confidence: 'candidate' });
});
test('busca vazia sobre árvore parcial ou fonte indisponível não prova ausência', async () => {
  const partial = await searchSources(memorySource({ complete: false, text: 'other\n' }), 'needle');
  assert.equal(partial.complete, false); assert.equal(partial.matches.length, 0);
  const unavailable = await searchSources(memorySource({ status: 'unavailable' }), 'needle');
  assert.equal(unavailable.complete, false); assert.equal(unavailable.omitted, 1);
});
test('busca respeita cancelamento e limites de resultado sem alegar cobertura integral', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchSources(memorySource(), 'needle', { signal: controller.signal }), /cancelada/);
  const result = await searchSources(memorySource({ text: ('needle\n').repeat(100) }), 'needle');
  assert.equal(result.matches.length, 50); assert.equal(result.complete, false); assert.ok(result.omitted > 0);
});
test('busca mascara segredo antes do corte visual e mascara a consulta devolvida', async () => {
  const secret = 'ghp_' + 'x'.repeat(40), line = 'x'.repeat(489) + ' ' + secret;
  const result = await searchSources(memorySource({ text: line }), secret);
  assert.equal(result.matches[0].text, mascararSegredos(line).slice(0, 500));
  assert.ok(!result.matches[0].text.includes(secret.slice(0, 10)));
  assert.equal(result.query, mascararSegredos(secret));
});
