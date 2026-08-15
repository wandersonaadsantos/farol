'use strict';
// Escalonador headless com paralelismo POR CONTA opt-in (config.parallelReviews):
// o padrão continua 1 (série dentro da conta, contas diferentes em paralelo, como
// sempre foi), e quem pede mais ganha até 4 revisões simultâneas da MESMA conta.
// headlessBusyAccounts virou Map de contagem (conta -> revisões rodando); o teto é
// lido a cada volta do loop e clampado em 1..4 no próprio escalonador (defesa em
// profundidade, mesmo padrão do buildModelFlags: config torta nunca vira loop nem 0).
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-parallel-' + process.pid);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const reviewMod = require('../lib/engine/review');

function engineSched(parallelReviews, prs) {
  return {
    config: { parallelReviews },
    headlessQueue: [...prs],
    headlessBusyAccounts: new Map(),
    ran: [],
    accountForPr: (pr) => pr.acct,
    headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); },
    runOneHeadless(pr, acct) { this.ran.push(`${pr.key}@${acct}`); },
  };
}

const pr = (n, acct = 'eu') => ({ key: `org/app#${n}`, acct });

test('padrão (1): mesma conta segue em série, o resto espera na fila', () => {
  const e = engineSched(undefined, [pr(1), pr(2)]);
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['org/app#1@eu']);
  assert.equal(e.headlessQueue.length, 1);
  assert.equal(e.headlessBusyAccounts.get('eu'), 1);
});

test('parallelReviews 2: a mesma conta roda 2 juntas e a 3ª espera', () => {
  const e = engineSched(2, [pr(1), pr(2), pr(3)]);
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['org/app#1@eu', 'org/app#2@eu']);
  assert.equal(e.headlessQueue.length, 1);
  assert.equal(e.headlessBusyAccounts.get('eu'), 2);
});

test('slot liberado puxa o próximo da fila da mesma conta', () => {
  const e = engineSched(2, [pr(1), pr(2), pr(3)]);
  reviewMod.processHeadless(e);
  reviewMod.freeHeadlessSlot(e, 'eu');
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['org/app#1@eu', 'org/app#2@eu', 'org/app#3@eu']);
  assert.equal(e.headlessBusyAccounts.get('eu'), 2, 'liberou 1, entrou 1');
});

test('freeHeadlessSlot zera limpo: conta sem revisão sai do Map (o "está ocupado?" do update.js segue por size)', () => {
  const e = engineSched(1, [pr(1)]);
  reviewMod.processHeadless(e);
  reviewMod.freeHeadlessSlot(e, 'eu');
  assert.equal(e.headlessBusyAccounts.size, 0);
});

test('contas diferentes continuam independentes, cada uma com o próprio teto', () => {
  const e = engineSched(2, [pr(1, 'a'), pr(2, 'a'), pr(3, 'a'), pr(4, 'b')]);
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['org/app#1@a', 'org/app#2@a', 'org/app#4@b']);
});

test('config torta clampa: 0/negativo/lixo viram 1, exagero vira 4', () => {
  for (const [cfg, esperado] of [[0, 1], [-3, 1], ['banana', 1], [9, 4], ['3', 3]]) {
    const e = engineSched(cfg, [pr(1), pr(2), pr(3), pr(4), pr(5)]);
    reviewMod.processHeadless(e);
    assert.equal(e.ran.length, Math.min(esperado, 5), `parallelReviews=${JSON.stringify(cfg)}`);
  }
});
