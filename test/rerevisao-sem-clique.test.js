// Reanalisar o necessário sem depender de ação manual (02/10/2026).
//
// Medição de uma semana (123 PRs de colegas com review meu) achou três buracos em que
// código novo entrava depois do meu review e o Farol não revisava de novo:
//   1. aprovação DISMISSED pelo push (repositório que dispensa aprovação velha): o gatilho
//      de re-revisão só lia APPROVED e CHANGES_REQUESTED, caía em indeterminado e nunca
//      relançava. Cinco PRs na semana, inclusive um mergeado com o pedido aberto;
//   2. pendência na mesa + commit novo: congelava até o seu clique;
//   3. saída de cena valia para o PR inteiro, não para o commit em que nasceu.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-rerevisao-'));
const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default;
const { TEMPOS } = await import('../lib/constants.js');
const { marcarCommitNovo } = await import('../lib/engine/pendencia-commit-novo.js');
const { observarHead, largarSeHeadMudou } = await import('../lib/engine/head-novo.js');
const skip = await import('../lib/engine/skip-review.js');

const runReal = io.run;
after(() => {
  io.run = runReal;
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});

const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
const AGORA = new Date('2026-10-02T15:00:00').getTime();
const QUIETO = AGORA - TEMPOS.HEAD_QUIETO_MS - 1000;
const KEY = 'acme/r#1';
const PR = { key: KEY, repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1', isDraft: false };
const semInflight = new Set();

function engineBase() {
  const e = Object.create(Engine.prototype);
  e.panorama = [{ ...PR, reviewedByMe: true }];
  e.staleInfo = {};
  e.staleStates = {};
  e.headQuietoDesde = {};
  e.reReviewLaunched = {};
  e.decisions = { pending: [], resolved: [] };
  e.autoReviewParked = new Set();
  e.retryAfterNet = new Map();
  e.skipComentado = {};
  e.config = {};
  e.accountForPr = () => 'eu';
  e.isMuted = () => false;
  e.autoReviewFor = () => true;
  e.tokenFor = () => 'tok';
  e.ghEnv = () => ({});
  e.budgetBlockedFor = () => false;
  e.outrosRevisando = () => [];
  e.reviewActions = () => ({});
  e.toasts = [];
  e.logs = [];
  e.emit = (_, t) => { e.toasts.push(t.text); };
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.salvos = 0;
  e.saveDecisions = () => { e.salvos++; };
  e.saveSkipComentado = () => { e.salvos++; };
  return e;
}

/* ---------- 1. aprovação dispensada pelo push ---------- */

test('1: o leitor do meu último review aceita DISMISSED, e o commit dele diz que o head andou', async () => {
  const e = engineBase();
  let jq = '';
  io.run = async (_cmd, args) => {
    const a = args.join(' ');
    if (a.includes('--json headRefOid')) return { ok: true, code: 0, stdout: `${H2}\n`, stderr: '' };
    if (a.includes('/reviews')) { jq = args[args.indexOf('--jq') + 1]; return { ok: true, code: 0, stdout: JSON.stringify({ state: 'DISMISSED', commit: H1 }), stderr: '' }; }
    return { ok: false, code: 1, stdout: '', stderr: 'inesperado' };
  };
  try {
    assert.deepEqual(await e.staleForReview(PR), { stale: true, head: H2, lastState: 'DISMISSED' });
  } finally { io.run = runReal; }
  assert.match(jq, /\.state == "DISMISSED"/, 'o filtro do gh inclui a aprovação dispensada');
  assert.match(jq, /\.state == "APPROVED" or \.state == "CHANGES_REQUESTED"/, 'e continua com as duas de antes');
});

test('1: aprovação dispensada com commit novo relança sozinha, depois do PR quieto', () => {
  const e = engineBase();
  e.staleInfo[KEY] = { stale: true, head: H2, lastState: 'DISMISSED' };
  e.headQuietoDesde[KEY] = { head: H2, at: AGORA - 1000 };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0, 'head fresco ainda espera o debounce');
  e.headQuietoDesde[KEY] = { head: H2, at: QUIETO };
  const alvos = e.reReviewTargets(semInflight, AGORA);
  assert.equal(alvos.length, 1);
  assert.equal(alvos[0]._headRound, H2);
});

test('1: dispensada sem commit novo (mesmo head) não relança, e estado desconhecido também não', () => {
  const e = engineBase();
  e.staleInfo[KEY] = { stale: false, head: H1, lastState: 'DISMISSED' };
  e.headQuietoDesde[KEY] = { head: H1, at: QUIETO };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0);
  e.staleInfo[KEY] = { stale: true, head: H2, lastState: 'COMMENTED' };
  e.headQuietoDesde[KEY] = { head: H2, at: QUIETO };
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 0, 'comentário não é decisão');
});

/* ---------- 2. pendência na mesa + commit novo ---------- */

function comPendencia(extra = {}) {
  const e = engineBase();
  e.decisions.pending.push({ id: 'd1', key: KEY, pr: PR, headSha: H1, createdAt: AGORA - 3600e3, reasons: [{ text: 'ponto da revisão', kind: 'content' }], ...extra });
  e.leituras = 0;
  e.headSha = async () => { e.leituras++; return H2; };
  return e;
}

test('2: pendência viva com head novo vira stale_head, com o head novo e o relógio recomeçando agora', async () => {
  const e = comPendencia();
  assert.equal(await marcarCommitNovo(e, null, AGORA), 1);
  const d = e.decisions.pending[0];
  assert.equal(d.blockedKind, 'stale_head');
  assert.equal(d.blockedHead, H2);
  assert.equal(d.headQuietoDesde, AGORA);
  assert.match(d.reasons[0].text, /chegou commit novo enquanto o resultado esperava você \(aaaaaaa -> bbbbbbb\): reviso de novo sozinho/);
  assert.equal(d.reasons[1].text, 'ponto da revisão', 'as razões da revisão ficam');
  assert.equal(e.salvos, 1);
  assert.ok(e.toasts.some((t) => /reviso de novo sozinho/.test(t)));
});

test('2: e a partir daí o gatilho B relança depois do PR quieto, sem clique', async () => {
  const e = comPendencia();
  await marcarCommitNovo(e, null, AGORA);
  assert.equal(e.reReviewTargets(semInflight, AGORA + 1000).length, 0, 'rajada de push ainda em curso espera');
  const alvos = e.reReviewTargets(semInflight, AGORA + TEMPOS.HEAD_QUIETO_MS + 1000);
  assert.equal(alvos.length, 1);
  assert.equal(alvos[0]._headRound, H2);
});

test('2: não mexe no que já tem dono para o commit novo, nem sem prova do head', async () => {
  for (const extra of [{ esperaCi: { desde: 1 } }, { postRetry: { event: 'approve', attempts: 0 } }, { blockedKind: 'stale_head', blockedHead: H2 }, { headSha: '' }]) {
    const e = comPendencia(extra);
    assert.equal(await marcarCommitNovo(e, null, AGORA), 0, JSON.stringify(extra));
    assert.equal(e.leituras, 0, 'nem lê o GitHub');
  }
  for (const resposta of [H1, '']) {
    const e = comPendencia();
    e.headSha = async () => resposta;
    assert.equal(await marcarCommitNovo(e, null, AGORA), 0, `head lido: "${resposta}"`);
    assert.equal(e.decisions.pending[0].blockedKind, undefined);
  }
  const e = comPendencia();
  e.headSha = async () => { throw new Error('rede'); };
  assert.equal(await marcarCommitNovo(e, null, AGORA), 0);
  assert.equal(e.decisions.pending[0].blockedKind, undefined);
});

test('2: respeita o recorte de chaves de quem chama', async () => {
  const e = comPendencia();
  assert.equal(await marcarCommitNovo(e, new Set(['outro/r#9']), AGORA), 0);
  assert.equal(e.leituras, 0);
});

test('2: o reconcilePending de cada ciclo faz a marcação, sem clique', async () => {
  const e = comPendencia();
  e.prState = async () => 'OPEN';
  e.myReviewsWithTime = async () => [];
  await e.reconcilePending();
  assert.equal(e.decisions.pending[0].blockedKind, 'stale_head');
  assert.equal(e.decisions.pending[0].blockedHead, H2);
});

/* ---------- 3. saída de cena presa ao commit ---------- */

test('3: commit novo libera a saída de cena, inclusive a co-assinada; mesmo head ou sem prova, não', () => {
  for (const reg of [{ head: H1, quem: ['ana'] }, { head: H1, quem: ['ana'], coAssinado: true }]) {
    const e = engineBase();
    e.skipComentado[KEY] = reg;
    assert.equal(largarSeHeadMudou(e, KEY, H2), true);
    assert.equal(e.skipComentado[KEY], undefined);
    assert.equal(e.salvos, 1);
    assert.ok(e.toasts.some((t) => /chegou commit novo depois que saí de cena/.test(t)));
  }
  for (const [reg, head] of [[{ head: H1 }, H1], [{ head: '' }, H2], [{ head: H1 }, '']]) {
    const e = engineBase();
    e.skipComentado[KEY] = reg;
    assert.equal(largarSeHeadMudou(e, KEY, head), false);
    assert.ok(e.skipComentado[KEY]);
  }
});

test('3: o PR da fila com saída de cena volta sem ler review nenhum quando o commit mudou', async () => {
  const e = engineBase();
  e.skipComentado[KEY] = { head: H1, quem: ['ana'] };
  let chamadas = 0;
  io.run = async () => { chamadas++; return { ok: false, code: 1, stdout: '', stderr: '' }; };
  try {
    assert.equal(await skip.seguirForaDeCena(e, PR, e.skipComentado[KEY], H2), false);
  } finally { io.run = runReal; }
  assert.equal(chamadas, 0);
  assert.equal(e.skipComentado[KEY], undefined);
});

test('3: o PR que eu revisei sai do saiu_de_cena no refresh do ciclo e a re-revisão volta a valer', async () => {
  const e = engineBase();
  e.skipComentado[KEY] = { head: H1, quem: ['ana'] };
  e.staleForReview = async () => ({ stale: true, head: H2, lastState: 'CHANGES_REQUESTED' });
  await e.refreshStaleStates(QUIETO);
  assert.equal(e.skipComentado[KEY], undefined);
  assert.deepEqual(e.headQuietoDesde[KEY], { head: H2, at: QUIETO }, 'o relógio de PR quieto segue carimbado como antes');
  assert.equal(e.reReviewTargets(semInflight, AGORA).length, 1);
});

test('3: observarHead mantém o carimbo antigo quando o head não mudou e não carimba head vazio', () => {
  const e = engineBase();
  observarHead(e, KEY, H1, 10);
  observarHead(e, KEY, H1, 20);
  assert.deepEqual(e.headQuietoDesde[KEY], { head: H1, at: 10 });
  observarHead(e, 'acme/r#2', '', 30);
  assert.equal(e.headQuietoDesde['acme/r#2'], undefined);
});
