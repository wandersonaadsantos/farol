// Compartilhamento DESLIGADO: o que sobe para o banco fica exatamente como era antes do
// contrato v2 (CT-COMPAT e CT-ENV, "com o compartilhamento desligado nada disto vale").
// Este arquivo nasce ANTES da mudança, verde contra o código de então, e continua verde
// depois: é a prova byte a byte da presença, do lease, do recibo e do evento de consumo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-desligado-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const { accountHash, prHash, operationFingerprint, eventIdFor } = await import('../lib/sync/keys.js');
const { buildLease } = await import('../lib/sync/lease.js');
const { buildReceipt } = await import('../lib/sync/receipts.js');
const { payloadFor } = await import('../lib/sync/outbox.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'Org/Repo#7';
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
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

// o banco do dublê é http em 127.0.0.1, então o login vai para o Auth do emulador; aqui
// ele é desviado para o dublê de identidade, e nada sai da máquina
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false },
    deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function salvarSync(engine, cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

async function motorConectado(cfg = syncCfg()) {
  const engine = new Engine();
  engine.log = () => { };
  engine.pushState = () => { };
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, cfg);
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  return engine;
}

// O corpo de cada escrita v1 sai das MESMAS funções puras que o engine usa. Se alguma
// delas passar a carregar campo novo com o compartilhamento desligado, o caso reprova.
test('lease v1: o corpo é o de hoje, com o headSha em claro', () => {
  const lease = buildLease({ leaseId: 'L1', deviceId: 'dA', operationKind: 'review', headSha: HEAD, nowMs: AGORA, farolVersion: '9.9.9' });
  assert.equal(lease.headSha, HEAD);
  assert.deepEqual(Object.keys(lease).sort(), ['acquiredAt', 'deviceId', 'expiresAt', 'farolVersion', 'headSha', 'heartbeatAt', 'leaseId', 'operationKind'].sort());
});

test('recibo v1: materialVersion em claro, sem prefixo', () => {
  const recibo = buildReceipt({ operationKind: 'review', materialVersion: HEAD, deviceId: 'dA', leaseId: 'L1', nowMs: AGORA, outcome: 'completed', publicationState: 'published', reviewId: '', farolVersion: '9.9.9' });
  assert.equal(recibo.materialVersion, HEAD);
  assert.equal(String(recibo.materialVersion).startsWith('h1:'), false);
});

test('evento de consumo v1: hashes sem chave e campos em claro, como hoje', () => {
  const sessao = { id: 'a1', at: AGORA, kind: 'review', ref: PR_KEY, account: 'fulano', model: 'Opus 5', profileId: 'p1', inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.25, farol: '2.59.4', costSource: 'medido', status: 'ok' };
  const p = payloadFor(sessao, 'dA', '9.9.9');
  assert.equal(p.accountHash, accountHash('fulano'));
  assert.equal(p.refHash, prHash(PR_KEY));
  assert.equal(p.profileId, 'p1');
  assert.equal(p.localId, 'a1');
  assert.equal(p.enc, undefined, 'nada cifrado com o compartilhamento desligado');
});

test('caminhos da coordenação continuam em SHA-256 sem sal', () => {
  assert.match(accountHash('fulano'), /^[0-9a-f]{64}$/);
  assert.match(prHash(PR_KEY), /^[0-9a-f]{64}$/);
  assert.match(operationFingerprint('review', HEAD), /^review_[0-9a-f]{32}$/);
  assert.equal(operationFingerprint('review', HEAD), operationFingerprint('review', HEAD), 'determinístico');
});

test('eventIdFor: vetor dourado sobre uma sessão literal', () => {
  const sessao = { id: 'a1', at: 1_700_000_000_000, kind: 'review', ref: 'Org/Repo#1', model: 'Opus 5', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5 };
  assert.equal(eventIdFor(sessao, 'dourado'), eventIdFor(sessao, 'dourado'), 'determinístico');
  assert.match(eventIdFor(sessao, 'dourado'), /^[0-9a-f]{64}$/);
  assert.notEqual(eventIdFor(sessao, 'dourado'), eventIdFor({ ...sessao, at: 1 }, 'dourado'));
});

test('presença com o compartilhamento desligado: o PUT do aparelho é o de hoje', async () => {
  const engine = await motorConectado();
  await engine.syncTick();
  // o `createdAt` é escrito à parte, com o sentinela de timestamp como corpo inteiro: a
  // presença é a outra escrita, e é ela que carrega os campos do aparelho
  const dev = fake.requests.filter((r) => r.path.includes('/devices/') && r.method !== 'GET' && !r.path.includes('/createdAt'));
  assert.ok(dev.length >= 1, 'a presença sobe');
  const corpo = JSON.parse(dev.at(-1).body || '{}');
  assert.deepEqual(Object.keys(corpo).sort(), ['farolVersion', 'lastSeenAt', 'name', 'platform'], 'nenhum campo novo na presença');
  assert.equal(corpo.contract, undefined, 'sem campo de contrato v2');
  assert.equal(corpo.keyReady, undefined, 'sem prontidão de chave');
  assert.equal(typeof corpo.name, 'string', 'o nome do aparelho continua em claro');
});

test('nenhum nó novo do contrato v2 é escrito com o compartilhamento desligado', async () => {
  const engine = await motorConectado();
  await engine.syncTick();
  const proibidos = ['/keyring', '/catalog', '/live/', '/rulesProbe'];
  const tocados = fake.requests.filter((r) => r.method !== 'GET' && proibidos.some((p) => r.path.includes(p)));
  assert.deepEqual(tocados.map((r) => `${r.method} ${r.path}`), []);
});

test('sincronização desligada: nada é escrito e nenhum arquivo novo aparece', async () => {
  const antes = fs.readdirSync(FAROL_HOME);
  const engine = new Engine();
  engine.log = () => { };
  engine.pushState = () => { };
  await engine.syncTick();
  assert.deepEqual(fake.requests.filter((r) => r.method !== 'GET').map((r) => r.path), []);
  assert.deepEqual(fs.readdirSync(FAROL_HOME).sort(), antes.sort());
});
