// A arbitragem no funil (CT-POST), exercitada pelo postReview real de dois "aparelhos"
// com o banco e o GitHub em dublê.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-arbitragem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { criarGithubFalso, recusa422 } from './helpers/github-reviews-falso.js';
import { montarAparelho } from './helpers/aparelho-coordenado.js';
import { SYNC } from '../lib/constants.js';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const { adquirirPosseDePostagem } = await import('../lib/sync/posse-postagem.js');
const registro = await import('../lib/engine/registro-postagem.js');
const { lancarSePossePerdida } = await import('../lib/engine/postagem-arbitragem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const HEAD_NOVO = 'b8722a34da5fadb9fda260565f166c977eb5d992';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const APPROVE = { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.', comments: [] };
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

function aparelho(deviceId) {
  n++;
  return montarAparelho({ Engine, createRtdbClient, fake, token: TOKEN, deviceId, dir: path.join(FAROL_HOME, `ap-${n}`), relogio });
}

function ctxRevisao() {
  return { prKey: PR.key, account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: PR, operationKind: 'review', opId: '' };
}

async function revisaoAdmitida(e) {
  const adm = await admit(e, ctxRevisao());
  assert.equal(adm.admitted, true);
  handles.push(adm.handle);
  return adm.handle;
}

test('posse perdida durante a espera na fila por processo: o io.run não é chamado', async () => {
  const a = aparelho('dA');
  const handle = await revisaoAdmitida(a);
  let liberar;
  a.postLanes = new Map([['eu|o/r#1', new Promise((r) => { liberar = r; })]]);
  const promessa = a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'revisao', handle });
  await new Promise((r) => setTimeout(r, 30));
  relogio.agora += SYNC.LEASE_TTL_MS + 1;
  liberar();
  const r = await promessa;
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'posse-perdida');
  assert.equal(gh.posts.length, 0);
  assert.equal((await registro.lerRegistro(a, CTX_REG)).efetivo.estado, 'nao_enviada');
});

test('retomada depois de suspensão: posse vencida não posta e nem grava intenção', async () => {
  const a = aparelho('dA');
  const handle = await revisaoAdmitida(a);
  relogio.agora += SYNC.LEASE_TTL_MS + 1;
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'posse-perdida');
  assert.equal(gh.posts.length, 0);
  assert.equal((await registro.lerRegistro(a, CTX_REG)).efetivo, null);
});

test('lancarSePossePerdida: só posse perdida vira perda de coordenação', () => {
  assert.throws(() => lancarSePossePerdida({ ok: false, estado: 'nao_enviada', motivo: 'posse-perdida' }), (err) => err.coordenacao === 'perdido');
  assert.doesNotThrow(() => lancarSePossePerdida({ ok: false, estado: 'enviando', motivo: 'resultado-incerto' }));
  assert.doesNotThrow(() => lancarSePossePerdida({ ok: true, estado: 'confirmada' }));
});

test('sucesso: confirmada com o id do review, e o lease de postagem volta', async () => {
  const a = aparelho('dA');
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'confirmada');
  assert.equal(r.reviewId, '1000');
  assert.equal(gh.posts.length, 1);
  assert.equal((await registro.lerRegistro(a, CTX_REG)).efetivo.estado, 'confirmada');
  const t = fake.tree();
  assert.equal(t.users.u1.leases, undefined, 'posse própria devolvida');
});

test('recusa provada no clique: recusada, e o recuo sem âncora é uma tentativa nova', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = (_p, i) => (i === 1 ? recusa422() : null);
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.ok, true);
  assert.equal(gh.posts.length, 2);
  assert.equal(gh.posts[0].payload.commit_id, HEAD);
  assert.equal(gh.posts[1].payload.commit_id, undefined);
});

test('texto já recusado neste commit não é enviado de novo', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = () => recusa422();
  const primeira = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique', recuoPermitido: false });
  assert.equal(primeira.estado, 'recusada');
  const segunda = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique', recuoPermitido: false });
  assert.equal(segunda.estado, 'recusada');
  assert.equal(segunda.motivo, 'recusada-antes');
  assert.equal(gh.posts.length, 1);
});

test('recuoPermitido false: nenhuma segunda chamada depois do 422', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = () => recusa422();
  const posse = await adquirirPosseDePostagem(a, { prKey: PR.key, account: 'eu', headSha: HEAD });
  handles.push(posse.handle);
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'coassinatura', handle: posse.handle, commitIdObrigatorio: HEAD, recuoPermitido: false });
  assert.equal(r.estado, 'recusada');
  assert.equal(gh.posts.length, 1);
});

test('commitIdObrigatorio com head que andou depois da posse: não posta', async () => {
  const a = aparelho('dA');
  const posse = await adquirirPosseDePostagem(a, { prKey: PR.key, account: 'eu', headSha: HEAD });
  handles.push(posse.handle);
  relogio.head = HEAD_NOVO;
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'coassinatura', handle: posse.handle, commitIdObrigatorio: HEAD, recuoPermitido: false });
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'head-mudou');
  assert.equal(gh.posts.length, 0);
});

test('commitIdObrigatorio e payload sem âncora: não posta', async () => {
  const a = aparelho('dA');
  const posse = await adquirirPosseDePostagem(a, { prKey: PR.key, account: 'eu', headSha: HEAD });
  handles.push(posse.handle);
  const r = await a.postReview(PR, { ...APPROVE }, { via: 'coassinatura', handle: posse.handle, commitIdObrigatorio: HEAD, recuoPermitido: false });
  assert.equal(r.motivo, 'ancora-ausente');
  assert.equal(gh.posts.length, 0);
});

test('falha que não prova recusa (502): fica enviando e a próxima tentativa não posta', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = () => ({ ok: false, code: 1, stdout: '<html>502</html>', stderr: 'gh: Bad Gateway (HTTP 502)' });
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.estado, 'enviando');
  assert.equal(r.attempted, true);
  gh.estado.aoPostar = null;
  const b = aparelho('dB');
  const outra = await b.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(outra.estado, 'enviando');
  assert.equal(outra.motivo, 'resultado-incerto');
  assert.equal(gh.posts.length, 1);
});

// O caso do 502 acima não prova sozinho a exigência do 422: o corpo dele é HTML e já não
// passa na prova de forma. Aqui o corpo É JSON de erro do GitHub, então só o status separa
// recusa provada de falha incerta.
test('recusa só é provada por 422: 403 com corpo JSON de erro continua incerta', async () => {
  const a = aparelho('dA');
  gh.estado.aoPostar = () => ({ ok: false, code: 1, stdout: JSON.stringify({ message: 'Forbidden' }), stderr: 'gh: Forbidden (HTTP 403)' });
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.estado, 'enviando');
  assert.equal(r.motivo, 'resultado-incerto');
  assert.equal((await registro.lerRegistro(a, CTX_REG)).efetivo.estado, 'enviando');
});

test('myReviewStates indisponível: não enviada por estado desconhecido', async () => {
  const a = aparelho('dA');
  gh.estado.falharLeitura = true;
  const r = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(r.estado, 'nao_enviada');
  assert.equal(r.motivo, 'estado-desconhecido');
  assert.equal(gh.posts.length, 0);
});

test('conectado e banco recusando: nenhuma via posta, nem com handle, nem o clique', async () => {
  const a = aparelho('dA');
  const handle = await revisaoAdmitida(a);
  a.sync.client = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'tok-errado' }) });
  const comHandle = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'revisao', handle });
  assert.equal(comHandle.estado, 'nao_enviada');
  const clique = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(clique.ok, false, 'conectado, a arbitragem manda: banco recusando não é banco fora do ar');
  assert.equal(gh.posts.length, 0);
});

// Decisão de 18/09/2026 (v2.62.1, ver docs/REVIEW-GATES.md): até aqui o clique com a conexão
// em erro era recusado com `coordenacao-indisponivel`, e o Farol ficava sem saída nenhuma.
test('fora do ar: o clique posta pelo caminho sem Firebase, e o automático segue esperando', async () => {
  const a = aparelho('dA');
  a.sync.status = 'erro';
  const reenvio = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'reenvio' });
  assert.equal(reenvio.motivo, 'coordenacao-indisponivel');
  assert.equal(gh.posts.length, 0);
  const clique = await a.postReview(PR, { ...APPROVE, commit_id: HEAD }, { via: 'clique' });
  assert.equal(clique.ok, true, JSON.stringify(clique));
  assert.equal(gh.posts.length, 1);
});

test('COMMENT não passa pela arbitragem, mesmo com a coordenação ligada', async () => {
  const a = aparelho('dA');
  const r = await a.postReview(PR, { event: 'COMMENT', body: 'Pergunta sobre o fluxo de retry.', comments: [] }, { via: 'sessao' });
  assert.equal(r.ok, true);
  assert.equal(r.estado, undefined);
  assert.equal(fs.existsSync(a.postagensArquivo), false);
});
