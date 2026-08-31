// Checkpoint de verificação: memória persistida e incremental do que a revisão headless
// já confirmou, pra não reprocessar do zero depois de um subagente travar em 529 ou a
// sessão ser relançada. Ver a seção "Checkpoint de verificação" do CLAUDE.md.
// Runner nativo (node --test), ZERO dependências.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkpoint-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { checkpointPath, appendCheckpointEntry } = await import('../lib/engine/verification-checkpoint.js');
const { STATE_DIR } = await import('../lib/paths.js');

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

const { readCheckpoint, summarizeCheckpoint } = await import('../lib/engine/verification-checkpoint.js');

test('readCheckpoint: arquivo ausente devolve ok:true com entries vazio', () => {
  const p = checkpointPath('nunca/existiu#1');
  const r = readCheckpoint(p);
  assert.deepEqual(r, { ok: true, entries: [] });
});

test('readCheckpoint: JSON malformado devolve ok:false com motivo', () => {
  const p = checkpointPath('malformado/teste#1');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ isso nao e json valido');
  const r = readCheckpoint(p);
  assert.equal(r.ok, false);
  assert.ok(r.reason, 'tem motivo');
});

test('readCheckpoint: JSON válido sem campo entries devolve ok:false', () => {
  const p = checkpointPath('semcampo/teste#1');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ prKey: 'x' }));
  const r = readCheckpoint(p);
  assert.equal(r.ok, false);
});

test('readCheckpoint: JSON válido e completo devolve as entradas intactas', () => {
  const p = checkpointPath('completo/teste#1');
  appendCheckpointEntry(p, 'completo/teste#1', 'url', { claim: 'c', file: 'f.ts', line: 1, verdict: 'confirmado', evidence: 'e', sessionId: 's', at: 'x' });
  const r = readCheckpoint(p);
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].claim, 'c');
});

test('summarizeCheckpoint: sem entradas', () => {
  assert.deepEqual(summarizeCheckpoint([]), { total: 0, confirmedCount: 0, conflicts: [] });
});

test('summarizeCheckpoint: entradas concordantes não geram conflito', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' },
    { claim: 'b', file: 'y.ts', line: 2, verdict: 'refutado' },
  ];
  const s = summarizeCheckpoint(entries);
  assert.equal(s.total, 2);
  assert.equal(s.confirmedCount, 1);
  assert.deepEqual(s.conflicts, []);
});

test('summarizeCheckpoint: duas entradas da MESMA afirmação com veredito diferente geram um conflito', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado', at: '2026-08-05T10:00:00-03:00' },
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'refutado', at: '2026-08-05T10:10:00-03:00' },
  ];
  const s = summarizeCheckpoint(entries);
  assert.equal(s.conflicts.length, 1);
  assert.equal(s.conflicts[0].entries.length, 2);
});

test('summarizeCheckpoint: mesma linha, claim DIFERENTE, não é conflito (afirmações distintas)', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado' },
    { claim: 'b (outra afirmação na mesma linha)', file: 'x.ts', line: 1, verdict: 'refutado' },
  ];
  const s = summarizeCheckpoint(entries);
  assert.deepEqual(s.conflicts, [], 'claim diferente não agrupa junto');
});

test('summarizeCheckpoint detecta conflito mesmo com fraseado ligeiramente diferente da claim', () => {
  const entries = [
    { file: 'a.ts', line: 10, claim: 'a função trata null corretamente', verdict: 'confirmado' },
    { file: 'a.ts', line: 10, claim: '  A Função   trata NULL corretamente', verdict: 'refutado' },
  ];
  const r = summarizeCheckpoint(entries);
  assert.equal(r.conflicts.length, 1, 'variação de caixa/espaço/pontuação na claim não deveria esconder o conflito');
});

const { resumeBlock } = await import('../lib/engine/verification-checkpoint.js');

test('summarizeCheckpoint sem currentHeadSha considera todas as entradas (compatibilidade)', () => {
  const entries = [
    { file: 'a.ts', line: 1, claim: 'x', verdict: 'confirmado', headSha: 'sha-velho' },
    { file: 'b.ts', line: 2, claim: 'y', verdict: 'confirmado', headSha: 'sha-novo' },
  ];
  const r = summarizeCheckpoint(entries);
  assert.equal(r.total, 2);
});

test('summarizeCheckpoint com currentHeadSha ignora entradas de SHA diferente', () => {
  const entries = [
    { file: 'a.ts', line: 1, claim: 'x', verdict: 'refutado', headSha: 'sha-velho' },
    { file: 'a.ts', line: 1, claim: 'x', verdict: 'confirmado', headSha: 'sha-novo' },
  ];
  // sem filtro, isto seria um conflito (mesma claim, veredito diferente); com o SHA
  // atual = sha-novo, a entrada velha some e não sobra conflito nenhum
  const r = summarizeCheckpoint(entries, 'sha-novo');
  assert.equal(r.total, 1);
  assert.equal(r.conflicts.length, 0);
});

test('summarizeCheckpoint com currentHeadSha ainda considera entradas sem headSha (dado antigo, nunca descarta por falta de info)', () => {
  const entries = [
    { file: 'a.ts', line: 1, claim: 'x', verdict: 'confirmado' }, // sem headSha (gravado antes da Task 12, ou gh falhou)
  ];
  const r = summarizeCheckpoint(entries, 'sha-novo');
  assert.equal(r.total, 1);
});

test('resumeBlock: menciona a contagem e o caminho, em tom de atenção', () => {
  const texto = resumeBlock(5, '/caminho/x.json');
  assert.match(texto, /5/);
  assert.match(texto, /\/caminho\/x\.json/);
  assert.match(texto, /ATENÇÃO/);
});

/* ---------- divergência é ENTRE passadas, não dentro de uma ---------- */
// biudtech/biud-mia#121, medido em 30/08/2026: a mesma sessão `a3`, mesmo head e mesmo
// blob, gravou `confirmado` às 18:37:02 e `parcial` às 18:37:47. Ela refinou a própria
// resposta, e o app leu isso como conflito entre rodadas, travando approve E reject
// naquele PR pra sempre (nada expira a entrada).

test('mesma sessão que refina o próprio veredito NÃO é divergência', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'confirmado', sessionId: 'a3' },
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'parcial', sessionId: 'a3' },
  ];
  const vc = summarizeCheckpoint(entries);
  assert.equal(vc.conflicts.length, 0);
  assert.equal(vc.total, 2, 'as duas entradas continuam contadas: nada é apagado');
});

test('sessões DIFERENTES que discordam continuam sendo divergência', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'confirmado', sessionId: 'a3' },
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'refutado', sessionId: 'a9' },
  ];
  assert.equal(summarizeCheckpoint(entries).conflicts.length, 1);
});

test('dentro da sessão vale o ÚLTIMO veredito, e é ele que confronta a outra sessão', () => {
  const iguais = [
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'refutado', sessionId: 'a3' },
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'confirmado', sessionId: 'a3' },
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'confirmado', sessionId: 'a9' },
  ];
  assert.equal(summarizeCheckpoint(iguais).conflicts.length, 0, 'o último da a3 concorda com a a9');
});

test('entrada sem sessionId conta como passada própria (dado antigo não apaga divergência)', () => {
  const entries = [
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'confirmado' },
    { claim: 'a', file: 'x.ts', line: 2, verdict: 'refutado' },
  ];
  assert.equal(summarizeCheckpoint(entries).conflicts.length, 1);
});
