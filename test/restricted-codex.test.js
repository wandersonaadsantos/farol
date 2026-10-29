import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSelfIsolation } from '../lib/engine/self-isolation.js';
import { sourceRead, dispatchSource } from '../lib/engine/restricted-source.js';
import { observeRestrictedCodex, restrictedCodex } from '../lib/engine/restricted-codex.js';
import io from '../lib/io.js';
import { IS_WIN } from '../lib/paths.js';

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-codex-restricted-'));
after(() => fs.rm(base, { recursive: true, force: true }));
const source = { status: 'complete', manifest: { H: 'a'.repeat(40), files: [
  { path: '.env.example', patch: '+FLAG=false', patchStatus: 'available' },
  { path: 'a.js', patch: '+one\n+two', patchStatus: 'available' }] },
  reader: { tree: async () => ({ complete: true, entries: [] }) } };
const snapshot = await prepareSelfIsolation({ source }, { base });

test('MCP só expõe leitura/listagem fixadas e recusa escapes, operações e intervalos inválidos', async () => {
  const listed = await dispatchSource(snapshot.root, { method: 'tools/list' });
  assert.deepEqual(listed.tools.map(t => t.name), ['read_source', 'list_sources']);
  assert.ok(listed.tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  assert.equal((await sourceRead(snapshot.root, { side: 'patches', path: '.env.example' })).text, '+FLAG=false');
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
    for (const flag of ['--no-daemon', '--ignore-user-config', '--ignore-rules', '--ephemeral', 'read-only']) assert.ok(selected.args.includes(flag));
    assert.ok(selected.args.includes('shell_tool')); assert.ok(selected.args.includes('unified_exec'));
    assert.ok(!selected.args.some(a => a.includes('bypass')));
    assert.equal(selected.env.CODEX_HOME, inherited.CODEX_HOME);
    for (const name of ['GH_TOKEN', 'OPENAI_API_KEY', 'NODE_OPTIONS']) assert.equal(selected.env[name], undefined);
    assert.equal(inherited.GH_TOKEN, 'fake');
    await assert.rejects(restrictedCodex({ ...opts, extraArgs: ['--resume', 'old'] }, { kind: 'codex' }, inherited));
    io.run = async () => ({ ok: true, stdout: '--sandbox' });
    await assert.rejects(restrictedCodex(opts, { kind: 'codex' }, inherited), /sem contrato/);
  } finally { io.run = original; }
});
