// O relógio dos sinais começa ao CONECTAR (v2.62.2).
//
// Medido no Farol real em 19/09/2026, logo depois de reabrir o app: a chave reabriu em 12 s,
// mas a tela ficou 3 min e meio sem dizer quem é o admin, porque o relógio de 10 s só era
// ligado no `tickConectado`, ou seja, no primeiro ciclo de polling. Quem observa os sinais do
// admin é esse relógio, então o atraso era o do polling, não o da coordenação.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-relogio-conectar-'));
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
  // o relógio acompanha o app MONITORANDO: aqui o polling é simulado pelo timer
  e.timer = setTimeout(() => { }, 60_000);
  if (e.timer.unref) e.timer.unref();
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


test('conectar já liga o relógio dos sinais, sem esperar o ciclo de polling', async () => {
  const e = await motorLogado();
  assert.ok(e.sync.relogioAndamento, 'sem isto a tela espera o primeiro tique para saber do admin');
  assert.equal(syncMod.statusForUi(e).coordination, true);
});

test('sem o app monitorando (sem polling) o relógio não é criado', async () => {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg() });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.ok(!e.sync.relogioAndamento);
});

test('compartilhamento desligado não liga relógio nenhum', async () => {
  const e = await motorLogado(syncCfg({ shared: { enabled: false } }));
  assert.ok(!e.sync.relogioAndamento);
});

test('reconectar não duplica o relógio', async () => {
  const e = await motorLogado();
  const primeiro = e.sync.relogioAndamento;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal(e.sync.relogioAndamento, primeiro, 'ligarRelogio é idempotente por construção');
});
