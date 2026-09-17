// Desbloqueio (CT-ENV): aparelho que já estava logado antes da feature tem refresh token e
// não tem senha. Com o compartilhamento ligado ele fica 'bloqueado neste aparelho' e opera
// no modo legado até a pessoa digitar a senha uma vez.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-unlock-'));
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
const cache = await import('../lib/sync/cache-chave.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
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
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; cache.apagarCache(); });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function motor(cfg = syncCfg()) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: cfg });
  if (e.sync.iniciando) await e.sync.iniciando;
  return e;
}

async function motorLogado(cfg = syncCfg()) {
  const e = await motor(cfg);
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  return e;
}

function keyring() {
  const t = fake.tree();
  const no = t && t.users && t.users.u1 ? t.users.u1.keyring : null;
  return no || null;
}

test('compartilhamento desligado: a chave aparece como desligada e a rota não toca rede', async () => {
  const e = await motor(syncCfg({ shared: { enabled: false } }));
  assert.equal(syncMod.statusForUi(e).chave, 'desligada');
  fake.requests.length = 0;
  const r = await e.syncUnlock({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'compartilhamento-desligado');
  assert.deepEqual(fake.requests, []);
});

test('logado sem chave: fica bloqueado, e o desbloqueio com a senha certa cria o chaveiro', async () => {
  const e = await motorLogado();
  cache.apagarCache();
  e.sync.material = null;
  assert.equal(syncMod.statusForUi(e).chave, 'bloqueada');
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.equal(syncMod.statusForUi(e).chave, 'pronta');
  assert.ok(keyring(), 'o chaveiro foi criado');
  assert.ok(cache.lerCache(), 'o cache local foi gravado');
});

test('senha errada não grava nada: sem chaveiro, sem cache e sem estado pronto', async () => {
  const e = await motorLogado();
  cache.apagarCache();
  e.sync.material = null;
  const r = await e.syncUnlock({ password: 'errada' });
  assert.equal(r.ok, false);
  assert.equal(keyring(), null, 'nenhum chaveiro chegou ao banco');
  assert.equal(cache.lerCache(), null);
  assert.notEqual(syncMod.statusForUi(e).chave, 'pronta');
});

test('a senha não sobrevive em lugar nenhum: nem no config, nem no snapshot, nem no cache', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const varrer = (v) => JSON.stringify(v || {}).includes(SENHA);
  assert.equal(varrer(e.config), false);
  assert.equal(varrer(syncMod.statusForUi(e)), false);
  assert.equal(fs.readFileSync(cache.caminhoDoCache(), 'utf8').includes(SENHA), false);
});

test('chaveiro apagado depois de visto: estado perdida, e o desbloqueio não recria', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  fake.setTree(null);
  cache.apagarCache();
  e.sync.material = null;
  const r = await e.syncUnlock({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'chave-perdida');
  assert.equal(syncMod.statusForUi(e).chave, 'perdida');
  assert.equal(keyring(), null, 'nada foi recriado');
});
