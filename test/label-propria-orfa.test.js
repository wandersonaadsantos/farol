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
  assert.deepEqual(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')), { observadaEm: T0 + 5000, vistas: { [PR.key]: T0 } });
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
  const chamadas = [];
  const run = async (_c, args) => { chamadas.push(args.join(' ')); return { ok: true, stderr: '' }; };
  // observação contínua: uma rodada a cada 5 min (o limite sem intervalo configurado é a folga de 10 min)
  for (let t = T0; t < T0 + TEMPOS.SINAL_REVISAO_TTL_MS; t += 5 * 60 * 1000) await tirarOrfas(e, [PR], { agora: t, run });
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

// Observação contínua (onda final, 05/11/2026): o relógio da label própria só corre enquanto este
// aparelho olha o PR a cada ciclo. Notebook fechado ou Farol parado por mais de alguns intervalos de
// polling recomeçam a contagem, senão o B que viu a label do A, dormiu e acordou depois de 3 h
// apagaria na hora a label de uma sessão nova do A.
const PASSO = 10 * 60 * 1000;
const comIntervalo = (extra = {}) => motor({ config: { intervalSeconds: 60 }, ...extra });
async function observar(e, de, ate, opcoes) {
  for (let t = de; t <= ate; t += PASSO) await tirarOrfas(e, [PR], { ...opcoes, agora: t });
}

test('intervalo sem observação maior que o limite recomeça o relógio, sem remover', async () => {
  const e = comIntervalo();
  const chamadas = [];
  const run = async (_c, args) => { chamadas.push(args.join(' ')); return { ok: true, stderr: '' }; };
  await tirarOrfas(e, [PR], { agora: T0, run });
  await tirarOrfas(e, [PR], { agora: T0 + TEMPOS.SINAL_REVISAO_TTL_MS, run });
  assert.deepEqual(chamadas, [], 'o salto de 3 h não conta como 3 h de label órfã');
  assert.equal(e.labelPropriaVistaDesde[PR.key], T0 + TEMPOS.SINAL_REVISAO_TTL_MS);
});

test('observação contínua por 3 h remove a label', async () => {
  const e = comIntervalo();
  const chamadas = [];
  const run = async (_c, args) => { chamadas.push(args.join(' ')); return { ok: true, stderr: '' }; };
  await observar(e, T0, T0 + TEMPOS.SINAL_REVISAO_TTL_MS, { run });
  assert.deepEqual(chamadas, [`pr edit ${PR.url} --remove-label eu:revisando`]);
});

test('reiniciar depois de um intervalo longo descarta o carimbo gravado', async () => {
  const e = comIntervalo();
  await tirarOrfas(e, [PR], { agora: T0, run: async () => ({ ok: true }) });
  const reiniciado = comIntervalo({ labelPropriaVistaDesde: undefined });
  const chamadas = [];
  await tirarOrfas(reiniciado, [PR], { agora: T0 + TEMPOS.SINAL_REVISAO_TTL_MS, run: async (...a) => { chamadas.push(a); return { ok: true }; } });
  assert.deepEqual(chamadas, []);
  assert.equal(reiniciado.labelPropriaVistaDesde[PR.key], T0 + TEMPOS.SINAL_REVISAO_TTL_MS);
});

test('reiniciar logo depois preserva o carimbo gravado', async () => {
  const e = comIntervalo();
  await tirarOrfas(e, [PR], { agora: T0, run: async () => ({ ok: true }) });
  const reiniciado = comIntervalo({ labelPropriaVistaDesde: undefined });
  await tirarOrfas(reiniciado, [PR], { agora: T0 + 60_000, run: async () => ({ ok: true }) });
  assert.equal(reiniciado.labelPropriaVistaDesde[PR.key], T0);
});

test('ao carregar, carimbo com mais de 2 x TTL é descartado', async () => {
  const agora = T0 + 3 * TEMPOS.SINAL_REVISAO_TTL_MS;
  fs.writeFileSync(ARQUIVO, JSON.stringify({ observadaEm: agora - 60_000, vistas: { [PR.key]: T0 } }));
  const e = comIntervalo({ labelPropriaVistaDesde: undefined });
  const chamadas = [];
  await tirarOrfas(e, [PR], { agora, run: async (...a) => { chamadas.push(a); return { ok: true }; } });
  assert.deepEqual(chamadas, []);
  assert.equal(e.labelPropriaVistaDesde[PR.key], agora);
});

// Com a coordenação ligada a remoção passa pelo mesmo CAS de lease da pendência comum: entre ler o
// lease ausente e remover, outro aparelho da mesma conta pode ter aberto uma revisão no PR.
function rtdb({ recusa = false } = {}) {
  let no = null, versao = 0;
  const ops = [];
  const client = {
    get: async () => ({ ok: true, data: no, etag: `e${versao}` }),
    put: async (_p, v, { ifMatch } = {}) => {
      ops.push('put');
      if (recusa || ifMatch !== `e${versao}`) return { ok: false, code: 'indisponivel' };
      no = v; versao++;
      return { ok: true, etag: `e${versao}` };
    },
    del: async (_p, { ifMatch } = {}) => {
      ops.push('del');
      if (ifMatch !== `e${versao}`) return { ok: false, code: 'indisponivel' };
      no = null; versao++;
      return { ok: true };
    },
  };
  return { ops, client };
}
const coordenado = (client) => ({ syncCoordenacaoAtiva: () => true, sync: { status: 'conectado', uid: 'u', deviceId: 'd', client } });

test('com coordenação, sem a posse do lease a órfã não é removida e fica pendente', async () => {
  const { client, ops } = rtdb({ recusa: true });
  const e = comIntervalo(coordenado(client));
  const chamadas = [];
  await observar(e, T0, T0 + TEMPOS.SINAL_REVISAO_TTL_MS, { run: async (...a) => { chamadas.push(a); return { ok: true }; } });
  assert.deepEqual(chamadas, [], 'sem o CAS, nenhum gh');
  assert.ok(ops.includes('put'), 'a remoção disputou o lease');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(PENDENTES, 'utf8'))).length, 1, 'a pendência segue para o próximo ciclo');
});

test('com coordenação e a posse do lease, remove e solta o lease', async () => {
  const { client, ops } = rtdb();
  const e = comIntervalo(coordenado(client));
  const chamadas = [];
  await observar(e, T0, T0 + TEMPOS.SINAL_REVISAO_TTL_MS, { run: async (_c, args) => { chamadas.push(args.join(' ')); return { ok: true, stderr: '' }; } });
  assert.deepEqual(chamadas, [`pr edit ${PR.url} --remove-label eu:revisando`]);
  assert.deepEqual(ops, ['put', 'del']);
  assert.deepEqual(e.labelPropriaVistaDesde, {});
});
