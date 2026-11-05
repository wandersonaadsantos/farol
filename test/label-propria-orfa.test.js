// Label própria sem dono some sozinha (A3): o relógio local da `<conta>:revisando` do próprio Farol.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-label-propria-'));

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { carimbarEPodar, tirarOrfas, ARQUIVO } = await import('../lib/engine/label-propria-orfa.js');
const { ARQUIVO: PENDENTES } = await import('../lib/engine/labels-a-tirar.js');
const { leaseVivo } = await import('../lib/sync/lease.js');
const { TEMPOS } = await import('../lib/constants.js');

after(() => fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }));
beforeEach(() => { fs.rmSync(ARQUIVO, { force: true }); fs.rmSync(PENDENTES, { force: true }); });

const T0 = 1_800_000_000_000;
const PR = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', labels: ['eu:revisando'] };

function motor(extra = {}) {
  return {
    logs: [], accountForPr: () => 'eu', tokenFor: () => 'tok', ghEnv: () => ({}),
    activeReviews: new Map(), labelPropriaVistaDesde: {},
    log(n, m) { this.logs.push(`${n} ${m}`); },
    ...extra,
  };
}

test('carimba a primeira vez que vê a própria label sem sessão e sem pendência; preserva o carimbo depois', async () => {
  const e = motor();
  await carimbarEPodar(e, [PR], T0);
  assert.equal(e.labelPropriaVistaDesde[PR.key], T0);
  await carimbarEPodar(e, [PR], T0 + 5000);
  assert.equal(e.labelPropriaVistaDesde[PR.key], T0);
  assert.equal(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))[PR.key], T0);
});

test('label que sumiu ou PR que saiu do panorama perde o carimbo', async () => {
  const e = motor();
  await carimbarEPodar(e, [PR], T0);
  await carimbarEPodar(e, [{ ...PR, labels: [] }], T0 + 1);
  assert.deepEqual(e.labelPropriaVistaDesde, {});
  await carimbarEPodar(e, [PR], T0 + 2);
  await carimbarEPodar(e, [], T0 + 3);
  assert.deepEqual(e.labelPropriaVistaDesde, {});
});

test('com sessão viva deste aparelho no PR, não carimba', async () => {
  const e = motor({ activeReviews: new Map([['s1', { keys: [PR.key] }]]) });
  await carimbarEPodar(e, [PR], T0);
  assert.deepEqual(e.labelPropriaVistaDesde, {});
});

test('passado o TTL de 3 h, entra em labels-a-tirar e remove', async () => {
  const e = motor();
  await carimbarEPodar(e, [PR], T0);
  const chamadas = [];
  const run = async (_c, args) => { chamadas.push(args.join(' ')); return { ok: true, stderr: '' }; };
  await tirarOrfas(e, [PR], { agora: T0 + TEMPOS.SINAL_REVISAO_TTL_MS - 1, run });
  assert.deepEqual(chamadas, []);
  await tirarOrfas(e, [PR], { agora: T0 + TEMPOS.SINAL_REVISAO_TTL_MS, run });
  assert.deepEqual(chamadas, [`pr edit ${PR.url} --remove-label eu:revisando`]);
});

const sync = (get) => ({ syncCoordenacaoAtiva: () => true, sync: { status: 'conectado', uid: 'u', deviceId: 'd', client: { get } } });

test('com coordenação ligada e lease vivo de outro aparelho, não carimba nem remove', async () => {
  const e = motor(sync(async () => ({ ok: true, data: { leaseId: 'x', expiresAt: T0 + 1e9 } })));
  const chamadas = [];
  const run = async (...a) => { chamadas.push(a); return { ok: true }; };
  await tirarOrfas(e, [PR], { agora: T0, run });
  await tirarOrfas(e, [PR], { agora: T0 + 10 * TEMPOS.SINAL_REVISAO_TTL_MS, run });
  assert.deepEqual(e.labelPropriaVistaDesde, {});
  assert.deepEqual(chamadas, []);
});

test('leitura do lease que falha conta como vivo', async () => {
  const ids = { uid: 'u', accountHash: 'a', prHash: 'p' };
  assert.equal(await leaseVivo({ get: async () => ({ ok: false }) }, ids, T0), null);
  const e = motor(sync(async () => ({ ok: false, code: 'x' })));
  await tirarOrfas(e, [PR], { agora: T0, run: async () => ({ ok: true }) });
  assert.deepEqual(e.labelPropriaVistaDesde, {});
});

test('leaseVivo: ausente e expirado são false; vigente e sem expiresAt são true', async () => {
  const ids = { uid: 'u', accountHash: 'a', prHash: 'p' };
  const com = (data) => ({ get: async () => ({ ok: true, data }) });
  assert.equal(await leaseVivo(com(null), ids, T0), false);
  assert.equal(await leaseVivo(com({ leaseId: 'x', expiresAt: T0 - 1 }), ids, T0), false);
  assert.equal(await leaseVivo(com({ leaseId: 'x', expiresAt: T0 + 1 }), ids, T0), true);
  assert.equal(await leaseVivo(com({ leaseId: 'x' }), ids, T0), true);
});
