// Pedido de revisão NOVO num PR que eu já revisei, SEM commit novo (02/10/2026).
//
// Caso de campo: o autor removeu e pediu a revisão de novo pelo botão do GitHub, o head
// continuou o mesmo, e não aconteceu nada — sem round, sem recusa, sem aviso. Duas
// barreiras somadas: o PR já estava `seen` e o `markReRequests` só desmarca uma vez por
// temporada de pedido (a chave fica em reReviewedKeys enquanto eu seguir pedido, e
// remover+pedir no mesmo instante nunca é observado entre dois ciclos); e, mesmo que o
// round saísse, o dedup por head acharia o meu APPROVE naquele head e resolveria como
// already_reviewed.
//
// A regra que estes casos travam é do PRODUTO, sem nada de repositório ou organização:
// pedido de revisão PRA MIM, posterior ao meu último review, é estado novo do PR.
import test, { after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-pedido-mesmo-head-'));
const { Engine } = await import('../server.js');

after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});

const destrava = (await import('../lib/engine/destrava.js')).default;
const decisionMod = (await import('../lib/engine/decision.js')).default;

const KEY = 'acme/r#1';
const HEAD = 'a'.repeat(40);
const MIN = 60 * 1000;
const AGORA = new Date('2026-10-02T11:30:00').getTime();
const REVIEW_EM = AGORA - 120 * MIN;   // aprovei há duas horas
const PEDIDO_EM = AGORA - 5 * MIN;     // ele pediu de novo há cinco minutos

function engineBase() {
  const e = Object.create(Engine.prototype);
  e.panorama = [{
    key: KEY, repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1',
    isDraft: false, updatedAt: new Date(PEDIDO_EM).toISOString(),
  }];
  e.decisions = {
    pending: [],
    resolved: [{
      key: KEY, status: 'posted', action: 'approve', headSha: HEAD, resolvedAt: REVIEW_EM,
      pr: { repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1' },
    }],
  };
  e.autoReviewParked = new Set();
  e.parkedMotivos = {};
  e.reReviewLaunched = {};
  e.retryAfterNet = new Map();
  e.headlessQueue = [];
  e.activeReviews = new Map();
  e.queue = [];
  e.seen = new Set([KEY]);          // já revisado = fora da fila
  e.ignorados = new Set();
  e.mineKeys = new Set([KEY]);      // o GitHub voltou a me pedir
  e.destravados = {};
  e.accountForPr = () => 'revisora';
  e.autoReviewFor = () => true;
  e.ghEnv = () => ({});
  e.saveSeen = () => {};
  e.saveDecisions = () => {};
  e.saveAutoReviewParked = () => {};
  e.saveReReviewLaunched = () => {};
  e.saveDestravados = () => {};
  e.log = () => {};
  e.toasts = [];
  e.emit = (ev, d) => { if (ev === 'toast') e.toasts.push(d.text); };
  return e;
}

const candidatos = (e) => destrava.candidatosDestrave(e, new Set());

/* ---------- o PR já revisado passa a ser candidato a destrave ---------- */

test('PR já revisado, pedido a mim de novo: vira candidato pelo meu último review', () => {
  const e = engineBase();
  const c = candidatos(e);
  assert.equal(c.length, 1, 'o PR já revisado tem que entrar na seleção');
  assert.equal(c[0].tipo, 'revisado');
  assert.equal(c[0].desde, REVIEW_EM, 'a régua é o meu último review, não a abertura do PR');
  assert.equal(c[0].headConhecido, HEAD);
});

test('não entra quem não está sendo pedido a mim', () => {
  const e = engineBase();
  e.mineKeys = new Set();
  assert.deepEqual(candidatos(e), []);
});

test('PR ignorado continua fora: descarte deliberado não é destravado por pedido', () => {
  const e = engineBase();
  e.ignorados = new Set([KEY]);
  assert.deepEqual(candidatos(e), []);
});

test('sem atividade depois do meu review, não há o que destravar', () => {
  const e = engineBase();
  e.panorama[0].updatedAt = new Date(REVIEW_EM - MIN).toISOString();
  assert.deepEqual(candidatos(e), []);
});

// Pendência na mesa é o caso `presa`, que já tem dono: não pode virar dois candidatos.
test('PR com pendência na mesa não vira candidato por este caminho', () => {
  const e = engineBase();
  e.decisions.pending = [{ key: KEY, status: 'pending', blockedKind: 'stale_head', blockedHead: HEAD, createdAt: REVIEW_EM }];
  const c = candidatos(e);
  assert.notEqual(c[0] && c[0].tipo, 'revisado');
});

/* ---------- o destrave devolve à fila e deixa rastro ---------- */

test('pedido novo devolve o PR à fila, avisa e grava a marca com o tipo do sinal', () => {
  const e = engineBase();
  const [cand] = candidatos(e);
  destrava.aplicarDestrave(e, cand, { tipo: 'pedido', at: PEDIDO_EM, head: '' });
  assert.equal(e.seen.has(KEY), false, 'sai de visto: é isso que o devolve aos caminhos automáticos');
  assert.equal(e.queue.some(p => p.key === KEY), true);
  assert.match(e.toasts.join(' '), /pediram revisão de novo/);
  assert.deepEqual(e.destravados[KEY], { at: PEDIDO_EM, tipo: 'pedido' });
});

test('o mesmo pedido não destrava duas vezes', () => {
  const e = engineBase();
  destrava.aplicarDestrave(e, candidatos(e)[0], { tipo: 'pedido', at: PEDIDO_EM, head: '' });
  e.seen.add(KEY);                                  // revisei de novo e saí da fila
  assert.deepEqual(candidatos(e), [], 'sinal já consumido não pode rearmar sozinho');
});

test('marca antiga gravada como número (formato legado) continua sendo respeitada', () => {
  const e = engineBase();
  e.destravados = { [KEY]: PEDIDO_EM };
  assert.deepEqual(candidatos(e), [], 'o formato velho tem que seguir valendo depois do update');
});

/* ---------- o dedup por head deixa de engolir o pedido novo ---------- */

function engineComReviews(reviews, marca) {
  const e = engineBase();
  e.destravados = marca ? { [KEY]: marca } : {};
  e.myReviewsWithTime = async () => reviews;
  return e;
}

test('sem pedido novo, o dedup por head segue valendo (proteção do #742)', async () => {
  const e = engineComReviews([{ state: 'APPROVED', at: REVIEW_EM, commit: HEAD }]);
  const states = await decisionMod.myReviewStates(e, { key: KEY, repo: 'acme/r', number: 1 }, HEAD);
  assert.deepEqual(states, ['APPROVED'], 'sem sinal novo, o review antigo continua contando');
});

test('review ANTERIOR ao pedido novo não conta: ele não responde ao que foi pedido agora', async () => {
  const e = engineComReviews([{ state: 'APPROVED', at: REVIEW_EM, commit: HEAD }], { at: PEDIDO_EM, tipo: 'pedido' });
  const states = await decisionMod.myReviewStates(e, { key: KEY, repo: 'acme/r', number: 1 }, HEAD);
  assert.deepEqual(states, [], 'é esta linha que fazia o round rodar e se recusar a postar');
});

test('review POSTERIOR ao pedido conta, e o dedup volta a proteger contra duplicata', async () => {
  const e = engineComReviews([
    { state: 'APPROVED', at: REVIEW_EM, commit: HEAD },
    { state: 'APPROVED', at: PEDIDO_EM + MIN, commit: HEAD },
  ], { at: PEDIDO_EM, tipo: 'pedido' });
  const states = await decisionMod.myReviewStates(e, { key: KEY, repo: 'acme/r', number: 1 }, HEAD);
  assert.deepEqual(states, ['APPROVED'], 'o review que já respondeu ao pedido novo impede o segundo APPROVE');
});

// Commit novo já tinha caminho próprio (o recorte por head): a marca de push não pode
// mudar a conta dos reviews, senão um destrave por push afrouxaria o dedup sem motivo.
test('marca de PUSH não mexe no dedup: quem cuida de head novo é o recorte por head', async () => {
  const e = engineComReviews([{ state: 'APPROVED', at: REVIEW_EM, commit: HEAD }], { at: PEDIDO_EM, tipo: 'push' });
  const states = await decisionMod.myReviewStates(e, { key: KEY, repo: 'acme/r', number: 1 }, HEAD);
  assert.deepEqual(states, ['APPROVED']);
});

test('review sem carimbo de hora nunca é descartado pelo pedido (falta de dado não decide)', async () => {
  const e = engineComReviews([{ state: 'APPROVED', at: null, commit: HEAD }], { at: PEDIDO_EM, tipo: 'pedido' });
  const states = await decisionMod.myReviewStates(e, { key: KEY, repo: 'acme/r', number: 1 }, HEAD);
  assert.deepEqual(states, ['APPROVED']);
});
