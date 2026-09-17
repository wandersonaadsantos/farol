// Sinais do admin, modo e volta ao local (7.C5, anexo S3, "Degradação e volta").
//
// Os casos que carregam o contrato: a primeira leitura não prova vida, a prontidão vence
// em três intervalos e o aparelho cai para local, a volta sai em lote com atraso próprio
// e com guarda contra duas voltas ao mesmo tempo, e o primeiro valor fresco devolve o
// modo distribuído na hora.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c5d-sinais-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const sinais = (await import('../lib/engine/sync-sinais.js')).default;
const modo = (await import('../lib/sync/modo-distribuicao.js')).default;
const autoridade = (await import('../lib/sync/autoridade.js')).default;
const reviewMod = (await import('../lib/engine/review.js')).default;

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const I = SYNC.AUTORIDADE_INTERVALO_MS;
let fake;
let identity;

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
});
after(async () => {
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  autoridade.apagarSequenciaVista();
});

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    distribution: { enabled: true }, aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY,
    databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function motorAdmin() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }] });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  e.sync.autoridade = { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: I };
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  e.sync.autoridade = null;
  Object.assign(e, { headlessQueue: [], writeInflight() { }, processHeadless() { } });
  return e;
}

function distribuindoN(e, n, desde) {
  e.headlessDistribuindo = new Map();
  for (let i = 1; i <= n; i++) {
    const pr = { key: `dono/repo#${i}`, headSha: `sha${i}` };
    e.headlessDistribuindo.set(pr.key, { pr, desde: desde + i });
  }
}

// Leva a prontidão a "fresca": a primeira leitura é snapshot, a mudança seguinte vale.
async function prontidaoViva(e, agora) {
  await sinais.publicarSinal(e, e.config.sync, sinais.NO_PRONTIDAO, { agora });
  await sinais.observarSinais(e, { agora });
  await sinais.publicarSinal(e, e.config.sync, sinais.NO_PRONTIDAO, { agora: agora + 1 });
  await sinais.observarSinais(e, { agora: agora + 1 });
}

test('a primeira leitura do batimento é snapshot; a mudança seguinte prova vida', async () => {
  const e = await motorAdmin();
  const T = Date.now() + 1000;
  const r1 = await sinais.cicloDosSinais(e, e.config.sync, { agora: T });
  assert.equal(r1.ok, true);
  assert.equal(e.sync.autoridade.fresca, false, 'valor que já estava lá não prova nada');
  const cedo = await sinais.publicarBatimento(e, e.config.sync, { agora: T + 10 });
  assert.equal(cedo, false, 'no máximo um batimento por intervalo');
  await sinais.cicloDosSinais(e, e.config.sync, { agora: T + I });
  assert.equal(e.sync.autoridade.fresca, true);
  assert.ok(autoridade.lerSequenciaVista() >= 2, 'a sequência vista sobrevive a reinício');
});

test('sem a chave da geração vigente, ninguém publica batimento', async () => {
  const e = await motorAdmin();
  const adminChave = (await import('../lib/sync/admin-chave.js')).default;
  adminChave.apagarChaveDeAdmin();
  assert.equal(await sinais.publicarBatimento(e, e.config.sync, { agora: Date.now() + I }), false);
  const t = fake.tree();
  assert.equal(t.users.u1.live.control.beat, undefined);
});

test('prontidão copiada para o caminho do batimento não vale como batimento', async () => {
  const e = await motorAdmin();
  const T = Date.now() + 1000;
  await sinais.observarSinais(e, { agora: T });
  await sinais.publicarSinal(e, e.config.sync, sinais.NO_PRONTIDAO, { agora: T });
  const ready = fake.tree().users.u1.live.control.ready;
  const r = await e.sync.client.put('/users/u1/live/control/beat', { ...ready, sequencia: ready.sequencia + 50 }, {});
  assert.equal(r.ok, true);
  await sinais.observarSinais(e, { agora: T + 1 });
  assert.equal(e.sync.autoridade.fresca, false, 'assinatura de outro caminho não prova vida');
  assert.equal(e.sync.autoridade.sequenciaVista, 0, 'nem envenena a sequência vista');
});

test('prontidão fresca é modo distribuído; três intervalos sem mudança viram local', async () => {
  const e = await motorAdmin();
  const T = Date.now() + 1000;
  await prontidaoViva(e, T);
  assert.equal(sinais.modoAtual(e, { agora: T + 1 }), 'distribuido');
  assert.equal(sinais.modoAtual(e, { agora: T + 1 + 3 * I }), 'distribuido');
  assert.equal(sinais.modoAtual(e, { agora: T + 2 + 3 * I }), 'local');
});

test('sem sinal observado o modo é local: desconhecido vale como indisponível', () => {
  assert.equal(sinais.modoAtual({ sync: {} }), 'local');
  assert.equal(sinais.modoAtual(null), 'local');
});

test('ao virar local, a volta espera o atraso do aparelho e devolve só o teto por giro', async () => {
  const e = await motorAdmin();
  const T = Date.now() + 1000;
  await prontidaoViva(e, T);
  const r0 = await sinais.cicloDosSinais(e, e.config.sync, { agora: T + 2 });
  assert.equal(r0.modo, 'distribuido');
  distribuindoN(e, SYNC.VOLTA_TETO_POR_GIRO + 2, T);
  const devolvidos = [];
  e.devolverAoLocal = (pr) => { e.headlessDistribuindo.delete(pr.key); devolvidos.push(pr.key); };
  const esperas = [];
  const esperar = async (ms) => { esperas.push(ms); };
  const vencido = T + 3 + 3 * I + I;
  e.sync.sinais.ultimoBatimentoEm = vencido;
  const r1 = await sinais.cicloDosSinais(e, e.config.sync, { agora: vencido, esperar });
  assert.equal(r1.virada, 'para-local');
  const volta = await r1.volta;
  assert.deepEqual(esperas, [modo.jitterMs(e.sync.deviceId, SYNC.VOLTA_JITTER_TETO_MS)]);
  assert.equal(volta.devolvidos.length, SYNC.VOLTA_TETO_POR_GIRO);
  assert.deepEqual(volta.devolvidos, ['dono/repo#1', 'dono/repo#2', 'dono/repo#3', 'dono/repo#4'], 'os mais antigos primeiro');
  assert.equal(volta.restantes, 2);
  const r2 = await sinais.cicloDosSinais(e, e.config.sync, { agora: vencido + 10, esperar });
  assert.equal(r2.virada, null);
  assert.deepEqual((await r2.volta).devolvidos, ['dono/repo#5', 'dono/repo#6']);
  assert.equal(esperas.length, 1, 'o atraso só vale no primeiro lote da virada');
});

test('duas voltas ao mesmo tempo não devolvem em dobro', async () => {
  const e = await motorAdmin();
  await sinais.observarSinais(e, { agora: Date.now() });
  distribuindoN(e, 8, 0);
  e.sync.sinais.voltaPendente = true;
  const devolvidos = [];
  e.devolverAoLocal = (pr) => { devolvidos.push(pr.key); };
  let soltar;
  const trava = new Promise((resolve) => { soltar = resolve; });
  const primeira = sinais.voltarAoLocal(e, { esperar: () => trava });
  const segunda = await sinais.voltarAoLocal(e, { esperar: async () => { } });
  assert.deepEqual(segunda, { ok: false, code: 'volta-em-andamento' });
  soltar();
  await primeira;
  assert.equal(devolvidos.length, SYNC.VOLTA_TETO_POR_GIRO);
});

test('o primeiro valor fresco devolve o modo distribuído, e a volta que esperava desiste', async () => {
  const e = await motorAdmin();
  const T = Date.now() + 1000;
  await sinais.cicloDosSinais(e, e.config.sync, { agora: T });
  assert.equal(e.sync.sinais.modo, 'local');
  distribuindoN(e, 2, T);
  e.devolverAoLocal = () => assert.fail('não devolve com a prontidão de volta');
  e.sync.sinais.voltaPendente = true;
  let soltar;
  const trava = new Promise((resolve) => { soltar = resolve; });
  const volta = sinais.voltarAoLocal(e, { esperar: () => trava });
  await prontidaoViva(e, T + 5);
  const r = await sinais.cicloDosSinais(e, e.config.sync, { agora: T + 7 });
  assert.equal(r.virada, 'para-distribuido');
  soltar();
  assert.deepEqual(await volta, { ok: false, code: 'modo-distribuido' });
  assert.equal(e.headlessDistribuindo.size, 2);
});

test('leitura que falha não muda o estado observado', async () => {
  const e = await motorAdmin();
  const T = Date.now() + 1000;
  await prontidaoViva(e, T);
  const antes = e.sync.sinais.ready;
  const get = e.sync.client.get;
  e.sync.client.get = async () => { throw new Error('rede caiu'); };
  try {
    assert.equal(await sinais.observarSinais(e, { agora: T + 5 }), false);
  } finally {
    e.sync.client.get = get;
  }
  assert.equal(e.sync.sinais.ready, antes);
});

test('a volta usa o ramo local de sempre: o PR entra na fila e sai do mapa', async () => {
  const e = await motorAdmin();
  await sinais.observarSinais(e, { agora: Date.now() });
  distribuindoN(e, 1, 0);
  const r = await sinais.voltarAoLocal(e, { esperar: async () => { } });
  assert.deepEqual(r.devolvidos, ['dono/repo#1']);
  assert.equal(e.headlessDistribuindo.size, 0);
  assert.deepEqual(e.headlessQueue.map((p) => p.key), ['dono/repo#1']);
  assert.equal(typeof reviewMod.devolverAoLocal, 'function');
});
