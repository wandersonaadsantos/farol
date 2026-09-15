// Co-assinatura com a coordenação ligada (7.C0b), em dois "aparelhos" da mesma conta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-coassinatura-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso, recusa422 } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const skip = await import('../lib/engine/skip-review.js');
const { aprovouNoMesmoSha } = await import('../lib/engine/coassinatura-coordenada.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const HEAD_NOVO = 'b8722a34da5fadb9fda260565f166c977eb5d992';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
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

function aparelho(deviceId) {
  n++;
  const e = montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: path.join(FAROL_HOME, `ap-${n}`), relogio });
  e.config.coAssinarReview = true;
  e.skipComentado[PR.key] = { head: HEAD, quem: ['ana'] };
  return e;
}

function anaAprovou(commitId = HEAD) {
  gh.adicionarReview({ user: 'ana', state: 'APPROVED', commit_id: commitId });
}

function ctxRevisao() {
  return { prKey: PR.key, account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: PR, operationKind: 'review', opId: '' };
}

test('aprovouNoMesmoSha: só APPROVED da pessoa no mesmo commit', () => {
  assert.equal(aprovouNoMesmoSha([{ quem: 'Ana', state: 'APPROVED', commit: HEAD }], 'ana', HEAD), true);
  assert.equal(aprovouNoMesmoSha([{ quem: 'ana', state: 'APPROVED', commit: '' }], 'ana', HEAD), false);
  assert.equal(aprovouNoMesmoSha([{ quem: 'ana', state: 'APPROVED', commit: HEAD }], 'ana', ''), false);
  assert.equal(aprovouNoMesmoSha([{ quem: 'zoe', state: 'APPROVED', commit: HEAD }], 'ana', HEAD), false);
  assert.equal(aprovouNoMesmoSha(null, 'ana', HEAD), false);
});

test('duas co-assinaturas concorrentes em dois aparelhos: um único POST, ancorado', async () => {
  anaAprovou();
  const a = aparelho('dA');
  const b = aparelho('dB');
  const r = await Promise.all([skip.coAssinar(a, PR, 'ana', HEAD), skip.coAssinar(b, PR, 'ana', HEAD)]);
  assert.equal(gh.posts.length, 1);
  assert.equal(r.filter(Boolean).length, 1);
  assert.equal(gh.posts[0].payload.commit_id, HEAD);
  const perdedor = r[0] ? b : a;
  assert.equal(await skip.coAssinar(perdedor, PR, 'ana', HEAD), false);
  assert.equal(perdedor.skipComentado[PR.key].coAssinado, true, 'o dedup grava a marca de concluída');
  assert.equal(gh.posts.length, 1);
});

test('co-assinatura concorrendo com revisão normal que segura o PR: um único POST', async () => {
  anaAprovou();
  const a = aparelho('dA');
  const b = aparelho('dB');
  const adm = await admit(a, ctxRevisao());
  assert.equal(adm.admitted, true);
  handles.push(adm.handle);
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  const auto = await a.postReview(PR, { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.', comments: [], commit_id: HEAD }, { via: 'revisao', handle: adm.handle });
  assert.equal(auto.ok, true);
  assert.equal(gh.posts.length, 1);
});

test('co-assinatura que sai primeiro: a revisão do outro aparelho não é admitida', async () => {
  anaAprovou();
  const a = aparelho('dA');
  const b = aparelho('dB');
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), true);
  const adm = await admit(a, ctxRevisao());
  assert.equal(adm.admitted, false);
  assert.equal(adm.reason, 'recibo');
  assert.equal(gh.posts.length, 1);
});

test('HEAD mudando entre a conferência e o POST: não aprova o commit novo e avisa', async () => {
  anaAprovou();
  const b = aparelho('dB');
  relogio.head = HEAD_NOVO;
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(gh.posts.length, 0);
  assert.ok(b.toasts.some((t) => /commit novo/.test(t.text)));
  assert.ok(b.logs.some((l) => /não vale para o commit novo/.test(l)));
});

test('aprovação sem commit_id, em outro commit, ou head vazio: nada é postado', async () => {
  const b = aparelho('dB');
  anaAprovou('');
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  anaAprovou('c'.repeat(40));
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(await skip.coAssinar(b, PR, 'ana', ''), false);
  assert.equal(gh.posts.length, 0);
});

test('seguirForaDeCena com head vazio e coordenação ligada: aprovação sem sha não vira co-assinatura', async () => {
  anaAprovou('');
  const b = aparelho('dB');
  assert.equal(await skip.seguirForaDeCena(b, { ...PR, labels: [] }, { head: '', quem: ['ana'] }, ''), true);
  assert.equal(gh.posts.length, 0);
});

test('422 na co-assinatura: o recuo sem âncora não é tentado', async () => {
  anaAprovou();
  const b = aparelho('dB');
  gh.estado.aoPostar = () => recusa422();
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(gh.posts.length, 1);
  assert.equal(gh.posts[0].payload.commit_id, HEAD);
});

test('myReviewStates indisponível: a co-assinatura não posta', async () => {
  anaAprovou();
  const b = aparelho('dB');
  gh.estado.falharLeitura = true;
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), false);
  assert.equal(gh.posts.length, 0);
});

test('co-assinatura não é revisão: não abre sessão nem registra sessão ativa', async () => {
  anaAprovou();
  const b = aparelho('dB');
  b.runClaudeStream = async () => { throw new Error('co-assinatura não pode abrir sessão'); };
  assert.equal(await skip.coAssinar(b, PR, 'ana', HEAD), true);
  assert.equal(b.activeReviews.size, 0);
});
