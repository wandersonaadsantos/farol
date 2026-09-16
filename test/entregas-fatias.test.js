// Busca fatiada da aba Entregas. A busca do GitHub devolve no maximo 1000 por
// consulta (o gh recusa --limit acima disso), e o teto por org e 5000: a janela e
// quebrada por data de merge SO quando uma fatia volta cheia. Aqui travam as duas
// metades: a funcao pura (entregas-fatias.js) e o caminho real do fetchDeliveries,
// com io.run respondendo a partir de um conjunto sintetico de merges.
// ATENCAO a ordem: FAROL_HOME antes de qualquer modulo que alcance lib/paths.js
// (test/test-isolation.test.js), e o patch de io.run antes do server.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-entregas-fatias-' + process.pid);

const io = (await import('../lib/io.js')).default;
const chamadas = [];
let dataset = [];
let falharSe = () => false;
io.run = async (_cmd, args) => {
  chamadas.push(args);
  if (falharSe(args)) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
  const q = args.find(a => String(a).startsWith('merged:'));
  const [ini, fim] = q.slice('merged:'.length).split('..').map(s => Date.parse(s));
  const limite = Number(args[args.indexOf('--limit') + 1]);
  const dentro = dataset.filter(p => { const t = Date.parse(p.closedAt); return t >= ini && t <= fim; });
  return { ok: true, code: 0, stdout: JSON.stringify(dentro.slice(0, limite)), stderr: '' };
};

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { buscarFatiado, CONSULTA_MAX, FATIA_MINIMA_MS } = await import('../lib/engine/entregas-fatias.js');
const { DELIVERIES_LIMIT } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* temporario */ } });

beforeEach(() => { chamadas.length = 0; dataset = []; falharSe = () => false; });

// n merges espalhados de forma uniforme entre os instantes dados
function merges(n, iniMs, fimMs, repo = 'acme/app') {
  const passo = (fimMs - iniMs) / n;
  return Array.from({ length: n }, (_, i) => ({
    url: `https://github.com/${repo}/pull/${i + 1}`, title: `PR ${i + 1}`,
    author: { login: 'alice' }, number: i + 1, repository: { nameWithOwner: repo },
    closedAt: new Date(Math.floor(iniMs + i * passo)).toISOString()
  }));
}

function engineComToken() {
  const e = new Engine();
  e.tokens = { me: 'tok' };
  e.token = 'tok';
  e.accountForOwner = () => 'me';
  e.log = () => {};
  return e;
}

function nenhumLimiteAcimaDoTeto() {
  for (const args of chamadas) {
    const limite = Number(args[args.indexOf('--limit') + 1]);
    assert.ok(limite >= 1 && limite <= 1000, `--limit ${limite} fora do que o gh aceita`);
  }
}

test('teto do GitHub por consulta e 1000 e o total por org e 5000', () => {
  assert.equal(CONSULTA_MAX, 1000);
  assert.equal(DELIVERIES_LIMIT, 5000);
});

test('janela que cabe numa consulta: uma chamada so, sem fatiar', async () => {
  const agora = Date.now();
  dataset = merges(300, agora - 6 * 24 * 3600 * 1000, agora - 1000);
  const data = await engineComToken().fetchDeliveries(7, 'acme');
  assert.equal(chamadas.length, 1);
  assert.equal(data.items.length, 300);
  assert.equal(data.capped, false);
  assert.equal(data.partial, false);
  assert.equal(data.limit, 5000);
  assert.match(chamadas[0].find(a => a.startsWith('merged:')), /^merged:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\.\.\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  nenhumLimiteAcimaDoTeto();
});

test('fatia cheia se divide e soma mais de 1000 sem duplicar', async () => {
  const agora = Date.now();
  dataset = merges(2500, agora - 6 * 24 * 3600 * 1000, agora - 1000);
  const data = await engineComToken().fetchDeliveries(7, 'acme');
  assert.ok(chamadas.length > 1, 'fatiou');
  assert.equal(data.items.length, 2500);
  assert.equal(new Set(data.items.map(i => i.key)).size, 2500, 'sem duplicata na fronteira das fatias');
  assert.equal(data.capped, false);
  assert.equal(data.partial, false);
  const datas = data.items.map(i => i.mergedAt);
  assert.deepEqual(datas, [...datas].sort().reverse(), 'ordenado por merge desc');
  nenhumLimiteAcimaDoTeto();
});

test('org acima de 5000 para no teto total e marca capped, ficando com os mais recentes', async () => {
  const agora = Date.now();
  dataset = merges(7000, agora - 28 * 24 * 3600 * 1000, agora - 1000);
  const data = await engineComToken().fetchDeliveries(30, 'acme');
  assert.equal(data.items.length, 5000);
  assert.equal(data.capped, true);
  const maisNovo = dataset.map(p => p.closedAt).sort().reverse()[0];
  assert.equal(data.items[0].mergedAt, maisNovo, 'a metade recente e buscada primeiro');
  nenhumLimiteAcimaDoTeto();
});

test('fatia minima ainda cheia marca capped (perda real)', async () => {
  const agora = Date.now();
  const inicio = agora - 3 * 3600 * 1000;
  // 1200 merges dentro de 10 minutos: nenhuma divisao ate a fatia minima faz caber
  dataset = merges(1200, inicio + 3600 * 1000, inicio + 3600 * 1000 + 600 * 1000);
  const buscar = async (ini, fim, limite) => {
    const r = await io.run('gh', ['search', 'prs', `merged:${ini}..${fim}`, '--limit', String(limite)]);
    return { ok: true, list: JSON.parse(r.stdout) };
  };
  const res = await buscarFatiado({ inicioMs: inicio, fimMs: agora, buscar, tetoTotal: 5000 });
  assert.equal(res.capped, true);
  assert.equal(res.partial, false);
  assert.equal(res.list.length, 1000);
  assert.ok(FATIA_MINIMA_MS >= 1000, 'fatia minima acima da precisao de segundo do qualificador');
  nenhumLimiteAcimaDoTeto();
});

test('falha do gh numa fatia marca partial e segue as outras', async () => {
  const agora = Date.now();
  dataset = merges(1500, agora - 6 * 24 * 3600 * 1000, agora - 1000);
  let n = 0;
  // falha a segunda consulta (a primeira metade recente); a primeira, cheia, so fatia
  falharSe = () => ++n === 2;
  const data = await engineComToken().fetchDeliveries(7, 'acme');
  assert.equal(data.partial, true);
  assert.ok(data.items.length > 0 && data.items.length < 1500, 'o que a outra metade trouxe entra');
  nenhumLimiteAcimaDoTeto();
});

test('JSON invalido conta como falha (partial), nunca como lista vazia valida', async () => {
  const original = io.run;
  io.run = async (_cmd, args) => { chamadas.push(args); return { ok: true, code: 0, stdout: 'nao e json', stderr: '' }; };
  try {
    const data = await engineComToken().fetchDeliveries(7, 'acme');
    assert.equal(data.partial, true);
    assert.equal(data.items.length, 0);
    assert.equal(chamadas.length, 1, 'falha nao fatia');
  } finally { io.run = original; }
});
