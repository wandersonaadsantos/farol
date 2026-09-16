// Fiação da capacidade e do catálogo no relógio (C3h). Sem a capacidade publicada, o
// admin não enxerga aparelho apto e a distribuição nunca atribui nada; sem o catálogo, o
// item distribuído não tem nome em outro aparelho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3h-relogio-'));
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
const andamento = (await import('../lib/engine/sync-andamento.js')).default;
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const cachePolitica = (await import('../lib/sync/cache-politica.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag } = await import('../lib/sync/tags.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
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

async function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }], parallelReviews: 3 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.queue = [{ key: 'dono/repo#5', url: 'https://github.com/dono/repo/pull/5', title: 'Titulo', author: 'alguem', repo: 'dono/repo', number: 5 }];
  return e;
}

function arvore() {
  const t = fake.tree();
  return (t && t.users && t.users.u1) || {};
}

test('um giro do relógio publica a capacidade e o catálogo da fila', async () => {
  const e = await motor();
  await andamento.ciclo(e, e.config.sync);
  const status = arvore().live.deviceStatus[e.sync.deviceId];
  assert.ok(status && status.enc, 'a capacidade subiu cifrada');
  const tag = prTag(kek.bufferDe(e.sync.material.id), 'dono/repo#5');
  assert.ok(arvore().catalog[tag], 'a linha do PR da fila subiu');
  const linha = await publicacao.lerDoCatalogo(e, e.config.sync, tag);
  assert.equal(linha.title, 'Titulo');
});

test('sem outro aparelho pronto, o giro não publica nada', async () => {
  const e = await motor();
  e.sync.devices = {};
  await andamento.ciclo(e, e.config.sync);
  assert.equal(arvore().live, undefined);
  assert.equal(arvore().catalog, undefined);
});

test('a capacidade leva a política efetiva: pausa e teto publicados pelo admin', async () => {
  const e = await motor();
  assert.deepEqual([publicacao.capacidadeDe(e, e.config.sync).paralelismo, publicacao.capacidadeDe(e, e.config.sync).pausado], [3, false]);
  cachePolitica.gravarPolitica({ uid: e.sync.uid, dev: e.sync.deviceId, generation: 1, versao: 1, politica: { pausado: true, tetoParalelismo: 1 } });
  e.sync.autoridade = { fresca: true };
  const cap = publicacao.capacidadeDe(e, e.config.sync);
  assert.equal(cap.pausado, true);
  assert.equal(cap.paralelismo, 1);
});

test('o item distribuído também ganha nome no catálogo', async () => {
  const e = await motor();
  e.queue = [];
  e.headlessDistribuindo = new Map([['dono/repo#8', { pr: { key: 'dono/repo#8', title: 'Outro', repo: 'dono/repo', number: 8 }, desde: 1 }]]);
  await andamento.ciclo(e, e.config.sync);
  const tag = prTag(kek.bufferDe(e.sync.material.id), 'dono/repo#8');
  assert.ok(arvore().catalog[tag]);
});
