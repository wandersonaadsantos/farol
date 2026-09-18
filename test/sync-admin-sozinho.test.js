// Aparelho sozinho no conjunto vira admin e a tela precisa saber (medido em 18/09/2026).
//
// O relógio da sincronização parava no primeiro portão, o de haver outro aparelho pronto
// para ler (`sem-frota`), e os sinais do admin moravam depois dele. Resultado real: a
// geração 7 gravada no banco, a privada guardada no disco, o toast "Este aparelho agora é
// o admin", e a tela seguindo em "sem admin" para sempre, porque ninguém mais observava o
// nó do admin nem publicava o batimento. Os outros aparelhos da conta estavam em versão
// anterior ao contrato 2, então a frota nunca ficaria pronta sozinha.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-admin-sozinho-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { fixarMemoriaLivre, restaurarMemoriaLivre } from './helpers/memoria-livre.js';
import { SYNC } from '../lib/constants.js';

fixarMemoriaLivre();

const { Engine } = await import('../server.js');
const andamento = (await import('../lib/engine/sync-andamento.js')).default;
const syncTelas = (await import('../lib/engine/sync-telas.js')).default;
const ak = await import('../lib/sync/admin-chave.js');

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
  restaurarMemoriaLivre();
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); ak.apagarChaveDeAdmin(); });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg() {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local',
  };
}

// Os outros aparelhos existem, mas nenhum está no contrato 2 com a chave pronta: é a
// frota real do caso, e é o que faz `podePublicar` recusar com `sem-frota`.
function frotaAntiga() {
  const agora = Date.now();
  return {
    dMac: { contract: 0, keyReady: false, lastSeenAt: agora - 40 * 3600 * 1000 },
    dAndroid: { contract: 0, keyReady: false, lastSeenAt: agora },
  };
}

async function motorSozinho() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg() });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = frotaAntiga();
  return e;
}

test('sozinho no conjunto: o ciclo recusa publicar, e mesmo assim a tela vê este aparelho como admin', async () => {
  const e = await motorSozinho();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  // a primeira leitura do batimento é snapshot e não prova vida (test/sync-sinais.test.js);
  // é a mudança no giro seguinte, um intervalo depois, que prova
  const T = Date.now();
  const pub = await andamento.ciclo(e, e.config.sync, { agora: T });
  assert.equal(pub.code, 'sem-frota', 'a premissa do caso: não há leitor pronto');
  await andamento.ciclo(e, e.config.sync, { agora: T + SYNC.AUTORIDADE_INTERVALO_MS });
  const admin = syncTelas.projecaoDasTelas(e).admin;
  assert.ok(admin, 'sem isto a tela diz "sem admin" com a geração gravada no banco');
  assert.equal(admin.souEu, true);
  assert.equal(admin.generation, 1);
  assert.equal(admin.fresca, true, 'o batimento sai mesmo sem frota, senão a tela diria "admin sem sinal de vida"');
});

test('sozinho no conjunto: a recusa de publicar continua valendo para o conteúdo cifrado', async () => {
  const e = await motorSozinho();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  await andamento.ciclo(e, e.config.sync, { agora: Date.now() });
  const live = (fake.tree().users.u1 || {}).live || {};
  assert.equal(live.operations, undefined, 'andamento não sobe sem ninguém para ler');
  assert.ok(live.control && live.control.admin, 'o nó do admin está lá');
});

test('logo depois de virar admin a tela já sabe, sem esperar o próximo giro do relógio', async () => {
  const e = await motorSozinho();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  const admin = syncTelas.projecaoDasTelas(e).admin;
  assert.ok(admin, 'o toast diz "agora é o admin"; a tela não pode dizer "sem admin" no mesmo segundo');
  assert.equal(admin.souEu, true);
  assert.equal(admin.fresca, false, 'anotar quem é o admin não inventa batimento');
});
