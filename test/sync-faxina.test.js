// Retenção do banco da coordenação (lib/engine/sync-faxina.js, D17 do contrato): uma
// faxina por dia no syncTick, que poda dailyRounds de mais de ROUNDS_TTL_MS e apaga o
// recibo vencido com `if-match`. Contra o dublê do RTDB, com o relógio do runtime
// injetado (engine.sync.agora), então "amanhã" é uma soma, não uma espera.
//
// A parte do tick usa a Engine REAL com login no dublê do Auth, como em
// test/sync-engine.test.js. FAROL_HOME é fixado antes do import do server.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-faxina-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC, TEMPOS } from '../lib/constants.js';
import { accountHash, prHash, brasiliaDay, operationFingerprint } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const faxina = await import('../lib/engine/sync-faxina.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');

const TOKEN = 'tok-faxina';
const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-do-teste';
const AGORA = 1_800_000_000_000;
const EU = accountHash('eu');
const OUTRA = accountHash('outra');
const PR1 = prHash('Org/Repo#1');
const PR2 = prHash('Org/Repo#2');
const FP_VELHO = operationFingerprint('review', 'a'.repeat(40));
const FP_NOVO = operationFingerprint('review', 'b'.repeat(40));
const FP_SEM_PRAZO = operationFingerprint('self', 'c'.repeat(40));

const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
const rtdb = await startFakeRtdb({ token: (t) => t === TOKEN || identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { rtdb.setTree(null); rtdb.requests.length = 0; });

const cliente = createRtdbClient({ databaseUrl: rtdb.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) });

function dia(ms) { return brasiliaDay(ms); }

function rodada() { return { dayPolicy: SYNC.DAY_TZ, updatedAt: AGORA, reservations: { a1: { state: 'started' } } }; }

function recibo(expiresAt) {
  return { operationKind: 'review', materialVersion: 'x', deviceId: 'd', completedAt: AGORA - SYNC.RECEIPT_TTL_MS, outcome: 'completed', publicationState: 'published', expiresAt };
}

// o banco com um pouco de tudo: dia velho e dia recente, recibo vencido, vivo e sem
// prazo, nas duas contas
function bancoSujo() {
  const velho = dia(AGORA - SYNC.ROUNDS_TTL_MS - TEMPOS.DIA_MS);
  const recente = dia(AGORA - TEMPOS.DIA_MS);
  return {
    users: { u1: {
      dailyRounds: {
        [EU]: { [PR1]: { [velho]: rodada(), [recente]: rodada() }, [PR2]: { [velho]: rodada() } },
        [OUTRA]: { [PR1]: { [velho]: rodada() } },
      },
      receipts: {
        [EU]: { [PR1]: { [FP_VELHO]: recibo(AGORA - 1), [FP_NOVO]: recibo(AGORA + TEMPOS.DIA_MS), [FP_SEM_PRAZO]: { outcome: 'completed' } } },
        [OUTRA]: { [PR2]: { [FP_VELHO]: recibo(AGORA) } },
      },
    } },
  };
}

// motor mínimo: só o que a faxina lê do engine
function motor(extra = {}) {
  return {
    config: { sync: { enabled: true, coordination: { enabled: true } } },
    sync: { status: 'conectado', client: cliente, uid: 'u1', agora: () => AGORA, lastFaxinaAt: 0 },
    accountList: () => [{ user: 'eu' }, { user: 'Outra' }, { user: 'eu' }],
    ...extra,
  };
}

test('fatiaDoDia: lista pequena vai inteira; a grande gira com o dia e cobre tudo em poucos dias', () => {
  assert.deepEqual(faxina.fatiaDoDia([1, 2, 3], 7, 5), [1, 2, 3]);
  const lista = Array.from({ length: 5 }, (_, i) => i);
  assert.deepEqual(faxina.fatiaDoDia(lista, 0, 2), [0, 1]);
  assert.deepEqual(faxina.fatiaDoDia(lista, 1, 2), [2, 3]);
  assert.deepEqual(faxina.fatiaDoDia(lista, 2, 2), [4, 0], 'dá a volta no fim da lista');
  const vistos = new Set([0, 1, 2].flatMap((d) => faxina.fatiaDoDia(lista, d, 2)));
  assert.equal(vistos.size, lista.length, 'em três dias todos os cinco passaram');
});

test('faxina: poda dia velho de dailyRounds e apaga só recibo vencido, nas duas contas', async () => {
  rtdb.setTree(bancoSujo());
  const r = await faxina.faxinar(motor());
  assert.equal(r.ok, true);
  assert.equal(r.feita, true);
  const t = rtdb.tree().users.u1;
  assert.deepEqual(Object.keys(t.dailyRounds[EU][PR1]), [dia(AGORA - TEMPOS.DIA_MS)], 'o dia recente fica');
  assert.equal(t.dailyRounds[EU][PR2], undefined, 'PR só com dia velho some inteiro');
  assert.equal(t.dailyRounds[OUTRA], undefined, 'a outra conta também é faxinada');
  assert.deepEqual(Object.keys(t.receipts[EU][PR1]).sort(), [FP_NOVO, FP_SEM_PRAZO].sort(), 'vivo e sem prazo ficam; falta de dado nunca apaga');
  assert.equal(t.receipts[OUTRA], undefined, 'expiresAt igual a agora já venceu');
  assert.equal(r.rodadas, 3);
  assert.equal(r.recibos, 2);
});

test('faxina: todo DELETE de recibo vai condicionado ao etag lido', async () => {
  rtdb.setTree(bancoSujo());
  await faxina.faxinar(motor());
  const deletes = rtdb.requests.filter((q) => q.method === 'DELETE');
  assert.equal(deletes.length, 2);
  for (const d of deletes) assert.ok(d.headers['if-match'], `DELETE sem if-match em ${d.path}`);
});

test('faxina: uma por dia; no dia seguinte roda de novo', async () => {
  rtdb.setTree(bancoSujo());
  let agora = AGORA;
  const m = motor();
  m.sync.agora = () => agora;
  assert.equal((await faxina.faxinar(m)).feita, true);
  rtdb.setTree(bancoSujo());
  rtdb.requests.length = 0;
  agora += SYNC.FAXINA_MS - 1;
  assert.equal((await faxina.faxinar(m)).feita, false, 'dentro da janela não faxina');
  assert.equal(rtdb.requests.length, 0, 'nem toca o banco');
  agora += 1;
  assert.equal((await faxina.faxinar(m)).feita, true);
});

test('faxina: coordenação desligada, desconectado ou sem cliente não faz nada', async () => {
  rtdb.setTree(bancoSujo());
  const desligada = motor({ config: { sync: { enabled: true, coordination: { enabled: false } } } });
  assert.equal((await faxina.faxinar(desligada)).feita, false);
  const caida = motor();
  caida.sync.status = 'erro';
  assert.equal((await faxina.faxinar(caida)).feita, false);
  const semCliente = motor();
  semCliente.sync.client = null;
  assert.equal((await faxina.faxinar(semCliente)).feita, false);
  assert.equal(rtdb.requests.length, 0);
});

test('faxina: no máximo FAXINA_MAX_PRS nós de PR por faxina; o resto fica para o dia seguinte', async () => {
  const velho = dia(AGORA - SYNC.ROUNDS_TTL_MS - TEMPOS.DIA_MS);
  const muitos = {};
  for (let i = 0; i <= SYNC.FAXINA_MAX_PRS; i++) muitos[prHash(`Org/Repo#${i + 1}`)] = { [velho]: rodada() };
  rtdb.setTree({ users: { u1: { dailyRounds: { [EU]: muitos } } } });
  let agora = AGORA;
  const m = motor({ accountList: () => [{ user: 'eu' }] });
  m.sync.agora = () => agora;
  const r = await faxina.faxinar(m);
  assert.equal(r.prs, SYNC.FAXINA_MAX_PRS);
  assert.equal(Object.keys(rtdb.tree().users.u1.dailyRounds[EU]).length, 1, 'sobra um para amanhã');
  agora += SYNC.FAXINA_MS;
  await faxina.faxinar(m);
  assert.equal(rtdb.tree(), null, 'no dia seguinte a sobra sai');
});

test('faxina: falha na listagem não lança e espera o dia seguinte', async () => {
  const quebrado = createRtdbClient({ databaseUrl: rtdb.url, getIdToken: async () => ({ ok: true, idToken: 'tok-errado' }) });
  const m = motor();
  m.sync.client = quebrado;
  const r = await faxina.faxinar(m);
  assert.equal(r.ok, false);
  assert.equal(r.feita, true);
  assert.equal(r.code, 'nao_autorizado');
  assert.equal(m.sync.lastFaxinaAt, AGORA, 'a tentativa conta: tentar a cada tick só gastaria rede');
});

// --- fiação no syncTick com a Engine real -------------------------------------------

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

test('syncTick conectado com a coordenação ligada faz a faxina uma vez por dia', async () => {
  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  engine.pushState = () => {};
  engine.config.accounts = [{ user: 'eu', owners: ['Org'] }];
  engine.updateSettings({ sync: {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local',
  } });
  if (engine.sync.iniciando) await engine.sync.iniciando;
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const banco = rtdb.tree();
  rtdb.setTree({ users: { u1: { ...banco.users.u1, ...bancoSujo().users.u1 } } });
  engine.sync.agora = () => AGORA;
  engine.sync.lastFaxinaAt = 0;
  await engine.syncTick();
  // a faxina sai do tick SEM await de propósito (ela varre até 200 nós e o check()
  // espera o tick antes de relançar as re-revisões); quem quiser o desfecho espera a
  // promessa guardada
  await engine.sync.faxinaEmVoo;
  const t = rtdb.tree().users.u1;
  assert.equal(t.dailyRounds[EU][PR2], undefined, 'o tick fez a faxina');
  assert.deepEqual(Object.keys(t.receipts[EU][PR1]).sort(), [FP_NOVO, FP_SEM_PRAZO].sort());
  assert.ok(t.dailyRounds[OUTRA], 'conta que não é da engine não é tocada');
  const antes = rtdb.requests.length;
  await engine.syncTick();
  assert.equal(rtdb.requests.slice(antes).filter((q) => q.query.shallow).length, 0, 'o segundo tick do dia não lista nada');
  engine.syncLogout();
});
