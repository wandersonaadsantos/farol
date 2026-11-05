// O ciclo do re-round com a marca de conflito (C2): a trava síncrona só segura enquanto o PR
// segue no updatedAt lido; com updatedAt novo o PR chega ao gate assíncrono, que relê e limpa.
import test, { after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-conflito-ciclo-'));
const { Engine } = await import('../server.js');
after(() => { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });

const reviewMod = (await import('../lib/engine/review.js')).default;
const { seguraPorConflito, marcarConflito } = await import('../lib/engine/espera-conflito.js');

const KEY = 'acme/r#1';
const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
const MIN = 60 * 1000;
const AGORA = new Date('2026-11-05T12:00:00').getTime();
const U1 = new Date(AGORA - 30 * MIN).toISOString();
const U2 = new Date(AGORA - MIN).toISOString();

function engineBase() {
  const e = Object.create(Engine.prototype);
  Object.assign(e, {
    staleInfo: {}, headQuietoDesde: {}, reReviewLaunched: {}, decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(), parkedMotivos: {}, retryAfterNet: new Map(), skipComentado: {},
    headlessQueue: [], activeReviews: new Map(), queue: [], config: {},
    accountForPr: () => 'revisora', isMuted: () => false, autoReviewFor: () => true, tokenFor: () => 'tok',
    budgetBlockedFor: () => false, outrosRevisando: () => [], ghEnv: () => ({}), log: () => {},
    emit: () => {},
  });
  e.decisions.pending.push({
    id: 'p1', key: KEY, status: 'pending', blockedKind: 'stale_head', headSha: H1, blockedHead: H2,
    createdAt: AGORA - 10 * MIN, pr: { repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1', account: 'revisora' },
  });
  return e;
}
const pr = (updatedAt) => ({ key: KEY, repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1', isDraft: false, updatedAt });
const explica = (e, p) => reviewMod.explicaReRound(e, p, new Set(), AGORA);

test('updatedAt igual ao da marca: segue parado por conflito, sem reler', () => {
  const e = engineBase();
  marcarConflito(e, KEY, H2, AGORA, U1);
  const r = explica(e, pr(U1));
  assert.equal(r.estado, 'parado');
  assert.equal(r.motivo, 'conflito');
});

test('updatedAt novo: a trava não segura, o gate relê MERGEABLE, limpa a marca e o PR relança', async () => {
  const e = engineBase();
  marcarConflito(e, KEY, H2, AGORA, U1);
  assert.equal(explica(e, pr(U2)).estado, 'relanca');
  assert.equal(await seguraPorConflito(e, pr(U2), { agora: AGORA, ler: async () => 'MERGEABLE' }), false);
  assert.equal(e.esperaConflito[KEY], undefined);
  assert.equal(explica(e, pr(U2)).estado, 'relanca');
});

test('updatedAt novo e ainda CONFLICTING: a marca é regravada com o updatedAt novo e volta a segurar', async () => {
  const e = engineBase();
  marcarConflito(e, KEY, H2, AGORA, U1);
  assert.equal(await seguraPorConflito(e, pr(U2), { agora: AGORA, ler: async () => 'CONFLICTING' }), true);
  assert.equal(e.esperaConflito[KEY].updatedAt, U2);
  assert.equal(explica(e, pr(U2)).motivo, 'conflito');
});
