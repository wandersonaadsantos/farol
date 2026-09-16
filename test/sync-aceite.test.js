// Fiação do aceite no relógio (C2): a política e o grupo publicados pelo admin chegam ao
// aparelho sem clique, e só com consentimento local e autoridade fresca.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2c-aceite-'));
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
const aceite = (await import('../lib/engine/sync-aceite.js')).default;
const politicas = (await import('../lib/engine/sync-politicas.js')).default;
const grupos = (await import('../lib/engine/sync-grupo.js')).default;
const grupoMod = (await import('../lib/sync/grupo.js')).default;
const cachePolitica = (await import('../lib/sync/cache-politica.js')).default;
const admissao = (await import('../lib/engine/admissao.js')).default;

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
  try { fs.rmSync(cachePolitica.caminhoDoCache(), { force: true }); } catch { /* sem cache anterior */ }
});

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

function fresca() {
  return { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: I };
}

async function motorAdmin() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }], parallelReviews: 3 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  e.sync.autoridade = fresca();
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  return e;
}

test('a política publicada para este aparelho chega à admissão sem clique', async () => {
  const e = await motorAdmin();
  const pub = await politicas.syncPublicarPolitica(e, e.config.sync, { deviceId: e.sync.deviceId, politica: { pausado: true, tetoParalelismo: 2 } });
  assert.equal(pub.ok, true, pub.code);
  assert.equal(admissao.politicaDoAparelho(e).pausado, false, 'antes do giro, nada aceito');
  const r = await aceite.cicloDoAceite(e, e.config.sync);
  assert.equal(r.politica.ok, true, r.politica.code);
  assert.equal(admissao.politicaDoAparelho(e).pausado, true);
  const segunda = await aceite.cicloDoAceite(e, e.config.sync);
  assert.equal(segunda.politica.code, 'antiga', 'reentrega não é novidade');
});

test('o grupo publicado é aceito e fica disponível', async () => {
  const e = await motorAdmin();
  const id = grupoMod.novoIdDeGrupo();
  const pub = await grupos.syncPublicarGrupo(e, e.config.sync, { grupo: { id, nome: 'Time', periodo: 'dia', tetoUsd: 10 } });
  assert.equal(pub.ok, true, pub.code);
  const r = await aceite.cicloDoAceite(e, e.config.sync);
  assert.equal(r.grupos[id].ok, true, r.grupos[id].code);
  assert.deepEqual(grupos.grupoAceito(e, id), { id, nome: 'Time', periodo: 'dia', tetoUsd: 10 });
});

test('sem consentimento local, nem lê', async () => {
  const e = await motorAdmin();
  await politicas.syncPublicarPolitica(e, e.config.sync, { deviceId: e.sync.deviceId, politica: { pausado: true } });
  fake.requests.length = 0;
  const r = await aceite.cicloDoAceite(e, { ...e.config.sync, aceitarAdmin: false });
  assert.equal(r.code, 'sem-aceite');
  assert.equal(fake.requests.length, 0);
  assert.equal(cachePolitica.lerPolitica(), null);
});

test('sem autoridade fresca, nem lê', async () => {
  const e = await motorAdmin();
  await politicas.syncPublicarPolitica(e, e.config.sync, { deviceId: e.sync.deviceId, politica: { pausado: true } });
  e.sync.autoridade = { ...fresca(), fresca: false };
  fake.requests.length = 0;
  assert.equal((await aceite.cicloDoAceite(e, e.config.sync)).code, 'sem-aceite');
  assert.equal(fake.requests.length, 0);
});

test('política de OUTRO aparelho não é aplicada aqui', async () => {
  const e = await motorAdmin();
  await politicas.syncPublicarPolitica(e, e.config.sync, { deviceId: 'dOutro', politica: { pausado: true } });
  const r = await aceite.cicloDoAceite(e, e.config.sync);
  assert.equal(r.politica, null);
  assert.equal(admissao.politicaDoAparelho(e).pausado, false);
});

test('o relógio do andamento roda o aceite', async () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/sync-andamento.js', import.meta.url), 'utf8');
  assert.match(fonte, /aceite\.cicloDoAceite\(engine, cfg\)/);
});
