import test from 'node:test';
import assert from 'node:assert/strict';
import { quemCuida } from '../lib/sync/quem-cuida.js';
import telas from '../lib/engine/sync-telas.js';
import kek from '../lib/sync/kek.js';
import { acctTag, prTag } from '../lib/sync/tags.js';

const aparelhos = [
  { dev: 'adm', nome: 'PC', contasComToken: ['c1', 'c2'], observador: true },
  { dev: 'cel', nome: 'Celular', contasComToken: ['c1'], observador: false },
];
test('operação ao vivo manda', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [{ dev: 'cel', prTag: 'p', aparelho: 'Celular' }] }), { situacao: 'revisando', aparelho: 'Celular' });
});
test('executor com a conta cuida', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [] }), { situacao: 'cuida', aparelho: 'Celular' });
});
test('só o admin tem a conta: sem aparelho', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c2', prTag: 'p', aparelhos, operacoes: [] }), { situacao: 'sem-aparelho', aparelho: '' });
});
test('sem argumentos: sem aparelho, sem quebrar', () => {
  assert.deepEqual(quemCuida(), { situacao: 'sem-aparelho', aparelho: '' });
});

/* ---------- lib/engine/sync-telas.js: a projeção por PR, e o portão do observador ---------- */

const MATERIAL_ID = Buffer.alloc(32, 7).toString('base64url');
const LOGIN = 'wandersonaadsantos';

function engineDe({ observador, extra = {} } = {}) {
  const rt = {
    deviceId: 'adm', material: { id: MATERIAL_ID },
    devices: { adm: { name: 'PC' }, cel: { name: 'Celular' } },
    aparelhosDaFrota: [
      { dev: 'adm', nome: 'PC', contasComToken: ['ignorada'], observador: true },
      { dev: 'cel', nome: 'Celular', contasComToken: [acctTag(kek.bufferDe(MATERIAL_ID), LOGIN)], observador: false },
    ],
    andamentoRemoto: [],
    sinais: { admin: { dev: observador ? 'adm' : 'outro-aparelho' } },
    ...extra,
  };
  return {
    config: { sync: { enabled: true, shared: { enabled: true } } },
    sync: rt,
    queue: [{ key: 'o/r#1', url: 'https://x/1' }],
    accountForPr: () => LOGIN,
  };
}

test('projecaoDasTelas: só o admin ganha quemCuida, com a situação de cada PR da fila', () => {
  const admin = telas.projecaoDasTelas(engineDe({ observador: true }));
  assert.deepEqual(admin.quemCuida, { 'o/r#1': { situacao: 'cuida', aparelho: 'Celular' } });

  const executor = telas.projecaoDasTelas(engineDe({ observador: false }));
  assert.equal(Object.hasOwn(executor, 'quemCuida'), false, 'quem executa não ganha o campo: a fila dele é o trabalho de sempre');
});

test('quemCuidaDaFila: revisão ao vivo em outro aparelho manda sobre a conta', () => {
  const engine = engineDe({ observador: true });
  const kId = kek.bufferDe(MATERIAL_ID);
  engine.sync.andamentoRemoto = [{ dev: 'cel', aparelho: 'Celular', prTag: prTag(kId, 'o/r#1') }];
  assert.deepEqual(telas.quemCuidaDaFila(engine), { 'o/r#1': { situacao: 'revisando', aparelho: 'Celular' } });
});
