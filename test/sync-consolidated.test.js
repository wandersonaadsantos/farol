// Consumo consolidado entre aparelhos: a projeção pura (lib/sync/consolidated.js) e o
// caminho do engine até ela (GET /api/sync/consolidated, POST /api/sync/consolidate).
// A janela corta pelo dia de Brasília e a leitura nunca sai de /users/{uid}: o
// consolidado de uma pessoa não pode trazer o aparelho de outra.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import. consolidated.js é puro e entra estático.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-consolidated-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC, TEMPOS } from '../lib/constants.js';
import { consolidatedSummary } from '../lib/sync/consolidated.js';
import { usageDayKeysBack } from '../ui/pure.js';

const { Engine } = await import('../server.js');
const { eventIdFor } = await import('../lib/sync/keys.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
const rtdb = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// 15/01/2027 02:00 UTC = 14/01/2027 23:00 em Brasília: o dia UTC e o de Brasília divergem
const AGORA = Date.UTC(2027, 0, 15, 2, 0, 0);

function ev(at, extra = {}) {
  return { at, kind: 'review', costUsd: 1, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: 'medido', ...extra };
}

test('janela corta pelo dia de Brasília, não pelo UTC nem pelo dia gravado', () => {
  const eventos = {
    d1: {
      // 08/01 00:30 em Brasília (03:30 UTC): primeiro dia da janela de 7 dias que termina hoje, 14/01
      dentro: ev(Date.UTC(2027, 0, 8, 3, 30), { day: '2027-01-01' }),
      // 07/01 23:30 em Brasília, embora já seja 08/01 no UTC: fora
      fora: ev(Date.UTC(2027, 0, 8, 2, 30), { day: '2027-01-08' }),
    },
  };
  const r = consolidatedSummary(eventos, {}, { days: 7, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.equal(r.totals.sessions, 1);
  assert.deepEqual(r.series, [{ day: '2027-01-08', costUsd: 1, sessions: 1 }]);
  const tudo = consolidatedSummary(eventos, {}, { days: 0, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.equal(tudo.totals.sessions, 2, 'days 0 é o histórico inteiro');
  assert.deepEqual(tudo.series.map((s) => s.day), ['2027-01-07', '2027-01-08'], 'série em ordem de dia');
});

// "Este aparelho" (usageDayKeysBack, dias locais) e "Todos os aparelhos" precisam somar
// a MESMA quantidade de dias civis, senão trocar o segmentado num aparelho só já
// mostra totais diferentes para a mesma janela. A comparação é pela contagem porque o
// dia local depende do fuso do processo e o consolidado corta sempre em Brasília.
test('janela de n dias soma n dias civis, como a aba local', () => {
  const d1 = {};
  // um evento ao meio-dia de Brasília (15:00 UTC) em cada um dos 40 dias até hoje, 14/01
  for (let i = 0; i < 40; i++) d1[`e${i}`] = ev(Date.UTC(2027, 0, 14, 15, 0) - i * TEMPOS.DIA_MS);
  for (const n of [7, 15, 30]) {
    const r = consolidatedSummary({ d1 }, {}, { days: n, agoraMs: AGORA, euDeviceId: 'd1' });
    assert.equal(r.series.length, usageDayKeysBack(n, AGORA).length, `${n} dias: mesma contagem de dias da aba local`);
    assert.equal(r.totals.sessions, n, `${n} dias: um evento por dia`);
    assert.equal(r.series.at(-1).day, '2027-01-14', 'o último dia é hoje em Brasília');
  }
});

test('aparelhos: euMesmo, nome, somas por aparelho e quem não gastou aparece zerado', () => {
  const eventos = {
    d1: { a: ev(AGORA - 1000, { costUsd: 2, inputTokens: 5 }), b: ev(AGORA - 500, { costUsd: 3, inputTokens: 7 }) },
    d2: { c: ev(AGORA - 2000, { costUsd: 10 }) },
  };
  const devices = { d1: { name: 'Mesa' }, d2: { name: 'Celular' }, d3: { name: 'Notebook' } };
  const r = consolidatedSummary(eventos, devices, { days: 30, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.deepEqual(r.devices.map((d) => d.deviceId), ['d1', 'd2', 'd3'], 'eu primeiro, depois quem gastou mais');
  const [eu, cel, nb] = r.devices;
  assert.equal(eu.euMesmo, true);
  assert.equal(eu.name, 'Mesa');
  assert.equal(eu.sessions, 2);
  assert.equal(eu.costUsd, 5);
  assert.equal(eu.inputTokens, 12);
  assert.equal(eu.lastAt, AGORA - 500);
  assert.equal(cel.euMesmo, false);
  assert.equal(cel.costUsd, 10);
  assert.deepEqual([nb.sessions, nb.costUsd, nb.lastAt], [0, 0, 0]);
});

test('totais separam medido, estimado e sem base', () => {
  const eventos = {
    d1: {
      a: ev(AGORA, { costUsd: 4, costSource: 'medido' }),
      b: ev(AGORA, { costUsd: 1.5, costSource: 'estimado' }),
      c: ev(AGORA, { costUsd: 0, costSource: 'sem-base' }),
      d: ev(AGORA, { costUsd: 2, costSource: undefined }),
    },
  };
  const r = consolidatedSummary(eventos, {}, { days: 7, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.deepEqual(r.totals, {
    sessions: 4, costUsd: 7.5,
    medido: { sessions: 2, costUsd: 6 }, estimado: { sessions: 1, costUsd: 1.5 }, semBase: { sessions: 1, costUsd: 0 },
  });
});

test('entrada torta não derruba a projeção', () => {
  const r = consolidatedSummary({ d1: 'lixo', d2: { x: null, y: [1], z: ev(AGORA) } }, null, { days: 7, agoraMs: AGORA });
  assert.equal(r.totals.sessions, 1);
  assert.equal(consolidatedSummary(null, null, { days: 7, agoraMs: AGORA }).totals.sessions, 0);
});

// ---------- engine e rotas ----------

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

async function salvarSync(engine, cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

const engine = new Engine();
engine.sync.fetchImpl = fetchDosDubles;

test('consolidação desligada responde desligado e não lê o banco', async () => {
  await salvarSync(engine, syncCfg());
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const antes = rtdb.requests.length;
  const r = await engine.syncConsolidated('7');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'desligado');
  const c = await engine.syncConsolidate();
  assert.equal(c.ok, false);
  assert.equal(c.code, 'desligado');
  assert.equal(rtdb.requests.length, antes);
});

test('outro UID nunca aparece: a leitura é sempre em /users/{uid}', async () => {
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  const eu = engine.sync.deviceId;
  const arvore = rtdb.tree();
  arvore.users.u1.devices.celular = { name: 'Celular', lastSeenAt: AGORA };
  arvore.users.u1.usageEvents = { celular: { e1: ev(Date.now() - 1000, { costUsd: 3 }) } };
  arvore.users.u2 = { devices: { intruso: { name: 'Aparelho de outra pessoa' } }, usageEvents: { intruso: { e9: ev(Date.now(), { costUsd: 99 }) } } };
  rtdb.setTree(arvore);
  const antes = rtdb.requests.length;

  const r = await engine.syncConsolidated('30');
  assert.equal(r.ok, true);
  const ids = r.resumo.devices.map((d) => d.deviceId);
  assert.ok(ids.includes(eu) && ids.includes('celular'));
  assert.equal(ids.includes('intruso'), false);
  assert.equal(r.resumo.totals.costUsd >= 3 && r.resumo.totals.costUsd < 99, true);
  assert.equal(r.resumo.devices[0].euMesmo, true);
  const leituras = rtdb.requests.slice(antes);
  assert.ok(leituras.length > 0);
  for (const q of leituras) assert.ok(q.path.startsWith('/users/u1/'), `leitura fora do próprio uid: ${q.path}`);
});

test('consolidate: zera o cursor, reenfileira o histórico inteiro e envia sem duplicar', async () => {
  engine.recordUsage('a1', 'fulano', { usage: { output_tokens: 3 }, total_cost_usd: 0.25 }, 'opus', 'p1', 'o/r#1');
  engine.recordUsage('a2', 'fulano', { usage: { output_tokens: 4 }, total_cost_usd: 0.5 }, 'opus', 'p1', 'o/r#2');
  await engine.syncTick();
  const eu = engine.sync.deviceId;
  const remoto = () => Object.keys((rtdb.tree().users.u1.usageEvents || {})[eu] || {});
  const antes = remoto().length;
  assert.equal(antes, engine.usageSessions.sessions.length);

  const c = await engine.syncConsolidate();
  assert.equal(c.ok, true);
  assert.equal(c.enfileirados, engine.usageSessions.sessions.length, 'todo o histórico volta pra fila');
  assert.equal(c.pendentes, 0, 'e sai na mesma chamada');
  assert.deepEqual(remoto().sort(), engine.usageSessions.sessions.map((s) => eventIdFor(s, eu)).sort(), 'mesmo conjunto de eventos, nenhum a mais');
});

test('rotas: envelope nas duas, janela saneada e nada de e-mail ou token na resposta', async () => {
  const { startServer } = await import('../lib/http-server.js');
  engine.config.port = 0;
  const server = startServer(engine);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const texto = await (await fetch(`${base}/api/sync/consolidated?days=7`)).text();
    const r = JSON.parse(texto);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r).sort(), ['ok', 'resumo']);
    assert.ok(Array.isArray(r.resumo.devices) && Array.isArray(r.resumo.series));
    assert.equal(texto.includes(EMAIL), false);
    assert.equal(texto.includes('auth='), false);
    for (const t of identity.tokens.idTokens) assert.equal(texto.includes(t), false);

    const torta = JSON.parse(await (await fetch(`${base}/api/sync/consolidated?days=abc`)).text());
    assert.equal(torta.ok, true, 'janela inválida cai no padrão em vez de falhar');

    const post = await fetch(`${base}/api/sync/consolidate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1' }, body: '{}' });
    const c = JSON.parse(await post.text());
    assert.deepEqual(Object.keys(c).sort(), ['enfileirados', 'ok', 'pendentes']);

    await salvarSync(engine, syncCfg());
    const off = JSON.parse(await (await fetch(`${base}/api/sync/consolidated?days=7`)).text());
    assert.deepEqual(Object.keys(off).sort(), ['code', 'motivo', 'ok']);
    assert.equal(off.code, 'desligado');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('custo desconhecido entra no balde sem base do consolidado, nunca no medido', () => {
  const eventos = { d1: { a: ev(AGORA, { costUsd: 0, costSource: 'desconhecido' }) } };
  const r = consolidatedSummary(eventos, {}, { days: 7, agoraMs: AGORA, euDeviceId: 'd1' });
  assert.deepEqual(r.totals.semBase, { sessions: 1, costUsd: 0 });
  assert.deepEqual(r.totals.medido, { sessions: 0, costUsd: 0 });
});
