// "Precisa de você" em todos os aparelhos (7.C3, D3): publicar, ler, avisar e o visto.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3c-pendencias-'));
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
const pend = await import('../lib/engine/sync-pendencias.js');

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



function pendenciaLocal(e, id = 'd1', extra = {}) {
  e.decisions.pending.push({
    id, createdAt: 1_800_000_000_000, key: 'dono/repo#12', verdict: 'approve',
    pr: { repo: 'dono/repo', number: 12, title: 'Titulo secreto', account: LOGIN },
    reasons: [{ text: 'aguarda sua aprovação', kind: 'gate' }], reportMarkdown: 'RELATORIO INTERNO', ...extra,
  });
}

function no(nome) {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1.live && t.users.u1.live[nome]) || {};
}

// um segundo "aparelho" com a mesma chave, para ler o que o primeiro publicou
function outroAparelho(e) {
  const rt = { ...e.sync, deviceId: 'dOutro', pendenciasPublicadas: new Map(), pendenciasNotificadas: new Set() };
  rt.devices = { [e.sync.deviceId]: { contract: 2, keyReady: true, lastSeenAt: Date.now(), name: 'Notebook' } };
  const eventos = [];
  return { sync: rt, decisions: { pending: [] }, emit: (n, p) => eventos.push([n, p]), eventos };
}

test('sem frota nada sobe', async () => {
  const e = await motorPronto({ comFrota: false });
  pendenciaLocal(e);
  assert.equal((await pend.sincronizarPendencias(e, e.config.sync)).code, 'sem-frota');
  assert.deepEqual(no('pending'), {});
});

test('a pendência sobe cifrada, sem relatório, título nem login', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const r = await pend.sincronizarPendencias(e, e.config.sync);
  assert.equal(r.escritas.length, 1);
  const item = no('pending')[r.escritas[0]];
  assert.deepEqual(Object.keys(item).sort(), ['at', 'dev', 'enc', 'v']);
  assert.equal(item.at, 1_800_000_000_000, 'at é o instante da decisão, e não muda');
  const cru = JSON.stringify(fake.tree());
  for (const p of ['RELATORIO', 'Titulo secreto', 'dono/repo', LOGIN, 'aguarda sua']) assert.equal(cru.includes(p), false, p);
});

test('republicar sem mudança não escreve; a pendência resolvida é apagada', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const { escritas: [id] } = await pend.sincronizarPendencias(e, e.config.sync);
  assert.deepEqual((await pend.sincronizarPendencias(e, e.config.sync)).escritas, []);
  e.decisions.pending.length = 0;
  const r = await pend.sincronizarPendencias(e, e.config.sync);
  assert.deepEqual(r.apagadas, [id]);
  assert.equal(no('pending')[id], undefined);
});

test('o outro aparelho lê, é avisado uma vez, e o próprio não aparece para si', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  await pend.sincronizarPendencias(e, e.config.sync);
  assert.deepEqual(pend.lerPendencias(e, no('pending'), {}), [], 'o próprio não aparece');
  const b = outroAparelho(e);
  const primeira = pend.aplicarPendencias(b, no('pending'), {});
  assert.equal(primeira.lista.length, 1);
  assert.equal(primeira.lista[0].veredito, 'approve');
  assert.equal(primeira.lista[0].aparelho, 'Notebook');
  assert.equal(primeira.lista[0].motivos[0].text, 'aguarda sua aprovação');
  assert.equal(primeira.novas.length, 1);
  assert.equal(pend.aplicarPendencias(b, no('pending'), {}).novas.length, 0, 'avisa uma vez só');
  assert.equal(b.eventos[0][0], 'sync-pending');
});

test('visto em um aparelho cala o aviso no outro (D3)', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const { escritas: [id] } = await pend.sincronizarPendencias(e, e.config.sync);
  const r = await pend.marcarVisto(e, e.config.sync, id, { agora: 5 });
  assert.equal(r.gravado, true);
  assert.deepEqual(no('seen')[id], { at: 5, dev: e.sync.deviceId });
  const b = outroAparelho(e);
  const lido = pend.aplicarPendencias(b, no('pending'), no('seen'));
  assert.equal(lido.novas.length, 0, 'já visto noutro aparelho não avisa');
  assert.equal(lido.lista[0].visto, true);
});

test('o visto é gravado uma vez só: o segundo encontra o nó e não sobrescreve', async () => {
  const e = await motorPronto();
  const id = 'ab12';
  assert.equal((await pend.marcarVisto(e, e.config.sync, id, { agora: 5 })).gravado, true);
  const segundo = await pend.marcarVisto(e, e.config.sync, id, { agora: 9 });
  assert.equal(segundo.ok, true);
  assert.equal(segundo.gravado, false);
  assert.equal(no('seen')[id].at, 5, 'o primeiro visto vale');
  assert.equal((await pend.marcarVisto(e, e.config.sync, '../x')).code, 'forma');
});

test('item que não decifra some, e dev trocado não decifra', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const { escritas: [id] } = await pend.sincronizarPendencias(e, e.config.sync);
  const b = outroAparelho(e);
  const arvore = no('pending');
  assert.deepEqual(pend.lerPendencias(b, { [id]: { ...arvore[id], at: 1 } }, {}), [], 'at fora da AAD');
  assert.deepEqual(pend.lerPendencias(b, { [id]: { ...arvore[id], enc: 'e1.g1.AAAA.BBBB.CCCC' } }, {}), []);
});

test('visto sai quando a pendência some; com a pendência viva, fica', async () => {
  const e = await motorPronto();
  const arvore = fake.tree() || { users: { u1: {} } };
  arvore.users.u1.live = { pending: { aa: { v: 1 } }, seen: { aa: { at: Date.now(), dev: 'x' }, bb: { at: Date.now(), dev: 'x' } } };
  fake.setTree(arvore);
  const feitos = await pend.limparVistos(e, no('pending'), no('seen'));
  assert.deepEqual(feitos, ['bb']);
  assert.ok(no('seen').aa);
});

test('aplicar não chama pushState', async () => {
  const e = await motorPronto();
  let empurrou = 0;
  e.pushState = () => { empurrou++; };
  pend.aplicarPendencias(e, {}, {});
  assert.equal(empurrou, 0);
});

test('o ciclo do relógio publica e lê pendências, e a rota do visto existe', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const eventos = [];
  e.on('sync-pending', (p) => eventos.push(p));
  const andamentoEng = await import('../lib/engine/sync-andamento.js');
  await andamentoEng.ciclo(e, e.config.sync, { agora: Date.now() });
  assert.equal(Object.keys(no('pending')).length, 1);
  assert.equal(eventos.length, 1);
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
  assert.match(fonte, /p === '\/api\/sync\/seen'/);
  assert.match(fonte, /engine\.on\('sync-pending', p => broadcast\('sync-pending', p\)\)/);
});
