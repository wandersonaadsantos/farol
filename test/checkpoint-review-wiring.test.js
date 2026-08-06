'use strict';
// Confirma que a MONTAGEM de result.verificationCheckpoint segue exatamente
// summarizeCheckpoint(readCheckpoint(checkpointPath(pr.key)).entries), do jeito que
// runHeadlessReview monta antes de chamar shouldAutoApprove.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-wiring-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { checkpointPath, appendCheckpointEntry, readCheckpoint, summarizeCheckpoint } = require('../lib/engine/verification-checkpoint');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

test('monta verificationCheckpoint a partir do arquivo real, com conflito detectado', () => {
  const prKey = 'wiring/teste#1';
  const p = checkpointPath(prKey);
  appendCheckpointEntry(p, prKey, 'url', { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' });
  appendCheckpointEntry(p, prKey, 'url', { claim: 'a', file: 'x.ts', line: 1, verdict: 'refutado' });

  // isto é exatamente a linha que entra em runHeadlessReview
  const lido = readCheckpoint(checkpointPath(prKey));
  const vc = lido.ok ? summarizeCheckpoint(lido.entries) : { malformed: true };

  assert.equal(vc.total, 2);
  assert.equal(vc.conflicts.length, 1);
});
