// Tomada forçada (7.C8): a parte pura, o lease sucessor e o bloqueio da publicação tardia.
//
// O que esta entrega NÃO promete é tão importante quanto o que ela promete: não existe
// exactly-once. O Farol não alcança o processo do outro aparelho; ele garante que, a partir
// da tomada, o executor antigo não publica, e registra que o consumo pode ter sido duplo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c8-tomada-'));
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

const tomada = (await import('../lib/sync/tomada.js')).default;
const lease = (await import('../lib/sync/lease.js')).default;
const comando = (await import('../lib/sync/comando.js')).default;
const { createRtdbClient } = await import('../lib/sync/rtdb.js');

const T = 1_800_000_000_000;
const IDS = { uid: 'u1', accountHash: 'a'.repeat(64), prHash: 'b'.repeat(64) };
let fake;
let identity;

before(async () => {
  identity = await startFakeIdentity({ apiKey: 'k', users: { 'a@b.com': { password: 'x', uid: 'u1' } } });
  fake = await startFakeRtdb({ token: () => true });
});
after(async () => {
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); });

function leaseVivo(extra = {}) {
  return { leaseId: 'L1', deviceId: 'dA', operationKind: 'review', headSha: 'sha1', acquiredAt: T - 1000, heartbeatAt: T - 1000, expiresAt: T + SYNC.LEASE_TTL_MS, farolVersion: '2.59.4', ...extra };
}

test('tomar só faz sentido sobre lease VIVO de OUTRO aparelho', () => {
  assert.deepEqual(tomada.podeTomar(leaseVivo(), { nowMs: T, deviceId: 'dB' }), { pode: true, motivo: '' });
  assert.equal(tomada.podeTomar(null, { nowMs: T, deviceId: 'dB' }).motivo, 'sem-lease');
  assert.equal(tomada.podeTomar(leaseVivo({ deviceId: 'dB' }), { nowMs: T, deviceId: 'dB' }).motivo, 'ja-e-meu');
  assert.equal(tomada.podeTomar(leaseVivo({ expiresAt: T - 1 }), { nowMs: T, deviceId: 'dB' }).motivo, 'vencido', 'lease vencido usa a disputa de sempre');
});

test('o sucessor sobe uma geração e diz de quem tomou', () => {
  const s = tomada.sucessorDe(leaseVivo(), { leaseId: 'L2', deviceId: 'dB', operationKind: 'review', headSha: 'sha1', nowMs: T, farolVersion: '2.60.0' });
  assert.equal(s.takeoverSeq, 2);
  assert.equal(s.tomadoDe, 'dA');
  assert.equal(s.deviceId, 'dB');
  assert.equal(tomada.sucessorDe({ ...leaseVivo(), takeoverSeq: 5 }, { leaseId: 'L3', deviceId: 'dB', nowMs: T }).takeoverSeq, 6);
});

test('o risco é declarado pelo que se sabe: batida recente é provável, batida velha é possível', () => {
  assert.equal(tomada.riscoDeDuplicidade(leaseVivo({ heartbeatAt: T - 1000 }), { nowMs: T }), 'provavel');
  assert.equal(tomada.riscoDeDuplicidade(leaseVivo({ heartbeatAt: T - SYNC.LEASE_TTL_MS - 1 }), { nowMs: T }), 'possivel');
});

test('o aviso explica o risco ANTES de confirmar, e não promete o que não pode', () => {
  const aviso = tomada.avisoDaTomada(leaseVivo(), { nowMs: T, nomeDoAparelho: 'Celular' });
  assert.match(aviso, /Celular/);
  assert.match(aviso, /não encerra o processo do outro aparelho/);
  assert.match(aviso, /não consegue mais postar/);
  assert.match(aviso, /custar duas vezes/);
  // o risco sai em português, nunca o código interno sem acento (visto na jornada da bancada)
  assert.match(aviso, /duplicidade provável/);
  assert.doesNotMatch(aviso, /provavel|possivel/);
  assert.match(tomada.avisoDaTomada(leaseVivo({ heartbeatAt: T - SYNC.LEASE_TTL_MS - 1 }), { nowMs: T }), /duplicidade possível/);
});

test('quem está uma geração atrás não publica', () => {
  assert.equal(tomada.publicacaoBloqueada(1, { takeoverSeq: 2 }), true);
  assert.equal(tomada.publicacaoBloqueada(2, { takeoverSeq: 2 }), false);
  assert.equal(tomada.publicacaoBloqueada(1, leaseVivo()), false, 'lease sem tomada é geração 1');
  assert.equal(tomada.publicacaoBloqueada(1, null), false);
});

test('a evidência guarda de quem, para quem, a geração e o risco', () => {
  const e = tomada.evidenciaDaTomada(leaseVivo(), { prKey: 'dono/repo#1', deviceId: 'dB', nowMs: T });
  assert.deepEqual(e, { prKey: 'dono/repo#1', de: 'dA', para: 'dB', geracao: 2, risco: 'provavel', at: T });
});

// --- lease sucessor no banco ----------------------------------------------------------

function cliente() {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'tok' }) });
}

test('o sucessor entra por cima do lease vivo, e o antigo perde a renovação com motivo próprio', async () => {
  const c = cliente();
  await c.put(`/users/u1/leases/${IDS.accountHash}/${IDS.prHash}`, leaseVivo(), {});
  const t = await lease.takeoverLease(c, IDS, { leaseId: 'L2', deviceId: 'dB', operationKind: 'review', headSha: 'sha1', nowMs: T, farolVersion: '2.60.0' });
  assert.equal(t.ok, true);
  assert.equal(t.lease.takeoverSeq, 2);
  assert.equal(t.anterior.deviceId, 'dA');
  const antigo = await lease.renewLease(c, IDS, { leaseId: 'L1', nowMs: T });
  assert.equal(antigo.ok, false);
  assert.equal(antigo.reason, 'tomado', 'perder para uma tomada não é o mesmo que vencer');
});

test('o lease antigo não apaga o sucessor', async () => {
  const c = cliente();
  await c.put(`/users/u1/leases/${IDS.accountHash}/${IDS.prHash}`, leaseVivo(), {});
  await lease.takeoverLease(c, IDS, { leaseId: 'L2', deviceId: 'dB', operationKind: 'review', nowMs: T });
  const r = await lease.releaseLease(c, IDS, { leaseId: 'L1' });
  assert.deepEqual(r, { ok: true, released: false });
  const atual = fake.tree().users.u1.leases[IDS.accountHash][IDS.prHash];
  assert.equal(atual.leaseId, 'L2', 'o sucessor continua lá');
});

test('tomar de si mesmo ou de lease vencido não é tomada', async () => {
  const c = cliente();
  await c.put(`/users/u1/leases/${IDS.accountHash}/${IDS.prHash}`, leaseVivo({ expiresAt: T - 1 }), {});
  const vencido = await lease.takeoverLease(c, IDS, { leaseId: 'L2', deviceId: 'dB', nowMs: T });
  assert.equal(vencido.reason, 'vencido');
  await c.put(`/users/u1/leases/${IDS.accountHash}/${IDS.prHash}`, leaseVivo({ deviceId: 'dB' }), {});
  const meu = await lease.takeoverLease(c, IDS, { leaseId: 'L2', deviceId: 'dB', nowMs: T });
  assert.equal(meu.reason, 'ja-e-meu');
});

test('o comando tomar exige confirmação explícita', () => {
  const PR = 'a'.repeat(32);
  const MAT = 'b'.repeat(32);
  assert.equal(comando.sanearComando({ tipo: 'tomar', args: { prTag: PR, matTag: MAT } }), null);
  assert.equal(comando.sanearComando({ tipo: 'tomar', args: { prTag: PR, matTag: MAT, confirmado: 'sim' } }), null);
  assert.deepEqual(comando.sanearComando({ tipo: 'tomar', args: { prTag: PR, matTag: MAT, confirmado: true } }), { tipo: 'tomar', args: { prTag: PR, matTag: MAT, confirmado: true } });
});

test('o funil pergunta pela geração antes de enviar, e leitura indisponível não autoriza', () => {
  const arbitragem = fs.readFileSync(new URL('../lib/engine/postagem-arbitragem.js', import.meta.url), 'utf8');
  assert.match(arbitragem, /handle\.geracaoCorrente\(\)/);
  assert.match(arbitragem, /posse-tomada/);
  const coord = fs.readFileSync(new URL('../lib/sync/coordinator.js', import.meta.url), 'utf8');
  const i = coord.indexOf('async function geracaoCorrente');
  assert.ok(i > 0);
  assert.match(coord.slice(i, i + 400), /if \(!lido \|\| !lido\.ok\) return false;/, 'sem leitura, não publica');
});

test('a tomada só acontece com pedido explícito E confirmado', () => {
  const coord = fs.readFileSync(new URL('../lib/sync/coordinator.js', import.meta.url), 'utf8');
  assert.match(coord, /ctx\.tomar === true && ctx\.confirmado === true/);
  const review = fs.readFileSync(new URL('../lib/engine/review.js', import.meta.url), 'utf8');
  assert.match(review, /tomar, confirmado: tomar/, 'o pedido vem do item, e é consumido de uma vez');
  assert.match(review, /pr\.tomarLease = false;/);
});
