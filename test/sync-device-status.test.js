// Capacidade do aparelho publicada cifrada (7.C3), com as duas condições da entrega: vale
// publicar (existe outro aparelho pronto) e mudou (o texto claro é outro).
//
// O caso da ESCRITA ÚNICA é o que guarda a segunda condição, e ele não é óbvio: o envelope
// sorteia IV a cada cifragem, então o `enc` sempre difere e comparar o que está no banco
// nunca detectaria "não mudou". Quem detecta é o resumo do CLARO, e é ele que o caso mede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3a-status-'));
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
const syncMod = (await import('../lib/engine/sync.js')).default;
const publicacao = await import('../lib/engine/sync-publicacao.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
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
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: false, deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function motorPronto({ comFrota = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = comFrota
    ? { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } }
    : { dOutro: { contract: 1, keyReady: false, lastSeenAt: Date.now() } };
  fake.requests.length = 0;
  return e;
}

function noPublicado(e) {
  const t = fake.tree();
  const live = t && t.users && t.users.u1 ? t.users.u1.live : null;
  return (live && live.deviceStatus && live.deviceStatus[e.sync.deviceId]) || null;
}

function escritasDeStatus() {
  return fake.requests.filter((r) => String(r.path || r.url || '').includes('deviceStatus'));
}

test('sem outro aparelho pronto, nenhuma escrita sai', async () => {
  const e = await motorPronto({ comFrota: false });
  const r = await publicacao.publicarCapacidade(e, e.config.sync);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'sem-frota');
  assert.deepEqual(escritasDeStatus(), []);
});

test('com outro aparelho pronto, sobe {v, u, enc} cifrado', async () => {
  const e = await motorPronto();
  const r = await publicacao.publicarCapacidade(e, e.config.sync);
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.escreveu, true);
  const no = noPublicado(e);
  assert.deepEqual(Object.keys(no).sort(), ['enc', 'u', 'v']);
  assert.match(no.enc, /^e1\.g1\./);
  assert.ok(no.u > 0);
});

test('o login da conta e o nome da máquina não aparecem em claro no banco', async () => {
  const e = await motorPronto();
  await publicacao.publicarCapacidade(e, e.config.sync);
  const cru = JSON.stringify(fake.tree());
  assert.equal(cru.includes(LOGIN), false, 'login em claro no banco');
  assert.equal(cru.includes(os.hostname()), false, 'hostname em claro no banco');
});

test('a capacidade leva tag de conta, nunca o login', async () => {
  const e = await motorPronto();
  const c = publicacao.capacidadeDe(e, e.config.sync);
  assert.equal(c.contas.length, 1);
  assert.match(c.contas[0], /^[0-9a-f]{32}$/);
  assert.equal(c.contas[0].includes(LOGIN), false);
  assert.equal(c.paralelismo, 2);
  assert.equal(c.keyReady, true);
  assert.equal(/[A-Za-z]:[\/]|\/home\/|\/Users\//.test(JSON.stringify(c)), false, 'nenhum caminho de diretório');
});

// A segunda condição da entrega.
test('publicar duas vezes sem mudança escreve UMA vez', async () => {
  const e = await motorPronto();
  assert.equal((await publicacao.publicarCapacidade(e, e.config.sync)).escreveu, true);
  const segunda = await publicacao.publicarCapacidade(e, e.config.sync);
  assert.equal(segunda.ok, true);
  assert.equal(segunda.escreveu, false, 'o enc muda a cada cifragem, então quem decide é o resumo do claro');
  assert.equal(escritasDeStatus().length, 1);
});

test('mudar o paralelismo faz a segunda escrita sair', async () => {
  const e = await motorPronto();
  await publicacao.publicarCapacidade(e, e.config.sync);
  e.updateSettings({ parallelReviews: 3 });
  const r = await publicacao.publicarCapacidade(e, e.config.sync);
  assert.equal(r.escreveu, true);
  assert.equal(escritasDeStatus().length, 2);
});

test('sem a chave aberta não se publica capacidade nenhuma', async () => {
  const e = await motorPronto();
  e.sync.material = null;
  const r = await publicacao.publicarCapacidade(e, e.config.sync);
  assert.equal(r.code, 'sem-chave');
  assert.deepEqual(escritasDeStatus(), []);
});

// CT-ADM: a capacidade publica o resumo da admissão, e só a contagem.
test('a capacidade leva o resumo da admissão, sem referência de PR', async () => {
  const e = await motorPronto();
  const admissao = (await import('../lib/engine/admissao.js')).default;
  // o motor do teste não tem doctor nem presença: a reserva aqui é só para o resumo ter
  // o que contar, então os requisitos duros são satisfeitos de propósito
  e.doctorInfo = { claude: '1.0.0' };
  e.sync.lastPresenceAt = Date.now();
  const r = admissao.reservar(e, { tipo: 'review', ref: 'dono/repo#9' });
  assert.equal(r.ok, true, r.motivo);
  const c = publicacao.capacidadeDe(e, e.config.sync);
  assert.equal(c.admissao.total, 1);
  assert.equal(c.admissao.porTipo.review, 1);
  assert.equal(JSON.stringify(c).includes('dono/repo#9'), false, 'a capacidade não diz o que está rodando');
  assert.equal(c.admissao.refs, undefined);
});
