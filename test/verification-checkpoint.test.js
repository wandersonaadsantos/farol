'use strict';
// Checkpoint de verificação: memória persistida e incremental do que a revisão headless
// já confirmou, pra não reprocessar do zero depois de um subagente travar em 529 ou a
// sessão ser relançada. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
// Runner nativo (node --test), ZERO dependências.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { checkpointPath, appendCheckpointEntry } = require('../lib/engine/verification-checkpoint');
const { STATE_DIR } = require('../lib/paths');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('checkpointPath: usa encodeURIComponent, nunca colide entre keys diferentes', () => {
  const p1 = checkpointPath('a__b/c#1');
  const p2 = checkpointPath('a/b__c#1');
  assert.notEqual(p1, p2, 'owner/repo com __ não pode colidir');
  assert.ok(p1.startsWith(path.join(STATE_DIR, 'verification')), 'fica dentro de state/verification');
  assert.match(p1, /\.json$/);
});

test('appendCheckpointEntry: cria o diretório e o arquivo na primeira gravação', () => {
  const p = checkpointPath('acme/repo#42');
  assert.equal(fs.existsSync(p), false, 'ainda não existe');
  appendCheckpointEntry(p, 'acme/repo#42', 'https://github.com/acme/repo/pull/42', {
    claim: 'x.ts:10 confirma y', file: 'x.ts', line: 10, verdict: 'confirmado',
    evidence: 'linha 10 confirma', sessionId: 's1', at: '2026-08-05T10:00:00-03:00',
  });
  assert.equal(fs.existsSync(p), true);
  const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(saved.prKey, 'acme/repo#42');
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].verdict, 'confirmado');
});

test('appendCheckpointEntry: é append-only, nunca sobrescreve entrada anterior', () => {
  const p = checkpointPath('acme/repo#43');
  appendCheckpointEntry(p, 'acme/repo#43', 'https://github.com/acme/repo/pull/43', {
    claim: 'a', file: 'a.ts', line: 1, verdict: 'confirmado', evidence: 'e1', sessionId: 's1', at: '2026-08-05T10:00:00-03:00',
  });
  appendCheckpointEntry(p, 'acme/repo#43', 'https://github.com/acme/repo/pull/43', {
    claim: 'a', file: 'a.ts', line: 1, verdict: 'refutado', evidence: 'e2', sessionId: 's2', at: '2026-08-05T10:05:00-03:00',
  });
  const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(saved.entries.length, 2, 'as duas entradas ficam, mesmo divergindo');
  assert.equal(saved.entries[0].verdict, 'confirmado');
  assert.equal(saved.entries[1].verdict, 'refutado');
});
