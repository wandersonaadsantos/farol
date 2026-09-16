// Memoria de pushback entre aparelhos (7.C3): so o confirmado sobe, lapide retira, e
// conflito nao vira concordancia.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3f-pushback-'));
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
const pbEng = await import('../lib/engine/sync-pushback.js');

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
const KEY = 'dono/repo#7';

function comPushback(e, reg) {
  e.pushbacks = { [KEY]: { author: 'fulano', outcome: 'rejected', note: 'discordou do ponto', at: T, source: 'manual', status: 'confirmed', ...reg } };
  e.savePushbacks = () => { e.salvou = (e.salvou || 0) + 1; };
  e.panorama = [{ key: KEY }];
  return e;
}

function raiz() {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1.pushbacks) || {};
}

// outro aparelho, mesma chave do conjunto
function outro(e, pushbacks = {}) {
  return {
    sync: { ...e.sync, deviceId: 'dOutro', pushbacksPublicados: new Map() },
    pushbacks, panorama: [{ key: KEY }], savePushbacks() { this.salvou = (this.salvou || 0) + 1; },
  };
}

test('sem frota nada sobe', async () => {
  const e = comPushback(await motorPronto({ comFrota: false }), {});
  assert.equal((await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T })).code, 'sem-frota');
  assert.deepEqual(raiz(), {});
});

test('sobe cifrado, sem o login do autor nem a chave do PR em claro', async () => {
  const e = comPushback(await motorPronto(), {});
  const r = await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  assert.equal(r.escritas.length, 1);
  const no = raiz()[r.escritas[0]];
  assert.deepEqual(Object.keys(no).sort(), ['dev', 'enc', 'u', 'v']);
  assert.match(r.escritas[0], /^[0-9a-f]{32}$/);
  const cru = JSON.stringify(fake.tree());
  for (const p of ['fulano', 'dono/repo', 'discordou do ponto']) assert.equal(cru.includes(p), false, p);
});

test('suspeita de baixa confiança não sobe', async () => {
  const e = comPushback(await motorPronto(), { source: 'auto', confidence: 'low', status: 'pending' });
  assert.deepEqual((await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T })).escritas, []);
  assert.deepEqual(raiz(), {});
});

test('republicar sem mudança não escreve', async () => {
  const e = comPushback(await motorPronto(), {});
  await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  assert.deepEqual((await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T + 1 })).escritas, []);
});

test('registro retirado vira lápide, e a lápide apaga no outro aparelho', async () => {
  const e = comPushback(await motorPronto(), {});
  await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  const b = outro(e, { [KEY]: { author: 'x', outcome: 'rejected', note: '', at: T - 1000, source: 'auto', status: 'confirmed' } });
  e.pushbacks = {};
  const r = await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T + 10 });
  assert.equal(r.retirados.length, 1);
  assert.equal(raiz()[r.retirados[0]].del, true, 'lápide, não sumiço');
  const ap = pbEng.aplicarPushbacks(b, raiz());
  assert.deepEqual(ap.retirados, [KEY]);
  assert.equal(b.pushbacks[KEY], undefined, 'ninguém ressuscita registro retirado');
});

test('o outro aparelho recebe o registro e não duplica ao reler', async () => {
  const e = comPushback(await motorPronto(), {});
  await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  const b = outro(e);
  const primeira = pbEng.aplicarPushbacks(b, raiz());
  assert.deepEqual(primeira.aplicados, [KEY]);
  assert.equal(b.pushbacks[KEY].outcome, 'rejected');
  assert.equal(b.pushbacks[KEY].remoto, true);
  const segunda = pbEng.aplicarPushbacks(b, raiz());
  assert.deepEqual(segunda.aplicados, [], 'o mesmo registro de novo não é segunda evidência');
  assert.equal(Object.keys(b.pushbacks).length, 1);
});

test('manual local vence automático remoto, e nada muda no estado local', async () => {
  const e = comPushback(await motorPronto(), { source: 'auto', outcome: 'accepted', at: T + 5000 });
  await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  const b = outro(e, { [KEY]: { author: 'y', outcome: 'rejected', note: 'eu olhei', at: T, source: 'manual', status: 'confirmed' } });
  const r = pbEng.aplicarPushbacks(b, raiz());
  assert.deepEqual(r.aplicados, []);
  assert.equal(b.pushbacks[KEY].outcome, 'rejected', 'a decisão manual continua valendo');
});

test('dois manuais que discordam viram conflito, sem mudar o local', async () => {
  const e = comPushback(await motorPronto(), {});
  await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  const b = outro(e, { [KEY]: { author: 'y', outcome: 'accepted', note: 'eu vi outra coisa', at: T + 9000, source: 'manual', status: 'confirmed' } });
  const r = pbEng.aplicarPushbacks(b, raiz());
  assert.deepEqual(r.conflitos, [KEY]);
  assert.deepEqual(r.aplicados, []);
  assert.equal(b.pushbacks[KEY].outcome, 'accepted', 'o local não é sobrescrito em silêncio');
  assert.equal(b.sync.pushbackVisao[KEY].conflito, true, 'a tela tem como contar a divergência');
});

test('o próprio aparelho não se aplica, e registro que não decifra some', async () => {
  const e = comPushback(await motorPronto(), {});
  const r = await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  // o registro local fica mais ANTIGO que o publicado: sem a checagem de aparelho, a
  // própria publicação voltaria como novidade e o aparelho se aplicaria a si mesmo
  e.pushbacks[KEY].at = T - 10000;
  e.pushbacks[KEY].source = 'auto';
  assert.deepEqual(pbEng.aplicarPushbacks(e, raiz()).aplicados, []);
  const b = outro(e);
  const lixo = { [r.escritas[0]]: { ...raiz()[r.escritas[0]], u: 1 } };
  assert.deepEqual(pbEng.aplicarPushbacks(b, lixo).aplicados, [], 'u fora da AAD não decifra');
});

// Marcadores locais de varredura e de retry nunca sincronizam.
test('nada de pushbackScanned nem de falhas sobe', async () => {
  const e = comPushback(await motorPronto(), {});
  e.pushbackScanned = { [KEY]: 'marcador-local' };
  e.pushbackFalhas = { [KEY]: { tentativas: 3 } };
  await pbEng.sincronizarPushbacks(e, e.config.sync, { agora: T });
  const cru = JSON.stringify(fake.tree());
  assert.equal(cru.includes('marcador-local'), false);
  assert.equal(cru.includes('tentativas'), false);
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'sync-pushback.js'), 'utf8');
  // a varredura mira o USO (o comentário do módulo explica por que eles ficam de fora)
  assert.equal(/engine\.pushbackScanned|engine\.pushbackFalhas|savePushbackScanned\(/.test(fonte), false, 'o módulo não toca os marcadores locais');
});

// A memória calibra tom e postura; ela não decide nada.
test('nenhum caminho de decisão importa a memória sincronizada', () => {
  for (const arquivo of ['lib/engine/decision.js', 'lib/engine/review.js', 'lib/engine/skip-review.js']) {
    const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', arquivo), 'utf8');
    assert.equal(fonte.includes('sync-pushback'), false, arquivo);
    assert.equal(fonte.includes('pushback-sync'), false, arquivo);
  }
});
