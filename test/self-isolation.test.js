import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSelfIsolation, isolationMode, assertSelfIsolation, isolatedSelfBlock } from '../lib/engine/self-isolation.js';
import { restrictedEnvironment, restrictedLaunch } from '../lib/engine/restricted-launch.js';
import { restrictedVerification, restrictedCheckpoint } from '../lib/engine/self-read-proof.js';
import { verificacaoObservada } from '../lib/engine/selfpr.js';
import { checkpointPath, readCheckpoint } from '../lib/engine/verification-checkpoint.js';
import { assertRestrictedTools } from '../lib/engine/restricted-launch.js';
import { observeReadEvent, observarLeitura } from '../lib/engine/read-evidence.js';
import { IS_WIN } from '../lib/paths.js';

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-isolation-test-'));
after(() => fs.rm(base, { recursive: true, force: true }));
function prepared(files = [{ path: 'src/a.js', patch: '+safe', patchStatus: 'available' }]) {
  return { source: { status: 'complete', manifest: { H: 'a'.repeat(40), B: 'b'.repeat(40), M: 'c'.repeat(40), files },
    reader: { tree: async () => ({ complete: true, entries: [{ path: 'src/a.js', readable: true },
      { path: '.env', readable: false }, { path: 'link', readable: false }] }),
    read: async () => ({ status: 'available', text: 'export const n = 1;' }) } } };
}

test('duas execuções não compartilham fontes, temporários ou MCP e não tocam o vizinho', async () => {
  const neighbor = path.join(base, 'foreign.tmp');
  await fs.writeFile(neighbor, 'preserve');
  const [a, b] = await Promise.all([prepareSelfIsolation(prepared(), { base }), prepareSelfIsolation(prepared(), { base })]);
  assert.notEqual(a.root, b.root);
  assert.equal(await fs.readFile(path.join(a.patches, 'src/a.js'), 'utf8'), '+safe');
  assert.equal(await fs.readFile(path.join(a.root, 'head/src/a.js'), 'utf8'), 'export const n = 1;');
  await assert.rejects(fs.access(path.join(a.root, 'head/.env')));
  await assert.rejects(fs.access(path.join(a.root, 'head/link')));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(a.root, 'mcp.json'))), { mcpServers: {} });
  assert.equal(await fs.readFile(neighbor, 'utf8'), 'preserve');
  assert.match(isolatedSelfBlock(a), /Não execute comandos nem alegue testes executados/);
  assert.throws(() => assertSelfIsolation({ ...a }), /propriedade/);
});

test('fonte incompleta, patch ausente, traversal, segredo e cancelamento recusam execução', async () => {
  await assert.rejects(prepareSelfIsolation({ source: { status: 'unavailable' } }, { base }), /fixadas/);
  for (const file of [
    { path: '../foreign.tmp', patch: '+x', patchStatus: 'available' },
    { path: '.env', patch: '+x', patchStatus: 'available' },
    { path: 'x', patchStatus: 'unavailable' }
  ]) await assert.rejects(prepareSelfIsolation(prepared([file]), { base }));
  const incomplete = prepared(); incomplete.source.reader.tree = async () => ({ complete: false });
  await assert.rejects(prepareSelfIsolation(incomplete, { base }), /incompleta/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareSelfIsolation(prepared(), { base, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(isolationMode('restricted-read'), 'restricted-read');
  assert.throws(() => isolationMode('bypass'), /não suportado/);
  if (IS_WIN) {
    for (const path of ['.. /outside.txt', 'NUL', 'con .txt', 'COM¹.js', 'trailing./x.js', 'safe/x.']) {
      await assert.rejects(prepareSelfIsolation(prepared([{ path, patch: '+safe', patchStatus: 'available' }]), { base }), /Windows/);
    }
  }
});

test('ambiente do filho não herda tokens GitHub, API, opções Node ou diretórios temporários compartilhados', () => {
  const inherited = { PATH: '/bin', HOME: '/home/test', GH_TOKEN: 'fake', ANTHROPIC_API_KEY: 'fake',
    NODE_OPTIONS: '--require unsafe', TEMP: '/shared', CLAUDE_CONFIG_DIR: '/other-profile' };
  const auth = { kind: 'dir', dir: '/chosen-profile' };
  const env = restrictedEnvironment(inherited, auth, base);
  assert.equal(env.CLAUDE_CONFIG_DIR, auth.dir);
  assert.equal(env.TEMP, path.join(base, 'runtime'));
  for (const key of ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
  assert.equal(inherited.TEMP, '/shared'); assert.equal(inherited.CLAUDE_CONFIG_DIR, '/other-profile');
});

test('provedor incompatível, MCP, retomada e snapshot forjado não iniciam fallback', async () => {
  const selfIsolation = await prepareSelfIsolation(prepared(), { base });
  for (const [opts, auth] of [
    [{ selfIsolation, operationKind: 'self' }, { kind: 'codex' }],
    [{ selfIsolation, operationKind: 'review' }, { kind: 'dir', dir: '/profile' }],
    [{ selfIsolation, operationKind: 'self', extraArgs: ['--resume', 'old'] }, { kind: 'dir', dir: '/profile' }],
    [{ selfIsolation: { ...selfIsolation }, operationKind: 'self' }, { kind: 'dir', dir: '/profile' }]
  ]) await assert.rejects(restrictedLaunch(opts, auth, {}));
});

test('verificação restrita só usa leitura entregue da sessão e do head; ausência não dispensa contraprova', () => {
  const head = 'a'.repeat(40), id = 's-test';
  const session = { checkpoint: 'self', headSha: head, pr: { key: 'fixture/repo#491' }, filesRead: new Set() };
  const e = { activeReviews: new Map([[id, session]]) }, opts = { id, selfIsolation: {} };
  const entry = { method: 'read', file: 'src/a.js', claim: 'Contraprova estática', verdict: 'confirmado', evidence: 'O ramo rejeita a entrada.' };
  restrictedCheckpoint(e, opts, 'FAROL_CHECKPOINT: invalid');
  restrictedCheckpoint(e, opts, 'FAROL_CHECKPOINT: ' + JSON.stringify(entry));
  let entries = readCheckpoint(checkpointPath(session.pr.key, 'self')).entries;
  assert.equal(entries.length, 0, 'tentativa de leitura não prova entrega');
  session.filesRead.add(entry.file);
  restrictedCheckpoint(e, opts, 'FAROL_CHECKPOINT: ' + JSON.stringify(entry));
  entries = readCheckpoint(checkpointPath(session.pr.key, 'self')).entries;
  assert.match(entries[0].evidence, /sem execução de teste/);
  assert.equal(restrictedVerification(entries, head, id, verificacaoObservada).status, 'satisfied');
  assert.equal(restrictedVerification(entries, 'b'.repeat(40), id, verificacaoObservada).status, 'unknown');
  assert.equal(restrictedVerification(entries, head, 'other-session', verificacaoObservada).status, 'unknown');
  assert.equal(restrictedVerification([{ ...entries[0], verdict: 'inconclusivo' }], head, id, verificacaoObservada).status, 'unknown');
  assert.equal(restrictedVerification([...entries, { ...entries[0], verdict: 'inconclusivo' }], head, id, verificacaoObservada).status, 'unknown');
  assert.equal(restrictedVerification([{ ...entries[0], verdict: 'refutado' }], head, id, verificacaoObservada).status, 'failed');
  assert.throws(() => assertRestrictedTools({ tools: ['Read', 'Grep', 'Glob', 'Bash'] }), /divergem/);
  assert.throws(() => assertRestrictedTools({}), /divergem/);
  assert.doesNotThrow(() => assertRestrictedTools({ tools: ['Read', 'Grep', 'Glob'] }));
});

test('conteúdo sensível opcional é excluído com registro; patch ou fonte alterada sensível recusam', async () => {
  const secret = 'Authorization: Bearer fake-test-token-123456789';
  const fixture = prepared();
  fixture.source.reader.tree = async () => ({ complete: true, entries: [{ path: 'test/auth.js', readable: true }] });
  fixture.source.reader.read = async () => ({ status: 'available', text: secret });
  const value = await prepareSelfIsolation(fixture, { base });
  assert.ok(value.limitations.some(e => e.path === 'test/auth.js' && e.status === 'sensitive'));
  await assert.rejects(fs.access(path.join(value.root, 'head/test/auth.js')));
  fixture.source.manifest.files = [{ path: 'test/auth.js', patchStatus: 'available', patch: '+safe' }];
  await assert.rejects(prepareSelfIsolation(fixture, { base }), /alterada sensível/);
  fixture.source.manifest.files[0].patch = '+' + secret;
  await assert.rejects(prepareSelfIsolation(fixture, { base }), /sensível/);
});

test('Read negado, truncado ou sem conteúdo conferido não vira cobertura no modo restrito', async () => {
  const value = await prepareSelfIsolation(prepared(), { base });
  const session = { scopeRoot: value.patches, filesRead: new Set() };
  const e = { config: { reviewBatchedReads: false }, activeReviews: new Map([['s', session]]) };
  const opts = { id: 's', selfIsolation: value }, filePath = path.join(value.patches, 'src/a.js');
  const block = { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: filePath } };
  observarLeitura(e, opts, block); assert.equal(session.filesRead.size, 0);
  observeReadEvent(e, opts, { type: 'assistant', message: { content: [block] } });
  observeReadEvent(e, opts, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', is_error: true, content: 'Denied' }] } });
  assert.equal(session.filesRead.size, 0);
  observeReadEvent(e, opts, { type: 'assistant', message: { content: [block] } });
  observeReadEvent(e, opts, { type: 'user', tool_use_result: { type: 'text', file: {
    filePath, content: '+saf', startLine: 1, numLines: 1 } }, message: { content: [{
    type: 'tool_result', tool_use_id: 'r', content: '1→+saf' }] } });
  assert.equal(session.filesRead.size, 0);
});
