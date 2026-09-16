// A presença declara o contrato e se a chave está aberta (7.C3).
//
// `keyReady` é uma afirmação sobre AGORA, não uma promessa: ele diz que o material da
// chave está aberto nesta sessão. Anunciar chave pronta por otimismo faria outro aparelho
// publicar conteúdo cifrado contando com um leitor que não consegue abrir nada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3a-presenca-'));
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
const { APP_VERSION } = await import('../lib/paths.js');

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

async function motorLogado(cfg = syncCfg()) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: cfg });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  return e;
}

function meuNo(e) {
  const t = fake.tree();
  const devs = t && t.users && t.users.u1 ? t.users.u1.devices : null;
  return (devs && devs[e.sync.deviceId]) || null;
}

test('com o compartilhamento ligado, a presença declara contrato 2 e chave não pronta', async () => {
  const e = await motorLogado();
  assert.deepEqual(syncMod.presencaDe(e.sync, e.config.sync), {
    name: e.sync.deviceName, platform: process.platform, farolVersion: APP_VERSION,
    lastSeenAt: { '.sv': 'timestamp' }, contract: 2, keyReady: false,
  });
  await syncMod.touchPresence(e);
  assert.equal(meuNo(e).contract, 2);
  assert.equal(meuNo(e).keyReady, false);
});

test('a chave aberta vira keyReady no MESMO ciclo, sem esperar o próximo', async () => {
  const e = await motorLogado();
  await syncMod.touchPresence(e);
  assert.equal(meuNo(e).keyReady, false);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.lastPresenceAt = 0;
  await syncMod.touchPresence(e);
  assert.equal(meuNo(e).keyReady, true);
});

test('cada aparelho descreve só a si: a presença escreve no próprio nó', async () => {
  const e = await motorLogado();
  const arvore = fake.tree() || { users: { u1: {} } };
  arvore.users.u1.devices = { ...(arvore.users.u1.devices || {}), dOutro: { name: 'Celular', contract: 1, keyReady: false, lastSeenAt: 1 } };
  fake.setTree(arvore);
  await syncMod.touchPresence(e);
  const t = fake.tree();
  assert.equal(t.users.u1.devices.dOutro.contract, 1, 'ninguém escreve contrato no nó do outro');
  assert.equal(t.users.u1.devices[e.sync.deviceId].contract, 2);
});
