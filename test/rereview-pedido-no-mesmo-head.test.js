// Pedido novo pode retomar uma tentativa pendente. Uma aprovação ou reprovação
// publicada continua contando no mesmo head para o automático (regra de29/10/2026).
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

/* ---------- rodada que acabou sem review meu (08/11/2026) ---------- */

const dispensado = () => { const e = engineBase(); Object.assign(e.decisions.resolved[0], { status: 'approval_not_needed', action: 'skip' }); return e; };

test('rodada encerrada sem review meu: commit novo devolve o PR à fila', () => {
  const e = dispensado();
  const [cand] = candidatos(e);
  assert.equal(cand.tipo, 'dispensado');
  assert.equal(cand.desde, REVIEW_EM, 'a régua é o fim da rodada');
  destrava.aplicarDestrave(e, cand, { tipo: 'push', at: PEDIDO_EM, head: 'b'.repeat(40) });
  assert.equal(e.seen.has(KEY), false);
  assert.equal(e.queue.some(p => p.key === KEY), true);
  assert.match(e.toasts.join(' '), /chegou commit novo/);
  assert.deepEqual(e.destravados[KEY], { at: PEDIDO_EM, tipo: 'push', head: 'b'.repeat(40) });
});

test('o mesmo push não vira sinal de novo quando o PR só recebe um comentário', async () => {
  const e = dispensado();
  const H2 = 'b'.repeat(40);
  destrava.aplicarDestrave(e, candidatos(e)[0], { tipo: 'push', at: PEDIDO_EM, head: H2 });
  e.seen.add(KEY);                                          // a rodada saiu sem decisão local
  e.panorama[0].updatedAt = new Date(AGORA).toISOString();  // só um comentário depois
  e.headSha = async () => H2;
  const [cand] = candidatos(e);
  assert.equal(cand.headConhecido, H2, 'conhece o head que a marca já consumiu');
  const semEvento = async () => ({ ok: true, stdout: '' });
  assert.equal(await destrava.sinalDeEstadoNovo(e, cand, semEvento), null);
});

test('commit realmente novo depois da marca volta a contar', async () => {
  const e = dispensado();
  destrava.aplicarDestrave(e, candidatos(e)[0], { tipo: 'push', at: PEDIDO_EM, head: 'b'.repeat(40) });
  e.seen.add(KEY);
  e.panorama[0].updatedAt = new Date(AGORA).toISOString();
  e.headSha = async () => 'c'.repeat(40);
  const sinal = await destrava.sinalDeEstadoNovo(e, candidatos(e)[0], async () => ({ ok: true, stdout: '' }));
  assert.equal(sinal.tipo, 'push');
  assert.equal(sinal.head, 'c'.repeat(40));
});

test('atividade sem estado novo não custa outra consulta até o PR mudar de novo', async () => {
  const e = dispensado();
  e.headSha = async () => HEAD;
  let chamadas = 0;
  const run = async () => { chamadas += 1; return { ok: true, stdout: '' }; };
  await destrava.destravarPorEstadoNovo(e, run);
  assert.equal(chamadas, 1);
  assert.equal(e.queue.length, 0, 'comentário não é estado novo');
  await destrava.destravarPorEstadoNovo(e, run);
  assert.equal(chamadas, 1, 'o updatedAt não andou');
  e.panorama[0].updatedAt = new Date(AGORA).toISOString();
  await destrava.destravarPorEstadoNovo(e, run);
  assert.equal(chamadas, 2);
});

test('rodada dispensada não volta sem pedido a mim, se ignorada, ou sem atividade depois dela', () => {
  const base = dispensado;
  const semPedido = base(); semPedido.mineKeys = new Set();
  assert.deepEqual(candidatos(semPedido), [], 'não me pedem mais revisão');
  const ignorado = base(); ignorado.ignorados = new Set([KEY]);
  assert.deepEqual(candidatos(ignorado), [], 'descarte deliberado');
  const quieto = base(); quieto.panorama[0].updatedAt = new Date(REVIEW_EM - MIN).toISOString();
  assert.deepEqual(candidatos(quieto), [], 'nada mudou depois da rodada');
});

test('review postado segue pelo próprio caminho, e item substituído nunca é o último', () => {
  for (const status of ['auto_approved', 'auto_rejected', 'superseded']) {
    const e = engineBase();
    e.decisions.resolved[0].status = status;
    assert.deepEqual(candidatos(e), [], status);
  }
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

test('pedido novo não apaga decisão anterior no mesmo head para o automático', async () => {
  const e = engineComReviews([{ state: 'APPROVED', at: REVIEW_EM, commit: HEAD }], { at: PEDIDO_EM, tipo: 'pedido' });
  const states = await decisionMod.myReviewStates(e, { key: KEY, repo: 'acme/r', number: 1 }, HEAD);
  assert.deepEqual(states, ['APPROVED']);
});

test('review POSTERIOR ao pedido conta, e o dedup volta a proteger contra duplicata', async () => {
  const e = engineComReviews([
    { state: 'APPROVED', at: REVIEW_EM, commit: HEAD },
    { state: 'APPROVED', at: PEDIDO_EM + MIN, commit: HEAD },
  ], { at: PEDIDO_EM, tipo: 'pedido' });
  const states = await decisionMod.myReviewStates(e, { key: KEY, repo: 'acme/r', number: 1 }, HEAD);
  assert.deepEqual(states, ['APPROVED', 'APPROVED'], 'as decisões deste head continuam contando');
});

test('a exceção de pedido continua disponível somente para a revisão manual explícita', async () => {
  const e = engineComReviews([{ state: 'APPROVED', at: REVIEW_EM, commit: HEAD }], { at: PEDIDO_EM, tipo: 'pedido' });
  assert.deepEqual(await decisionMod.myReviewStates(e, { key: KEY, manual: true }, HEAD), []);
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
