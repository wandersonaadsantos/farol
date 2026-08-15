'use strict';
// Re-revisão automática pós-push (round 2 sem clique): quando EU pedi mudanças num PR
// e o autor empurrou commit novo, o PR volta pra fila de revisão headless sozinho, em
// vez de esperar você notar o push e clicar Re-revisar (era o elo manual do ciclo:
// o Farol abria o round rápido e fechava passivo, medido no biud-frontend#756).
//
// O gate (reReviewTargets) é SÍNCRONO e sem IO pelo mesmo motivo do retryTargets e do
// pushbackTargets: é ele que decide gastar sessão Claude, então tem que ser testável
// sem rede. A âncora por head (reReviewLaunched) garante que cada estado do PR é
// relançado NO MÁXIMO uma vez: falha da revisão cai nos fluxos de retry/estacionamento
// de sempre, e só um head NOVO reabre o gate.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-rereview-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const reviewMod = require('../lib/engine/review');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const KEY = 'org/app#7';

function engineBase() {
  const pr = { key: KEY, url: 'https://github.com/org/app/pull/7', author: 'dev' };
  const e = {
    pr,
    panorama: [pr],
    staleInfo: { [KEY]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    reReviewLaunched: {},
    decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(),
    retryAfterNet: new Map(),
    headlessQueue: [],
    activeReviews: new Map(),
    saved: 0,
    enq: [],
    toasts: [],
    accountForPr: () => 'eu',
    isMuted: () => false,
    autoReviewFor: () => true,
    tokenFor: () => 'tok',
    budgetBlockedFor: () => null,
    saveReReviewLaunched() { this.saved++; },
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    enqueueHeadless(p) { this.enq.push(p); },
  };
  return e;
}

function targets(e) { return reviewMod.reReviewTargets(e, new Set()); }

/* ---------- o caso que a feature existe pra pegar ---------- */

test('reReviewTargets: pedi mudanças + head novo + gates ok = alvo', () => {
  const e = engineBase();
  assert.deepEqual(targets(e).map(p => p.key), [KEY]);
});

/* ---------- o que NUNCA pode relançar ---------- */

test('reReviewTargets: aprovação stale não relança (só pedido de mudanças fecha round)', () => {
  const e = engineBase();
  e.staleInfo[KEY].lastState = 'APPROVED';
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: sem commit novo depois do meu review, nada acontece', () => {
  const e = engineBase();
  e.staleInfo[KEY].stale = false;
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: sem head conhecido não relança (incerteza nunca gasta sessão)', () => {
  const e = engineBase();
  e.staleInfo[KEY].head = '';
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: head já relançado não repete; head mais novo reabre', () => {
  const e = engineBase();
  e.reReviewLaunched[KEY] = 'sha-novo';
  assert.deepEqual(targets(e), [], 'mesma âncora = já cuidei deste estado');
  e.staleInfo[KEY].head = 'sha-mais-novo';
  assert.deepEqual(targets(e).map(p => p.key), [KEY], 'push novo reabre o gate');
});

test('reReviewTargets: pendência na sua mesa segura o relançamento (um card por vez)', () => {
  const e = engineBase();
  e.decisions.pending.push({ key: KEY });
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: respeita as mesmas travas de conta do toReview', () => {
  for (const quebra of [
    e => { e.isMuted = () => true; },
    e => { e.autoReviewFor = () => false; },
    e => { e.tokenFor = () => null; },
    e => { e.autoReviewParked.add(KEY); },
    e => { e.retryAfterNet.set(KEY, { tries: 1 }); },
    e => { e.budgetBlockedFor = () => ({ id: 'p1', label: 'perfil' }); },
  ]) {
    const e = engineBase();
    quebra(e);
    assert.deepEqual(targets(e), []);
  }
});

test('reReviewTargets: PR já na fila headless ou rodando fica de fora', () => {
  const e = engineBase();
  assert.deepEqual(reviewMod.reReviewTargets(e, new Set([KEY])), []);
});

/* ---------- launchReReviews: âncora, persistência e a fila ---------- */

test('launchReReviews: ancora o head, persiste e enfileira como revisão pedida a mim', () => {
  const e = engineBase();
  reviewMod.launchReReviews(e);
  assert.equal(e.reReviewLaunched[KEY], 'sha-novo', 'âncora gravada ANTES de enfileirar');
  assert.equal(e.saved, 1, 'âncora persistida');
  assert.equal(e.enq.length, 1);
  assert.equal(e.enq[0].key, KEY);
  assert.equal(e.enq[0].requested, true,
    'round 2 de um review meu é continuação do engajamento, não clique avulso: ' +
    'a postagem continua atrás do shouldAutoApprove/shouldAutoReject de sempre');
  assert.equal(e.enq[0].account, 'eu');
});

test('launchReReviews: segunda passada com a mesma âncora não enfileira de novo', () => {
  const e = engineBase();
  reviewMod.launchReReviews(e);
  reviewMod.launchReReviews(e);
  assert.equal(e.enq.length, 1);
});

test('launchReReviews: poda âncora de PR que saiu do panorama (fechou/mergeou)', () => {
  const e = engineBase();
  e.reReviewLaunched['org/app#99'] = 'sha-fechado';
  reviewMod.launchReReviews(e);
  assert.equal('org/app#99' in e.reReviewLaunched, false);
});

test('launchReReviews: sem alvo e sem órfão, não persiste nem toca a fila', () => {
  const e = engineBase();
  e.staleInfo[KEY].stale = false;
  reviewMod.launchReReviews(e);
  assert.equal(e.saved, 0);
  assert.deepEqual(e.enq, []);
});

/* ---------- recoverInflight: poda a âncora do round 2 (G7) ---------- */

test('recoverInflight poda a âncora de re-revisão dos PRs que estavam em andamento', () => {
  // monta o FAROL_HOME temporário do processo com:
  //  - state/inflight.json = [{ key: 'acme/repo#5', url: '...', title: 't' }]
  //  - state/rereview-launched.json = { 'acme/repo#5': 'a'.repeat(40), 'acme/outro#6': 'b'.repeat(40) }
  // ANTES do new Engine(), padrão dos testes de boot em test/boot.test.js.
  const stateDir = path.join(process.env.FAROL_HOME, 'workspace', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'inflight.json'), JSON.stringify([
    { key: 'acme/repo#5', url: 'https://github.com/acme/repo/pull/5', title: 't' },
  ]));
  fs.writeFileSync(path.join(stateDir, 'rereview-launched.json'), JSON.stringify({
    'acme/repo#5': 'a'.repeat(40),
    'acme/outro#6': 'b'.repeat(40),
  }));

  const e = new Engine();
  assert.equal(e.reReviewLaunched['acme/repo#5'], undefined, 'âncora do PR interrompido foi podada');
  assert.equal(e.reReviewLaunched['acme/outro#6'], 'b'.repeat(40), 'âncora alheia intacta');
});
