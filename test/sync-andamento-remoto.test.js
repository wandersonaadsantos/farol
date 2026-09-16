// Andamento ao vivo entre aparelhos (7.C3): os três ritmos da publicação e a leitura.
//
// O tempo é passado explicitamente (`agora`), porque os ritmos são de 10 s, 60 s e 150 s
// e um teste que dormisse de verdade levaria minutos.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3b-andamento-'));
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
const andamentoEng = await import('../lib/engine/sync-andamento.js');
const andamento = (await import('../lib/sync/andamento.js')).default;

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

function sessaoViva(e, id = 'a-1', extra = {}) {
  e.activeReviews.set(id, { id, mode: 'auto', checkpoint: 'review', startedAt: T, model: 'Opus 5', pr: { key: 'dono/repo#12', title: 'Titulo secreto' }, ...extra });
  e.activity.set(id, [{ t: T + 1000, k: 'text', text: 'prosa secreta do modelo', s: 'leitura' }]);
}

function operacoes() {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1.live && t.users.u1.live.operations) || {};
}

function escritasDeOp() {
  return fake.requests.filter((r) => String(r.path || r.url || '').includes('operations'));
}

test('sem frota nada sobe', async () => {
  const e = await motorPronto({ comFrota: false });
  sessaoViva(e);
  const r = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 2000 });
  assert.equal(r.code, 'sem-frota');
  assert.deepEqual(escritasDeOp(), []);
});

test('com frota, a sessão viva sobe com v, dev, t0, x e enc, sem prosa', async () => {
  const e = await motorPronto();
  sessaoViva(e);
  const r = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 2000 });
  assert.equal(r.escritas.length, 1);
  const no = operacoes()[r.escritas[0]];
  assert.deepEqual(Object.keys(no).sort(), ['dev', 'enc', 't0', 'v', 'x']);
  assert.equal(no.dev, e.sync.deviceId);
  assert.equal(no.x, T + 2000 + andamento.TTL_MS);
  const cru = JSON.stringify(fake.tree());
  for (const p of ['prosa secreta', 'Titulo secreto', 'dono/repo']) assert.equal(cru.includes(p), false, p);
});

test('dentro de 10 s, mudança não escreve; depois de 10 s, escreve', async () => {
  const e = await motorPronto();
  sessaoViva(e);
  await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 2000 });
  e.activity.get('a-1').push({ t: T + 3000, k: 'text', s: 'raciocinio' });
  const cedo = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 5000 });
  assert.deepEqual(cedo.escritas, [], 'coalescido');
  const depois = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 12001 });
  assert.equal(depois.escritas.length, 1);
});

test('sem mudança, renova a cada 60 s e não antes', async () => {
  const e = await motorPronto();
  sessaoViva(e);
  e.activity.set('a-1', []);
  await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T });
  assert.deepEqual((await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 30000 })).escritas, []);
  const renovou = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 60000 });
  assert.equal(renovou.escritas.length, 1, 'uma análise quieta não pode sumir da tela do outro');
  assert.equal(Object.values(operacoes())[0].x, T + 60000 + andamento.TTL_MS);
});

test('dev e t0 não mudam na vida da operação', async () => {
  const e = await motorPronto();
  sessaoViva(e);
  const { escritas: [op] } = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 1000 });
  const antes = operacoes()[op];
  // três renovações: com só duas, um t0 que mudasse DEPOIS da escrita nunca apareceria
  await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 70000 });
  await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 140000 });
  assert.equal(operacoes()[op].x, T + 140000 + andamento.TTL_MS, 'a terceira escrita aconteceu');
  assert.equal(operacoes()[op].t0, antes.t0);
  assert.equal(operacoes()[op].dev, antes.dev);
});

test('a sessão que termina é apagada no ciclo seguinte', async () => {
  const e = await motorPronto();
  sessaoViva(e);
  const { escritas: [op] } = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 1000 });
  e.activeReviews.delete('a-1');
  const r = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 2000 });
  assert.deepEqual(r.apagadas, [op]);
  assert.equal(operacoes()[op], undefined);
});

test('leitura: decifra os outros, ignora a si, marca vencida e falha fechada', async () => {
  const e = await motorPronto();
  sessaoViva(e);
  const { escritas: [op] } = await andamentoEng.sincronizarAndamentos(e, e.config.sync, { agora: T + 1000 });
  const arvore = operacoes();
  assert.deepEqual(andamentoEng.lerAndamentos(e, arvore, { agora: T + 2000 }), [], 'o próprio aparelho não aparece');
  const deOutro = { ...arvore[op], dev: 'dOutro' };
  assert.deepEqual(andamentoEng.lerAndamentos(e, { [op]: deOutro }, { agora: T + 2000 }), [], 'dev fora da AAD não decifra');
  // um nó legítimo de outro aparelho: mesma chave, dev dOutro
  const outro = { ...e.sync, deviceId: 'dOutro' };
  const e2 = { ...e, sync: outro, activeReviews: e.activeReviews, activity: e.activity, accountForPr: () => '' };
  outro.andamento = new Map();
  outro.devices = { [e.sync.deviceId]: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  const { escritas: [op2] } = await andamentoEng.sincronizarAndamentos(e2, e.config.sync, { agora: T + 1000 });
  const lida = andamentoEng.lerAndamentos(e, operacoes(), { agora: T + 2000 });
  assert.equal(lida.length, 1);
  assert.equal(lida[0].opId, op2);
  assert.equal(lida[0].situacao, 'viva');
  assert.equal(lida[0].etapa, 'leitura');
  const vencida = andamentoEng.lerAndamentos(e, operacoes(), { agora: T + 1000 + andamento.TTL_MS + 1 });
  assert.equal(vencida[0].situacao, 'interrompida');
  const lixo = { ...operacoes(), [op2]: { ...operacoes()[op2], enc: 'e1.g1.AAAA.BBBB.CCCC' } };
  assert.deepEqual(andamentoEng.lerAndamentos(e, lixo, { agora: T + 2000 }), []);
});

test('aplicar a leitura emite sync-live e não chama pushState', async () => {
  const e = await motorPronto();
  let empurrou = 0;
  const eventos = [];
  e.pushState = () => { empurrou++; };
  e.on('sync-live', (p) => eventos.push(p));
  andamentoEng.aplicarLeitura(e, {}, { agora: T });
  assert.equal(empurrou, 0);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0], { operacoes: [] });
});

test('vencida há mais de um TTL é apagada por qualquer aparelho; recém-vencida fica', async () => {
  const e = await motorPronto();
  const arvore = fake.tree() || { users: { u1: {} } };
  arvore.users.u1.live = { operations: { aa: { v: 1, dev: 'dOutro', t0: T, x: T, enc: 'e1.g1.a.b.c' }, bb: { v: 1, dev: 'dOutro', t0: T, x: T + 100000, enc: 'e1.g1.a.b.c' } } };
  fake.setTree(arvore);
  const feitos = await andamentoEng.apagarVencidos(e, operacoes(), { agora: T + andamento.TTL_MS + 1 });
  assert.deepEqual(feitos, ['aa']);
  assert.ok(operacoes().bb, 'a recém-vencida continua para a tela mostrar "interrompida"');
});

function agendadorFalso() {
  const a = { ligados: 0, desligados: 0, fn: null };
  a.setInterval = (fn) => { a.ligados++; a.fn = fn; return { id: a.ligados }; };
  a.clearInterval = () => { a.desligados++; };
  return a;
}

test('o relógio liga uma vez só e desliga limpando a visão', async () => {
  const e = await motorPronto();
  const ag = agendadorFalso();
  assert.equal(andamentoEng.ligarRelogio(e, (x) => x.config.sync, ag), true);
  assert.equal(andamentoEng.ligarRelogio(e, (x) => x.config.sync, ag), false, 'nunca dois relógios');
  assert.equal(ag.ligados, 1);
  e.sync.andamentoRemoto = [{ opId: 'x' }];
  assert.equal(andamentoEng.desligarRelogio(e.sync), true);
  assert.equal(ag.desligados, 1);
  assert.deepEqual(e.sync.andamentoRemoto, [], 'desligado não mostra andamento velho');
});

test('parar a sincronização para o relógio', async () => {
  const e = await motorPronto();
  andamentoEng.ligarRelogio(e, (x) => x.config.sync, agendadorFalso());
  syncMod.stopSync(e);
  assert.equal(e.sync.relogioAndamento, null);
});

test('o tick conectado liga o relógio só com o compartilhamento ligado', async () => {
  const e = await motorPronto();
  e.sync.lastPresenceAt = Date.now();
  await syncMod.syncTick(e);
  assert.ok(e.sync.relogioAndamento, 'ligado');
  andamentoEng.desligarRelogio(e.sync);
  e.updateSettings({ sync: { ...e.config.sync, shared: { enabled: false } } });
  if (e.sync.iniciando) await e.sync.iniciando;
  e.sync.lastPresenceAt = Date.now();
  await syncMod.syncTick(e);
  assert.ok(!e.sync.relogioAndamento, 'desligado não tem relógio');
});

test('um ciclo publica, lê e avisa a tela por sync-live', async () => {
  const e = await motorPronto();
  sessaoViva(e);
  const eventos = [];
  e.on('sync-live', (p) => eventos.push(p));
  const r = await andamentoEng.ciclo(e, e.config.sync, { agora: T + 1000 });
  assert.equal(r.escritas.length, 1);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0].operacoes, [], 'o próprio aparelho não aparece para si');
});

test('a rota SSE repassa sync-live', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
  assert.match(fonte, /engine\.on\('sync-live', p => broadcast\('sync-live', p\)\)/);
});
