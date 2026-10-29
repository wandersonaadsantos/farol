import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-projection-home-'));
process.env.FAROL_HOME = home;
const io = (await import('../lib/io.js')).default;
const { prepareSources } = await import('../lib/review-source/index.js');
const { blobHash } = await import('../lib/review-source/contract.js');
const { createSourceProjection } = await import('../lib/review-source/projection.js');
const { prepareSelfIsolation } = await import('../lib/engine/self-isolation.js');
const { restrictedCheckpoint, recordProjection } = await import('../lib/engine/self-read-proof.js');
const { checkpointPath, readCheckpoint } = await import('../lib/engine/verification-checkpoint.js');
after(() => fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40);
const TH = 'd'.repeat(40), TM = 'e'.repeat(40);
const PR = { repo: 'org/project', number: 42, url: 'https://github.com/org/project/pull/42' };
const engine = { config: {}, accountForPr: () => 'owner', tokenFor: () => 'synthetic', ghEnv: () => ({}) };

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-source-projection-'));
  const tokens = [0, 1].map(() => 'fixture-' + randomUUID());
  const before = Buffer.from(options.beforeText ?? `export const header = 'Bearer ${tokens[0]}';\n`);
  const after = options.afterBytes || Buffer.from(options.afterText ?? `export const header = 'Bearer ${tokens[1]}';\n`);
  const oldBlob = blobHash(before), newBlob = blobHash(after);
  const filename = options.path || 'src/header.js', previous = options.previousPath || filename;
  const status = options.status || 'modified', calls = [], handles = [];
  const patch = options.patch === undefined ? `@@ -1 +1 @@\n-${before.toString().trimEnd()}\n+${after.toString().trimEnd()}` : options.patch;
  const original = io.run;
  io.run = async (_command, args) => {
    const endpoint = args[3]; calls.push(endpoint);
    let data;
    if (endpoint === 'user') data = { login: 'owner' };
    else if (endpoint === 'repos/org/project') data = { id: 1, full_name: PR.repo, private: true };
    else if (endpoint.endsWith('/pulls/42')) data = { number: 42, url: PR.url, changedFiles: 1,
      head: H, base: B, baseRepo: PR.repo, headRepo: PR.repo, baseRepositoryId: 1, headRepositoryId: 1 };
    else if (endpoint.includes('/files?')) data = [[{ filename, previous_filename: options.previousPath,
      status, sha: newBlob, additions: 1, deletions: 1, patch }]];
    else if (endpoint.includes('/compare/')) data = { mergeBase: M };
    else if (endpoint.includes('/git/commits/')) {
      const sha = endpoint.split('/').at(-1); data = { sha, tree: sha === H ? TH : TM };
    } else if (endpoint.includes('/git/trees/')) {
      const head = endpoint.includes(TH), absent = head ? status === 'removed' : status === 'added';
      data = { sha: head ? TH : TM, truncated: options.truncated === true, tree: absent ? [] : [{
        path: head ? filename : previous, sha: head ? newBlob : oldBlob, mode: options.mode || '100644',
        type: 'blob', size: (head ? after : before).length }] };
    } else if (endpoint.includes('/git/blobs/')) {
      const bytes = endpoint.endsWith(newBlob) ? after : before;
      data = { sha: blobHash(bytes), encoding: 'base64', size: bytes.length, content: bytes.toString('base64') };
    }
    return { ok: !!data, stdout: JSON.stringify(data), stderr: '' };
  };
  t.after(async () => {
    for (const handle of handles) await handle.release();
    io.run = original;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  async function prepare(projected) {
    const source = await prepareSources(engine, PR, { root: path.join(root, 'cache'), expectedHead: H,
      projection: projected ? createSourceProjection() : undefined, limits: { reserveBytes: 1 } });
    handles.push(source); assert.equal(source.status, 'complete'); return source;
  }
  async function noOriginalPersisted() {
    async function walk(folder) {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) { await walk(file); continue; }
        const content = await fs.readFile(file, 'utf8');
        for (const token of [...tokens, ...(options.secretValues || []), before.toString('base64'), after.toString('base64')]) assert.equal(content.includes(token), false);
      }
    }
    await walk(root);
  }
  return { root, tokens, prepare, calls, noOriginalPersisted };
}

test('projeção mantém sintaxe, linhas, igualdade opaca e idempotência sem expor valores', () => {
  const p = createSourceProjection(), a = 'fixture-' + randomUUID(), b = 'fixture-' + randomUUID();
  const source = `const h = 'Bearer ${a}';\r\nGH_TOKEN="${a}";\r\nconst url = '?token=${b}';\r\n`;
  const projected = p.project(source);
  assert.equal(projected.text.includes(a), false); assert.equal(projected.text.includes(b), false);
  assert.equal(projected.text.split('\n').length, source.split('\n').length);
  assert.match(projected.text, /const h = 'Bearer \[FAROL_REDACTED_[^\]]+\]';/);
  assert.match(projected.text, /GH_TOKEN="\[FAROL_REDACTED_[^\]]+\]";/);
  assert.equal(projected.redactions[0].marker, projected.redactions[1].marker);
  assert.notEqual(projected.redactions[0].marker, projected.redactions[2].marker);
  assert.equal(p.project(projected.text).text, projected.text);
  assert.notEqual(createSourceProjection().project(source).text, projected.text);
  assert.throws(() => p.project('GH_TOKEN="unterminated'), /recusada/);
  assert.throws(() => p.project('GH_TOKEN=\\"ambiguous\\"'), /recusada/);
});

test('template só entrega chaves: senha genérica, comentários e valores multilinha não escapam', () => {
  const p = createSourceProjection(), secret = 'fixture-' + randomUUID();
  const text = `# ${secret}\nDATABASE_PASSWORD=${secret}\nPRIVATE_VALUE="${secret}\nTHIS_LOOKS_LIKE_A_KEY=${secret}\n"\nFLAG=false\n`;
  const view = p.projectTemplate(text);
  assert.equal(view.text.includes(secret), false);
  assert.equal(view.text.includes('THIS_LOOKS_LIKE_A_KEY'), false);
  assert.equal(view.text.includes('FLAG=false'), false);
  assert.match(view.text, /DATABASE_PASSWORD=\[FAROL_REDACTED_/);
  assert.equal(view.text.split('\n').length, text.split('\n').length);
  assert.equal(p.projectTemplate(view.text).text, view.text);
  assert.equal(p.project(view.text).text, view.text);
  assert.throws(() => p.projectTemplate('not an environment assignment'), /recusada/);
});

test('pontuação em credencial não citada nunca revela sufixo', () => {
  const p = createSourceProjection();
  for (const source of ['GH_TOKEN=alpha,beta', '?token=alpha;beta', 'GH_TOKEN=alpha)beta']) {
    const view = p.project(source);
    assert.equal(view.text.includes('alpha'), false);
    assert.equal(view.text.includes('beta'), false);
    assert.equal(p.project(view.text).text, view.text);
  }
});

test('projeções concorrentes não compartilham marcadores nem persistem o valor sintético', async t => {
  const f = await fixture(t), first = await f.prepare(true), second = await f.prepare(true);
  const [a, b] = await Promise.all([first, second].map(source =>
    prepareSelfIsolation({ source }, { base: path.join(f.root, 'snapshots') })));
  assert.notEqual(a.root, b.root);
  assert.notEqual(a.manifest.projection.id, b.manifest.projection.id);
  assert.notEqual(await fs.readFile(path.join(a.patches, 'src/header.js'), 'utf8'),
    await fs.readFile(path.join(b.patches, 'src/header.js'), 'utf8'));
  await f.noOriginalPersisted();
});

test('GitHub/reader padrão continuam fechados; somente a projeção entrega fixture ocultada', async t => {
  const f = await fixture(t), normal = await f.prepare(false);
  assert.equal(normal.manifest.files[0].patchStatus, 'unavailable');
  assert.equal(normal.manifest.files[0].patch, null);
  assert.deepEqual(normal.manifest.files[0].patchOrigin, { status: 'available', policy: 'sensitive-content' });
  const projected = await f.prepare(true);
  assert.equal(projected.manifest.files[0].patchStatus, 'available');
  assert.deepEqual(projected.manifest.files[0].patchOrigin, { status: 'available', policy: null });
  assert.equal(projected.manifest.files[0].sensitivity.content, true);
  const read = await projected.reader.read('src/header.js', 'head');
  assert.equal(read.commit, H); assert.equal(read.text.includes(f.tokens[1]), false);
  const isolated = await prepareSelfIsolation({ source: projected }, { base: path.join(f.root, 'snapshots') });
  assert.match(await fs.readFile(path.join(isolated.patches, 'src/header.js'), 'utf8'), /Bearer \[FAROL_REDACTED_/);
  assert.ok(isolated.manifest.representations.some(v => v.redactions.length));
  assert.equal(isolated.manifest.projection.hiddenValuesRead, false);
  await f.noOriginalPersisted();
});

test('senha genérica em template não depende do detector de Bearer para impedir cache bruto', async t => {
  const values = [0, 1].map(() => 'fixture-' + randomUUID());
  const f = await fixture(t, { path: '.env.example', beforeText: `DATABASE_PASSWORD=${values[0]}\n`,
    afterText: `DATABASE_PASSWORD=${values[1]}\n`, secretValues: values });
  const source = await f.prepare(true);
  assert.equal(source.manifest.files[0].sensitivity.content, false);
  assert.deepEqual(source.manifest.files[0].patchOrigin, { status: 'available', policy: 'template-keys' });
  const isolated = await prepareSelfIsolation({ source }, { base: path.join(f.root, 'snapshots') });
  assert.match(await fs.readFile(path.join(isolated.patches, '.env.example'), 'utf8'), /patch GitHub=available; política=template-keys/);
  await f.noOriginalPersisted();
});

for (const status of ['modified', 'added', 'removed', 'renamed']) test(`patch ausente usa versões verificadas para ${status}`, async t => {
  const f = await fixture(t, { status, patch: null, previousPath: status === 'renamed' ? 'old/header.js' : undefined });
  const source = await f.prepare(true);
  const isolated = await prepareSelfIsolation({ source }, { base: path.join(f.root, 'snapshots') });
  const view = isolated.manifest.representations.find(v => v.path === 'patches/src/header.js');
  assert.equal(view.kind, 'fixed-versions'); assert.equal(view.references.mergeBase.commit, M);
  assert.equal(view.references.head.commit, H);
  assert.equal(view.references.mergeBase.status, status === 'added' ? 'missing' : 'available');
  assert.equal(view.references.head.status, status === 'removed' ? 'missing' : 'available');
  if (status === 'renamed') assert.equal(view.references.mergeBase.path, 'old/header.js');
  const delivered = await fs.readFile(path.join(isolated.patches, 'src/header.js'), 'utf8');
  assert.match(delivered, /não um diff GitHub/); assert.equal(view.digest.length, 64);
  await f.noOriginalPersisted();
});

test('patch parcial usa versões completas sem promover o fragmento a diff completo', async t => {
  const f = await fixture(t, { patch: '@@ -1 +1 @@\n+partial' }), source = await f.prepare(true);
  assert.equal(source.manifest.files[0].patchStatus, 'partial');
  const isolated = await prepareSelfIsolation({ source }, { base: path.join(f.root, 'snapshots') });
  assert.equal(isolated.manifest.representations[0].kind, 'fixed-versions');
  await f.noOriginalPersisted();
});

for (const name of ['.env.example', '.env.sample']) test(`template ${name} só abre por opt-in e continua ocultando credenciais`, async t => {
  const f = await fixture(t, { path: name, beforeText: 'GH_TOKEN=fixture-before-value\n', afterText: 'GH_TOKEN=fixture-after-value\n' });
  const normal = await f.prepare(false);
  assert.equal((await normal.reader.read(name, 'head')).status, 'excluded');
  const projected = await f.prepare(true);
  assert.equal((await projected.reader.read(name, 'head')).text.includes('fixture-after-value'), false);
  const isolated = await prepareSelfIsolation({ source: projected }, { base: path.join(f.root, 'snapshots') });
  assert.equal((await fs.readFile(path.join(isolated.root, 'head', name), 'utf8')).includes('fixture-after-value'), false);
  const normalAgain = await f.prepare(false);
  assert.equal((await normalAgain.reader.read(name, 'head')).status, 'excluded', 'cache de árvore não amplia permissão de outra execução');
  await f.noOriginalPersisted();
});

for (const options of [{ path: '.env' }, { status: 'renamed', previousPath: '.env' }, { path: '.env.example', mode: '120000', patch: null },
  { mode: '120000' }, { mode: '160000' },
  { afterBytes: Buffer.from([0, 255]), patch: null }, { truncated: true, patch: null }]) test('fonte excluída, link, binário ou árvore incompleta não ganha cobertura', async t => {
  const f = await fixture(t, options), source = await f.prepare(true);
  await assert.rejects(prepareSelfIsolation({ source }, { base: path.join(f.root, 'snapshots') }));
});

test('o host conserva ressalva e torna inconclusiva uma contraprova de arquivo ocultado', async t => {
  const f = await fixture(t), source = await f.prepare(true);
  const isolated = await prepareSelfIsolation({ source }, { base: path.join(f.root, 'snapshots') });
  const key = 'org/projection#42', id = 's-projection';
  t.after(() => fs.rm(checkpointPath(key, 'self'), { force: true }));
  const e = { activeReviews: new Map([[id, { mode: 'self', keys: [key], pr: { key, url: PR.url }, checkpoint: 'self', headSha: H,
    filesRead: new Set(['src/header.js']) }]]), pushState() {} };
  restrictedCheckpoint(e, { id, selfIsolation: isolated }, 'FAROL_CHECKPOINT: ' + JSON.stringify({
    method: 'read', file: 'src/header.js', line: 1, claim: 'valor é válido', verdict: 'confirmado', evidence: 'declaração do modelo' }));
  const entry = readCheckpoint(checkpointPath(key, 'self')).entries.at(-1);
  assert.equal(entry.verdict, 'inconclusivo');
  const result = { summary: 'completo', reportMarkdown: 'tudo lido', coverageLimitations: [] }, observed = { scope: {} };
  recordProjection(result, observed, isolated);
  assert.equal(observed.scope.originalTextComplete, false);
  assert.equal(observed.sourceProjection.hiddenValuesRead, false);
  assert.match(result.reportMarkdown, /valores ocultos não foram lidos/);
  assert.deepEqual(result.coverageLimitations, [], 'ressalva do host não vira um caminho falso na lista do modelo');
});

test('caminho contendo valor reconhecido é recusado antes de cache, snapshot ou prompt', async t => {
  const secret = 'ghp_' + 'q'.repeat(30);
  const f = await fixture(t, { path: `src/${secret}.js`, secretValues: [secret] });
  const source = await prepareSources(engine, PR, { root: path.join(f.root, 'cache'), expectedHead: H,
    projection: createSourceProjection(), limits: { reserveBytes: 1 } });
  assert.equal(source.status, 'unavailable');
  assert.equal(JSON.stringify(source).includes(secret), false);
  await assert.rejects(prepareSelfIsolation({ source }, { base: path.join(f.root, 'snapshots') }));
  await f.noOriginalPersisted();
});
