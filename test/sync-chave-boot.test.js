// A chave do conjunto reabre sozinha depois de reiniciar (medido em 18/09/2026).
//
// O cache local (~/.farol/sync-key.json) existia para o boot reabrir a chave sem senha, e
// ninguém o lia no boot: a cada reinício, inclusive o do auto-update, a chave voltava a
// "bloqueada" e o compartilhamento cifrado parava até alguém digitar a senha de novo. Agora
// a conexão reabre pelo cache, e só quando ele é deste destino e o kcv confere com o
// chaveiro do banco; cache que não confere não abre nada e não é apagado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-chave-boot-'));
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


test('reiniciar depois do desbloqueio: a chave volta pronta sem senha', async () => {
  const antes = await motorLogado();
  assert.equal((await antes.syncUnlock({ password: SENHA })).ok, true);
  assert.equal(syncMod.statusForUi(antes).chave, 'pronta');
  antes.stopSync && antes.stopSync();
  const depois = await motor();
  assert.equal(syncMod.statusForUi(depois).chave, 'pronta', 'o reinício não pode trancar a chave que o cache prova');
  assert.equal(depois.sync.cur, antes.sync.cur);
});

test('cache que não confere com o chaveiro não abre, e não é apagado', async () => {
  const antes = await motorLogado();
  assert.equal((await antes.syncUnlock({ password: SENHA })).ok, true);
  const lido = cache.lerCache();
  const g = Object.keys(lido.enc)[0];
  const outro = Buffer.alloc(32, 7).toString('base64url');
  cache.gravarCache({ ...lido, enc: { ...lido.enc, [g]: outro } });
  const depois = await motor();
  assert.equal(syncMod.statusForUi(depois).chave, 'bloqueada');
  assert.equal(cache.lerCache().enc[g], outro, 'a senha continua sendo o caminho, e o cache fica para a recuperação');
});

test('cache de outro banco não abre a chave deste', async () => {
  const antes = await motorLogado();
  assert.equal((await antes.syncUnlock({ password: SENHA })).ok, true);
  const lido = cache.lerCache();
  cache.gravarCache({ ...lido, destino: 'u1|https://outro-banco.firebaseio.com' });
  const depois = await motor();
  assert.equal(syncMod.statusForUi(depois).chave, 'bloqueada');
});

test('sem cache, segue bloqueada como antes', async () => {
  const antes = await motorLogado();
  assert.equal((await antes.syncUnlock({ password: SENHA })).ok, true);
  cache.apagarCache();
  const depois = await motor();
  assert.equal(syncMod.statusForUi(depois).chave, 'bloqueada');
});
