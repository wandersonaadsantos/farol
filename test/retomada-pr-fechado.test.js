// Referência de retomada de PR mergeado ou fechado sai do inflight.json (25/09/2026).
//
// O lib/engine/retomada-duravel.js lista "PR mergeado ou fechado" entre os desfechos que
// consomem a entrada, mas só a repescagem do retry fazia isso, e o mapa do retry é memória:
// depois de um reinício, a entrada ficava no disco e ninguém mais perguntava pelo PR. Medido
// no Farol do mantenedor: biudtech/engine-ai#224 ficou "pendente" no inflight.json de 18/09
// até 25/09, uma semana depois do merge. A varredura do ciclo pergunta o estado do PR que
// sumiu da fila, no máximo uma vez por hora, e só consome com prova (MERGED ou CLOSED).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-retomada-fechado-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const varredura = (await import('../lib/engine/retomada-varredura.js')).default;
const { Engine } = await import('../server.js');
const { INFLIGHT_FILE } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = { key: 'o/r#224', url: 'https://github.com/o/r/pull/224', title: 'x', author: 'y', kind: 'auto', estado: 'pendente', retomarSid: '16a12d8d-3224-44d7-b57c-8545a1c11085' };

function engineCom(estadoDoPr) {
  const e = new Engine();
  e.retomadas = new Map([[PR.key, { ...PR }]]);
  e.queue = [];
  e.perguntas = [];
  e.prState = async (pr) => { e.perguntas.push(pr.key); return estadoDoPr; };
  return e;
}

function noArquivo() {
  return JSON.parse(fs.readFileSync(INFLIGHT_FILE, 'utf8')).map((x) => x.key);
}

test('PR mergeado sai do mapa e do inflight.json', async () => {
  const e = engineCom('MERGED');
  e.writeInflight();
  assert.deepEqual(noArquivo(), [PR.key]);
  await varredura.varrerFechadas(e);
  assert.equal(e.retomadas.has(PR.key), false);
  assert.deepEqual(noArquivo(), [], 'o arquivo é regravado na hora, não no próximo evento de revisão');
});

test('PR fechado sem merge também sai', async () => {
  const e = engineCom('CLOSED');
  await varredura.varrerFechadas(e);
  assert.equal(e.retomadas.has(PR.key), false);
});

test('PR aberto fica, e sem prova (rede, token) também fica', async () => {
  for (const estado of ['OPEN', null]) {
    const e = engineCom(estado);
    await varredura.varrerFechadas(e);
    assert.equal(e.retomadas.has(PR.key), true, `estado ${estado}`);
  }
});

test('PR que ainda está na fila deste ciclo não custa pergunta nenhuma: está aberto', async () => {
  const e = engineCom('MERGED');
  e.queue = [{ key: PR.key }];
  await varredura.varrerFechadas(e);
  assert.deepEqual(e.perguntas, []);
  assert.equal(e.retomadas.has(PR.key), true);
});

test('revisão rodando ou na fila de revisão também não é tocada', async () => {
  const e = engineCom('MERGED');
  e.activeReviews.set('s1', { mode: 'auto', pr: { key: PR.key } });
  await varredura.varrerFechadas(e);
  const e2 = engineCom('MERGED');
  e2.headlessQueue.push({ key: PR.key });
  await varredura.varrerFechadas(e2);
  assert.deepEqual([...e.perguntas, ...e2.perguntas], []);
});

test('o mesmo PR é perguntado no máximo uma vez por intervalo', async () => {
  const e = engineCom('OPEN');
  const t0 = 1_000_000;
  await varredura.varrerFechadas(e, t0);
  await varredura.varrerFechadas(e, t0 + 1000);
  assert.equal(e.perguntas.length, 1);
  await varredura.varrerFechadas(e, t0 + TEMPOS.RETOMADA_CONFERIR_MS + 1);
  assert.equal(e.perguntas.length, 2);
});

test('pergunta que falha não derruba o ciclo', async () => {
  const e = engineCom('MERGED');
  e.prState = async () => { throw new Error('gh fora'); };
  await varredura.varrerFechadas(e);
  assert.equal(e.retomadas.has(PR.key), true);
});

test('o ciclo do engine chama a varredura', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
  assert.match(fonte, /retomadaVarredura\.varrerFechadas\(this\)/);
});
