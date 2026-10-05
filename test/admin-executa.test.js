// O admin revisa a própria fila (28/09/2026 à noite, decisão do dono, revendo a v2.64.0):
// o aparelho admin é o mais capaz do conjunto e o dono o usa todo dia, então ele executa
// como qualquer aparelho, por todos os caminhos (clique, ciclo automático, re-revisão,
// retry, autoanálise, pushback, distribuição e comandos), e continua sendo quem vê a frota
// e decide pelos outros. Cada teste aqui falhava com a regra do observador.
// Runner nativo, ZERO deps. Engine real com FAROL_HOME temporário.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-admin-executa-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
io.run = function runEspiao() {
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');
const porta = (await import('../lib/engine/porta-de-execucao.js')).default;
const admissao = (await import('../lib/engine/admissao.js')).default;
const dist = await import('../lib/engine/sync-distribuicao.js');
const escolha = await import('../lib/engine/escolha.js');
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const comandos = await import('../lib/engine/sync-comandos.js');
const envelope = (await import('../lib/sync/envelope.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { STATE_DIR } = await import('../lib/paths.js');
const { diaLocal } = await import('../lib/engine/review.js');
const { TEMPOS } = await import('../lib/constants.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

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

test('launchReview no admin: o clique enfileira os PRs de outras pessoas', async () => {
  const e = engineDe('eu');
  e.panorama = [prDo('bob'), prDo('alice', 315)];
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); return { ok: true }; };
  const r = await e.launchReview([URL_314, URL_315], 'auto', 'clique');
  assert.notEqual(r.error, 'nada deste lote pode executar neste aparelho');
  assert.deepEqual(enfileirados.map((p) => p.key).sort(), [prDo('').key, prDo('', 315).key]);
});

test('enqueueHeadless no admin: o PR entra na fila local', () => {
  const e = engineDe('eu');
  const r = e.enqueueHeadless({ ...prDo('bob'), manual: true });
  assert.equal(r.ok, true);
  assert.equal(e.headlessQueue.length, 1);
});

test('admissão no admin: review, self e pushback não recusam por ser admin', () => {
  const e = engineDe('eu');
  for (const tipo of ['review', 'self', 'pushback']) {
    const r = admissao.reservar(e, { tipo, agora: AGORA });
    assert.notEqual(r.motivo, 'observador', tipo);
  }
});

test('a porta só barra o PR próprio, no admin e fora dele', () => {
  for (const adminDev of ['d1', 'd2']) {
    const e = engineDe('eu', { adminDev });
    assert.equal(porta.motivoParaNaoExecutar(e, prDo('bob')), '', adminDev);
    assert.equal(porta.motivoParaNaoExecutar(e, prDo('eu')), 'pr-proprio', adminDev);
  }
});

function statusDe(e, claro) {
  const cif = envelope.cifrar({
    uid: e.sync.uid, caminho: 'live/deviceStatus/d9', campo: 'capacidade', no: 'live/deviceStatus', esquema: 'cap1',
    cur: e.sync.cur, material: e.sync.material, r: 1, dados: { c: claro },
  });
  assert.equal(cif.ok, true, cif.motivo);
  return { v: 1, u: AGORA, enc: cif.enc };
}

test('capacidade: o admin não se declara fora e o agendador o elege', () => {
  const e = engineDe('eu');
  const claro = publicacao.capacidadeDe(e, e.config.sync);
  assert.equal('observador' in claro, false);
  const estado = dist.estadoDoAparelho(e.sync, 'd9', statusDe(e, { ...claro, aceitarAdmin: true, paralelismo: 2 }), { lista: [], agora: AGORA });
  assert.equal(estado.apto, true);
  // capacidade publicada por um admin na v2.64.x ainda traz o campo; ele não conta mais
  const antigo = dist.estadoDoAparelho(e.sync, 'd9', statusDe(e, { ...claro, aceitarAdmin: true, observador: true, paralelismo: 2 }), { lista: [], agora: AGORA });
  assert.equal(antigo.apto, true);
  const item = { itemId: 'aa_bb', publicadores: ['d9'] };
  assert.notEqual(escolha.motivoDoAparelho(item, { d9: estado }, 'd9', { agora: AGORA }), 'observador');
});

test('comandos entre aparelhos: tomar, iniciar e repetir não recusam por ser admin', async () => {
  const e = engineDe('eu');
  for (const tipo of ['tomar', 'iniciar', 'repetir']) {
    const r = await comandos.executar(e, e.config.sync, 'c1', { tipo, args: { prTag: 'aa', matTag: 'bb', acctTag: 'cc' } }, AGORA);
    assert.notEqual(r.code, 'observador', tipo);
  }
});

test('autoanálise no admin: não devolve o aviso de quem só assiste', async () => {
  const e = engineDe('eu');
  e.myPRs = [prDo('eu')];
  const r = await e.launchSelfAnalysis(URL_314);
  assert.doesNotMatch(String(r.error || ''), /assiste e decide/);
});

test('varredura de pushback no admin olha os PRs', async () => {
  const e = engineDe('eu');
  e.config.autoPushback = true;
  let leu = false;
  e.reviewActions = () => { leu = true; return []; };
  await e.scanPushbacks();
  assert.equal(leu, true);
});

test('atribuição da distribuição no admin: não recusa por ser admin', async () => {
  const e = engineDe('eu');
  const cfg = { ...e.config.sync, coordination: { enabled: true }, distribution: { enabled: true }, aceitarAdmin: true };
  e.sync.autoridade = { fresca: true };
  e.sync.client = { get: async () => ({ ok: true, data: null }), put: async () => ({ ok: true }) };
  const arvore = { aa_bb: { dev: 'd1', ttl: AGORA + 60000, generation: 0, matTag: 'bb' } };
  const r = await dist.aceitarAtribuicoes(e, cfg, arvore, { agora: AGORA });
  assert.equal(r.recusas.some((x) => x.problema === 'observador'), false);
});

/* ---------- os dois relançamentos automáticos do ciclo, no admin e fora dele ---------- */

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

function engineReRevisao({ adminDev = 'd1' } = {}) {
  const e = engineDe('eu', { adminDev });
  const pr = { key: 'biudtech/engine-ai#314', repo: 'biudtech/engine-ai', number: 314, url: URL_314, isDraft: false };
  e.panorama = [pr];
  e.staleInfo = { [pr.key]: { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' } };
  e.headQuietoDesde = { [pr.key]: { head: H2, at: Date.now() - TEMPOS.HEAD_QUIETO_MS - 1000 } };
  e.reReviewLaunched = { [pr.key]: { head: H1, dia: diaLocal(Date.now()), rodadas: 1 } };
  e.saveReReviewLaunched = () => { };
  e.fetchPrFiles = async () => { throw new Error('sem prova'); };
  e.bloqueiaAutomatico = async () => false;
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  const enfileirados = [];
  e.enqueueHeadless = (p) => { enfileirados.push(p); return { ok: true }; };
  return { e, pr, enfileirados };
}

for (const [rotulo, adminDev] of [['no admin', 'd1'], ['fora do admin', 'd2']]) {
  test(`re-revisão pós-push ${rotulo} relança`, async () => {
    const { e, pr, enfileirados } = engineReRevisao({ adminDev });
    await e.launchReReviews();
    assert.equal(enfileirados.length, 1);
    assert.equal(e.reReviewLaunched[pr.key].head, H2);
  });
}

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
  return { e, enfileirados };
}

for (const [rotulo, adminDev] of [['no admin', 'd1'], ['fora do admin', 'd2']]) {
  test(`retry pós-transitório ${rotulo} relança`, async () => {
    const { e, enfileirados } = engineRetry({ adminDev });
    await e._repescarRetry([], new Set());
    assert.equal(enfileirados.length, 1);
    assert.deepEqual(e.queue, []);
  });
}
