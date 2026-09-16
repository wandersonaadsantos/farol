// Revogação (7.C2): o corte de sessões, a retirada do consentimento local, e o resumo que
// a tela mostra.
//
// O caso mais importante deste arquivo é o que prova que o resumo NÃO PROMETE o que a
// revogação não faz. Tela que sugere "revoguei, então aquele aparelho não tem mais nada" é
// pior que tela nenhuma: chave que já saiu do banco está na máquina de alguém, e nenhum
// corte de token a traz de volta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2b-revogacao-'));
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
const revogacao = await import('../lib/engine/sync-revogacao.js');
const cachePolitica = (await import('../lib/sync/cache-politica.js')).default;

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
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; cachePolitica.apagarPolitica(); });

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

async function motorLogado(cfg = syncCfg()) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: cfg });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  return e;
}

function corteNoBanco() {
  const t = fake.tree();
  const c = t && t.users && t.users.u1 && t.users.u1.live ? t.users.u1.live.control : null;
  return c ? c.revokedBefore : undefined;
}

test('o corte fica abaixo do auth_time do próprio ato: quem revoga não se corta fora', async () => {
  const e = await motorLogado();
  const antes = Math.floor(Date.now() / 1000);
  const r = await e.syncRevogar({ password: SENHA });
  assert.equal(r.ok, true, r.motivo);
  assert.ok(r.corte < antes, 'o corte precisa ser menor que o auth_time, senão o servidor recusa');
  assert.equal(corteNoBanco(), r.corte);
});

test('o auth_time vem do token quando ele é um JWT, e do relógio quando não é', () => {
  const corpo = Buffer.from(JSON.stringify({ auth_time: 1700000000 }), 'utf8').toString('base64url');
  assert.equal(revogacao.authTimeDe(`a.${corpo}.c`, 1_800_000_000_000), 1700000000);
  assert.equal(revogacao.authTimeDe('id-nao-e-jwt', 1_800_000_000_000), 1_800_000_000 - 5, 'sem JWT, aproxima por baixo');
  assert.equal(revogacao.authTimeDe('a.lixo.c', 1_800_000_000_000), 1_800_000_000 - 5, 'corpo ilegível não lança');
});

test('o corte só cresce: um corte igual ou anterior ao vigente é recusado', async () => {
  const e = await motorLogado();
  const arvore = fake.tree() || { users: { u1: {} } };
  arvore.users.u1.live = { control: { revokedBefore: Math.floor(Date.now() / 1000) + 3600 } };
  fake.setTree(arvore);
  const r = await e.syncRevogar({ password: SENHA });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'sem-efeito');
  assert.ok(corteNoBanco() > Math.floor(Date.now() / 1000), 'o vigente continua lá');
});

test('senha errada não grava corte nenhum', async () => {
  const e = await motorLogado();
  const r = await e.syncRevogar({ password: 'errada' });
  assert.equal(r.ok, false);
  assert.equal(r.code, SYNC_CODES.CREDENCIAL_INVALIDA);
  assert.equal(corteNoBanco(), undefined);
});

test('retirar o consentimento volta à config local e descarta a política em cache', async () => {
  const e = await motorLogado();
  cachePolitica.gravarPolitica({ uid: 'u1', dev: e.sync.deviceId, generation: 1, versao: 3, politica: { pausado: true } });
  assert.ok(cachePolitica.lerPolitica(), 'o cache existe antes');
  const r = revogacao.retirarConsentimento(e, e.config.sync);
  assert.equal(r.ok, true);
  assert.equal(e.config.sync.aceitarAdmin, false);
  assert.equal(cachePolitica.lerPolitica(), null, 'a restrição não sobrevive à retirada do consentimento');
  assert.deepEqual(fake.requests.filter((x) => String(x.path || '').includes('control')), [], 'retirar consentimento é local');
});

test('o resumo separa as três revogações em campos diferentes', () => {
  const r = revogacao.resumoDaRevogacao({ corteVigente: 123 });
  assert.equal(r.corteVigente, 123);
  assert.match(r.tokenEmitido, /1 hora/, 'o limite do ID token já emitido precisa estar dito');
  assert.match(r.acessoAoBanco, /senha/);
  assert.match(r.autorizacaoDoAparelho, /neste aparelho/);
  assert.match(r.processosDeIa, /aparelho onde ela roda/);
});

// A promessa que a spec proíbe, procurada no texto que a pessoa lê.
test('o resumo não promete apagar o que o outro aparelho já recebeu', () => {
  const texto = Object.values(revogacao.resumoDaRevogacao({})).join(' ').toLowerCase();
  for (const promessa of ['apaga tudo', 'remove os dados', 'remove as chaves', 'imediatamente', 'encerra todas as sessões']) {
    assert.equal(texto.includes(promessa), false, `o resumo não pode dizer "${promessa}"`);
  }
  assert.match(texto, /continuam com ele/, 'e precisa dizer o que NÃO acontece');
});
