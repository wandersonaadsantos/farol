// O observador não executa (28/09/2026, decisão do dono): o aparelho admin assiste e
// decide, e nenhuma revisão headless, autoanálise ou pushback nasce nele, por caminho
// nenhum. A pergunta mora numa porta só (lib/engine/porta-de-execucao.js), e cada
// caminho que chega à execução por fora dela (admissão, capacidade publicada, atribuição
// da distribuição, comandos entre aparelhos) recusa com o código `observador`.
// Runner nativo, ZERO deps. Engine real com FAROL_HOME temporário.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-observador-' + process.pid);

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
const chamadas = [];
io.run = function runEspiao(cmd, args) {
  chamadas.push({ cmd, args: args || [] });
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');
const { AVISO_OBSERVADOR } = await import('../lib/engine/papel-do-aparelho.js');
const porta = (await import('../lib/engine/porta-de-execucao.js')).default;
const admissao = (await import('../lib/engine/admissao.js')).default;
const dist = await import('../lib/engine/sync-distribuicao.js');
const escolha = await import('../lib/engine/escolha.js');
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const comandos = await import('../lib/engine/sync-comandos.js');
const envelope = (await import('../lib/sync/envelope.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { STATE_DIR } = await import('../lib/paths.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; });

const AGORA = Date.now();

// `adminDev` é quem o sinal do banco diz que é o admin; este aparelho é sempre `d1`
function engineDe(conta, { adminDev = 'd1' } = {}) {
  const e = new Engine();
  e.config.accounts = [{ user: conta, owners: ['biudtech'] }];
  e.config.sync = { ...(e.config.sync || {}), enabled: true, shared: { ...((e.config.sync || {}).shared || {}), enabled: true } };
  e.sync = { deviceId: 'd1', sinais: { admin: { dev: adminDev } }, lastPresenceAt: AGORA, material: kek.novoMaterial(), uid: 'u1', cur: 'g1' };
  e.doctorInfo = { claude: true, ghAuth: true };
  e.token = 'tok';
  e.tokens = { [conta]: 'tok' };
  e.tokenOk = true;
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.pushState = () => { };
  e.processHeadless = () => { };
  e.bloqueiaAutomatico = async () => false;
  return e;
}

const URL_314 = 'https://github.com/biudtech/engine-ai/pull/314';
const URL_315 = 'https://github.com/biudtech/engine-ai/pull/315';
const prDo = (author, n = 314) => ({ key: `biudtech/engine-ai#${n}`, url: `https://github.com/biudtech/engine-ai/pull/${n}`, repo: 'biudtech/engine-ai', number: n, author });

test('launchReview no admin: PR de outra pessoa não enfileira e o aviso sai uma vez por lote', async () => {
  const e = engineDe('eu');
  e.panorama = [prDo('bob'), prDo('alice', 315)];
  const enfileirados = [];
  const toasts = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  e.on('toast', (t) => toasts.push(t));
  const r = await e.launchReview([URL_314, URL_315], 'auto', 'clique');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'nada deste lote pode executar neste aparelho');
  assert.equal(enfileirados.length, 0, 'nem o clique abre revisão headless no admin');
  assert.deepEqual(toasts.filter(t => t.text === AVISO_OBSERVADOR).length, 1, 'um aviso por lote, não por PR');
  assert.equal(e.seen.has(prDo('').key), false, 'PR barrado não é marcado como visto');
});

test('enqueueHeadless no admin: re-revisão, comando e distribuição recusam com observador', () => {
  const e = engineDe('eu');
  const r = e.enqueueHeadless({ ...prDo('bob'), viaComando: true });
  assert.deepEqual(r, { ok: false, code: 'observador' });
  assert.equal(e.headlessQueue.length, 0);
});

test('admissão no admin: review, self e pushback recusam com observador, e chat não', () => {
  const e = engineDe('eu');
  for (const tipo of ['review', 'self', 'pushback']) {
    const r = admissao.reservar(e, { tipo, agora: AGORA });
    assert.equal(r.ok, false, tipo);
    assert.equal(r.motivo, 'observador', tipo);
  }
  const chat = admissao.reservar(e, { tipo: 'chat', agora: AGORA });
  assert.notEqual(chat.motivo, 'observador', 'conversa não é execução de revisão');
});

test('aparelho que não é o admin segue o caminho normal', () => {
  const e = engineDe('eu', { adminDev: 'd2' });
  assert.equal(porta.motivoParaNaoExecutar(e, prDo('bob')), '');
  const r = e.enqueueHeadless({ ...prDo('bob'), manual: true });
  assert.notEqual(r && r.code, 'observador');
  assert.equal(e.headlessQueue.length, 1);
});

test('compartilhamento desligado: o aparelho é o Farol de sempre, nunca observador', () => {
  const e = engineDe('eu');
  e.config.sync = { ...e.config.sync, enabled: false };
  assert.equal(porta.motivoParaNaoExecutar(e, prDo('bob')), '');
});

test('a porta mantém a regra do PR próprio fora do admin', () => {
  const e = engineDe('eu', { adminDev: 'd2' });
  assert.equal(porta.motivoParaNaoExecutar(e, prDo('eu')), 'pr-proprio');
  const e2 = engineDe('eu');
  assert.equal(porta.motivoParaNaoExecutar(e2, prDo('eu')), 'observador', 'no admin a razão maior vem primeiro');
});

function statusDe(e, claro) {
  const cif = envelope.cifrar({
    uid: e.sync.uid, caminho: 'live/deviceStatus/d9', campo: 'capacidade', no: 'live/deviceStatus', esquema: 'cap1',
    cur: e.sync.cur, material: e.sync.material, r: 1, dados: { c: claro },
  });
  assert.equal(cif.ok, true, cif.motivo);
  return { v: 1, u: AGORA, enc: cif.enc };
}

test('capacidade: o admin publica observador, e o agendador não o elege', () => {
  const e = engineDe('eu');
  const claro = publicacao.capacidadeDe(e, e.config.sync);
  assert.equal(claro.observador, true);
  const estado = dist.estadoDoAparelho(e.sync, 'd9', statusDe(e, { ...claro, aceitarAdmin: true, paralelismo: 2 }), { lista: [], agora: AGORA });
  assert.equal(estado.apto, false);
  assert.equal(estado.observador, true);
  const item = { itemId: 'aa_bb', publicadores: ['d9'] };
  assert.equal(escolha.motivoDoAparelho(item, { d9: estado }, 'd9', { agora: AGORA }), 'observador');
  const outro = dist.estadoDoAparelho(e.sync, 'd9', statusDe(e, { ...claro, aceitarAdmin: true, observador: false, paralelismo: 2 }), { lista: [], agora: AGORA });
  assert.equal(outro.apto, true, 'executor comum continua elegível');
  assert.equal(outro.observador, false);
});

test('capacidade de quem não é admin publica observador false', () => {
  const e = engineDe('eu', { adminDev: 'd2' });
  assert.equal(publicacao.capacidadeDe(e, e.config.sync).observador, false);
});

test('comandos entre aparelhos: tomar, iniciar e repetir recusam no admin', async () => {
  const e = engineDe('eu');
  for (const tipo of ['tomar', 'iniciar', 'repetir']) {
    const r = await comandos.executar(e, e.config.sync, 'c1', { tipo, args: { prTag: 'aa', matTag: 'bb', acctTag: 'cc' } }, AGORA);
    assert.deepEqual(r, { estado: 'recusado', code: 'observador' }, tipo);
  }
});

test('autoanálise no admin: não entra na fila e devolve o aviso', async () => {
  const e = engineDe('eu');
  e.myPRs = [prDo('eu')];
  const r = await e.launchSelfAnalysis(URL_314);
  assert.deepEqual(r, { ok: false, error: AVISO_OBSERVADOR });
  assert.equal(e.headlessQueue.length, 0);
});

test('varredura de pushback no admin não roda', async () => {
  const e = engineDe('eu');
  e.config.autoPushback = true;
  let leu = false;
  e.reviewActions = () => { leu = true; return []; };
  await e.scanPushbacks();
  assert.equal(leu, false, 'a varredura sai antes de olhar qualquer PR');
  assert.notEqual(e.pushbackScanning, true, 'nem a trava de varredura é tomada');
});

test('o filtro automático do ciclo não lança revisão no admin', () => {
  const e = engineDe('eu');
  assert.equal(e.souObservador(), true);
  assert.equal(engineDe('eu', { adminDev: 'd2' }).souObservador(), false);
});

test('atribuição da distribuição no admin: recusa com o detalhe observador, sem reservar vaga', async () => {
  const e = engineDe('eu');
  const cfg = { ...e.config.sync, coordination: { enabled: true }, distribution: { enabled: true }, aceitarAdmin: true };
  const escritas = [];
  e.sync.autoridade = { fresca: true };
  e.sync.client = {
    get: async () => ({ ok: true, data: null }),
    put: async (caminho, corpo) => { escritas.push({ caminho, corpo }); return { ok: true }; },
  };
  const arvore = { aa_bb: { dev: 'd1', ttl: AGORA + 60000, generation: 0, matTag: 'bb' } };
  const r = await dist.aceitarAtribuicoes(e, cfg, arvore, { agora: AGORA });
  assert.deepEqual(r.aceitas, []);
  assert.deepEqual(r.recusas, [{ itemId: 'aa_bb', code: 'inapto', problema: 'observador' }]);
  const resposta = escritas.find((w) => /aa_bb$/.test(w.caminho));
  assert.equal(resposta.corpo.detalhe, 'observador', 'o detalhe chega a quem distribuiu, não some como fora da lista');
  assert.equal(admissao.resumo(e).total, 0);
  const deNovo = await dist.aceitarAtribuicoes(e, cfg, arvore, { agora: AGORA + 1 });
  assert.deepEqual(deNovo.recusas, [], 'a recusa sai uma vez por atribuição, não a cada giro');
});

/* ---------- fix 1: os dois relançamentos automáticos do ciclo ----------
   A re-revisão pós-push (launchReReviews) e a repescagem do retry pós-transitório
   (_repescarRetry) faziam os efeitos ANTES de chegar ao enqueueHeadless, que recusava em
   silêncio: no admin saía "revisando de novo" falso, a âncora do round era queimada (e o
   round morria se o aparelho deixasse de ser admin), e o PR do retry sumia da fila. */

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const { diaLocal } = await import('../lib/engine/review.js');
const { TEMPOS } = await import('../lib/constants.js');

function engineReRevisao({ adminDev = 'd1' } = {}) {
  const e = engineDe('eu', { adminDev });
  const pr = { key: 'biudtech/engine-ai#314', repo: 'biudtech/engine-ai', number: 314, url: URL_314, isDraft: false };
  e.panorama = [pr];
  e.staleInfo = { [pr.key]: { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' } };
  e.headQuietoDesde = { [pr.key]: { head: H2, at: Date.now() - TEMPOS.HEAD_QUIETO_MS - 1000 } };
  e.reReviewLaunched = { [pr.key]: { head: H1, dia: diaLocal(Date.now()), rodadas: 1 } };
  e.saveReReviewLaunched = () => { };
  e.fetchPrFiles = async () => { throw new Error('sem prova'); };
  let gh = 0;
  e.bloqueiaAutomatico = async () => { gh += 1; return false; };
  e.bloqueadoPorHistorico = async () => { gh += 1; return { bloqueado: false, head: '', quem: [], decisivos: [] }; };
  e.bloqueadoPorChecks = async () => { gh += 1; return { bloqueado: false, faltando: [] }; };
  const enfileirados = [];
  e.enqueueHeadless = (p) => { enfileirados.push(p); return { ok: true }; };
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  return { e, pr, enfileirados, toasts, gh: () => gh };
}

test('re-revisão pós-push no admin: nenhuma consulta, âncora intacta, sem aviso e nada enfileirado', async () => {
  const { e, pr, enfileirados, toasts, gh } = engineReRevisao();
  const antes = JSON.stringify(e.reReviewLaunched[pr.key]);
  await e.launchReReviews();
  assert.equal(gh(), 0, 'o admin não vai ao gh por um round que não vai rodar');
  assert.equal(JSON.stringify(e.reReviewLaunched[pr.key]), antes, 'a âncora do round não é queimada');
  assert.deepEqual(toasts, [], 'nenhum "revisando de novo" falso');
  assert.equal(enfileirados.length, 0);
});

test('re-revisão pós-push fora do admin segue relançando (contraprova da bancada)', async () => {
  const { e, pr, enfileirados } = engineReRevisao({ adminDev: 'd2' });
  await e.launchReReviews();
  assert.equal(enfileirados.length, 1);
  assert.equal(e.reReviewLaunched[pr.key].head, H2);
});

function engineRetry({ adminDev = 'd1' } = {}) {
  const e = engineDe('eu', { adminDev });
  const pr = { ...prDo('bob') };
  e.saveSeen = () => { };
  e.prState = async () => 'OPEN';
  e.retryAfterNet.set(pr.key, { tries: 1, pr: { ...pr } });
  e.retryTargets = () => [{ ...pr }];
  e.queue = [{ ...pr }];
  const enfileirados = [];
  e.enqueueHeadless = (p) => { enfileirados.push(p); return { ok: true }; };
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  return { e, pr, enfileirados, toasts };
}

test('retry pós-transitório no admin: o PR fica na fila, não é marcado visto e nada relança', async () => {
  const { e, pr, enfileirados, toasts } = engineRetry();
  await e._repescarRetry([], new Set());
  assert.equal(enfileirados.length, 0);
  assert.deepEqual(e.queue.map((p) => p.key), [pr.key], 'o card continua na fila do admin');
  assert.equal(e.seen.has(pr.key), false, 'nem marcado como visto');
  assert.deepEqual(toasts, [], 'nenhum "relançando" falso');
  assert.equal(e.retryAfterNet.has(pr.key), true, 'a promessa do retry não é consumida pelo admin');
});

test('retry pós-transitório fora do admin relança como sempre (contraprova)', async () => {
  const { e, enfileirados } = engineRetry({ adminDev: 'd2' });
  await e._repescarRetry([], new Set());
  assert.equal(enfileirados.length, 1);
  assert.deepEqual(e.queue, []);
});
