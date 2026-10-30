import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { prepareSelfIsolation } from '../lib/engine/self-isolation.js';
import { sourceRead, dispatchSource, serveSource } from '../lib/engine/restricted-source.js';
import { observeRestrictedCodex, restrictedCodex, beginRestrictedCodexObservation, finishRestrictedCodexObservation } from '../lib/engine/restricted-codex.js';
import io from '../lib/io.js';
import { IS_WIN } from '../lib/paths.js';
import { blobHash } from '../lib/review-source/contract.js';

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-codex-restricted-'));
after(() => fs.rm(base, { recursive: true, force: true }));
const source = { status: 'complete', manifest: { H: 'a'.repeat(40), B: 'b'.repeat(40), M: 'c'.repeat(40), files: [
  { path: '.env.example', status: 'added', patch: '+FLAG=false', patchStatus: 'available' },
  { path: 'a.js', patch: '+one\n+two', patchStatus: 'available' }] },
  reader: { tree: async side => ({ complete: true, entries: [
    ...(side === 'head' ? [{ path: '.env.example', readable: true, mode: '100644' }] : []),
    { path: 'a.js', readable: true, mode: '100644' }] }),
    read: async (_path, side) => ({ status: side === 'head' ? 'available' : 'missing',
      commit: side === 'head' ? 'a'.repeat(40) : 'c'.repeat(40), mode: '100644',
      blob: blobHash(Buffer.from('FLAG=false\n')), text: 'FLAG=false\n' }) } };
const snapshot = await prepareSelfIsolation({ source }, { base });

test('diagnóstico distingue configuração de resposta real, sem preservar stderr ou argumentos', async () => {
  const session = { filesRead: new Set(), scopeRoot: snapshot.patches };
  const engine = { activeReviews: new Map([['s', session]]) }, opts = { id: 's', selfIsolation: snapshot };
  beginRestrictedCodexObservation(engine, opts);
  assert.equal(session.sourceTools.calls, 0);
  assert.equal(session.sourceTools.responses, 0);
  const result = await dispatchSource(snapshot.root, { method: 'tools/call', params: {
    name: 'list_sources', arguments: { side: 'patches' } } });
  observeRestrictedCodex(engine, opts, { type: 'item.completed', item: { type: 'mcp_tool_call',
    server: 'farol_source', tool: 'list_sources', status: 'completed', result } });
  observeRestrictedCodex(engine, opts, { type: 'item.completed', item: { type: 'mcp_tool_call',
    server: 'farol_source', tool: 'read_source', status: 'failed', error: { message: 'não guardar mensagem' } } });
  finishRestrictedCodexObservation(engine, opts, 0, 'farol_source startup failed; PRIVATE_VALUE_NOT_TO_PERSIST');
  assert.deepEqual(session.sourceTools, { provider: 'codex', configured: true, calls: 2, responses: 1, failures: 1,
    finished: true, exitCode: 0, stderrMcpMentioned: true, stderrMcpFailureHint: true });
  assert.equal(JSON.stringify(session.sourceTools).includes('PRIVATE_VALUE_NOT_TO_PERSIST'), false);
  assert.equal(JSON.stringify(session.sourceTools).includes('não guardar mensagem'), false);
});

test('protocolo RPC recusa identificador fora do orçamento antes de produzir resposta', async () => {
  const input = new PassThrough(), output = new PassThrough();
  serveSource(snapshot.root, input, output);
  const first = new Promise(resolve => output.once('data', chunk => resolve(JSON.parse(String(chunk)))));
  for (const id of ['x'.repeat(65), {}, true]) input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  const result = await first;
  assert.equal(result.id, 1, 'O primeiro retorno pertence ao único identificador aceito.');
  assert.equal(result.result.tools.length, 2);
  input.end(); output.end();
});

test('MCP só expõe leitura/listagem fixadas e recusa escapes, operações e intervalos inválidos', async () => {
  const listed = await dispatchSource(snapshot.root, { method: 'tools/list' });
  assert.deepEqual(listed.tools.map(t => t.name), ['read_source', 'list_sources']);
  assert.ok(listed.tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  const template = (await sourceRead(snapshot.root, { side: 'patches', path: '.env.example' })).text;
  assert.match(template, /FLAG=\[FAROL_REDACTED_/);
  assert.equal(template.includes('FLAG=false'), false);
  for (const input of [{ side: 'patches', path: '../outside' }, { side: 'patches', path: '/outside' },
    { side: 'patches', path: 'C:/outside' }, { side: 'runtime', path: 'file' },
      { side: 'patches', path: 'a.js', start: -1 }, { side: 'patches', path: 'a.js', count: 61 }]) {
    await assert.rejects(sourceRead(snapshot.root, input));
  }
  await assert.rejects(dispatchSource(snapshot.root, { method: 'tools/call', params: { name: 'delete_file' } }));
  const outside = path.join(base, 'outside.txt'); await fs.writeFile(outside, 'untouched');
  const link = path.join(snapshot.patches, 'link');
  try { await fs.symlink(outside, link); }
  catch (error) { if (error.code !== 'EPERM') throw error; }
  try { await fs.lstat(link); await assert.rejects(sourceRead(snapshot.root, { side: 'patches', path: 'link' })); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
});

test('cobertura Codex exige retorno real do servidor próprio e o patch integral em páginas', async () => {
  const session = { scopeRoot: snapshot.patches, filesRead: new Set() };
  const e = { activeReviews: new Map([['s', session]]) }, opts = { id: 's', selfIsolation: snapshot };
  for (const start of [1, 2]) {
    const result = await dispatchSource(snapshot.root, { method: 'tools/call', params: {
      name: 'read_source', arguments: { side: 'patches', path: 'a.js', start, count: 1 } } });
    const event = { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'farol_source',
      tool: 'read_source', status: 'completed', result } };
    assert.throws(() => observeRestrictedCodex(e, opts, { ...event, item: { ...event.item, server: 'foreign' } }), /fora do contrato/);
    assert.equal(session.filesRead.size, 0);
    observeRestrictedCodex(e, opts, event);
    assert.equal(session.filesRead.size, start === 2 ? 1 : 0);
  }
});

test('launcher Codex é por execução, sem shell/config herdada, persistência, bypass ou mudança do perfil', async () => {
  const cliDir = path.join(base, 'cli'); await fs.mkdir(cliDir);
  const command = path.join(cliDir, IS_WIN ? 'codex.exe' : 'codex'); await fs.writeFile(command, 'fixture');
  const inherited = { PATH: cliDir, CODEX_HOME: '/existing-profile', GH_TOKEN: 'fake', OPENAI_API_KEY: 'fake', NODE_OPTIONS: '--require unsafe' };
  const original = io.run;
  io.run = async () => ({ ok: true, stdout: '--ignore-user-config --ignore-rules --ephemeral --sandbox' });
  try {
    const opts = { operationKind: 'self', selfIsolation: snapshot, extraArgs: [] };
    const selected = await restrictedCodex(opts, { kind: 'codex' }, inherited, { model: 'configured-model', effort: 'high' });
    assert.equal(selected.cwd, snapshot.root); assert.equal((await fs.stat(selected.command)).ino, (await fs.stat(command)).ino);
    for (const flag of ['--no-daemon', '--ignore-user-config', '--ignore-rules', '--ephemeral']) assert.ok(selected.args.includes(flag));
    assert.ok(selected.args.includes('default_permissions="farol_read"'));
    assert.ok(selected.args.some(arg => arg.startsWith('permissions.farol_read.filesystem=') && arg.includes('":workspace_roots"="read"')));
    assert.ok(selected.args.includes('permissions.farol_read.network.enabled=false'));
    assert.ok(selected.args.includes('shell_tool')); assert.ok(selected.args.includes('unified_exec'));
    assert.ok(!selected.args.some(a => a.includes('bypass')));
    assert.equal(selected.env.CODEX_HOME, inherited.CODEX_HOME);
    const budget = Number(selected.args.find(arg => arg.startsWith('tool_output_token_limit=')).split('=')[1]);
    for (const character of ['漢', '\u0001', '"', '\\']) {
      await fs.writeFile(path.join(snapshot.patches, 'maximum-page.js'), character.repeat(2048));
      const maximumPage = await dispatchSource(snapshot.root, { method: 'tools/call', params: {
        name: 'read_source', arguments: { side: 'patches', path: 'maximum-page.js' } } });
      const frame = { jsonrpc: '2.0', id: '\u0001'.repeat(64), result: maximumPage };
      assert.ok(Buffer.byteLength(JSON.stringify(frame)) < budget,
        'Um token por byte cabe incluindo controles, aspas, barras, representações e envelope RPC.');
      assert.equal(JSON.parse(maximumPage.content[1].text).rendered, undefined, 'Não duplica novamente a representação numerada.');
    }
    await fs.writeFile(path.join(snapshot.patches, 'oversized-line.js'), 'x'.repeat(2049));
    await assert.rejects(sourceRead(snapshot.root, { side: 'patches', path: 'oversized-line.js' }), /linha acima do limite/);
    for (const name of ['GH_TOKEN', 'OPENAI_API_KEY', 'NODE_OPTIONS']) assert.equal(selected.env[name], undefined);
    assert.equal(inherited.GH_TOKEN, 'fake');
    await assert.rejects(restrictedCodex({ ...opts, extraArgs: ['--resume', 'old'] }, { kind: 'codex' }, inherited));
    io.run = async () => ({ ok: true, stdout: '--sandbox' });
    await assert.rejects(restrictedCodex(opts, { kind: 'codex' }, inherited), /sem contrato/);
  } finally { io.run = original; }
});
