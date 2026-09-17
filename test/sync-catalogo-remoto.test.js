// Catálogo cifrado de PR (7.C3): quem nomeia um PR em qualquer aparelho.
//
// O catálogo é REGENERÁVEL, e é isso que define o que ele pode ser. Perdê-lo custa um nome
// na tela, nunca uma decisão. Por isso existe aqui um caso que varre o fonte e exige que
// nenhum caminho de decisão o importe: no dia em que o gate de postagem ler o catálogo,
// perder uma linha vira decisão errada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3a-catalogo-'));
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
const publicacao = await import('../lib/engine/sync-publicacao.js');

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

async function motorPronto({ comFrota = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = comFrota
    ? { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } }
    : { dOutro: { contract: 1, keyReady: false, lastSeenAt: Date.now() } };
  fake.requests.length = 0;
  return e;
}

function noPublicado(e) {
  const t = fake.tree();
  const live = t && t.users && t.users.u1 ? t.users.u1.live : null;
  return (live && live.deviceStatus && live.deviceStatus[e.sync.deviceId]) || null;
}

function escritasDeStatus() {
  return fake.requests.filter((r) => String(r.path || r.url || '').includes('deviceStatus'));
}


function catalogoNoBanco() {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1.catalog) || null;
}

function escritasDeCatalogo() {
  return fake.requests.filter((r) => String(r.path || r.url || '').includes('catalog'));
}

const PRS = [
  { key: 'dono/repo#12', url: 'https://github.com/dono/repo/pull/12', title: 'Corrige o gate de postagem', author: 'alguem', repo: 'dono/repo', number: 12, isDraft: false },
  { key: 'dono/repo#13', url: 'https://github.com/dono/repo/pull/13', title: 'Ajusta o retry', author: 'outra', repo: 'dono/repo', number: 13, isDraft: true },
];

test('sem outro aparelho pronto, nenhuma linha sobe', async () => {
  const e = await motorPronto({ comFrota: false });
  const r = await publicacao.publicarNoCatalogo(e, e.config.sync, PRS);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'sem-frota');
  assert.deepEqual(escritasDeCatalogo(), []);
});

test('com frota, sobe uma linha por PR, e o titulo nao aparece em claro', async () => {
  const e = await motorPronto();
  const r = await publicacao.publicarNoCatalogo(e, e.config.sync, PRS);
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.escritas.length, 2);
  const cat = catalogoNoBanco();
  assert.equal(Object.keys(cat).length, 2);
  for (const tag of Object.keys(cat)) {
    assert.match(tag, /^[0-9a-f]{32}$/, 'a chave do no e a tag, nunca o dono/repo#numero');
    assert.deepEqual(Object.keys(cat[tag]).sort(), ['enc', 'u', 'v']);
  }
  const cru = JSON.stringify(cat);
  assert.equal(cru.includes('Corrige o gate'), false, 'titulo em claro no banco');
  assert.equal(cru.includes('dono/repo'), false, 'repo em claro no banco');
  assert.equal(cru.includes('alguem'), false, 'autor em claro no banco');
});

test('republicar os mesmos PRs nao escreve de novo', async () => {
  const e = await motorPronto();
  await publicacao.publicarNoCatalogo(e, e.config.sync, PRS);
  const antes = escritasDeCatalogo().length;
  const r = await publicacao.publicarNoCatalogo(e, e.config.sync, PRS);
  assert.deepEqual(r.escritas, []);
  assert.equal(escritasDeCatalogo().length, antes);
});

test('mudar o titulo de um PR escreve SO a linha dele', async () => {
  const e = await motorPronto();
  await publicacao.publicarNoCatalogo(e, e.config.sync, PRS);
  const antes = escritasDeCatalogo().length;
  const r = await publicacao.publicarNoCatalogo(e, e.config.sync, [PRS[0], { ...PRS[1], title: 'Outro titulo' }]);
  assert.equal(r.escritas.length, 1);
  assert.equal(escritasDeCatalogo().length, antes + 1);
});

test('ler devolve a linha decifrada, e a segunda leitura nao faz GET', async () => {
  const e = await motorPronto();
  const { escritas } = await publicacao.publicarNoCatalogo(e, e.config.sync, PRS);
  const tag = escritas[0];
  const linha = await publicacao.lerDoCatalogo(e, e.config.sync, tag);
  assert.equal(linha.title, 'Corrige o gate de postagem');
  assert.equal(linha.number, 12);
  const antes = escritasDeCatalogo().length;
  const denovo = await publicacao.lerDoCatalogo(e, e.config.sync, tag);
  assert.deepEqual(denovo, linha);
  assert.equal(escritasDeCatalogo().length, antes, 'a segunda leitura sai do LRU');
});

test('linha que nao decifra vira null, e nao derruba as outras', async () => {
  const e = await motorPronto();
  const { escritas } = await publicacao.publicarNoCatalogo(e, e.config.sync, PRS);
  const arvore = fake.tree();
  arvore.users.u1.catalog[escritas[0]] = { v: 1, u: 1, enc: 'e1.g1.AAAA.BBBB.CCCC' };
  fake.setTree(arvore);
  assert.equal(await publicacao.lerDoCatalogo(e, e.config.sync, escritas[0]), null);
  const outra = await publicacao.lerDoCatalogo(e, e.config.sync, escritas[1]);
  assert.equal(outra.number, 13);
});

test('PR sem chave nao vira linha', async () => {
  const e = await motorPronto();
  const r = await publicacao.publicarNoCatalogo(e, e.config.sync, [{ title: 'sem key' }]);
  assert.deepEqual(r.escritas, []);
  assert.equal(catalogoNoBanco(), null);
});

// O catalogo e regeneravel: no dia em que um caminho de decisao ler dele, perder uma linha
// vira decisao errada, e nao so um nome faltando na tela.
test('nenhum caminho de decisao importa o catalogo', () => {
  for (const arquivo of ['lib/engine/decision.js', 'lib/engine/review.js', 'lib/engine/skip-review.js']) {
    const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', arquivo), 'utf8');
    assert.equal(fonte.includes('catalogo'), false, arquivo);
    assert.equal(fonte.includes('sync-publicacao'), false, arquivo);
  }
});
