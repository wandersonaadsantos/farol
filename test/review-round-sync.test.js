import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-round-sync-'));
process.env.FAROL_HOME = home;
const { publishRound, readRemoteRounds } = await import('../lib/engine/review-round-sync.js');
const { prepareRoundReview } = await import('../lib/engine/review-rounds.js');
const { scopeFor, readRounds } = await import('../lib/engine/review-round-store.js');
const kek = (await import('../lib/sync/kek.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
after(() => fs.rmSync(home, { recursive: true, force: true }));

const scope = scopeFor('o/r#1', 'eu');
function round() {
  const findings = Array.from({ length: 75 }, (_, i) => ({ id: `b:f${i}`, severity: 'blocking', title: `Achado ${i}`, summary: '漢字'.repeat(1000), file: 'a.ts', line: 1, ref: null, status: null, evidence: '' }));
  return { schema: 1, id: 'e'.repeat(32), scope, parents: [], headSha: 'h1', baseSha: 'base', at: 1,
    findings, unresolved: findings, files: [{ path: 'a.ts', sha: 'blob1' }] };
}

function bank() {
  const nodes = new Map();
  const client = {
    put: async (key, value, options) => {
      assert.equal(options.ifMatch, 'null_etag');
      assert.ok(value.enc.length <= 48000, 'limite real do nó já existente');
      if (nodes.has(key)) return { ok: false, code: 'conflito' };
      nodes.set(key, value); return { ok: true };
    },
    get: async key => {
      if (nodes.has(key)) return { ok: true, data: nodes.get(key) };
      const data = {};
      for (const [k, v] of nodes) if (k.startsWith(key + '/')) data[k.slice(key.length + 1)] = v;
      return { ok: true, data };
    },
  };
  const engine = { config: { sync: { enabled: true, shared: { enabled: true } } }, accountForPr: () => 'eu', log: () => {},
    sync: { client, historicoDesde: 1, uid: 'u1', deviceId: 'd1', cur: 'g1', material: kek.novoMaterial(), devices: {} } };
  return { engine, nodes };
}

test('dois aparelhos recuperam 75 blockers grandes sem cortes, sempre cifrados', async () => {
  const { engine, nodes } = bank();
  const r = round();
  assert.equal((await publishRound(engine, r)).ok, true);
  assert.ok(nodes.size > 2, 'foi necessário fragmentar');
  assert.equal(JSON.stringify([...nodes]).includes('Achado 74'), false);
  const other = { ...engine, sync: { ...engine.sync, deviceId: 'd2' } };
  const restored = await readRemoteRounds(other, scope);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.rounds, [r]);
  const count = nodes.size;
  assert.equal((await publishRound(other, r)).ok, true, 'retentativa confirma conteúdo existente');
  assert.equal(nodes.size, count);
});

test('fragmento ausente ou adulterado impede afirmar memória completa', async () => {
  const { engine, nodes } = bank();
  await publishRound(engine, round());
  const fragment = [...nodes.keys()][0];
  const saved = nodes.get(fragment);
  nodes.delete(fragment);
  assert.equal((await readRemoteRounds(engine, scope)).ok, false);
  nodes.set(fragment, { ...saved, enc: saved.enc.slice(0, -4) + 'aaaa' });
  assert.equal((await readRemoteRounds(engine, scope)).ok, false);
});

test('falha antes do manifesto não vira rodada vazia e a retentativa repara o transporte', async () => {
  const { engine, nodes } = bank();
  const put = engine.sync.client.put;
  let calls = 0;
  engine.sync.client.put = async (...args) => (++calls === 2 ? { ok: false } : put(...args));
  assert.equal((await publishRound(engine, round())).ok, false);
  assert.equal((await readRemoteRounds(engine, scope)).ok, false);
  assert.equal(nodes.size, 1);
  engine.sync.client.put = put;
  assert.equal((await publishRound(engine, round())).ok, true);
  assert.equal((await readRemoteRounds(engine, scope)).ok, true);
});

test('memória não abre em outra conta, PR, uid ou chave', async () => {
  const { engine } = bank();
  await publishRound(engine, round());
  assert.equal((await readRemoteRounds(engine, scopeFor('o/r#2', 'eu'))).rounds.length, 0);
  const bad = { ...engine, sync: { ...engine.sync, material: { ...engine.sync.material, enc: kek.novoMaterial().enc } } };
  assert.equal((await readRemoteRounds(bad, scope)).ok, false);
});

test('executor antigo fica explicitamente incompatível, nunca presumido pronto', async () => {
  const { engine } = bank();
  engine.sync.devices.d2 = { name: 'antigo' };
  assert.match((await readRemoteRounds(engine, scope)).reason, /suporte/);
  const c = envelope.cifrar({ uid: 'u1', caminho: 'live/deviceStatus/d2', campo: 'capacidade', esquema: 'cap1',
    no: 'live/deviceStatus', cur: 'g1', material: engine.sync.material, r: 1, dados: { c: { reviewRoundsSchema: 1 } } });
  const get = engine.sync.client.get;
  engine.sync.client.get = async key => key.endsWith('/live/deviceStatus') ? { ok: true, data: { d2: { enc: c.enc, u: 1 } } } : get(key);
  assert.equal((await readRemoteRounds(engine, scope)).ok, true);
});

test('contexto do segundo aparelho herda a rodada pela mesma implementação usada na revisão', async () => {
  const { engine } = bank();
  await publishRound(engine, round());
  const ctx = await prepareRoundReview(engine, { key: 'o/r#1' }, 'h2', { baseSha: 'base' });
  assert.equal(ctx.parents.length, 1);
  assert.equal(ctx.parents[0].unresolved.length, 75);
  assert.equal(readRounds(scope).rounds.length, 1, 'cache persistido sobrevive a reinício');
});

test('ligar compartilhamento não exporta a memória anterior ao marco', async () => {
  const { engine, nodes } = bank();
  engine.sync.historicoDesde = 100;
  const result = await publishRound(engine, round());
  assert.equal(result.ok, false);
  assert.match(result.reason, /envio explícito/);
  assert.equal(nodes.size, 0);
});

test('identificador da sessão CLI e campos fora do contrato não viajam na memória', async () => {
  const { engine, nodes } = bank();
  const result = await publishRound(engine, { ...round(), sessionId: 'sessao-somente-local' });
  assert.equal(result.ok, false);
  assert.equal(nodes.size, 0);
});
