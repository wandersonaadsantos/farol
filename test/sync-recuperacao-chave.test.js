// As três situações de recuperação de CT-ENV. Recuperar a CONTA do Firebase e recuperar as
// CHAVES de dados são coisas diferentes: a redefinição por e-mail devolve a conta e não
// abre o chaveiro, que continua embrulhado pela senha antiga.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-recuperacao-'));
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
const SENHA = 'senha-velha';
const SENHA_NOVA = 'senha-nova';
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
beforeEach(() => {
  fake.setTree(null);
  fake.requests.length = 0;
  cache.apagarCache();
  identity.setPassword(EMAIL, SENHA);
});

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg() {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local',
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
  return e;
}

function keyring() {
  const t = fake.tree();
  const no = t && t.users && t.users.u1 ? t.users.u1.keyring : null;
  return no || null;
}

test('troca de senha com cache no mesmo rev: o aparelho reembrulha, sem pedir a senha antiga', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const kcvAntes = keyring().kcv.g1;
  const salAntes = keyring().slots.pw.kdf.salt;

  identity.setPassword(EMAIL, SENHA_NOVA);
  const r = await e.syncUnlock({ password: SENHA_NOVA });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(keyring().rev, 2, 'reembrulhou');
  assert.notEqual(keyring().slots.pw.kdf.salt, salAntes, 'sal novo');
  assert.equal(keyring().kcv.g1, kcvAntes, 'a MESMA chave continua valendo: o histórico não vira ilegível');
  assert.equal(syncMod.statusForUi(e).chave, 'pronta');
});

test('troca de senha sem cache nenhum: o chaveiro não abre e nada é regravado', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const revAntes = keyring().rev;

  cache.apagarCache();
  e.sync.material = null;
  identity.setPassword(EMAIL, SENHA_NOVA);
  const r = await e.syncUnlock({ password: SENHA_NOVA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'senha-nao-abre');
  assert.equal(keyring().rev, revAntes, 'nada foi regravado com a senha que não abre');
});

test('cache que não confere com o banco não reembrulha: chave alheia nunca vira a do conjunto', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const revAntes = keyring().rev;
  const kcvAntes = keyring().kcv.g1;

  // cache com material de OUTRO conjunto: o kcv do banco não bate com ele
  const local = cache.lerCache();
  const kek = await import('../lib/sync/kek.js');
  const outro = kek.novoMaterial();
  cache.gravarCache({ ...local, id: outro.id, enc: outro.enc });
  e.sync.material = null;
  identity.setPassword(EMAIL, SENHA_NOVA);

  const r = await e.syncUnlock({ password: SENHA_NOVA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'senha-nao-abre');
  assert.equal(keyring().rev, revAntes, 'nada foi regravado');
  assert.equal(keyring().kcv.g1, kcvAntes, 'a chave do conjunto continua a mesma');
});

test('credencial do Firebase inválida NÃO apaga o cache: é ele que salva a recuperação', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.ok(cache.lerCache());
  e.sync.lastError = { code: 'credencial_invalida' };
  e.sync.status = 'erro';
  syncMod.stopSync(e);
  assert.ok(cache.lerCache(), 'desligar e cair em credencial inválida não apagam a chave local');
});

test('sair deste aparelho apaga o cache, e só ele', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.ok(cache.lerCache());
  e.syncLogout();
  assert.equal(cache.lerCache(), null);
});

test('sem chave recuperável: estado perdida, e a época nova nasce com chave diferente', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const kcvAntigo = keyring().kcv.g1;

  fake.setTree(null);
  cache.apagarCache();
  e.sync.material = null;
  assert.equal((await e.syncUnlock({ password: SENHA })).code, 'chave-perdida');
  assert.equal(syncMod.statusForUi(e).chave, 'perdida');

  const nova = await e.syncGerarChaveNova({ password: SENHA });
  assert.equal(nova.ok, true, nova.motivo);
  assert.equal(syncMod.statusForUi(e).chave, 'pronta');
  assert.notEqual(keyring().kcv.g1, kcvAntigo, 'a época nova tem chave nova');
  assert.ok(keyring().epochSince > 0);
});

test('gerar chave nova exige o estado perdida: com a chave pronta, recusa', async () => {
  const e = await motorLogado();
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  const r = await e.syncGerarChaveNova({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'chave-disponivel');
  assert.equal(keyring().rev, 1, 'nada foi regravado');
});
