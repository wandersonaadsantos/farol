// Presença v2, capacidade e catálogo DESLIGADOS: o Farol se comporta como hoje
// (CT-COMPAT, item 2: com o compartilhamento desligado a presença é byte a byte a de
// hoje). Este arquivo nasce antes da mudança e continua verde depois.
//
// A comparação da presença é por IGUALDADE DE OBJETO, não campo a campo, de propósito:
// campo novo que vaze para o corpo da presença precisa reprovar aqui, e uma asserção que
// só olha os campos conhecidos nunca reprovaria.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3a-desligado-'));
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
const { STATE_DIR, APP_VERSION } = await import('../lib/paths.js');

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
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: false },
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

function escritasDe(trecho) {
  return fake.requests.filter((r) => String(r.path || r.url || '').includes(trecho));
}

test('com o compartilhamento desligado, o corpo da presença é exatamente o de hoje', async () => {
  const e = await motorLogado();
  assert.deepEqual(syncMod.presencaDe(e.sync), {
    name: e.sync.deviceName, platform: process.platform, farolVersion: APP_VERSION,
    lastSeenAt: { '.sv': 'timestamp' },
  }, 'campo novo no corpo da presença precisa reprovar aqui');
});

test('desligado: nenhum ciclo escreve capacidade nem catálogo', async () => {
  const e = await motorLogado();
  await syncMod.touchPresence(e);
  await syncMod.lerAparelhos(e);
  assert.deepEqual(escritasDe('deviceStatus'), []);
  assert.deepEqual(escritasDe('catalog'), []);
});

// O gate precisa existir ANTES de a publicação existir: sozinho, um aparelho não tem para
// quem publicar, e escrever sem leitor é cota gasta e superfície de dado sem dono.
test('ligado e sozinho: também não escreve capacidade nem catálogo', async () => {
  const e = await motorLogado(syncCfg({ shared: { enabled: true } }));
  await syncMod.touchPresence(e);
  await syncMod.lerAparelhos(e);
  assert.deepEqual(escritasDe('deviceStatus'), []);
  assert.deepEqual(escritasDe('catalog'), []);
});

test('nada disso cria arquivo local novo', async () => {
  await motorLogado();
  for (const f of ['sync-catalogo.json', 'sync-capacidade.json', 'sync-frota.json']) {
    assert.equal(fs.existsSync(path.join(STATE_DIR, f)), false, f);
  }
});
