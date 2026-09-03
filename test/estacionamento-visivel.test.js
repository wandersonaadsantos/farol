// Estacionamento VISÍVEL e com motivo (v2.57.4).
//
// Caso medido (biudtech/biud-core#317, 03/09/2026, no Farol de um colega): a sessão
// autônoma abriu às 13:14:55, morreu às 13:21:56 sem postar nada, e o PR voltou pra
// "Sua fila" com o botão Revisar, sem NENHUM rastro na tela do que tinha acontecido.
// O único registro era um toast de cinco segundos e uma linha ERROR no farol.log. Do
// lado de quem olha a tela, "nunca revisou" e "revisou, caiu e estacionou" eram
// idênticos, e o PR ficou duas horas parado enquanto o mesmo Farol revisava outros.
// Três frentes, todas aqui:
//   1) o estacionamento passa a guardar POR QUE e QUANDO estacionou, e o card mostra;
//   2) morte por provedor de IA indisponível (5xx, "Overloaded") é transitória, não
//      permanente: volta pra fila e relança sozinha, com o teto de sempre;
//   3) a poda do estacionamento exige duas ausências seguidas do panorama, porque o
//      índice do gh search já respondeu "não achei" sobre PR aberto (mesma régua da
//      poda da autoanálise, SELF_PRUNE_STRIKES).
// Runner nativo, ZERO deps. Engine real com FAROL_HOME temporário.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-estacionamento-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');
const P = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

// mensagem REAL do farol.log de 03/09/2026 (7 linhas idênticas entre 10:47 e 11:56)
const MSG_529 = 'sessão retornou erro: API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment. If it persists, check https://status.claude.com.';
const MSG_CONTRATO = 'JSON da sessão fora do contrato';

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.isMuted = () => false;
  e.tokens = { eu: 'tok-eu' };
  e.log = () => { };
  e.prState = async () => 'OPEN';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  return e;
}
const prDe = (key) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

/* ---------- 1) o estacionamento sabe por que e quando ---------- */

test('falha permanente estaciona com motivo, tipo e hora', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { throw new Error(MSG_CONTRATO); };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(e.autoReviewParked.has('o/r#1'), true);
  const info = e.parkedMotivos['o/r#1'];
  assert.ok(info, 'o motivo é registrado junto da key');
  assert.equal(info.tipo, 'falha');
  assert.match(info.motivo, /fora do contrato/);
  assert.ok(!isNaN(Date.parse(info.at)), 'a hora é um ISO legível');
});

test('cancelamento estaciona com tipo cancelado', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { const err = new Error('cancelado'); err.cancelled = true; throw err; };
  await e.runOneHeadless(prDe('o/r#2'), 'eu');
  assert.equal(e.parkedMotivos['o/r#2'].tipo, 'cancelado');
});

test('retry esgotado estaciona com tipo esgotado e o último erro como motivo', async () => {
  const e = engineBase();
  e.retryAfterNet.set('o/r#3', { tries: 3, pr: prDe('o/r#3'), notBefore: null });
  e.runHeadlessReview = async () => { throw new Error('fetch failed'); };
  await e.runOneHeadless(prDe('o/r#3'), 'eu');
  assert.equal(e.autoReviewParked.has('o/r#3'), true, 'teto de 3 tentativas transitórias estaciona');
  assert.equal(e.parkedMotivos['o/r#3'].tipo, 'esgotado');
  assert.match(e.parkedMotivos['o/r#3'].motivo, /fetch failed/);
});

test('orçamento estourado na boca da sessão estaciona com tipo orcamento', async () => {
  const e = engineBase();
  e.budgetBlockedFor = () => ({ id: 'p1', label: 'P1' });
  e.runHeadlessReview = async () => { throw new Error('não deveria abrir sessão'); };
  e.headlessBusyAccounts.set('eu', 1);
  await e.runOneHeadless(prDe('o/r#4'), 'eu');
  assert.equal(e.parkedMotivos['o/r#4'].tipo, 'orcamento');
  assert.match(e.parkedMotivos['o/r#4'].motivo, /P1/);
});

test('o motivo persiste entre reinícios da Engine, no MESMO arquivo do estacionamento', async () => {
  const e1 = engineBase();
  e1.runHeadlessReview = async () => { throw new Error(MSG_CONTRATO); };
  await e1.runOneHeadless(prDe('acme/repo#7'), 'eu');
  const e2 = new Engine();
  assert.equal(e2.autoReviewParked.has('acme/repo#7'), true);
  assert.equal(e2.parkedMotivos['acme/repo#7'].tipo, 'falha');
  assert.match(e2.parkedMotivos['acme/repo#7'].motivo, /fora do contrato/);
});

test('arquivo legado (lista de keys) continua lido, só que sem motivo', () => {
  const arquivo = path.join(STATE_DIR, 'auto-review-parked.json');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(arquivo, '["legado/repo#1"]');
  const e = new Engine();
  assert.equal(e.autoReviewParked.has('legado/repo#1'), true, 'a key do formato antigo entra');
  assert.equal(e.parkedMotivos['legado/repo#1'], undefined, 'sem motivo não se inventa motivo');
  fs.unlinkSync(arquivo);
});

test('motivo de key que não está mais estacionada não sobrevive ao boot', () => {
  const arquivo = path.join(STATE_DIR, 'auto-review-parked.json');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify({ keys: ['a/b#1'], motivos: { 'a/b#1': { at: 'x', motivo: 'm', tipo: 'falha' }, 'orfa/x#9': { at: 'x', motivo: 'm', tipo: 'falha' } } }));
  const e = new Engine();
  assert.deepEqual(Object.keys(e.parkedMotivos), ['a/b#1'], 'motivo órfão é descartado no load');
  fs.unlinkSync(arquivo);
});

test('lançar de novo (Revisar) tira do estacionamento E apaga o motivo', async () => {
  const e = engineBase();
  e.token = 'tok-eu';
  e.refreshTokens = async () => true;
  e.enqueueHeadless = () => { };
  e.pushState = () => { };
  e.markSeen = () => { };
  e.saveSeen = () => { };
  const pr = prDe('o/r#5');
  e.queue = [{ ...pr }];
  e.autoReviewParked.add(pr.key);
  e.parkedMotivos[pr.key] = { at: new Date().toISOString(), motivo: 'x', tipo: 'falha' };
  const r = await e.launchReview([pr.url], 'auto');
  assert.equal(r.ok, true);
  assert.equal(e.autoReviewParked.has(pr.key), false);
  assert.equal(e.parkedMotivos[pr.key], undefined, 'motivo velho não pode reaparecer no card da revisão nova');
});

test('snapshot expõe parked só com at, motivo (curto) e tipo, e só das keys estacionadas', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { throw new Error('x'.repeat(400)); };
  await e.runOneHeadless(prDe('o/r#6'), 'eu');
  e.parkedMotivos['fantasma/x#1'] = { at: 'x', motivo: 'm', tipo: 'falha', segredo: 'nao' };
  const snap = e.snapshot();
  assert.deepEqual(Object.keys(snap.parked), ['o/r#6'], 'motivo sem key no Set não vai pra tela');
  assert.deepEqual(Object.keys(snap.parked['o/r#6']).sort(), ['at', 'motivo', 'tipo']);
  assert.ok(snap.parked['o/r#6'].motivo.length <= 200, 'o texto é cortado: stderr inteiro não é pra tela');
  assert.doesNotThrow(() => JSON.stringify(snap));
});

/* ---------- 2) provedor de IA indisponível é transitório ---------- */

test('529 Overloaded NÃO estaciona: entra no retry transitório e o PR relança sozinho', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { throw new Error(MSG_529); };
  await e.runOneHeadless(prDe('o/r#8'), 'eu');
  assert.equal(e.autoReviewParked.has('o/r#8'), false, 'era o caso do #317: estacionava em silêncio');
  assert.equal(e.retryAfterNet.get('o/r#8').tries, 1);
});

/* ---------- 3) o card da fila mostra o estacionamento ---------- */

const MARK = { style: '', varStyle: '', dim: '', chip: '', dot: '', acct: { label: 'acme' } };
const PR = { key: 'acme/api#7', url: 'https://github.com/acme/api/pull/7', title: 'Corrige o gate', author: 'alice', updatedAt: '2026-09-03T16:00:00Z' };

test('queueCardHtml: PR estacionado mostra quando parou, por que, e que o Revisar tenta de novo', () => {
  const parked = { 'acme/api#7': { at: '2026-09-03T16:21:56Z', motivo: 'sessão retornou erro: API Error: 529', tipo: 'falha' } };
  const html = P.queueCardHtml(PR, { people: {}, mark: MARK, parked });
  assert.match(html, /pr-parked/, 'tem o bloco de estacionamento');
  assert.match(html, /Revisão automática parada/);
  assert.match(html, /API Error: 529/, 'o motivo aparece');
  assert.match(html, /Revisar/, 'diz que o botão tenta de novo');
  assert.doesNotMatch(html, /—/, 'sem travessão');
});

test('queueCardHtml: cada tipo de estacionamento tem a própria frase', () => {
  const de = (tipo) => P.queueCardHtml(PR, { people: {}, mark: MARK, parked: { 'acme/api#7': { at: '2026-09-03T16:21:56Z', motivo: 'm', tipo } } });
  assert.match(de('cancelado'), /cancelada por você/);
  assert.match(de('orcamento'), /orçamento/);
  assert.match(de('esgotado'), /várias vezes/);
  assert.match(de('falha'), /falhou/);
});

test('queueCardHtml: sem estacionamento não há bloco, e ctx sem parked não quebra', () => {
  assert.doesNotMatch(P.queueCardHtml(PR, { people: {}, mark: MARK, parked: {} }), /pr-parked/);
  assert.doesNotMatch(P.queueCardHtml(PR, { people: {}, mark: MARK }), /pr-parked/);
});

test('queueCardHtml: o motivo sai escapado', () => {
  const parked = { 'acme/api#7': { at: '2026-09-03T16:21:56Z', motivo: '<img src=x onerror=1>', tipo: 'falha' } };
  const html = P.queueCardHtml(PR, { people: {}, mark: MARK, parked });
  assert.ok(!html.includes('<img src=x'), 'a carga não aparece crua');
  assert.match(html, /&lt;img/);
});
