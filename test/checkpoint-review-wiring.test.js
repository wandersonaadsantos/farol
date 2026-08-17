// Confirma que a MONTAGEM de result.verificationCheckpoint segue exatamente
// summarizeCheckpoint(readCheckpoint(checkpointPath(pr.key)).entries), do jeito que
// runHeadlessReview monta antes de chamar shouldAutoApprove.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-wiring-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { checkpointPath, appendCheckpointEntry, readCheckpoint, summarizeCheckpoint, resumeBlock } = await import('../lib/engine/verification-checkpoint.js');

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

test('decide injetar resumeBlock quando o checkpoint tem entradas', () => {
  const prKey = 'wiring/teste#2';
  const p = checkpointPath(prKey);
  appendCheckpointEntry(p, prKey, 'url', { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' });

  // é exatamente a lógica que entra em runHeadlessReview antes de runClaudeStream
  const cp = readCheckpoint(checkpointPath(prKey));
  let prompt = 'prompt base';
  if (cp.ok && cp.entries.length) prompt += resumeBlock(cp.entries.length, checkpointPath(prKey));

  assert.match(prompt, /ATENÇÃO/);
  assert.match(prompt, /1 afirmação/);
});

test('NÃO injeta resumeBlock quando o checkpoint está ausente ou vazio', () => {
  const prKey = 'wiring/teste#3'; // nunca gravado
  const cp = readCheckpoint(checkpointPath(prKey));
  let prompt = 'prompt base';
  if (cp.ok && cp.entries.length) prompt += resumeBlock(cp.entries.length, checkpointPath(prKey));

  assert.equal(prompt, 'prompt base', 'sem checkpoint, o prompt não ganha nada a mais');
});

test('resumeBlock não conta entradas de um head antigo na decisão de injetar', () => {
  const prKey = 'wiring/teste#4';
  const p = checkpointPath(prKey);
  appendCheckpointEntry(p, prKey, 'url', { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado', headSha: 'sha-velho' });

  const cp = readCheckpoint(p);
  const headShaAtual = 'sha-novo';
  const relevantes = cp.entries.filter(e => !e.headSha || e.headSha === headShaAtual);
  let prompt = 'prompt base';
  if (cp.ok && relevantes.length) prompt += resumeBlock(relevantes.length, p);

  assert.equal(prompt, 'prompt base', 'entrada é só do SHA antigo: não deveria disparar o aviso de retomada pro head atual');
});
