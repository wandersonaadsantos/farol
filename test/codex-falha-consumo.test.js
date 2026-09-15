// Codex que falha não registrava nada: turn.failed montava resultado com uso vazio e
// custo zero, e o recordUsage descartava tudo zerado (spec 4.1, buraco 1).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-codex-falha-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { eventoCodex, fecharCodex } = await import('../lib/codex/stream.js');
const usage = (await import('../lib/engine/usage.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineReal() {
  const eng = { usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: {}, pushState() { }, log() { }, parseEnvelope: (raw) => raw };
  eng.recordUsage = (...args) => usage.recordUsage(eng, ...args);
  return eng;
}

const estado = () => ({ text: '', sessionId: null, resultEvent: null });

test('turn.failed gera linha de erro com custo desconhecido', () => {
  const eng = engineReal();
  const st = estado();
  eventoCodex({ type: 'turn.failed', error: { message: 'modelo recusou a requisição' } }, st, () => { });
  assert.throws(() => fecharCodex(eng, { id: 'a-cx1', account: 'eu', ref: 'o/r#1' }, { cancelled: false, model: '' }, st, '', '', 1));
  const s = eng.usageSessions.sessions.at(-1);
  assert.ok(s, 'a falha do Codex virou linha');
  assert.equal(s.status, 'erro');
  assert.equal(s.costSource, 'desconhecido');
});

test('processo do Codex morto sem evento nenhum também registra', () => {
  const eng = engineReal();
  assert.throws(() => fecharCodex(eng, { id: 'a-cx2', account: 'eu', ref: 'o/r#2' }, { cancelled: false, model: '' }, estado(), '', 'morreu', 137), /codex saiu com código 137/);
  assert.equal(eng.usageSessions.sessions.at(-1).costSource, 'desconhecido');
});

test('cancelamento sem evento vira cancelada, não erro', () => {
  const eng = engineReal();
  assert.throws(() => fecharCodex(eng, { id: 'a-cx3' }, { cancelled: true, model: '' }, estado(), '', '', null), /cancelada por você/);
  assert.equal(eng.usageSessions.sessions.at(-1).status, 'cancelada');
});

test('turn.completed segue como hoje: medido, sem marca de desconhecido', () => {
  const eng = engineReal();
  const st = estado();
  eventoCodex({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }, st, () => { });
  eventoCodex({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }, st, () => { });
  fecharCodex(eng, { id: 'a-cx4' }, { cancelled: false, model: '' }, st, '', '', 0);
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'ok');
  assert.equal(s.costSource, 'medido');
});

test('saída 0 sem evento nenhum e sem token continua sem linha (stub)', () => {
  const eng = engineReal();
  fecharCodex(eng, { id: 'a-cx5' }, { cancelled: false, model: '' }, estado(), 'texto', '', 0);
  assert.equal(eng.usageSessions.sessions.length, 0);
});
