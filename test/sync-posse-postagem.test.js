// Posse de postagem (CT-POST, passo 1): o MESMO lease das análises, tipo 'post'.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-posse-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { TEMPOS } from '../lib/constants.js';
import { accountHash, prHash } from '../lib/sync/keys.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { adquirirPosseDePostagem } = await import('../lib/sync/posse-postagem.js');

const TOKEN = 'tok-ok';
const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR_KEY = 'o/r#1';
const AH = accountHash('eu');
const PH = prHash(PR_KEY);
const CTX = { prKey: PR_KEY, account: 'eu', headSha: HEAD };
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function motor(status = 'conectado', deviceId = 'dEu') {
  const rt = {
    status, uid: 'u1', deviceId, relogio: AGORA,
    client: createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) }),
  };
  rt.agora = () => rt.relogio;
  return { sync: rt, log() { }, cancelSession() { } };
}

function leaseNoBanco() {
  const t = fake.tree();
  return t && t.users && t.users.u1.leases && t.users.u1.leases[AH] && t.users.u1.leases[AH][PH];
}

test('PR livre: pega o lease com tipo post e devolve handle válido', async () => {
  const p = await adquirirPosseDePostagem(motor(), CTX);
  assert.equal(p.ok, true);
  assert.equal(leaseNoBanco().operationKind, 'post');
  assert.equal(leaseNoBanco().deviceId, 'dEu');
  assert.equal(leaseNoBanco().headSha, HEAD);
  assert.equal(p.handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS), true);
  await p.handle.abort();
  // o dublê representa nó apagado como null (semântica do RTDB), não como chave ausente:
  // o que a garantia exige é que não sobre lease nenhum, não a forma do vazio
  assert.ok(!leaseNoBanco(), 'abort devolve o lease');
});

test('lease vivo de outro aparelho (qualquer tipo): posse-alheia e o lease dele fica', async () => {
  const outro = { leaseId: 'LO', deviceId: 'dOutro', operationKind: 'review', headSha: HEAD, acquiredAt: AGORA, heartbeatAt: AGORA, expiresAt: AGORA + 60_000, farolVersion: '9.9.9' };
  fake.setTree({ users: { u1: { leases: { [AH]: { [PH]: outro } } } } });
  assert.deepEqual(await adquirirPosseDePostagem(motor(), CTX), { ok: false, motivo: 'posse-alheia' });
  assert.equal(leaseNoBanco().leaseId, 'LO');
});

test('dois aparelhos disputando ao mesmo tempo: só um fica com a posse', async () => {
  const [pa, pb] = await Promise.all([adquirirPosseDePostagem(motor(), CTX), adquirirPosseDePostagem(motor('conectado', 'dOutro'), CTX)]);
  assert.equal([pa, pb].filter((p) => p.ok).length, 1);
  for (const p of [pa, pb]) if (p.ok) await p.handle.abort();
});

test('fora de conectado, sem head ou sem conta: indisponível sem tocar a rede', async () => {
  assert.deepEqual(await adquirirPosseDePostagem(motor('erro'), CTX), { ok: false, motivo: 'coordenacao-indisponivel' });
  assert.deepEqual(await adquirirPosseDePostagem(motor(), { ...CTX, headSha: '' }), { ok: false, motivo: 'coordenacao-indisponivel' });
  assert.deepEqual(await adquirirPosseDePostagem(motor(), { ...CTX, account: '' }), { ok: false, motivo: 'coordenacao-indisponivel' });
  assert.equal(fake.requests.length, 0);
});
