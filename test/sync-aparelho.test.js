// Gestão de aparelho (7.C2): renomear e aposentar.
//
// APOSENTAR É ATO EXPLÍCITO. A regra parece óbvia e é justamente a que um app tende a
// quebrar sozinho: some a presença por uns dias, alguém acha razoável "limpar a lista", e
// o aparelho de quem estava de férias volta aposentado sem ninguém ter decidido nada. Por
// isso existe aqui um caso que roda ciclos de presença com carimbo velho e exige que nada
// tenha sido marcado.
//
// E aposentar não é revogar: não apaga dado, não tira chave e não encerra sessão. O que
// ele faz é dizer "este não está mais em serviço", e ter volta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2b-aparelho-'));
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
const aparelhos = await import('../lib/engine/sync-aparelho.js');
const syncMod = (await import('../lib/engine/sync.js')).default;

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const OUTRO = 'dOutro';
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

async function motorLogado() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg() });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  await syncMod.touchPresence(e);
  return e;
}

function noDoAparelho(id) {
  const t = fake.tree();
  const devs = t && t.users && t.users.u1 ? t.users.u1.devices : null;
  return (devs && devs[id]) || null;
}

function semearOutro({ lastSeenAt }) {
  const arvore = fake.tree() || { users: { u1: {} } };
  arvore.users.u1.devices = { ...(arvore.users.u1.devices || {}), [OUTRO]: { name: 'Celular', platform: 'android', farolVersion: '2.59.4', lastSeenAt, createdAt: 1 } };
  fake.setTree(arvore);
}

test('renomear outro aparelho grava o nome e não toca em presença nem em criação', async () => {
  const e = await motorLogado();
  semearOutro({ lastSeenAt: Date.now() });
  const antes = noDoAparelho(OUTRO);
  const r = await e.syncAparelho({ deviceId: OUTRO, nome: 'Celular da sala' });
  assert.equal(r.ok, true, r.motivo);
  const depois = noDoAparelho(OUTRO);
  assert.equal(depois.name, 'Celular da sala');
  assert.equal(depois.lastSeenAt, antes.lastSeenAt, 'renomear não finge presença');
  assert.equal(depois.createdAt, antes.createdAt);
});

test('renomear OUTRO aparelho não muda o nome deste', async () => {
  const e = await motorLogado();
  semearOutro({ lastSeenAt: Date.now() });
  await e.syncAparelho({ deviceId: OUTRO, nome: 'Celular da sala' });
  assert.equal(e.config.sync.deviceName, 'Notebook');
  assert.equal(e.sync.deviceName, 'Notebook');
});

test('renomear ESTE aparelho também troca o nome local', async () => {
  const e = await motorLogado();
  const r = await e.syncAparelho({ deviceId: e.sync.deviceId, nome: 'Estação' });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(e.config.sync.deviceName, 'Estação');
  assert.equal(e.sync.deviceName, 'Estação');
});

test('aposentar é explícito, sai dos ativos e continua no histórico', async () => {
  const e = await motorLogado();
  semearOutro({ lastSeenAt: Date.now() });
  const r = await e.syncAparelho({ deviceId: OUTRO, aposentar: true });
  assert.equal(r.ok, true, r.motivo);
  const no = noDoAparelho(OUTRO);
  assert.ok(no.retiredAt > 0);
  assert.equal(no.name, 'Celular', 'o nó continua lá inteiro');
  await syncMod.lerAparelhos(e);
  assert.ok(e.sync.devices[OUTRO], 'o aposentado continua na leitura');
  assert.equal(aparelhos.ativos(e.sync.devices)[OUTRO], undefined, 'mas não conta como ativo');
});

test('desaposentar tem volta: aposentar por engano não é definitivo', async () => {
  const e = await motorLogado();
  semearOutro({ lastSeenAt: Date.now() });
  await e.syncAparelho({ deviceId: OUTRO, aposentar: true });
  await e.syncAparelho({ deviceId: OUTRO, aposentar: false });
  assert.equal(noDoAparelho(OUTRO).retiredAt, 0);
  await syncMod.lerAparelhos(e);
  assert.ok(aparelhos.ativos(e.sync.devices)[OUTRO], 'voltou para os ativos');
});

// O caso que a regra existe para impedir.
test('ausência NÃO aposenta: presença velha atravessa ciclos sem ser carimbada', async () => {
  const e = await motorLogado();
  semearOutro({ lastSeenAt: Date.now() - 30 * 24 * 3600 * 1000 });
  for (let i = 0; i < 3; i++) {
    await syncMod.touchPresence(e);
    await syncMod.lerAparelhos(e);
  }
  assert.equal(noDoAparelho(OUTRO).retiredAt, undefined, 'ninguém decidiu aposentar, então nada foi decidido');
  assert.ok(aparelhos.ativos(e.sync.devices)[OUTRO], 'sumido não é aposentado: são estados diferentes');
});

test('aposentar não apaga dado, não tira chave e não encerra sessão', async () => {
  const e = await motorLogado();
  semearOutro({ lastSeenAt: Date.now() });
  const arvore = fake.tree();
  arvore.users.u1.keyring = { v: 1, rev: 1 };
  arvore.users.u1.live = { control: { admin: { deviceId: OUTRO, generation: 1, publicKey: 'x'.repeat(43), setAt: 1 } } };
  fake.setTree(arvore);
  await e.syncAparelho({ deviceId: OUTRO, aposentar: true });
  const t = fake.tree();
  assert.deepEqual(t.users.u1.keyring, { v: 1, rev: 1 }, 'a chave do conjunto continua lá');
  assert.equal(t.users.u1.live.control.admin.deviceId, OUTRO, 'aposentar não depõe o admin');
  assert.ok(noDoAparelho(OUTRO), 'o nó do aparelho não é removido');
});

test('nome vazio não apaga o nome, e aparelho desconhecido recusa', async () => {
  const e = await motorLogado();
  semearOutro({ lastSeenAt: Date.now() });
  await e.syncAparelho({ deviceId: OUTRO, nome: '   ' });
  assert.equal(noDoAparelho(OUTRO).name, 'Celular');
  const r = await e.syncAparelho({ deviceId: '', nome: 'X' });
  assert.equal(r.ok, false);
});
