// Política 1 da spec 2026-09-10-justica-de-fila-entre-orgs: o escalonador headless
// deixou de ser FIFO puro dentro da conta e passou a fazer RODÍZIO POR ORG. Entre os
// PRs elegíveis (conta abaixo do teto de parallelReviews), ganha o da org atendida há
// mais tempo; dentro da mesma org, continua a ordem de chegada.
//
// O invariante que manda em tudo é work-conserving: se há elegível na fila e slot
// livre, alguma revisão SEMPRE dispara. A política escolhe QUAL, nunca SE. É a regra
// do Wanderson: com fila, divide; sem fila, o que chegar é atendido.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-justica-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';
const reviewMod = (await import('../lib/engine/review.js')).default;

function engineSched(prs, { parallelReviews, globalParallelReviews } = {}) {
  return {
    config: { parallelReviews, globalParallelReviews },
    headlessQueue: [...prs],
    headlessBusyAccounts: new Map(),
    orgLastStart: new Map(),
    ran: [],
    accountForPr: (pr) => pr.acct,
    headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); },
    runOneHeadless(pr, acct) { this.ran.push(`${pr.key}@${acct}`); },
  };
}

// PR de uma org, numa conta. A org sai da key (owner/repo#n), o mesmo caminho que
// accountForPr já usa pra resolver a conta dona.
const pr = (org, n, acct = 'eu') => ({ key: `${org}/app#${n}`, acct });

test('org do PR sai da key, e cai num balde próprio quando não dá pra resolver', () => {
  assert.equal(reviewMod.headlessOrg({ key: 'biudtech/app#1' }), 'biudtech');
  assert.equal(reviewMod.headlessOrg({ repo: 'BiudTech/app', key: '' }), 'biudtech');
  assert.equal(reviewMod.headlessOrg({ key: '' }), '(sem org)');
  assert.equal(reviewMod.headlessOrg(null), '(sem org)');
});

test('org nunca atendida passa na frente da org que acabou de rodar', () => {
  const e = engineSched([pr('biudtech', 1), pr('biudtech', 2), pr('pessoal', 3)], { parallelReviews: 1 });
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['biudtech/app#1@eu'], 'primeiro disparo é o primeiro da fila');
  reviewMod.freeHeadlessSlot(e, 'eu');
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran.at(-1), 'pessoal/app#3@eu', 'a org que nunca rodou fura a fila da que já rodou');
});

test('dentro da mesma org a ordem continua sendo a de chegada', () => {
  const e = engineSched([pr('biudtech', 1), pr('biudtech', 2), pr('biudtech', 3)], { parallelReviews: 1 });
  for (let i = 0; i < 3; i++) { reviewMod.processHeadless(e); reviewMod.freeHeadlessSlot(e, 'eu'); }
  assert.deepEqual(e.ran, ['biudtech/app#1@eu', 'biudtech/app#2@eu', 'biudtech/app#3@eu']);
});

test('duas orgs em disputa se alternam em vez de uma monopolizar', () => {
  const e = engineSched(
    [pr('biudtech', 1), pr('biudtech', 2), pr('biudtech', 3), pr('pessoal', 4), pr('pessoal', 5)],
    { parallelReviews: 1 }
  );
  for (let i = 0; i < 5; i++) { reviewMod.processHeadless(e); reviewMod.freeHeadlessSlot(e, 'eu'); }
  assert.deepEqual(e.ran, [
    'biudtech/app#1@eu', 'pessoal/app#4@eu',
    'biudtech/app#2@eu', 'pessoal/app#5@eu',
    'biudtech/app#3@eu',
  ], 'alterna enquanto as duas têm fila, e a que sobra leva o resto');
});

test('a org pequena não espera a fila inteira da org grande esvaziar', () => {
  const grandes = Array.from({ length: 10 }, (_, i) => pr('biudtech', i + 1));
  const e = engineSched([...grandes, pr('pessoal', 99)], { parallelReviews: 1 });
  for (let i = 0; i < 11; i++) { reviewMod.processHeadless(e); reviewMod.freeHeadlessSlot(e, 'eu'); }
  const posicao = e.ran.indexOf('pessoal/app#99@eu');
  assert.equal(posicao, 1, 'entra na segunda vaga, não na décima primeira');
});

// --- work-conserving: o invariante da spec ---

test('work-conserving: uma org sozinha na fila não paga pedágio nenhum', () => {
  const e = engineSched([pr('biudtech', 1), pr('biudtech', 2)], { parallelReviews: 2 });
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['biudtech/app#1@eu', 'biudtech/app#2@eu'], 'sem disputa, atende tudo que cabe');
});

test('work-conserving: nenhum ciclo termina com slot livre e elegível esperando', () => {
  const e = engineSched(
    [pr('biudtech', 1), pr('pessoal', 2), pr('outra', 3), pr('biudtech', 4)],
    { parallelReviews: 2 }
  );
  reviewMod.processHeadless(e);
  assert.equal(e.headlessBusyAccounts.get('eu'), 2, 'encheu o teto da conta');
  assert.equal(e.headlessQueue.length, 2, 'só sobrou o que não cabia');
});

test('parallelReviews > 1 espalha entre orgs antes de repetir a mesma', () => {
  const e = engineSched(
    [pr('biudtech', 1), pr('biudtech', 2), pr('pessoal', 3)],
    { parallelReviews: 2 }
  );
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['biudtech/app#1@eu', 'pessoal/app#3@eu'], 'a 2ª vaga vai pra outra org, não pro 2º da biudtech');
});

test('PR sem org participa do rodízio como qualquer outra', () => {
  const e = engineSched([{ key: '', acct: 'eu' }, pr('biudtech', 1)], { parallelReviews: 1 });
  reviewMod.processHeadless(e);
  reviewMod.freeHeadlessSlot(e, 'eu');
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 2);
  assert.notEqual(e.ran[0], e.ran[1]);
});

test('o rodízio é por org e não atravessa conta: cada conta tem o próprio teto', () => {
  const e = engineSched(
    [pr('biudtech', 1, 'a'), pr('biudtech', 2, 'a'), pr('pessoal', 3, 'b')],
    { parallelReviews: 1 }
  );
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['biudtech/app#1@a', 'pessoal/app#3@b'], 'contas diferentes disparam juntas, como sempre');
});

// --- Política 3: teto global de revisões simultâneas ---

test('teto global desligado (default) não muda comportamento nenhum', () => {
  const e = engineSched([pr('a', 1, 'x'), pr('b', 2, 'y'), pr('c', 3, 'z')], { parallelReviews: 1 });
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 3, 'sem teto global, as três contas disparam');
});

test('teto global segura o total somando todas as contas', () => {
  const e = engineSched([pr('a', 1, 'x'), pr('b', 2, 'y'), pr('c', 3, 'z')], { parallelReviews: 1, globalParallelReviews: 2 });
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 2);
  assert.equal(e.headlessQueue.length, 1);
});

test('vaga global liberada vai pro rodízio de org, não pro primeiro da fila', () => {
  const e = engineSched(
    [pr('biudtech', 1, 'x'), pr('biudtech', 2, 'x'), pr('pessoal', 3, 'y')],
    { parallelReviews: 2, globalParallelReviews: 1 }
  );
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['biudtech/app#1@x']);
  reviewMod.freeHeadlessSlot(e, 'x');
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran.at(-1), 'pessoal/app#3@y', 'a vaga foi pra org que não tinha rodado');
});

test('teto global torto não trava a fila nem vira loop', () => {
  for (const cfg of [-3, 'banana', NaN, null, 0]) {
    const e = engineSched([pr('a', 1, 'x'), pr('b', 2, 'y')], { parallelReviews: 1, globalParallelReviews: cfg });
    reviewMod.processHeadless(e);
    assert.equal(e.ran.length, 2, `globalParallelReviews=${JSON.stringify(cfg)} deve significar desligado`);
  }
  const e = engineSched(Array.from({ length: 30 }, (_, i) => pr('a', i, `c${i}`)), { parallelReviews: 1, globalParallelReviews: 99 });
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 8, 'teto exagerado clampa no máximo (8) em vez de virar infinito');
});
