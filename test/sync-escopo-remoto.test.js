// Panorama e Meus PRs entre aparelhos (7.C3): um publicador por conta, so o que mudou,
// tombstone para o que saiu, e Meus PRs chegando somente leitura.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3e-escopo-'));
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
const esc = await import('../lib/engine/sync-escopo.js');

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




const T = 1_800_000_000_000;
const PRS = [
  { key: 'dono/repo#1', title: 'Primeiro secreto', author: 'a', repo: 'dono/repo', number: 1, updatedAt: 'x', mine: true },
  { key: 'dono/repo#2', title: 'Segundo', author: 'b', repo: 'dono/repo', number: 2, updatedAt: 'y' },
];

function raiz(nome) {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1[nome]) || {};
}

function outro(e) {
  return { sync: { ...e.sync, deviceId: 'dOutro', escopos: {} } };
}

test('sem frota nada sobe', async () => {
  const e = await motorPronto({ comFrota: false });
  const r = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T });
  assert.equal(r.code, 'sem-frota');
  assert.deepEqual(raiz('panorama'), {});
});

test('publica uma linha por PR, com su, u e ctag em claro e o resto cifrado', async () => {
  const e = await motorPronto();
  const r = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T });
  assert.equal(r.escritas.length, 2);
  const linhas = Object.entries(raiz('panorama'));
  assert.equal(linhas.length, 2);
  for (const [id, no] of linhas) {
    assert.match(id, /^[0-9a-f]{32}_[0-9a-f]{32}$/);
    assert.deepEqual(Object.keys(no).sort(), ['ctag', 'enc', 'su', 'u', 'v']);
    assert.ok(no.su.startsWith(`${r.scope}|`));
  }
  const cru = JSON.stringify(fake.tree());
  for (const p of ['Primeiro secreto', 'dono/repo', LOGIN]) assert.equal(cru.includes(p), false, p);
  assert.equal(fake.tree().users.u1.live.rev.panorama[r.scope], T);
});

test('republicar sem mudança não escreve; mudar um título escreve só ele', async () => {
  const e = await motorPronto();
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T });
  const r = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T + 1 });
  assert.deepEqual(r.escritas, []);
  const r2 = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: [PRS[0], { ...PRS[1], title: 'Novo' }], agora: T + 2 });
  assert.equal(r2.escritas.length, 1);
});

test('depois de reiniciar, compara com o que está lá em vez de reescrever', async () => {
  const e = await motorPronto();
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T });
  e.sync.escopos = {};
  const r = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T + 5 });
  assert.deepEqual(r.escritas, [], 'os ctag em claro bastam para saber que nada mudou');
});

test('PR que sai vira tombstone, uma vez só, e o leitor fica sabendo', async () => {
  const e = await motorPronto();
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T });
  const r = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: [PRS[0]], agora: T + 10 });
  assert.equal(r.saidas.length, 1);
  const tomb = Object.values(raiz('panorama')).find((n) => n.del === true);
  assert.ok(tomb, 'o nó continua, marcado');
  assert.equal(tomb.enc, undefined, 'tombstone não carrega conteúdo');
  const denovo = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: [PRS[0]], agora: T + 20 });
  assert.deepEqual(denovo.saidas, []);
  const lido = await esc.lerEscopo(outro(e), { tipo: 'panorama', conta: LOGIN });
  assert.equal(lido.linhas.length, 1);
  assert.equal(lido.saidas.length, 1);
});

test('um publicador por conta: outro vivo segura, vencido libera', async () => {
  const e = await motorPronto();
  const r = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T });
  const t = fake.tree();
  t.users.u1.panoramaMeta[r.scope] = { dev: 'dOutro', x: T + 1000 };
  fake.setTree(t);
  const bloqueado = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: [], agora: T + 500 });
  assert.equal(bloqueado.code, 'outro-publicador');
  assert.equal(Object.values(raiz('panorama')).some((n) => n.del), false, 'quem não tem a vez não marca saída');
  const liberado = await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T + 2000 });
  assert.equal(liberado.ok, true);
  assert.equal(raiz('panoramaMeta')[r.scope].dev, e.sync.deviceId);
});

test('leitura: decifra, ordena, lê incremental e falha fechada', async () => {
  const e = await motorPronto();
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: [PRS[0]], agora: T });
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T + 100 });
  const tudo = await esc.lerEscopo(outro(e), { tipo: 'panorama', conta: LOGIN });
  assert.deepEqual(tudo.linhas.map((l) => l.number), [2, 1]);
  assert.equal(tudo.linhas[1].title, 'Primeiro secreto');
  assert.deepEqual(tudo.linhas[1].selos, { mine: true, reviewedByMe: false, reRequested: false });
  const novas = await esc.lerEscopo(outro(e), { tipo: 'panorama', conta: LOGIN, desdeU: T + 100 });
  assert.deepEqual(novas.linhas.map((l) => l.number), [2]);
  const t = fake.tree();
  for (const no of Object.values(t.users.u1.panorama)) no.ctag = 'trocado';
  fake.setTree(t);
  assert.deepEqual((await esc.lerEscopo(outro(e), { tipo: 'panorama', conta: LOGIN })).linhas, [], 'ctag fora da AAD');
});

test('Meus PRs chega somente leitura e com o estado de merge para mostrar', async () => {
  const e = await motorPronto();
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'myPrs', conta: LOGIN, prs: [{ ...PRS[0], mergeable: 'MERGEABLE', headRefOid: 'sha' }], agora: T });
  const [linha] = (await esc.lerEscopo(outro(e), { tipo: 'myPrs', conta: LOGIN })).linhas;
  assert.equal(linha.somenteLeitura, true, 'o botão Merge nunca é habilitado por dado remoto');
  assert.equal(linha.mergeable, 'MERGEABLE');
  assert.equal(linha.headRefOid, undefined);
});

test('tombstone sai só 24 h depois; tipo desconhecido é recusado', async () => {
  const e = await motorPronto();
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: PRS, agora: T });
  await esc.publicarEscopo(e, e.config.sync, { tipo: 'panorama', conta: LOGIN, prs: [], agora: T + 10 });
  assert.deepEqual(await esc.apagarTombstones(e, { tipo: 'panorama', conta: LOGIN, agora: T + 1000 }), []);
  const feitos = await esc.apagarTombstones(e, { tipo: 'panorama', conta: LOGIN, agora: T + 25 * 3600 * 1000 });
  assert.equal(feitos.length, 2);
  assert.equal((await esc.publicarEscopo(e, e.config.sync, { tipo: 'outro', conta: LOGIN, prs: [] })).code, 'forma');
});

test('o ciclo do relógio publica Panorama e Meus PRs por conta', async () => {
  const e = await motorPronto();
  e.panorama = PRS;
  e.myPRs = [PRS[0]];
  e.accountForPr = () => LOGIN;
  const andamentoEng = await import('../lib/engine/sync-andamento.js');
  await andamentoEng.ciclo(e, e.config.sync, { agora: Date.now() });
  assert.equal(Object.keys(raiz('panorama')).length, 2);
  assert.equal(Object.keys(raiz('myPrs')).length, 1);
});
