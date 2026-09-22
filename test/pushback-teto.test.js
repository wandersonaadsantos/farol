// Pushback que falha ou sai ilegível tentava de novo a cada ciclo, sem teto por PR, e
// cada tentativa é uma sessão paga (spec 4.1, extras).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-pushback-teto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { classify } = await import('../lib/log-taxonomy.js');
const pb = await import('../lib/engine/pushback.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineAlvo(marcador = '2026-08-01T09:00:00Z') {
  // o limite do plano fica em disco por assinatura: um caso não pode herdar o do anterior
  try { fs.rmSync(path.join(FAROL_HOME, 'state', 'limite-plano.json'), { force: true }); } catch { /* ausente */ }
  const e = new Engine();
  e.decisions = { resolved: [{ key: 'o/r#2', status: 'auto_approved', action: 'approve', reasons: ['confira X'], cardMet: true, resolvedAt: 1 }], pending: [] };
  e.panorama = [{ key: 'o/r#2', updatedAt: '2026-08-01T10:00:00Z' }];
  e.pushbackScanned = {};
  e.pushbackFalhas = {};
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  e.config.autoPushback = true;
  e.savePushbackScanned = () => { };
  e.pushState = () => { };
  e.detectAuthorPushback = async () => ({ marker: marcador, hadActivity: true });
  return e;
}

test('falha permanente repetida para no teto do PR, e marcador novo reabre', async () => {
  const e = engineAlvo();
  let chamadas = 0;
  e.classifyPushback = async () => { chamadas++; throw new Error('JSON fora do contrato qwerty'); };
  for (let i = 0; i < 5; i++) await e.scanPushbacks();
  assert.equal(chamadas, pb.MAX_FALHAS_PUSHBACK_POR_PR);
  assert.equal(e.pushbackFalhas['o/r#2'].classe, classify('JSON fora do contrato qwerty').id, 'a contagem passa pela taxonomia');
  e.detectAuthorPushback = async () => ({ marker: '2026-08-02T09:00:00Z', hadActivity: true });
  await e.scanPushbacks();
  assert.equal(chamadas, pb.MAX_FALHAS_PUSHBACK_POR_PR + 1, 'comentário novo do autor volta a classificar');
});

test('falha transitória não conta para o teto', async () => {
  const msg = 'sessão retornou erro: API Error: 529 Overloaded';
  assert.equal(classify(msg).kind, 'transitorio', 'premissa da taxonomia');
  const e = engineAlvo();
  let chamadas = 0;
  e.classifyPushback = async () => { chamadas++; throw new Error(msg); };
  for (let i = 0; i < 5; i++) await e.scanPushbacks();
  assert.equal(chamadas, 5);
  assert.equal(e.pushbackFalhas['o/r#2'], undefined);
});

test('resultado ilegível conta, registra falha e marca erro no consumo', async () => {
  const e = engineAlvo();
  let sessoes = 0;
  e.runClaudeStream = async (prompt, opts) => {
    sessoes++;
    e.recordUsage(opts.id, 'eu', { usage: { output_tokens: 4 }, total_cost_usd: 0.04 }, 'claude-opus-5', '', opts.ref);
    return { text: 'prosa sem json', sessionId: null };
  };
  for (let i = 0; i < 5; i++) await e.scanPushbacks();
  assert.equal(sessoes, pb.MAX_FALHAS_PUSHBACK_POR_PR);
  const ultima = e.usageSessions.sessions.at(-1);
  assert.equal(ultima.status, 'erro');
  assert.equal(e.falhaDaSessao(ultima.id).kind, 'pushback');
});

test('a contagem sobrevive a um engine novo', async () => {
  const e = engineAlvo();
  e.classifyPushback = async () => { throw new Error('JSON fora do contrato qwerty'); };
  for (let i = 0; i < 3; i++) await e.scanPushbacks();
  const outro = engineAlvo();
  delete outro.pushbackFalhas;
  assert.equal(pb.pushbackNoTeto(outro, 'o/r#2', '2026-08-01T09:00:00Z'), true);
});

// 17/09/2026: o limite semanal do plano fez o scan gastar uma sessão por ciclo no mesmo PR
// e escrever um cartão de falha por minuto no Diagnóstico. Limite de plano tem hora pra
// voltar; até lá o scan inteiro para, e o registro conta as repetições em vez de crescer.
test('limite do plano para o scan até o reset e não empilha cartão', async () => {
  const msg = "sessão retornou erro: You've hit your weekly limit · resets 2am (America/Sao_Paulo)";
  assert.equal(classify(msg).kind, 'espera-reset', 'premissa da taxonomia');
  const e = engineAlvo();
  e.falhasSessao = [];
  let chamadas = 0;
  e.classifyPushback = async () => { chamadas++; throw new Error(msg); };
  for (let i = 0; i < 5; i++) await e.scanPushbacks();
  assert.equal(chamadas, 1, 'uma sessão só: as outras quatro esperariam o mesmo reset');
  // com hora citada, a espera mora no registro da assinatura (lib/engine/limite-plano.js),
  // o mesmo que as revisões consultam, e não mais num campo só do pushback
  assert.ok(e.limiteDoPlanoAte('eu') > Date.now(), 'a assinatura fica esperando o reset');
  assert.equal(pb.pushbackTargets(e, e.reviewActions()).length, 0, 'ninguém entra no scan durante a espera');
  const doPlano = e.falhasRecentes({ limite: 50 }).filter((f) => f.classe === 'limite-plano');
  assert.equal(doPlano.length, 1, 'um cartão só');
  // passado o reset, o scan volta sozinho (o registro descarta o que venceu)
  for (const v of e.limitesDePlano.values()) v.ate = Date.now() - 1000;
  await e.scanPushbacks();
  assert.equal(chamadas, 2);
});

test('mensagem de limite sem hora citada espera meia hora', () => {
  const e = new Engine();
  e.log = () => { };
  const agora = Date.UTC(2026, 8, 17, 12, 0, 0);
  const ate = pb.esperarResetDePlano(e, 'sessão retornou erro: hit your usage limit', agora);
  assert.equal(ate - agora, 30 * 60 * 1000);
  assert.equal(pb.esperandoResetDePlano(e, agora), true);
  assert.equal(pb.esperandoResetDePlano(e, ate + 1), false);
});

