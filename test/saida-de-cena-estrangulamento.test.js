// A promessa "não vou duplicar a revisão" vale em TODOS os caminhos (v2.51.1).
//
// O tropeço que motivou (biudtech/engine-ai#68, 20/08/2026): a trava nasceu só no
// `toReview` e os outros dois caminhos automáticos entravam por baixo dela. Medido
// no PR: o Farol comentou às 19:55:52 e a label dele subiu às 19:57:45 com a label
// do colega AINDA no ar, ou seja, por um caminho que nem olhava a label.
//
// A correção é de ARQUITETURA: a garantia mora no ponto de estrangulamento
// (`enqueueHeadless`), por onde toda revisão headless passa, e não em cada
// chamador. Gate em chamador é gate que o próximo caminho esquece.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-estrang-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reviewMod = (await import('../lib/engine/review.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineFalso(extra = {}) {
  return {
    skipComentado: {},
    headlessQueue: [],
    activeReviews: new Map(),
    autoReviewParked: new Set(),
    retryAfterNet: new Map(),
    panorama: [],
    decisions: { pending: [] },
    staleInfo: {},
    reReviewLaunched: {},
    config: {},
    salvouSkip: 0,
    token: 'tok',
    queue: [],
    panoramaLista: [],
    refreshTokens: async () => { },
    // o stub delega no modulo de verdade: e justamente o ponto de estrangulamento
    // que estes testes existem pra provar, entao ele nao pode ser falsificado
    enqueueHeadless(pr) { return reviewMod.enqueueHeadless(this, pr); },
    prFromUrl: (u) => ({ key: 'o/r#1', url: u, repo: 'o/r', number: 1 }),
    accountForPr: () => 'eu',
    isMuted: () => false,
    autoReviewFor: () => true,
    tokenFor: () => 'tok',
    budgetBlockedFor: () => null,
    outrosRevisando: () => [],
    markSeen() { },
    unsee() { },
    saveAutoReviewParked() { },
    saveSkipComentado() { this.salvouSkip++; },
    writeInflight() { },
    processHeadless() { },
    pushState() { },
    emit() { },
    log() { },
    ...extra,
  };
}

const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1 };

/* ---------- o ponto de estrangulamento ---------- */

test('enqueueHeadless: com saída de cena registrada, NÃO enfileira', () => {
  const e = engineFalso();
  e.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  reviewMod.enqueueHeadless(e, { ...PR });
  assert.equal(e.headlessQueue.length, 0);
});

test('enqueueHeadless: sem saída de cena, enfileira normalmente', () => {
  const e = engineFalso();
  reviewMod.enqueueHeadless(e, { ...PR });
  assert.equal(e.headlessQueue.length, 1);
});

// clique explícito é do humano: ele sabe que outra pessoa está lá e mandou revisar
test('enqueueHeadless: clique explícito (manual) atravessa a saída de cena', () => {
  const e = engineFalso();
  e.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  reviewMod.enqueueHeadless(e, { ...PR, manual: true });
  assert.equal(e.headlessQueue.length, 1);
});

/* ---------- os caminhos que passavam por baixo ---------- */

// era o furo do #68: retry não olhava label NEM saída registrada
test('retryTargets: PR de onde eu saí de cena não volta pelo retry', () => {
  const e = engineFalso();
  e.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: { ...PR } });
  assert.deepEqual(reviewMod.retryTargets(e, new Set(), new Set()), []);
});

test('retryTargets: sem saída de cena, o retry segue funcionando', () => {
  const e = engineFalso();
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: { ...PR } });
  assert.equal(reviewMod.retryTargets(e, new Set(), new Set()).length, 1);
});

test('reReviewTargets: round 2 automático não fura a saída de cena', () => {
  const e = engineFalso();
  e.panorama = [{ ...PR, isDraft: false }];
  e.staleInfo['o/r#1'] = { stale: true, head: 'sha2', lastState: 'CHANGES_REQUESTED' };
  // debounce (v2.53.0): head quieto o bastante pra armar o gate neste teste
  e.headQuietoDesde = { 'o/r#1': { head: 'sha2', at: 0 } };
  assert.equal(reviewMod.reReviewTargets(e, new Set()).length, 1, 'sem saída de cena, arma');
  e.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  assert.equal(reviewMod.reReviewTargets(e, new Set()).length, 0, 'com saída de cena, não arma');
});

/* ---------- clique desfaz a saída de cena ---------- */

test('launchReview por clique apaga a âncora e revisa', async () => {
  const e = engineFalso();
  e.queue = [{ ...PR }];
  e.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const r = await reviewMod.launchReview(e, [PR.url], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.equal(e.skipComentado['o/r#1'], undefined, 'âncora desfeita');
  assert.equal(e.salvouSkip, 1, 'e persistida');
  assert.equal(e.headlessQueue.length, 1, 'o PR entrou na fila');
});

// o ciclo automático NÃO desfaz: só o humano decide voltar pro PR
test('launchReview automático não apaga a âncora nem enfileira', async () => {
  const e = engineFalso();
  e.queue = [{ ...PR }];
  e.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  await reviewMod.launchReview(e, [PR.url], 'auto');
  assert.ok(e.skipComentado['o/r#1'], 'âncora intacta');
  assert.equal(e.headlessQueue.length, 0, 'nada enfileirado');
});
