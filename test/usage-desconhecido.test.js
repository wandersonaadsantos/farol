// Custo que não se sabe não pode aparecer como zero, nem se esconder no balde medido
// (spec 4.1, buracos 1 e 4, e o extra da auditoria). E a sessão cortada pelo fim
// abrupto do processo precisa de um desfecho próprio.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-desconhecido-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const usage = (await import('../lib/engine/usage.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const engineDeTeste = () => ({ usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: {}, pushState() { }, log() { } });

test('estimativa sem base devolve origem desconhecido, nunca um número inventado', () => {
  assert.deepEqual(usage.estimarCusto([], 'review', 'Opus 5', 250), { costUsd: 0, source: 'desconhecido' });
});

test('falha com custo desconhecido e sem token vira linha, e não some', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-cx', 'eu', { usage: {}, is_error: true, total_cost_usd: 0, farol_custo_desconhecido: true }, 'Codex (padrão)', 'p1', 'o/r#1');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(eng.usageSessions.sessions.length, 1);
  assert.equal(s.costSource, 'desconhecido');
  assert.equal(s.status, 'erro');
  assert.equal(s.costUsd, 0);
});

test('stub zerado sem marca continua ignorado', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-z', 'eu', { usage: {}, total_cost_usd: 0 }, 'claude-opus-5', '', 'x');
  assert.equal(eng.usageSessions.sessions.length, 0);
});

test('interrompida sem token: desfecho interrompida e custo desconhecido', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-int', 'eu', { usage: {}, farol_interrompida: true, farol_custo_desconhecido: true, farol_attempt: 'tent-1', farol_iniciada_em: 1234, farol_provedor_destacado: true }, 'claude-opus-5', 'p1', 'o/r#2');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'desconhecido');
  assert.equal(s.attemptId, 'tent-1');
  assert.equal(s.iniciadaEm, 1234);
  assert.equal(s.provedorPodeTerContinuado, true);
});

test('interrompida com token parcial: estimado quando há base, e interrompida vence parcial', () => {
  const medida = { status: 'ok', kind: 'review', model: 'Opus 5', outputTokens: 1000, costUsd: 1 };
  const eng = engineDeTeste();
  eng.usageSessions.sessions.push(medida, { ...medida }, { ...medida });
  usage.recordUsage(eng, 'a-int2', 'eu', { usage: { output_tokens: 500 }, farol_parcial: true, farol_interrompida: true, farol_attempt: 'tent-2' }, 'claude-opus-5', 'p1', 'o/r#3');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'estimado');
  assert.equal(s.costUsd, 0.5);
  assert.equal('provedorPodeTerContinuado' in s, false);
});

test('linha normal não ganha campos de tentativa além do attemptId informado', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-ok', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1, farol_attempt: 'tent-3', farol_resume_outcome: 'retomada' }, 'claude-opus-5', '', 'x');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'ok');
  assert.equal(s.costSource, 'medido');
  assert.equal(s.attemptId, 'tent-3');
  assert.equal(s.resumeOutcome, 'retomada', 'o desfecho da retomada da A5 persiste na linha');
  assert.equal('iniciadaEm' in s, false);
  usage.recordUsage(eng, 'a-ok2', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1, farol_resume_outcome: 'inventado' }, 'claude-opus-5', '', 'x');
  assert.equal('resumeOutcome' in eng.usageSessions.sessions.at(-1), false);
});

test('auditoria separa desconhecido (inclusive o legado sem-base) do medido', () => {
  const r = usage.auditoriaDeConsumo([
    { costUsd: 2, costSource: 'medido', status: 'ok' },
    { costUsd: 0, costSource: 'sem-base', status: 'parcial' },
    { costUsd: 0, costSource: 'desconhecido', status: 'interrompida' },
  ]);
  assert.deepEqual(r.medido, { sessions: 1, costUsd: 2 });
  assert.deepEqual(r.desconhecido, { sessions: 2, costUsd: 0 });
  assert.equal(r.perdido.sessions, 2, 'parcial e interrompida são gasto que não virou resultado');
});

test('marcarDesfecho aceita interrompida', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'a-m', 'eu', { usage: { output_tokens: 1 }, total_cost_usd: 0.1 }, 'claude-opus-5', '', 'x');
  assert.equal(usage.marcarDesfecho(eng, 'a-m', 'interrompida'), true);
  assert.ok(usage.DESFECHOS.includes('interrompida'));
});
