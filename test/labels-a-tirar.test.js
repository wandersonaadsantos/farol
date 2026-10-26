// Label `<conta>:revisando` cuja remoção falhou no fim da revisão (10/10/2026).
//
// Antes: o WARN era tudo, e a label ficava no PR até a próxima revisão dele pela mesma conta
// (24h28 num PR real). Agora a falha fica anotada em disco e o check() tenta de novo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-labels-a-tirar-'));

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { anotar, tirarPendentes, ARQUIVO } = await import('../lib/engine/labels-a-tirar.js');
const { removeInProgressLabel } = await import('../lib/engine/review.js');

const runReal = io.run;
after(() => { io.run = runReal; fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });
beforeEach(() => { fs.rmSync(ARQUIVO, { force: true }); });

const PR = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7' };

function motor(extra = {}) {
  const logs = [];
  return {
    logs,
    accountForPr: () => 'eu', tokenFor: () => 'tok', ghEnv: () => ({}),
    activeReviews: new Map(),
    log: (nivel, msg) => logs.push(`${nivel} ${msg}`),
    ...extra,
  };
}

function lerArquivo() { return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); }

test('remoção que falha fica anotada em disco, com o WARN dizendo que tenta de novo', async () => {
  io.run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'dial tcp: i/o timeout' });
  const e = motor();
  await removeInProgressLabel(e, PR, 'eu:revisando');
  assert.match(e.logs[0], /não saiu de acme\/app#7; tento de novo/);
  assert.equal(Object.values(lerArquivo())[0].label, 'eu:revisando');
});

test('remoção que dá certo não anota nada', async () => {
  io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  await removeInProgressLabel(motor(), PR, 'eu:revisando');
  assert.deepEqual(lerArquivo(), {});
});

test('o ciclo seguinte tira a label e limpa a anotação, inclusive depois de reiniciar', async () => {
  io.run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'rede' });
  await removeInProgressLabel(motor(), PR, 'eu:revisando');
  const chamadas = [];
  // motor novo = app reiniciado: a anotação vem do disco
  await tirarPendentes(motor(), async (_c, args) => { chamadas.push(args.join(' ')); return { ok: true, stderr: '' }; });
  assert.deepEqual(chamadas, [`pr edit ${PR.url} --remove-label eu:revisando`]);
  assert.deepEqual(lerArquivo(), {});
});

test('falha de novo mantém a anotação; label que já não está lá encerra', async () => {
  const e = motor();
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: Date.now() } };
  await tirarPendentes(e, async () => ({ ok: false, stderr: 'rede' }));
  assert.equal(Object.values(e.labelsATirar).length, 1);
  await tirarPendentes(e, async (_cmd, args) => args[1] === 'view' ? { ok: true, stdout: '{"labels":[]}' } : { ok: false, stderr: "'eu:revisando' not found" });
  assert.deepEqual(e.labelsATirar, {});
});

test('revisão viva deste aparelho no mesmo PR adia: a label é dela', async () => {
  const e = motor();
  e.activeReviews.set('s1', { mode: 'review', keys: [PR.key] });
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: Date.now() } };
  let chamou = false;
  await tirarPendentes(e, async () => { chamou = true; return { ok: true }; });
  assert.equal(chamou, false);
  assert.ok(e.labelsATirar[PR.key]);
});

test('conta sem token não chama o gh e não perde a anotação', async () => {
  const e = motor({ tokenFor: () => '' });
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: Date.now() } };
  let chamou = false;
  await tirarPendentes(e, async () => { chamou = true; return { ok: true }; });
  assert.equal(chamou, false);
  assert.ok(e.labelsATirar[PR.key]);
});

test('pendência antiga continua sendo tentada em vez de desaparecer após sete dias', async () => {
  const e = motor();
  const agora = Date.now();
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: agora - 8 * 24 * 3600 * 1000 } };
  let chamou = false;
  await tirarPendentes(e, async () => { chamou = true; return { ok: true }; }, agora);
  assert.equal(chamou, true);
  assert.deepEqual(e.labelsATirar, {});
});

test('pendências de duas contas no mesmo PR são preservadas e removidas individualmente', async () => {
  const e = motor();
  anotar(e, PR, 'eu:revisando'); anotar(e, PR, 'outra:revisando');
  assert.equal(Object.values(lerArquivo()).length, 2);
  const seen = [];
  await tirarPendentes(e, async (_cmd, args) => { seen.push(args.at(-1)); return { ok: true }; });
  assert.deepEqual(seen.sort(), ['eu:revisando', 'outra:revisando']);
  assert.deepEqual(lerArquivo(), {});
});

test('404 sem consulta conclusiva não é prova de que a tag saiu', async () => {
  const e = motor(); anotar(e, PR, 'eu:revisando');
  await tirarPendentes(e, async () => ({ ok: false, stderr: 'not found' }));
  assert.equal(Object.values(lerArquivo()).length, 1);
});

test('limpeza adiada disputa o lease e preserva a revisão de outro aparelho', async () => {
  const { startFakeRtdb } = await import('./helpers/fake-rtdb.js');
  const { createRtdbClient } = await import('../lib/sync/rtdb.js');
  const { acquireLease, releaseLease, leasePath } = await import('../lib/sync/lease.js');
  const { accountHash, prHash } = await import('../lib/sync/keys.js');
  const fake = await startFakeRtdb({ token: 'synthetic-token' });
  const client = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'synthetic-token' }) });
  const ids = { uid: 'u1', accountHash: accountHash('eu'), prHash: prHash(PR.key) };
  const now = Date.now();
  const data = { leaseId: 'other', deviceId: 'other-device', operationKind: 'review', headSha: 'a'.repeat(40), nowMs: now, farolVersion: '2.77.9' };
  try {
    assert.equal((await acquireLease(client, ids, data)).ok, true);
    const e = motor({ syncCoordenacaoAtiva: () => true, sync: { status: 'conectado', client, uid: 'u1', deviceId: 'this-device' } });
    anotar(e, PR, 'eu:revisando'); let called = 0;
    await tirarPendentes(e, async () => { called++; return { ok: true }; }, now);
    assert.equal(called, 0); assert.equal(Object.values(lerArquivo()).length, 1);
    await releaseLease(client, ids, { leaseId: 'other' });
    await tirarPendentes(e, async () => {
      called++;
      const concurrent = await acquireLease(client, ids, { ...data, leaseId: 'next-review', nowMs: Date.now() });
      assert.equal(concurrent.ok, false); assert.equal(concurrent.reason, 'alheio');
      return { ok: true };
    }, Date.now());
    assert.equal(called, 1); assert.deepEqual(lerArquivo(), {});
    assert.equal((await client.get(leasePath(ids.uid, ids.accountHash, ids.prHash))).data, null);
  } finally { await fake.close(); }
});

test('coordenação indisponível adia limpeza automática sem perder a pendência', async () => {
  const e = motor({ syncCoordenacaoAtiva: () => true, sync: { status: 'desconectado' } });
  anotar(e, PR, 'eu:revisando'); let called = false;
  await tirarPendentes(e, async () => { called = true; return { ok: true }; });
  assert.equal(called, false); assert.equal(Object.values(lerArquivo()).length, 1);
});

test('caixa e representação antiga não duplicam pendência da mesma tag', () => {
  const e = motor();
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'Eu:Revisando', desde: 100 } };
  anotar(e, PR, 'eu:revisando', 200);
  assert.equal(Object.values(lerArquivo()).length, 1);
  assert.equal(Object.values(lerArquivo())[0].desde, 100);
});

test('arquivo de pendências inválido não provoca chamadas ao GitHub', async () => {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify({ invalid: null, broken: { key: 5, url: PR.url, label: 'eu:revisando' }, foreign: { key: PR.key, url: 'https://evil.invalid/acme/app/pull/7', label: 'eu:revisando' } }));
  let called = false;
  await tirarPendentes(motor(), async () => { called = true; return { ok: true }; });
  assert.equal(called, false);
});

test('uma revisão local com outra caixa na chave também adia a limpeza', async () => {
  const e = motor(); e.activeReviews.set('s', { mode: 'auto', keys: [PR.key.toUpperCase()] });
  anotar(e, PR, 'eu:revisando'); let called = false;
  await tirarPendentes(e, async () => { called = true; return { ok: true }; });
  assert.equal(called, false); assert.equal(Object.values(lerArquivo()).length, 1);
});

test('limpeza manual adiada reserva a dona da tag, mas autentica com a conta que remove', async () => {
  const { startFakeRtdb } = await import('./helpers/fake-rtdb.js');
  const { createRtdbClient } = await import('../lib/sync/rtdb.js');
  const { acquireLease, releaseLease } = await import('../lib/sync/lease.js');
  const { accountHash, prHash } = await import('../lib/sync/keys.js');
  const fake = await startFakeRtdb({ token: 'synthetic-token' });
  const client = createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: 'synthetic-token' }) });
  const ids = { uid: 'u1', accountHash: accountHash('colleague'), prHash: prHash(PR.key) };
  const data = { leaseId: 'other-review', deviceId: 'other-device', operationKind: 'review', headSha: 'a'.repeat(40), nowMs: Date.now(), farolVersion: '2.77.9' };
  try {
    assert.equal((await acquireLease(client, ids, data)).ok, true);
    const e = motor({ tokenFor: account => account === 'eu' ? 'synthetic-token' : '', ghEnv: account => ({ ACTOR: account }), syncCoordenacaoAtiva: () => true, sync: { status: 'conectado', client, uid: 'u1', deviceId: 'this-device' } });
    anotar(e, PR, 'colleague:revisando', Date.now(), 'eu'); let called = 0;
    const run = async (_cmd, args, options) => { called++; assert.equal(options.env.ACTOR, 'eu'); assert.equal(args.at(-1), 'colleague:revisando'); return { ok: true }; };
    await tirarPendentes(e, run); assert.equal(called, 0); assert.equal(Object.values(lerArquivo()).length, 1);
    await releaseLease(client, ids, { leaseId: 'other-review' });
    await tirarPendentes(e, run); assert.equal(called, 1); assert.deepEqual(lerArquivo(), {});
  } finally { await fake.close(); }
});
