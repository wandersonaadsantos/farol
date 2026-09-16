// Tornar ESTE aparelho admin (7.C2): a senha real do Firebase vem ANTES de qualquer
// gravação. Senha errada não troca admin, e a geração só anda para cima, uma de cada vez.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-admin-'));
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
const ak = await import('../lib/sync/admin-chave.js');

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
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; ak.apagarChaveDeAdmin(); });

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

function adminNoBanco() {
  const t = fake.tree();
  const c = t && t.users && t.users.u1 && t.users.u1.live ? t.users.u1.live.control : null;
  return (c && c.admin) || null;
}

test('senha certa: grava o admin na geração 1 e guarda a privada só aqui', async () => {
  const e = await motorLogado();
  const r = await e.syncTornarAdmin({ password: SENHA });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.generation, 1);
  const no = adminNoBanco();
  assert.equal(no.deviceId, e.sync.deviceId);
  assert.equal(no.generation, 1);
  assert.equal(no.publicKey.length, 43);
  assert.ok(no.setAt > 0);
  const local = ak.lerChaveDeAdmin();
  assert.equal(local.generation, 1);
  assert.ok(local.jwk.d, 'a privada fica no aparelho');
  assert.equal(JSON.stringify(no).includes(local.jwk.d), false, 'a privada NUNCA sobe');
});

test('senha errada não troca admin: nada no banco, nada no disco', async () => {
  const e = await motorLogado();
  const r = await e.syncTornarAdmin({ password: 'errada' });
  assert.equal(r.ok, false);
  assert.equal(adminNoBanco(), null, 'nenhuma gravação chegou ao banco');
  assert.equal(ak.lerChaveDeAdmin(), null, 'nenhuma chave foi guardada');
});

test('já existe admin na geração 2: a nova gravação vai com 3', async () => {
  const e = await motorLogado();
  const arvore = fake.tree() || { users: { u1: {} } };
  arvore.users.u1.live = { control: { admin: { deviceId: 'dOutro', generation: 2, publicKey: 'x'.repeat(43), setAt: 1 } } };
  fake.setTree(arvore);
  const r = await e.syncTornarAdmin({ password: SENHA });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.generation, 3);
  assert.equal(adminNoBanco().generation, 3);
  assert.equal(adminNoBanco().deviceId, e.sync.deviceId);
});

test('a senha não sobrevive: nem no config, nem no arquivo da chave', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  assert.equal(JSON.stringify(e.config).includes(SENHA), false);
  assert.equal(fs.readFileSync(ak.caminhoDaChaveDeAdmin(), 'utf8').includes(SENHA), false);
});

test('compartilhamento desligado: a rota recusa sem tocar rede', async () => {
  const e = await motorLogado(syncCfg({ shared: { enabled: false } }));
  fake.requests.length = 0;
  const r = await e.syncTornarAdmin({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'compartilhamento-desligado');
  assert.deepEqual(fake.requests, []);
});
