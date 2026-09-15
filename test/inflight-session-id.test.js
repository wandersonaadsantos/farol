// Task 2 (v2.57.3) e A5 (retomada durável): sessionId persistido assim que nasce,
// não só no fim da revisão. writeInflight serializa sessionId (ou '' sem ele) junto
// do PR ativo, e o boot restaura a referência em engine.retomadas
// (lib/engine/retomada-duravel.js). enqueueHeadless só LÊ a referência: quem a
// consome é um desfecho. IMPORTANTE: FAROL_HOME temporário ANTES do import de
// server.js (const de nível de módulo lida uma única vez no load), mesmo padrão de
// test/boot.test.js e test/retry-net.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-inflight-sid-'));
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { enqueueHeadless } = await import('../lib/engine/review.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineBase() {
  const e = new Engine();
  e.log = () => { };
  return e;
}

test('writeInflight grava sessionId da sessão ativa (auto) no JSON', () => {
  const e = engineBase();
  e.activeReviews.set('id1', {
    mode: 'auto',
    pr: { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', title: 't' },
    sessionId: 'abc-123'
  });
  e.writeInflight();
  const inflight = JSON.parse(fs.readFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), 'utf8'));
  const item = inflight.find(p => p.key === 'o/r#1');
  assert.ok(item, 'entrada gravada');
  assert.equal(item.sessionId, 'abc-123');
});

test('writeInflight grava sessionId vazio quando a sessão ainda não recebeu o sid', () => {
  const e = engineBase();
  e.activeReviews.set('id1', {
    mode: 'auto',
    pr: { key: 'o/r#2', url: 'https://github.com/o/r/pull/2', title: 't' }
  });
  e.writeInflight();
  const inflight = JSON.parse(fs.readFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), 'utf8'));
  const item = inflight.find(p => p.key === 'o/r#2');
  assert.ok(item, 'entrada gravada');
  assert.equal(item.sessionId, '');
});

test('boot com inflight.json legado (só sessionId) restaura a referência e o enqueueHeadless não consome', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', title: 't', sessionId: 'sid-recuperado' }
  ]));
  const e = engineBase();
  const entrada = e.retomadas.get('o/r#3');
  assert.ok(entrada, 'referência restaurada no boot');
  assert.equal(entrada.retomarSid, 'sid-recuperado');
  assert.equal(entrada.knownHead, '');
  assert.equal(entrada.provedor, '', 'inflight legado não tem contexto; a validação decide depois');

  // dependências do enqueueHeadless real: processHeadless/pushState viram no-op,
  // o teste foca só no dado que entra na fila
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', title: 't' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#3');
  assert.ok(enfileirado, 'PR redescoberto entrou na fila');
  assert.equal(enfileirado.retomarSid, 'sid-recuperado', 'sid recuperado carimbado como retomarSid');
  assert.equal(e.retomadas.has('o/r#3'), true, 'enfileirar não consome: quem consome é um desfecho');
});

test('boot com inflight.json sem sessionId não gera referência pro PR', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#4', url: 'https://github.com/o/r/pull/4', title: 't' }
  ]));
  const e = engineBase();
  assert.equal(e.retomadas.has('o/r#4'), false);
});

/* ---------- head da sessão caída persiste junto do sid (guarda de head no boot) ---------- */
// Sem o head gravado, a guarda de head era inerte no caminho do boot: o app podia
// ficar horas fora do ar, o PR ganhar commit novo e a sessão morta ser retomada
// com ordem de não reler o que mudou.
test('writeInflight grava o headSha da sessão ativa', () => {
  const e = engineBase();
  e.activeReviews.set('id1', {
    mode: 'auto',
    pr: { key: 'o/r#5', url: 'https://github.com/o/r/pull/5', title: 't' },
    sessionId: 'abc-123',
    headSha: 'head-da-queda'
  });
  e.writeInflight();
  const inflight = JSON.parse(fs.readFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), 'utf8'));
  const item = inflight.find(p => p.key === 'o/r#5');
  assert.equal(item.headSha, 'head-da-queda');
});

test('boot com headSha carimba knownHead junto do retomarSid no enqueueHeadless', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#6', url: 'https://github.com/o/r/pull/6', title: 't', sessionId: 'sid-000006', headSha: 'head-6' }
  ]));
  const e = engineBase();
  assert.equal(e.retomadas.get('o/r#6').retomarSid, 'sid-000006');
  assert.equal(e.retomadas.get('o/r#6').knownHead, 'head-6');
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#6', url: 'https://github.com/o/r/pull/6', title: 't' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#6');
  assert.equal(enfileirado.retomarSid, 'sid-000006');
  assert.equal(enfileirado.knownHead, 'head-6');
});

test('knownHead que já veio no objeto não é sobrescrito pelo head do boot', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', title: 't', sessionId: 'sid-000007', headSha: 'head-antigo' }
  ]));
  const e = engineBase();
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', title: 't', knownHead: 'head-vivo' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#7');
  assert.equal(enfileirado.knownHead, 'head-vivo', 'o caminho vivo manda');
  assert.equal(enfileirado.retomarSid, 'sid-000007');
});
