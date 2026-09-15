// Registro de postagem (CT-POST, passos 3 e 5): cópia local atômica e cópia remota no
// recibo da revisão daquele head. O que vale quando as duas divergem é estadoEfetivo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-registro-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const registro = await import('../lib/engine/registro-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const CTX = { account: 'eu', prKey: 'o/r#1', head: HEAD, evento: 'APPROVE' };
let fake;
let n = 0;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); });

function aparelho(token = TOKEN) {
  n++;
  const rt = { status: 'conectado', uid: 'u1', deviceId: `d${n}`, relogio: AGORA, client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: token }) }) };
  rt.agora = () => rt.relogio;
  return { sync: rt, logs: [], log(nv, m) { this.logs.push(`${nv} ${m}`); }, postagensArquivo: path.join(FAROL_HOME, `postagens-${n}.json`) };
}

function intencao(extra = {}) {
  return { estado: 'enviando', tentativaId: 't1', intencaoEm: AGORA, atualizadoEm: AGORA, deviceId: 'd1', via: 'clique', evento: 'APPROVE', head: HEAD, payloadHash: 'h1', reviewId: '', commitId: '', motivo: '', leiturasVazias: [], ...extra };
}

function remotoNoBanco() {
  const fp = operationFingerprint('review', HEAD);
  const t = fake.tree();
  const no = t && t.users.u1.receipts[accountHash('eu')][prHash('o/r#1')][fp];
  return no && no.postagens && no.postagens.APPROVE;
}

test('estadoEfetivo: mesma tentativa, o desfecho vence o enviando', () => {
  const env = intencao();
  const conf = intencao({ estado: 'confirmada', atualizadoEm: AGORA - 5 });
  assert.equal(registro.estadoEfetivo(env, conf).estado, 'confirmada');
  assert.equal(registro.estadoEfetivo(conf, env).estado, 'confirmada');
});

test('estadoEfetivo: tentativas diferentes, vence a intenção mais nova', () => {
  const velha = intencao({ estado: 'nao_enviada', tentativaId: 't0', intencaoEm: AGORA - 1000 });
  const nova = intencao({ tentativaId: 't2', intencaoEm: AGORA });
  assert.equal(registro.estadoEfetivo(velha, nova).tentativaId, 't2');
  assert.equal(registro.estadoEfetivo(nova, velha).tentativaId, 't2');
});

test('estadoEfetivo: registro remoto ilegível só restringe (CT-FIO)', () => {
  const localLivre = intencao({ estado: 'nao_enviada', intencaoEm: AGORA + 999 });
  const ilegivel = { estado: 'enviando', tentativaId: '', intencaoEm: Number.NaN, invalido: true };
  assert.equal(registro.estadoEfetivo(localLivre, ilegivel).estado, 'enviando');
  assert.equal(registro.estadoEfetivo(null, null), null);
});

test('gravarIntencao: grava as duas cópias, e o remoto não leva conta nem PR em texto', async () => {
  const e = aparelho();
  assert.deepEqual(await registro.gravarIntencao(e, CTX, intencao()), { ok: true });
  const remoto = remotoNoBanco();
  assert.equal(remoto.estado, 'enviando');
  assert.equal(remoto.tentativaId, 't1');
  assert.equal(JSON.stringify(remoto).includes('o/r#1'), false);
  assert.equal(JSON.stringify(remoto).includes('"eu"'), false);
  assert.equal(remoto.leiturasVazias, undefined, 'as leituras da reconciliação são só locais');
  const lido = await registro.lerRegistro(e, CTX);
  assert.equal(lido.ok, true);
  assert.equal(lido.local.estado, 'enviando');
  assert.equal(lido.efetivo.estado, 'enviando');
});

test('gravarIntencao com o banco recusando: não autoriza o envio e a cópia local vira nao_enviada', async () => {
  const e = aparelho('tok-errado');
  const r = await registro.gravarIntencao(e, CTX, intencao());
  assert.deepEqual(r, { ok: false, motivo: 'registro-indisponivel' });
  const local = JSON.parse(fs.readFileSync(e.postagensArquivo, 'utf8'));
  assert.equal(Object.values(local)[0].estado, 'nao_enviada');
});

test('gravarIntencao com outra tentativa em enviando no banco: registro-concorrente', async () => {
  const a = aparelho();
  const b = aparelho();
  await registro.gravarIntencao(a, CTX, intencao());
  const r = await registro.gravarIntencao(b, CTX, intencao({ tentativaId: 't9', deviceId: 'd9' }));
  assert.deepEqual(r, { ok: false, motivo: 'registro-concorrente' });
  assert.equal(remotoNoBanco().tentativaId, 't1');
});

test('gravarDesfecho: confirmada nas duas cópias', async () => {
  const e = aparelho();
  await registro.gravarIntencao(e, CTX, intencao());
  const r = await registro.gravarDesfecho(e, CTX, 't1', { estado: 'confirmada', reviewId: '77' });
  assert.equal(r.ok, true);
  assert.equal(remotoNoBanco().estado, 'confirmada');
  assert.equal(remotoNoBanco().reviewId, '77');
  assert.equal((await registro.lerRegistro(e, CTX)).efetivo.estado, 'confirmada');
});

test('gravarDesfecho não sobrescreve no banco o enviando de outra tentativa', async () => {
  const a = aparelho();
  const b = aparelho();
  await registro.gravarIntencao(a, CTX, intencao());
  await registro.gravarDesfecho(b, CTX, 'outra', { estado: 'nao_enviada', motivo: 'x' });
  assert.equal(remotoNoBanco().estado, 'enviando');
  assert.equal(remotoNoBanco().tentativaId, 't1');
});

test('gravarDesfecho com remotoPrimeiro e banco fora: não toca a cópia local', async () => {
  const e = aparelho();
  await registro.gravarIntencao(e, CTX, intencao());
  e.sync.client = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'tok-errado' }) });
  const r = await registro.gravarDesfecho(e, CTX, 't1', { estado: 'nao_enviada' }, { remotoPrimeiro: true });
  assert.deepEqual(r, { ok: false, local: false, remoto: false });
  assert.equal(registro.listarIncertos(e).length, 1);
});

test('cada aparelho tem o próprio arquivo local; o banco é o que eles dividem', async () => {
  const a = aparelho();
  const b = aparelho();
  await registro.gravarIntencao(a, CTX, intencao());
  assert.equal(registro.listarIncertos(b).length, 0);
  const lidoB = await registro.lerRegistro(b, CTX);
  assert.equal(lidoB.local, null);
  assert.equal(lidoB.efetivo.estado, 'enviando');
  registro.observarRemoto(b, CTX, lidoB.remoto);
  assert.equal(registro.listarIncertos(b).length, 1);
});
