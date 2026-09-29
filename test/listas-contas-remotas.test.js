// Controle do celular (28/09/2026), parte 2: o admin lê a fila e o Panorama de uma conta
// que ELE NÃO TEM (lacuna 5 da spec).
//
// Dois motores reais no mesmo banco falso e com a mesma chave do conjunto: o "celular"
// monitora a conta dele e publica; o "computador" monitora outra conta e lê. Antes desta
// entrega o computador só lia o escopo das contas configuradas nele, e a conta do celular
// não aparecia nunca.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-listas-contas-remotas-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const listas = (await import('../lib/engine/sync-listas.js')).default;
const escopos = (await import('../lib/engine/sync-escopo.js')).default;
const andamento = (await import('../lib/engine/sync-andamento.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { acctTag } = await import('../lib/sync/tags.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const CONTA_CEL = 'conta-do-celular';
const CONTA_PC = 'conta-do-computador';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const T = Date.now();
let fake;
let identity;
const MOTORES = [];

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
afterEach(() => { for (const e of MOTORES.splice(0)) syncMod.stopSync(e); });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(nome) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: false, deviceName: nome, apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local',
  };
}

async function aparelho(nome, deviceId, conta, owner) {
  const e = new Engine();
  MOTORES.push(e);
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(nome), accounts: [{ user: conta, owners: [owner] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.deviceId = deviceId;
  e.sync.deviceName = nome;
  e.accountForPr = () => conta;
  return e;
}

async function par() {
  const cel = await aparelho('Celular', 'dCel', CONTA_CEL, 'acme');
  const pc = await aparelho('Computador', 'dPc', CONTA_PC, 'outra-org');
  cel.sync.devices = { dPc: { contract: 2, keyReady: true, lastSeenAt: Date.now(), name: 'Computador' } };
  pc.sync.devices = { dCel: { contract: 2, keyReady: true, lastSeenAt: Date.now(), name: 'Celular' } };
  return { cel, pc };
}

const PAN = [
  { key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'Pedido a mim', author: 'ana', repo: 'acme/app', number: 1, updatedAt: 'x', mine: true },
  { key: 'acme/app#2', url: 'https://github.com/acme/app/pull/2', title: 'De outra pessoa', author: 'bia', repo: 'acme/app', number: 2, updatedAt: 'y', mine: false },
];

function escoposDaConta(proj, conta) {
  return proj.escopos.filter((x) => x.account === conta);
}

test('o computador lê o Panorama de uma conta que só o celular tem, com o nome da conta e a fila', async () => {
  const { cel, pc } = await par();
  const filaDe = (pr) => (pr.key === 'acme/app#1' ? { estado: 'estacionado', motivo: 'esgotado', desde: T } : { estado: 'esperando' });
  assert.equal((await escopos.publicarEscopo(cel, cel.config.sync, { tipo: 'panorama', conta: CONTA_CEL, prs: PAN, filaDe, agora: T })).ok, true);
  await listas.lerListasRemotas(pc, pc.config.sync, { agora: T + 10 });
  const [pano] = escoposDaConta(pc.syncListasRemotas(), CONTA_CEL);
  assert.ok(pano, 'a conta do celular aparece no computador, que não a tem');
  assert.equal(pano.tipo, 'panorama');
  assert.equal(pano.contaDaqui, false);
  assert.equal(pano.dev, 'dCel');
  assert.equal(pano.aparelho, 'Celular');
  assert.equal(pano.acctTag, acctTag(kek.bufferDe(pc.sync.material.id), CONTA_CEL));
  const porKey = Object.fromEntries(pano.linhas.map((l) => [l.key, l]));
  assert.deepEqual(porKey['acme/app#1'].fila, { estado: 'estacionado', motivo: 'esgotado', desde: T, ate: 0 });
  assert.equal(porKey['acme/app#2'].fila, undefined, 'PR que não foi pedido ao celular não tem fila');
  assert.equal(porKey['acme/app#1'].account, CONTA_CEL);
  // a conta daqui continua lida pelo login, e sem publicador ela diz isso em vez de sumir
  const daqui = escoposDaConta(pc.syncListasRemotas(), CONTA_PC);
  assert.deepEqual(daqui.map((x) => x.estado).sort(), ['sem-publicador', 'sem-publicador']);
});

test('conta remota sem linha com nome aparece pela tag curta, e Meus PRs só no tipo publicado', async () => {
  const { cel, pc } = await par();
  const tag = acctTag(kek.bufferDe(cel.sync.material.id), CONTA_CEL);
  // o meta sem linha nenhuma: alguém publica a conta, mas ainda não subiu linha
  const t = fake.tree() || {};
  t.users = t.users || {};
  t.users.u1 = { ...(t.users.u1 || {}), panoramaMeta: { [tag]: { dev: 'dCel', x: T + 60_000 } }, live: { rev: { panorama: { [tag]: T } } } };
  fake.setTree(t);
  await listas.lerListasRemotas(pc, pc.config.sync, { agora: T + 10 });
  const remotos = pc.syncListasRemotas().escopos.filter((x) => !x.contaDaqui);
  assert.equal(remotos.length, 1, 'só o Panorama: Meus PRs dessa conta não tem meta');
  assert.equal(remotos[0].account, tag.slice(0, 8));
  assert.equal(remotos[0].estado, 'ok');
});

test('a leitura remota continua incremental e mantém a visão quando falha', async () => {
  const { cel, pc } = await par();
  await escopos.publicarEscopo(cel, cel.config.sync, { tipo: 'panorama', conta: CONTA_CEL, prs: PAN, agora: T });
  await listas.lerListasRemotas(pc, pc.config.sync, { agora: T + 10 });
  const real = pc.sync.client;
  pc.sync.client = { ...real, get: async (p, o) => (o && o.consulta ? { ok: false, code: 'indisponivel' } : real.get(p, o)) };
  await escopos.publicarEscopo(cel, cel.config.sync, { tipo: 'panorama', conta: CONTA_CEL, prs: [PAN[0], { ...PAN[1], title: 'Mudou' }], agora: T + 20 });
  await listas.lerListasRemotas(pc, pc.config.sync, { agora: T + 30 });
  pc.sync.client = real;
  const [pano] = escoposDaConta(pc.syncListasRemotas(), CONTA_CEL);
  assert.equal(pano.estado, 'falhou');
  assert.equal(pano.linhas.length, 2, 'falha não vira lista vazia');
  fake.requests.length = 0;
  await listas.lerListasRemotas(pc, pc.config.sync, { agora: T + 40 });
  const leitura = fake.requests.find((r) => r.method === 'GET' && r.path === '/users/u1/panorama.json' && r.query.orderBy);
  assert.ok(leitura && !/\|0000000000000"$/.test(leitura.query.startAt), 'relê a partir do maior u, não do zero');
  const [depois] = escoposDaConta(pc.syncListasRemotas(), CONTA_CEL);
  assert.equal(depois.linhas.find((l) => l.key === 'acme/app#2').title, 'Mudou');
});

test('o relógio do celular publica a fila real do engine na linha do Panorama', async () => {
  const { cel, pc } = await par();
  cel.panorama = PAN.map((p) => ({ ...p }));
  cel.ownersJaLidos.add('acme');
  cel.autoReviewParked.add('acme/app#1');
  cel.parkedMotivos = { 'acme/app#1': { at: new Date(T).toISOString(), tipo: 'cancelado', motivo: 'cancelado por você' } };
  cel.seen.add('acme/app#1');
  await andamento.ciclo(cel, cel.config.sync, { agora: Date.now() });
  await listas.lerListasRemotas(pc, pc.config.sync, { agora: Date.now() });
  const [pano] = escoposDaConta(pc.syncListasRemotas(), CONTA_CEL);
  const linha = pano.linhas.find((l) => l.key === 'acme/app#1');
  assert.equal(linha.fila.estado, 'estacionado');
  assert.equal(linha.fila.motivo, 'cancelado');
  const cru = JSON.stringify(fake.tree());
  for (const proibido of ['cancelado por você', 'estacionado', CONTA_CEL]) assert.equal(cru.includes(proibido), false, `${proibido} em claro no banco`);
});

test('título de muitos bytes que passaria do teto encurta, e a linha chega em vez de sumir', async () => {
  const { cel, pc } = await par();
  const repo = `${'o'.repeat(39)}/${'r'.repeat(100)}`;
  const pr = { key: `${repo}#999999`, url: `https://github.com/${repo}/pull/999999`, title: '\u{1F600}'.repeat(200), author: 'a'.repeat(39), repo, number: 999999, updatedAt: 'x', mine: true };
  const r = await escopos.publicarEscopo(cel, cel.config.sync, { tipo: 'panorama', conta: CONTA_CEL, prs: [pr], filaDe: () => ({ estado: 'sem-automatica', motivo: 'silenciada', desde: T }), agora: T });
  assert.equal(r.escritas.length, 1, 'a linha foi escrita');
  await listas.lerListasRemotas(pc, pc.config.sync, { agora: T + 10 });
  const [pano] = escoposDaConta(pc.syncListasRemotas(), CONTA_CEL);
  const linha = pano.linhas[0];
  assert.ok(linha.title.length < pr.title.length, 'o título encurtou');
  assert.equal(linha.fila.estado, 'sem-automatica', 'o que importa para o controle continua');
});
