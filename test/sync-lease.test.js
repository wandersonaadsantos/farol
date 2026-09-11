// lib/sync/lease.js: o lease de coordenação entre aparelhos. Tudo contra o dublê do
// RTDB (test/helpers/fake-rtdb.js), que faz o CAS por ETag de verdade: é o `if-match`
// que decide quem fica com o lease quando dois aparelhos chegam juntos.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { createRtdbClient } from '../lib/sync/rtdb.js';
import { SYNC } from '../lib/constants.js';
import lease, {
  leasePath, leaseAcquirable, buildLease, acquireLease, renewLease, releaseLease,
} from '../lib/sync/lease.js';

const TOKEN = 'tok-ok';
const IDS = { uid: 'u1', accountHash: 'a'.repeat(64), prHash: 'b'.repeat(64) };
const AGORA = 1_800_000_000_000;
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(extra = {}) {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }), ...extra });
}

function dadosDe(leaseId, deviceId, nowMs = AGORA) {
  return { leaseId, deviceId, operationKind: 'review', headSha: 'abc123', nowMs, farolVersion: '9.9.9' };
}

function noBanco() {
  const t = fake.tree();
  return t && t.users.u1.leases[IDS.accountHash][IDS.prHash];
}

test('exporta pelo default e pelos nomes', () => {
  for (const nome of ['leasePath', 'leaseAcquirable', 'buildLease', 'acquireLease', 'renewLease', 'releaseLease']) {
    assert.equal(typeof lease[nome], 'function', nome);
  }
});

test('leasePath monta o caminho do contrato', () => {
  assert.equal(leasePath('u1', 'ah', 'ph'), '/users/u1/leases/ah/ph');
});

test('leaseAcquirable: ausente, meu, expirado, alheio e falta de dado', () => {
  assert.equal(leaseAcquirable(null, { leaseId: 'L1', nowMs: AGORA }), 'ausente');
  assert.equal(leaseAcquirable(undefined, { leaseId: 'L1', nowMs: AGORA }), 'ausente');
  assert.equal(leaseAcquirable({ leaseId: 'L1', expiresAt: AGORA - 1 }, { leaseId: 'L1', nowMs: AGORA }), 'meu');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: AGORA }, { leaseId: 'L1', nowMs: AGORA }), 'expirado');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: AGORA + 1 }, { leaseId: 'L1', nowMs: AGORA }), 'alheio');
  assert.equal(leaseAcquirable({ leaseId: 'L2' }, { leaseId: 'L1', nowMs: AGORA }), 'alheio', 'sem expiresAt não libera');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: null }, { leaseId: 'L1', nowMs: AGORA }), 'alheio', 'null não vira zero');
  assert.equal(leaseAcquirable({ leaseId: 'L2', expiresAt: 'x' }, { leaseId: 'L1', nowMs: AGORA }), 'alheio');
  assert.equal(leaseAcquirable({ expiresAt: AGORA + 1 }, { leaseId: '', nowMs: AGORA }), 'alheio', 'leaseId vazio dos dois lados não é "meu"');
});

test('buildLease: expira em LEASE_TTL_MS e headSha vazio vira texto vazio', () => {
  const l = buildLease({ leaseId: 'L1', deviceId: 'd1', operationKind: 'self', headSha: undefined, nowMs: AGORA, farolVersion: '1.0.0' });
  assert.deepEqual(l, {
    leaseId: 'L1', deviceId: 'd1', operationKind: 'self', headSha: '',
    acquiredAt: AGORA, heartbeatAt: AGORA, expiresAt: AGORA + SYNC.LEASE_TTL_MS, farolVersion: '1.0.0',
  });
});

test('acquireLease em nó vazio grava com if-match null_etag', async () => {
  const r = await acquireLease(cliente(), IDS, dadosDe('L1', 'd1'));
  assert.equal(r.ok, true);
  assert.equal(r.lease.leaseId, 'L1');
  assert.match(r.etag, /^[0-9a-f]{40}$/);
  assert.equal(noBanco().deviceId, 'd1');
  const put = fake.requests.find((q) => q.method === 'PUT');
  assert.equal(put.headers['if-match'], 'null_etag');
});

test('dois aparelhos disputando ao mesmo tempo: exatamente um fica com o lease', async () => {
  const [a, b] = await Promise.all([
    acquireLease(cliente(), IDS, dadosDe('LA', 'dA')),
    acquireLease(cliente(), IDS, dadosDe('LB', 'dB')),
  ]);
  const vencedores = [a, b].filter((r) => r.ok);
  assert.equal(vencedores.length, 1, 'exatamente um ok');
  const perdedor = [a, b].find((r) => !r.ok);
  assert.equal(perdedor.reason, 'alheio');
  assert.equal(perdedor.lease.leaseId, vencedores[0].lease.leaseId, 'o perdedor enxerga o lease do vencedor');
  assert.equal(noBanco().leaseId, vencedores[0].lease.leaseId);
});

test('lease alheio vivo não é tomado', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await acquireLease(cliente(), IDS, dadosDe('LB', 'dB', AGORA + 1000));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'alheio');
  assert.equal(r.lease.deviceId, 'dA');
  assert.equal(noBanco().leaseId, 'LA');
});

test('lease expirado é assumido', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const depois = AGORA + SYNC.LEASE_TTL_MS;
  const r = await acquireLease(cliente(), IDS, dadosDe('LB', 'dB', depois));
  assert.equal(r.ok, true);
  assert.equal(noBanco().leaseId, 'LB');
  assert.equal(noBanco().expiresAt, depois + SYNC.LEASE_TTL_MS);
});

test('lease "meu" é readquirido com validade nova', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await acquireLease(cliente(), IDS, dadosDe('LA', 'dA', AGORA + 5000));
  assert.equal(r.ok, true);
  assert.equal(noBanco().expiresAt, AGORA + 5000 + SYNC.LEASE_TTL_MS);
});

test('renewLease do meu lease estende a validade e devolve o etag novo', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA + 30_000 });
  assert.equal(r.ok, true);
  assert.match(r.etag, /^[0-9a-f]{40}$/);
  assert.equal(noBanco().heartbeatAt, AGORA + 30_000);
  assert.equal(noBanco().expiresAt, AGORA + 30_000 + SYNC.LEASE_TTL_MS);
  assert.equal(noBanco().acquiredAt, AGORA, 'acquiredAt fica');
});

test('renewLease de lease alheio devolve perdido e não toca o do outro', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LB', 'dB'));
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA + 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(r.lease.leaseId, 'LB');
  assert.equal(noBanco().heartbeatAt, AGORA);
});

test('renewLease de lease que sumiu devolve perdido', async () => {
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
});

test('renewLease de lease expirado devolve perdido (outro aparelho pode já ter lido como livre)', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await renewLease(cliente(), IDS, { leaseId: 'LA', nowMs: AGORA + SYNC.LEASE_TTL_MS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(noBanco().expiresAt, AGORA + SYNC.LEASE_TTL_MS, 'não ressuscita');
});

test('renewLease condiciona o PUT ao etag lido: sucessor que assumiu entre o GET e o PUT não é sobrescrito', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const base = cliente();
  let intercalou = false;
  // entre a leitura (lease meu e vivo) e a escrita, outro aparelho assume o nó
  const c = {
    ...base,
    put: async (p, v, o) => {
      if (!intercalou) {
        intercalou = true;
        const sucessor = buildLease({ leaseId: 'LB', deviceId: 'dB', operationKind: 'review', headSha: 'abc123', nowMs: AGORA + 1, farolVersion: '9.9.9' });
        fake.setTree({ users: { u1: { leases: { [IDS.accountHash]: { [IDS.prHash]: sucessor } } } } });
      }
      return base.put(p, v, o);
    },
  };
  const r = await renewLease(c, IDS, { leaseId: 'LA', nowMs: AGORA + 30_000 });
  assert.equal(intercalou, true, 'o gancho rodou entre o GET e o PUT');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'perdido');
  assert.equal(r.lease.leaseId, 'LB', 'o 412 devolve o lease de quem assumiu');
  assert.equal(noBanco().leaseId, 'LB', 'o sucessor continua dono do nó');
  assert.equal(noBanco().deviceId, 'dB');
  const put = fake.requests.filter((q) => q.method === 'PUT').at(-1);
  assert.match(put.headers['if-match'], /^[0-9a-f]{40}$/, 'a renovação levou if-match');
});

test('releaseLease do meu apaga com if-match', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const r = await releaseLease(cliente(), IDS, { leaseId: 'LA' });
  assert.deepEqual(r, { ok: true, released: true });
  assert.equal(fake.tree(), null);
  const del = fake.requests.find((q) => q.method === 'DELETE');
  assert.match(del.headers['if-match'], /^[0-9a-f]{40}$/);
});

test('releaseLease nunca apaga o lease de outro aparelho', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LB', 'dB'));
  const r = await releaseLease(cliente(), IDS, { leaseId: 'LA' });
  assert.deepEqual(r, { ok: true, released: false });
  assert.equal(noBanco().leaseId, 'LB');
  assert.equal(fake.requests.some((q) => q.method === 'DELETE'), false, 'nem tenta apagar');
});

test('release atrasado depois de o sucessor adquirir não apaga o sucessor', async () => {
  await acquireLease(cliente(), IDS, dadosDe('LA', 'dA'));
  const sucessor = await acquireLease(cliente(), IDS, dadosDe('LB', 'dB', AGORA + SYNC.LEASE_TTL_MS + 1));
  assert.equal(sucessor.ok, true);
  const r = await releaseLease(cliente(), IDS, { leaseId: 'LA' });
  assert.deepEqual(r, { ok: true, released: false });
  assert.equal(noBanco().leaseId, 'LB');
});

test('rede caída devolve indisponivel nas três operações, sem lançar', async () => {
  const semRede = cliente({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const a = await acquireLease(semRede, IDS, dadosDe('LA', 'dA'));
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'indisponivel');
  assert.equal(a.code, 'indisponivel');
  assert.equal(typeof a.motivo, 'string');
  const r = await renewLease(semRede, IDS, { leaseId: 'LA', nowMs: AGORA });
  assert.equal(r.reason, 'indisponivel');
  const l = await releaseLease(semRede, IDS, { leaseId: 'LA' });
  assert.equal(l.ok, false);
  assert.equal(l.reason, 'indisponivel');
});

test('token recusado também é indisponivel (nunca libera nem toma)', async () => {
  const c = cliente({ getIdToken: async () => ({ ok: true, idToken: 'errado' }) });
  const a = await acquireLease(c, IDS, dadosDe('LA', 'dA'));
  assert.equal(a.reason, 'indisponivel');
  assert.equal(a.code, 'nao_autorizado');
});

// O ETag é o que prova a posse na escrita; sem ele o PUT sairia sem if-match, ou seja,
// tomando o lease de quem estiver com ele. Proxy e servidor mal configurado engolem
// cabeçalho, então "sem ETag" não é hipótese de laboratório.
test('sem ETag na resposta, adquirir, renovar e soltar viram indisponivel sem escrever nada', async () => {
  const c = cliente();
  await c.put(leasePath('u1', IDS.accountHash, IDS.prHash), buildLease(dadosDe('L-outro', 'outro')));
  fake.requests.length = 0;
  fake.setSemEtag(true);
  try {
    const desfechos = [
      await acquireLease(c, IDS, dadosDe('L1', 'dev-1')),
      await renewLease(c, IDS, { leaseId: 'L-outro', nowMs: AGORA }),
      await releaseLease(c, IDS, { leaseId: 'L-outro' }),
    ];
    for (const r of desfechos) {
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'indisponivel');
      assert.equal(r.code, 'resposta_invalida');
    }
    assert.deepEqual(fake.requests.filter((q) => q.method !== 'GET').map((q) => q.method), [], 'nenhuma escrita sem prova de posse');
    assert.equal(noBanco().leaseId, 'L-outro');
  } finally {
    fake.setSemEtag(false);
  }
});

// A borda existe nos DOIS lados: aqui e na regra do banco (firebase/database.rules.json),
// que autoriza a tomada quando `expiresAt <= now`. Os dois usavam sinais diferentes (o
// cliente `<=`, a regra `<`), e no milissegundo exato o cliente tentava uma escrita que
// a regra recusava. Nenhuma suíte executa as regras, então o que trava o lado de cá é
// este teste, e o lado de lá é o roteiro manual do firebase/README.md.
test('expirado é <=, e o milissegundo exato já conta como expirado', () => {
  const agora = 1_000_000;
  const vivo = { leaseId: 'L', deviceId: 'd', expiresAt: agora + 1 };
  const naBorda = { leaseId: 'L', deviceId: 'd', expiresAt: agora };
  assert.equal(leaseAcquirable(vivo, { leaseId: 'outro', nowMs: agora }), 'alheio');
  assert.equal(leaseAcquirable(naBorda, { leaseId: 'outro', nowMs: agora }), 'expirado');
});
