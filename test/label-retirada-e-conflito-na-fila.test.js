// Achados da revisão do PR #343: a revisão parada porque tiraram a label não volta sozinha pela
// recuperação, PR em conflito na fila não paga gh a cada ciclo, e sessão de outro aparelho que já
// revisou sai como revisada, não como pedido para parar.
import test, { after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-label-conflito-fila-'));
const { Engine } = await import('../server.js');
after(() => { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });

const reviewMod = (await import('../lib/engine/review.js')).default;
const { pausaDaRecuperacao } = await import('../lib/engine/recuperacao-prova.js');
const { marcarConflito } = await import('../lib/engine/espera-conflito.js');
const { decidir } = await import('../lib/engine/vigia-sessao.js');

const KEY = 'acme/r#1';
const H1 = 'a'.repeat(40);
const U1 = '2026-11-05T11:30:00.000Z';

function engineBase() {
  const e = Object.create(Engine.prototype);
  Object.assign(e, {
    staleInfo: {}, headQuietoDesde: {}, reReviewLaunched: {}, decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(), parkedMotivos: {}, retryAfterNet: new Map(), skipComentado: {},
    headlessQueue: [], activeReviews: new Map(), queue: [], config: {}, seen: new Set(),
    accountForPr: () => 'revisora', isMuted: () => false, autoReviewFor: () => true, tokenFor: () => 'tok',
    budgetBlockedFor: () => false, outrosRevisando: () => [], ghEnv: () => ({}), log: () => {},
    emit: () => {}, pushState: () => {}, refreshTokens: async () => {},
  });
  return e;
}

test('recuperação não relança a revisão parada porque tiraram a label', async () => {
  const e = engineBase();
  e.autoReviewParked.add(KEY);
  e.parkedMotivos[KEY] = { tipo: 'label-retirada', motivo: 'a label de revisão foi retirada do PR' };
  const item = { key: KEY, pr: { repo: 'acme/r', number: 1, account: 'revisora' }, esperaProva: {} };
  const pausa = await pausaDaRecuperacao(e, item);
  assert.match(pausa, /label/);
  assert.doesNotMatch(pausa, /não classificada/);
});

test('PR em conflito memorizado na fila não chega aos gates que gastam gh', async () => {
  const e = new Engine();
  e.token = 'tok';
  e.tokens = { revisora: 'tok' };
  e.config.accounts = [{ user: 'revisora', owners: ['acme'] }];
  e.autoReviewFor = () => true;
  e.saveDecisions = () => {};
  e.pushState = () => {};
  e.log = () => {};
  e.on('toast', () => {});
  const pr = { key: KEY, repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1', account: 'revisora', requested: true, updatedAt: U1, headRefOid: H1 };
  marcarConflito(e, KEY, H1, Date.now(), U1);
  let consultas = 0;
  e.bloqueiaAutomatico = async () => { consultas += 1; return false; };
  e.queue = [pr];
  await reviewMod.launchReview(e, [pr.url], 'auto', 'auto');
  assert.equal(consultas, 0);
});

test('vigia: label tirada por quem já revisou este head sai como revisada', () => {
  const r = decidir({ headInicial: H1, headAgora: H1, meusEstados: ['APPROVED'], labelPropria: 'revisora:revisando', labelsAgora: [] });
  assert.equal(r.abandonar, true);
  assert.equal(r.motivo, 'ja-revisado');
});
