// Task 2: sessionId persistido assim que nasce, não só no fim da revisão. Cobre
// dois pontos: writeInflight serializa sessionId (ou '' sem ele) junto do PR
// ativo, e o boot recupera esse sid via retomadaPendente, consumido em
// enqueueHeadless (o pr.key volta pra fila via o próprio check(), redescoberto
// no GitHub; a recuperação não reenfileira direto, só guarda o sid pra quando
// o PR reaparecer). IMPORTANTE: FAROL_HOME temporário ANTES do require de
// server.js (const de nível de módulo lida uma única vez no load), mesmo
// padrão de test/boot.test.js e test/retry-net.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-inflight-sid-' + process.pid);
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

test('boot com inflight.json contendo sessionId popula retomadaPendente, consumido por enqueueHeadless como retomarSid', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', title: 't', sessionId: 'sid-recuperado' }
  ]));
  const e = engineBase();
  assert.ok(e.retomadaPendente instanceof Map, 'retomadaPendente populado no boot');
  assert.deepEqual(e.retomadaPendente.get('o/r#3'), { sid: 'sid-recuperado', head: '' });

  // dependências do enqueueHeadless real: processHeadless/pushState viram no-op,
  // o teste foca só no dado que entra na fila
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', title: 't' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#3');
  assert.ok(enfileirado, 'PR redescoberto entrou na fila');
  assert.equal(enfileirado.retomarSid, 'sid-recuperado', 'sid recuperado carimbado como retomarSid');
  assert.equal(e.retomadaPendente.has('o/r#3'), false, 'consumido (get + delete), não reutilizável');
});

test('boot com inflight.json sem sessionId não gera retomadaPendente pro PR', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#4', url: 'https://github.com/o/r/pull/4', title: 't' }
  ]));
  const e = engineBase();
  assert.equal(e.retomadaPendente && e.retomadaPendente.has('o/r#4'), false);
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
    { key: 'o/r#6', url: 'https://github.com/o/r/pull/6', title: 't', sessionId: 'sid-6', headSha: 'head-6' }
  ]));
  const e = engineBase();
  assert.deepEqual(e.retomadaPendente.get('o/r#6'), { sid: 'sid-6', head: 'head-6' });
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#6', url: 'https://github.com/o/r/pull/6', title: 't' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#6');
  assert.equal(enfileirado.retomarSid, 'sid-6');
  assert.equal(enfileirado.knownHead, 'head-6');
});

test('knownHead que já veio no objeto não é sobrescrito pelo head do boot', () => {
  fs.mkdirSync(path.join(HOME, 'workspace', 'state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'workspace', 'state', 'inflight.json'), JSON.stringify([
    { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', title: 't', sessionId: 'sid-7', headSha: 'head-antigo' }
  ]));
  const e = engineBase();
  e.processHeadless = () => { };
  e.pushState = () => { };
  enqueueHeadless(e, { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', title: 't', knownHead: 'head-vivo' });
  const enfileirado = e.headlessQueue.find(p => p.key === 'o/r#7');
  assert.equal(enfileirado.knownHead, 'head-vivo', 'o caminho vivo manda');
  assert.equal(enfileirado.retomarSid, 'sid-7');
});
