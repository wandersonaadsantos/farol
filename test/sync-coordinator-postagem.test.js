// Três ajustes do coordenador que a arbitragem de postagem (CT-POST) consome: a posse com
// margem (validoPor), o noop que não barra quem não ligou a coordenação e o recibo que
// não apaga o registro de postagem gravado no mesmo nó.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-coord-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { SYNC, TEMPOS } from '../lib/constants.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit, noopHandle } = await import('../lib/sync/coordinator.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'Org/Repo#7';
const IDS = { uid: 'u1', accountHash: accountHash('Eu'), prHash: prHash(PR_KEY) };
const FP = operationFingerprint('review', HEAD);
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); });

function motor() {
  const rt = {
    status: 'conectado', lastError: null, uid: 'u1', deviceId: 'dEu', deviceName: 'Notebook',
    client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) }),
    devices: {}, leasesVistos: {}, recibosVistos: {}, espera: {}, relogio: AGORA,
  };
  rt.agora = () => rt.relogio;
  return {
    config: { sync: { enabled: true, coordination: { enabled: true }, consolidation: { enabled: false } } },
    sync: rt, logs: [], log(n, m) { this.logs.push([n, m]); }, markSeen() { }, cancelSession() { },
    async myReviewStates() { return []; }, accountForPr: () => 'Eu', async headSha() { return HEAD; },
  };
}

function ctx() {
  const pr = { key: PR_KEY, repo: 'Org/Repo', number: 7, account: 'Eu' };
  return { prKey: PR_KEY, account: 'Eu', materialVersion: HEAD, headSha: HEAD, contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr, operationKind: 'review', opId: '' };
}

function noDoRecibo() {
  return fake.tree().users.u1.receipts[IDS.accountHash][IDS.prHash][FP];
}

test('validoPor exige folga até o vencimento; valido() continua sem folga', async () => {
  const e = motor();
  const a = await admit(e, ctx());
  assert.equal(a.admitted, true);
  e.sync.relogio = AGORA + SYNC.LEASE_TTL_MS - 10_000;
  assert.equal(a.handle.valido(), true);
  assert.equal(a.handle.validoPor(0), true);
  assert.equal(a.handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS), false);
  await a.handle.abort();
});

test('noopHandle: validoPor nunca barra quem não tem lease', () => {
  assert.equal(noopHandle().validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS), true);
});

test('complete sobre nó que só tinha o registro de postagem: grava o recibo e preserva postagens', async () => {
  const registro = { estado: 'confirmada', tentativaId: 't1', intencaoEm: AGORA, atualizadoEm: AGORA, head: HEAD, evento: 'APPROVE' };
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: { postagens: { APPROVE: registro } } } } } } } });
  const e = motor();
  const a = await admit(e, ctx());
  assert.equal(a.admitted, true, 'nó sem outcome não bloqueia a admissão');
  assert.equal((await a.handle.complete({ publicationState: 'published' })).ok, true);
  const no = noDoRecibo();
  assert.equal(no.outcome, 'completed');
  assert.equal(no.publicationState, 'published');
  assert.deepEqual(no.postagens.APPROVE, registro);
});

test('as constantes da arbitragem existem e têm a ordem certa', () => {
  assert.equal(TEMPOS.POSTAGEM_RECONCILIACAO_ESPERA_MS, 60_000);
  assert.ok(TEMPOS.POSTAGEM_MARGEM_POSSE_MS > 0 && TEMPOS.POSTAGEM_MARGEM_POSSE_MS < SYNC.HEARTBEAT_MS);
});
