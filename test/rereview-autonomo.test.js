import test from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-reauto-'));
const { Engine } = await import('../server.js');
const { MAX_RODADAS_AUTO_DIA, diaLocal } = await import('../lib/engine/review.js');
const { TEMPOS } = await import('../lib/constants.js');

const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
const AGORA = new Date('2026-08-25T15:00:00').getTime();
const QUIETO = AGORA - TEMPOS.HEAD_QUIETO_MS - 1000; // carimbo velho o bastante

function engineBase() {
  const e = Object.create(Engine.prototype);
  e.panorama = [{ key: 'acme/r#1', repo: 'acme/r', number: 1, url: 'u', isDraft: false }];
  e.staleInfo = {};
  e.headQuietoDesde = {};
  e.reReviewLaunched = {};
  e.decisions = { pending: [], resolved: [] };
  e.autoReviewParked = new Set();
  e.retryAfterNet = new Map();
  e.skipComentado = {};
  e.accountForPr = () => 'conta';
  e.isMuted = () => false;
  e.autoReviewFor = () => true;
  e.tokenFor = () => 'tok';
  e.budgetBlockedFor = () => false;
  e.outrosRevisando = () => [];
  return e;
}
const semInflight = new Set();

test('APPROVE stale RELANÇA quando a conta é autônoma (era só CHANGES_REQUESTED)', () => {
  const e = engineBase();
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'APPROVED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  const alvos = e.reReviewTargets(semInflight, AGORA);
  assert.equal(alvos.length, 1);
  assert.equal(alvos[0]._headRound, H2);
});

test('pendência stale_head destrava o round sozinha, mesmo SEM staleInfo (nunca postei review)', () => {
  const e = engineBase();
  e.decisions.pending.push({ key: 'acme/r#1', blockedKind: 'stale_head', blockedHead: H2, createdAt: QUIETO });
  const alvos = e.reReviewTargets(semInflight, AGORA);
  assert.equal(alvos.length, 1);
  assert.equal(alvos[0]._headRound, H2);
});

test('pendência VIVA (sem blockedKind) continua segurando o round: julgamento é seu', () => {
  const e = engineBase();
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.decisions.pending.push({ key: 'acme/r#1', status: 'pending' });
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0);
});

test('debounce: head visto agora NÃO relança; visto há HEAD_QUIETO_MS relança', () => {
  const e = engineBase();
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: AGORA - 1000 };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0, 'head fresco espera');
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 1);
});

test('pendência stale_head fresca (createdAt recente) também espera o debounce', () => {
  const e = engineBase();
  e.decisions.pending.push({ key: 'acme/r#1', blockedKind: 'stale_head', blockedHead: H2, createdAt: AGORA - 1000 });
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0);
});

test('teto diário: MAX_RODADAS_AUTO_DIA rodadas hoje = esgotado, dia novo reabre', () => {
  const e = engineBase();
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.reReviewLaunched['acme/r#1'] = { head: H1, dia: diaLocal(AGORA), rodadas: MAX_RODADAS_AUTO_DIA };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0);
  assert.deepEqual(e.reReviewEsgotados(semInflight, AGORA).map(p => p.key), ['acme/r#1']);
  e.reReviewLaunched['acme/r#1'] = { head: H1, dia: '2026-08-24', rodadas: MAX_RODADAS_AUTO_DIA };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 1, 'dia novo zera o teto');
});

test('âncora no MESMO head continua segurando (dedup por round preservado, formato novo e legado)', () => {
  const e = engineBase();
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.reReviewLaunched['acme/r#1'] = { head: H2, dia: diaLocal(AGORA), rodadas: 1 };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0);
  e.reReviewLaunched['acme/r#1'] = H2; // formato string legado
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0);
});

test('conta com autoReview desligado NUNCA relança, nem pelo gatilho de pendência', () => {
  const e = engineBase();
  e.autoReviewFor = () => false;
  e.decisions.pending.push({ key: 'acme/r#1', blockedKind: 'stale_head', blockedHead: H2, createdAt: QUIETO });
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0);
});

test('pendência stale_head de PR FORA do panorama ainda relança (a fila mine não filtra por owner)', () => {
  const e = engineBase();
  e.panorama = [];
  e.decisions.pending.push({
    key: 'outra/org#9', blockedKind: 'stale_head', blockedHead: H2, createdAt: QUIETO,
    pr: { repo: 'outra/org', number: 9, url: 'u9', title: 't', author: 'dev' }
  });
  const alvos = e.reReviewTargets(semInflight, AGORA);
  assert.equal(alvos.length, 1);
  assert.equal(alvos[0].key, 'outra/org#9');
});

test('mesmo PR nos dois gatilhos sai UMA vez', () => {
  const e = engineBase();
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'APPROVED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.decisions.pending.push({ key: 'acme/r#1', blockedKind: 'stale_head', blockedHead: H2, createdAt: QUIETO });
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 1);
});
