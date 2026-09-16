// O ato de apagar (7.C2, decisões D-b e D8).
//
// Os casos de recusa afirmam o CÓDIGO, e não só que recusou, porque aqui a ordem É a
// proteção: senha errada precisa ser recusada ANTES de a trava existir, senão cada tentativa
// errada travaria o conjunto inteiro por dez minutos, que é justamente o que uma senha
// errada não pode conseguir fazer.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2b-limpeza-ato-'));
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
const { SYNC_CODES } = await import('../lib/sync/errors.js');

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
    aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

function autoridade() {
  return { fresca: true, agora: 1000, intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS, ultimaMudancaEm: 1000 };
}

function usuario() { return fake.tree().users.u1; }

function semearConteudo() {
  const arvore = fake.tree();
  const u = arvore.users.u1;
  u.usageEvents = { d1: { e1: { at: 1, kind: 'review', costUsd: 1 } } };
  u.catalog = { ['a'.repeat(32)]: { v: 1, u: 1, enc: 'e1.g1.a.b.c' } };
  u.recentReviews = { ['b'.repeat(32)]: { v: 1, t: 1, d: 'd1', dt: 'd1|1', enc: 'e1.g1.a.b.c' } };
  u.panorama = { a_b: { v: 1, su: 'a|1', u: 1, ctag: 'c', enc: 'e1.g1.a.b.c' } };
  u.myPrsMeta = { a: { dev: 'd1', x: 1 } };
  u.pushbacks = { ['c'.repeat(32)]: { v: 1, u: 1, dev: 'd1', enc: 'e1.g1.a.b.c' } };
  u.reviewBodies = { ['b'.repeat(32)]: { 1: { v: 1, enc: 'e1.g1.a.b.c' } } };
  u.live.deviceStatus = { d1: { v: 1, u: 1, enc: 'e1.g1.a.b.c' } };
  u.live.groups = { g1: { v: 1, generation: 1, enc: 'e1.g1.a.b.c', sig: 'x' } };
  u.keyring = u.keyring || { v: 1, rev: 1 };
  u.leases = { acc1: { pr1: { leaseId: 'l1', deviceId: 'd9', operationKind: 'review', expiresAt: 1 } } };
  u.receipts = { acc1: { pr1: { fp1: { outcome: 'ok' } } } };
  u.dailyRounds = { acc1: { pr1: { '2026-09-15': { dayPolicy: 'America/Sao_Paulo' } } } };
  fake.setTree(arvore);
}

async function motorAdmin({ ligarChave = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg() });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  e.sync.autoridade = autoridade();
  if (ligarChave) assert.equal((await e.syncChaveDeLimpeza({ ligada: true })).ok, true);
  semearConteudo();
  return e;
}

test('caminho feliz: o alcançável some, o corte fica e a trava sai', async () => {
  const e = await motorAdmin();
  const r = await e.syncLimpar({ password: SENHA });
  assert.equal(r.ok, true, r.motivo);
  const u = usuario();
  assert.equal(u.usageEvents, undefined);
  assert.equal(u.live.groups, undefined);
  assert.equal(u.catalog, undefined, 'o catálogo é regenerável, e a limpeza o alcança');
  assert.equal(u.recentReviews, undefined);
  assert.equal(u.reviewBodies, undefined);
  assert.equal(u.panorama, undefined);
  assert.equal(u.myPrsMeta, undefined);
  assert.equal(u.pushbacks, undefined);
  assert.equal(u.live.deviceStatus, undefined);
  assert.ok(u.live.control.lastCleanup.at > 0, 'o corte da outbox fica gravado');
  assert.equal(u.live.control.cleanupLock, undefined, 'a trava sai no fim');
});

test('o que a limpeza nunca alcança continua lá depois do caminho feliz', async () => {
  const e = await motorAdmin();
  assert.equal((await e.syncLimpar({ password: SENHA })).ok, true);
  const u = usuario();
  assert.ok(u.keyring, 'keyring');
  assert.ok(u.leases, 'leases');
  assert.ok(u.receipts, 'receipts');
  assert.ok(u.dailyRounds, 'dailyRounds');
  assert.ok(u.live.control.admin, 'live/control');
  assert.ok(u.live.control.cleanup, 'a própria chave de limpeza');
});

test('senha errada não apaga nada E não chega a gravar a trava', async () => {
  const e = await motorAdmin();
  const r = await e.syncLimpar({ password: 'errada' });
  assert.equal(r.ok, false);
  assert.equal(r.code, SYNC_CODES.CREDENCIAL_INVALIDA);
  const u = usuario();
  assert.ok(u.usageEvents, 'nada foi apagado');
  assert.equal(u.live.control.cleanupLock, undefined, 'senha errada não trava o conjunto');
  assert.equal(u.live.control.lastCleanup, undefined);
});

test('chave desligada recusa antes de pedir a senha', async () => {
  const e = await motorAdmin({ ligarChave: false });
  const r = await e.syncLimpar({ password: SENHA });
  assert.equal(r.code, 'limpeza-desligada');
  assert.ok(usuario().usageEvents);
});

test('operação viva recusa e a árvore fica intacta', async () => {
  const e = await motorAdmin();
  const arvore = fake.tree();
  arvore.users.u1.leases.acc1.pr1.expiresAt = Date.now() + 60_000;
  fake.setTree(arvore);
  const r = await e.syncLimpar({ password: SENHA });
  assert.equal(r.code, 'operacao-viva');
  assert.ok(usuario().usageEvents);
  assert.equal(usuario().live.control.cleanupLock, undefined);
});

test('sessão headless rodando aqui também conta como operação viva', async () => {
  const e = await motorAdmin();
  e.running.set('s1', { child: null, cancelled: false });
  const r = await e.syncLimpar({ password: SENHA });
  e.running.clear();
  assert.equal(r.code, 'operacao-viva');
  assert.ok(usuario().usageEvents);
});

test('categoria proibida pedida junto: a proibida fica, a alcançável vai', async () => {
  const e = await motorAdmin();
  const r = await e.syncLimpar({ password: SENHA, categorias: ['usageEvents', 'keyring', 'leases'] });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(r.apagadas, ['usageEvents']);
  const u = usuario();
  assert.equal(u.usageEvents, undefined);
  assert.ok(u.keyring, 'pedir o proibido não o torna apagável');
  assert.ok(u.leases);
});

test('só categorias proibidas: recusa sem travar e sem apagar', async () => {
  const e = await motorAdmin();
  const r = await e.syncLimpar({ password: SENHA, categorias: ['keyring'] });
  assert.equal(r.ok, false);
  assert.equal(usuario().live.control.cleanupLock, undefined);
  assert.ok(usuario().keyring);
});

// D8: sem prova de senha recente o servidor recusa a remoção, e não existe caminho
// alternativo dentro do app.
test('servidor recusando a remoção: nada é publicado e o código manda ao console', async () => {
  const e = await motorAdmin();
  const del = e.sync.client.del.bind(e.sync.client);
  e.sync.client.del = async (caminho, ...resto) => {
    if (caminho.includes('cleanupLock')) return del(caminho, ...resto);
    return { ok: false, code: SYNC_CODES.NAO_AUTORIZADO, motivo: 'senha recente não conferida' };
  };
  const r = await e.syncLimpar({ password: SENHA });
  e.sync.client.del = del;
  assert.equal(r.ok, false);
  assert.equal(r.code, 'limpeza-recusada');
  assert.ok(usuario().usageEvents, 'nada foi apagado');
  assert.equal(usuario().live.control.lastCleanup, undefined, 'e nenhum corte foi publicado');
  assert.equal(usuario().live.control.cleanupLock, undefined, 'a trava saiu mesmo assim');
});

test('falha no meio: o que deu certo some, o corte sai com o que foi, e a trava sai', async () => {
  const e = await motorAdmin();
  const del = e.sync.client.del.bind(e.sync.client);
  e.sync.client.del = async (caminho, ...resto) => {
    if (caminho.endsWith('live/groups')) return { ok: false, code: SYNC_CODES.INDISPONIVEL };
    return del(caminho, ...resto);
  };
  const r = await e.syncLimpar({ password: SENHA });
  e.sync.client.del = del;
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(r.falharam, ['live/groups']);
  const u = usuario();
  assert.equal(u.usageEvents, undefined);
  assert.ok(u.live.groups, 'o que falhou continua lá');
  // o banco devolve lista como objeto de índices, que é o comportamento real do RTDB
  assert.deepEqual(Object.values(u.live.control.lastCleanup.categorias), r.apagadas, 'o corte diz o que realmente saiu');
  assert.equal(u.live.control.cleanupLock, undefined, 'a trava sai mesmo com falha no meio');
});

test('a senha não sobrevive ao ato', async () => {
  const e = await motorAdmin();
  await e.syncLimpar({ password: SENHA });
  assert.equal(JSON.stringify(e.config).includes(SENHA), false);
  assert.equal(JSON.stringify(fake.tree()).includes(SENHA), false);
});
