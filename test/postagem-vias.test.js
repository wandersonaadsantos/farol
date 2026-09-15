// As vias de postagem com a coordenação ligada, em dois "aparelhos" da mesma conta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-vias-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const registro = await import('../lib/engine/registro-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const CORPO = 'Leitura atenta, tudo certo por aqui.';
const CTX_REG = { account: 'eu', prKey: PR.key, head: HEAD, evento: 'APPROVE' };
const relogio = { agora: AGORA, head: HEAD };
const runReal = io.run;
let fake;
let gh;
let n = 0;
let handles = [];

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  io.run = runReal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  relogio.agora = AGORA;
  relogio.head = HEAD;
  gh = criarGithubFalso({ conta: 'eu', agora: () => relogio.agora, head: () => relogio.head });
  io.run = (cmd, args, opts) => gh.run(cmd, args, opts);
});
afterEach(async () => {
  for (const h of handles) await h.abort();
  handles = [];
});

function aparelho(deviceId, dir) {
  n++;
  return montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: dir || path.join(FAROL_HOME, `ap-${n}`), relogio });
}

function reiniciar(e) {
  return aparelho(e.sync.deviceId, path.dirname(e.postagensArquivo));
}

function pendencia(extra = {}) {
  return {
    id: 'd1', key: PR.key, createdAt: AGORA, status: 'pending', verdict: 'approve',
    pr: { repo: 'o/r', number: 1, url: PR.url, author: 'dev', account: 'eu' }, headSha: HEAD, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: CORPO, comments: [] } }, ...extra,
  };
}

function intencaoSemEnvio() {
  return { estado: 'enviando', tentativaId: 't-velha', intencaoEm: AGORA, atualizadoEm: AGORA, deviceId: 'dA', via: 'revisao', evento: 'APPROVE', head: HEAD, payloadHash: '', reviewId: '', commitId: '', motivo: '', leiturasVazias: [] };
}

async function revisaoAdmitida(e) {
  const ctx = { prKey: PR.key, account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: PR, operationKind: 'review', opId: '' };
  const adm = await admit(e, ctx);
  assert.equal(adm.admitted, true);
  handles.push(adm.handle);
  return adm.handle;
}

test('dois cliques em aparelhos diferentes: um único POST', async () => {
  const a = aparelho('dA');
  const b = aparelho('dB');
  a.decisions.pending = [pendencia()];
  b.decisions.pending = [pendencia()];
  await Promise.all([a.decide('d1', 'approve'), b.decide('d1', 'approve')]);
  assert.equal(gh.posts.length, 1);
  await a.decide('d1', 'approve');
  await b.decide('d1', 'approve');
  assert.equal(gh.posts.length, 1, 'o clique repetido depois também não duplica');
});

test('clique durante a revisão automática de outro aparelho: um único POST', async () => {
  const a = aparelho('dA');
  const b = aparelho('dB');
  const handle = await revisaoAdmitida(a);
  b.decisions.pending = [pendencia()];
  const clique = await b.decide('d1', 'approve');
  assert.equal(clique.ok, false);
  assert.equal(clique.motivo, 'posse-alheia');
  assert.equal(gh.posts.length, 0);
  const auto = await a.postReview(PR, { event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(auto.ok, true);
  assert.equal(gh.posts.length, 1);
});

test('reenvio automático com enviando pendente não posta nem gasta tentativa', async () => {
  const a = aparelho('dA');
  await registro.gravarIntencao(a, CTX_REG, intencaoSemEnvio());
  a.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  assert.equal(await a.retryFailedPosts(), 0);
  assert.equal(gh.posts.length, 0);
  assert.equal(a.decisions.pending.length, 1);
  assert.equal(a.decisions.pending[0].postRetry.attempts, 0);
});

test('chat depois de reinício não duplica review já publicado, nem num aparelho sem o arquivo local', async () => {
  const a = aparelho('dA');
  const sub = { key: PR.key, payload: { event: 'APPROVE', body: CORPO, comments: [] } };
  assert.equal((await a.postReviewFromSession(sub, a.createReviewPostCapability([PR.key], 'eu', 'chat', ''))).ok, true);
  const a2 = reiniciar(a);
  const r = await a2.postReviewFromSession(sub, a2.createReviewPostCapability([PR.key], 'eu', 'chat', ''));
  assert.equal(r.ok, true);
  assert.equal(r.deduped, true);
  const b = aparelho('dB');
  const rb = await b.postReviewFromSession(sub, b.createReviewPostCapability([PR.key], 'eu', 'chat', ''));
  assert.equal(rb.ok, true);
  assert.equal(gh.posts.length, 1);
});

test('myReviewStates indisponível não autoriza postagem: revisão automática, reenvio, clique e chat', async () => {
  gh.estado.falharLeitura = true;
  const auto = aparelho('dA');
  const handle = await revisaoAdmitida(auto);
  const rAuto = await auto.postReview(PR, { event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(rAuto.motivo, 'estado-desconhecido');
  const reenvio = aparelho('dB');
  reenvio.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  await reenvio.retryFailedPosts();
  const clique = aparelho('dC');
  clique.decisions.pending = [pendencia()];
  const rClique = await clique.decide('d1', 'approve');
  assert.equal(rClique.ok, false);
  const chat = aparelho('dD');
  const rChat = await chat.postReviewFromSession({ key: PR.key, payload: { event: 'APPROVE', body: CORPO, comments: [] } }, chat.createReviewPostCapability([PR.key], 'eu', 'chat', ''));
  assert.equal(rChat.ok, false);
  assert.equal(gh.posts.length, 0);
});

test('um aparelho só, coordenação ligada: o clique posta uma vez e resolve a pendência', async () => {
  const a = aparelho('dA');
  a.decisions.pending = [pendencia()];
  assert.equal((await a.decide('d1', 'approve')).ok, true);
  assert.equal(a.decisions.pending.length, 0);
  assert.equal(gh.posts.length, 1);
});
