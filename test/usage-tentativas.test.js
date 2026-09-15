// O acumulador de consumo vive em memória: app fechado no meio (bandeja, queda) perdia
// o gasto inteiro (spec 4.1, buraco 3). O diário grava a tentativa antes do provedor e o
// parcial durante a sessão; o boot seguinte transforma o que sobrou em linha interrompida.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-tentativas-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const t = await import('../lib/engine/usage-tentativas.js');
const usage = (await import('../lib/engine/usage.js')).default;
const { TEMPOS } = await import('../lib/constants.js');
const { IS_WIN } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { fs.rmSync(t.arquivoDeTentativas(), { force: true }); });

const ler = () => JSON.parse(fs.readFileSync(t.arquivoDeTentativas(), 'utf8')).tentativas;
const engineDeTeste = () => ({ usage: usage.defaultUsage(), usageSessions: usage.defaultSessions(), log() { }, pushState() { throw new Error('boot não avisa a tela'); } });
const META = { sessionId: 'a-diario', account: 'eu', profileId: 'p1', model: 'claude-opus-5', ref: 'o/r#1', provedor: 'claude' };

test('abrirTentativa grava antes do provedor, com id opaco e metadados', () => {
  const id = t.abrirTentativa(engineDeTeste(), META);
  assert.match(id, /^[0-9a-f-]{36}$/);
  const r = ler()[id];
  assert.equal(r.sessionId, 'a-diario');
  assert.equal(r.kind, 'review');
  assert.equal(r.profileId, 'p1');
  assert.ok(r.abertaEm > 0);
  assert.equal(r.parcial.output_tokens, 0);
});

test('registrarParcial respeita o intervalo, mas o fim de turno grava sempre', (ctx) => {
  ctx.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 10 } }), true, 'primeira gravação sai na hora');
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 20 } }), false, 'dentro do intervalo não grava');
  assert.equal(ler()[id].parcial.output_tokens, 10);
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 30 }, fimDeTurno: true, model: 'claude-sonnet-5' }), true);
  assert.equal(ler()[id].parcial.output_tokens, 30);
  assert.equal(ler()[id].model, 'claude-sonnet-5');
  ctx.mock.timers.tick(TEMPOS.TENTATIVA_PARCIAL_MS);
  assert.equal(t.registrarParcial(e, id, { usage: { output_tokens: 40 } }), true);
});

test('fecharTentativa tira a tentativa do diário', () => {
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  assert.equal(t.fecharTentativa(e, id), true);
  assert.equal(ler()[id], undefined);
  assert.equal(t.fecharTentativa(e, id), false, 'fechar de novo é no-op');
});

test('boot: tentativa com tokens vira linha interrompida com o parcial', () => {
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  t.registrarParcial(e, id, { usage: { input_tokens: 12, output_tokens: 345 }, fimDeTurno: true });
  const boot = engineDeTeste();
  assert.equal(t.reconciliarInterrompidas(boot), 1);
  const s = boot.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.outputTokens, 345);
  assert.equal(s.inputTokens, 12);
  assert.equal(s.attemptId, id);
  assert.equal(s.costSource, 'desconhecido', 'sem base de estimativa no registro vazio');
  assert.equal(s.provedorPodeTerContinuado === true, !IS_WIN);
  assert.deepEqual(ler(), {});
});

test('boot: tentativa sem nenhum consumo vira linha com custo desconhecido, nunca ausência', () => {
  t.abrirTentativa(engineDeTeste(), META);
  const boot = engineDeTeste();
  assert.equal(t.reconciliarInterrompidas(boot), 1);
  const s = boot.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'interrompida');
  assert.equal(s.costSource, 'desconhecido');
  assert.equal(s.costUsd, 0);
  assert.equal(s.outputTokens, 0);
});

test('boot: tentativa já registrada pelo fechamento normal não duplica', () => {
  const e = engineDeTeste();
  const id = t.abrirTentativa(e, META);
  const boot = engineDeTeste();
  usage.recordUsage({ ...boot, pushState() { } }, 'a-diario', 'eu', { usage: { output_tokens: 5 }, total_cost_usd: 0.1, farol_attempt: id }, 'claude-opus-5', 'p1', 'o/r#1');
  assert.equal(t.reconciliarInterrompidas(boot), 0);
  assert.equal(boot.usageSessions.sessions.length, 1);
  assert.deepEqual(ler(), {});
});

test('boot sem diário não faz nada', () => {
  assert.equal(t.reconciliarInterrompidas(engineDeTeste()), 0);
});
