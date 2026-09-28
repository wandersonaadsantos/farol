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
const AGORA = 1_000_000;
const LIDO = { lidoEm: AGORA, agora: AGORA };

test('operação ao vivo manda, mesmo sem retrato da frota (é prova por si só)', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [{ dev: 'cel', prTag: 'p', aparelho: 'Celular' }] }), { situacao: 'revisando', aparelho: 'Celular' });
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', operacoes: [{ dev: 'cel', prTag: 'p', aparelho: 'Celular' }] }), { situacao: 'revisando', aparelho: 'Celular' });
});
test('executor com a conta cuida', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [], ...LIDO }), { situacao: 'cuida', aparelho: 'Celular' });
});
test('só o admin tem a conta: sem aparelho', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c2', prTag: 'p', aparelhos, operacoes: [], ...LIDO }), { situacao: 'sem-aparelho', aparelho: '' });
});
// Revisão final (28/09/2026): cuidar é VAI EXECUTAR. Pausado ou sem aceitar comandos do
// admin, o aparelho tem a conta mas não recebe o PR, e "cuida" seria promessa falsa.
test('aparelho pausado ou sem aceitar o admin não cuida, mesmo com a conta', () => {
  const pausado = [{ dev: 'cel', nome: 'Celular', contasComToken: ['c1'], pausado: true }];
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos: pausado, operacoes: [], ...LIDO }), { situacao: 'sem-aparelho', aparelho: '' });
  const semAceite = [{ dev: 'cel', nome: 'Celular', contasComToken: ['c1'], aceitarAdmin: false }];
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos: semAceite, operacoes: [], ...LIDO }), { situacao: 'sem-aparelho', aparelho: '' });
  const misto = [...pausado, { dev: 'nb', nome: 'Notebook', contasComToken: ['c1'], pausado: false, aceitarAdmin: true }];
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos: misto, operacoes: [], ...LIDO }), { situacao: 'cuida', aparelho: 'Notebook' });
});
test('sem argumentos: nunca lido, não quebra', () => {
  assert.deepEqual(quemCuida(), { situacao: 'nao-lido', aparelho: '' });
});

/* ---------- fix round 1 (29/09/2026): ausência de leitura não é ausência de aparelho ---------- */

test('nunca lido (lidoEm ausente/zero): nao-lido, nunca sem-aparelho', () => {
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [], agora: AGORA }), { situacao: 'nao-lido', aparelho: '' });
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [], lidoEm: 0, agora: AGORA }), { situacao: 'nao-lido', aparelho: '' });
});
test('leitura mais velha que 60s: nao-lido, mesmo com aparelhos aptos na lista', () => {
  const velha = { lidoEm: AGORA - 60001, agora: AGORA };
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [], ...velha }), { situacao: 'nao-lido', aparelho: '' });
});
test('leitura exatamente no limite dos 60s ainda vale', () => {
  const noLimite = { lidoEm: AGORA - 60000, agora: AGORA };
  assert.deepEqual(quemCuida({ acctTag: 'c1', prTag: 'p', aparelhos, operacoes: [], ...noLimite }), { situacao: 'cuida', aparelho: 'Celular' });
});

/* ---------- lib/engine/sync-telas.js: a projeção por PR, e o portão do observador ---------- */

const MATERIAL_ID = Buffer.alloc(32, 7).toString('base64url');
const LOGIN = 'wandersonaadsantos';

function engineDe({ observador, lidoEm = AGORA, extra = {} } = {}) {
  const rt = {
    deviceId: 'adm', material: { id: MATERIAL_ID }, agora: () => AGORA,
    devices: { adm: { name: 'PC' }, cel: { name: 'Celular' } },
    aparelhosDaFrota: { lidoEm, lista: [
      { dev: 'adm', nome: 'PC', contasComToken: ['ignorada'], observador: true },
      { dev: 'cel', nome: 'Celular', contasComToken: [acctTag(kek.bufferDe(MATERIAL_ID), LOGIN)], observador: false },
    ] },
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

// Fix round 1: antes do primeiro giro do agendador (rt.aparelhosDaFrota nunca setado, ou
// zerado por desligarRelogio), a fila do admin não pode afirmar "sem aparelho com a conta
// X" — ninguém verificou isso ainda.
test('projecaoDasTelas: antes do primeiro ciclo (frota nunca lida), a situação é nao-lido', () => {
  const semFrota = engineDe({ observador: true, extra: { aparelhosDaFrota: null } });
  assert.deepEqual(telas.projecaoDasTelas(semFrota).quemCuida, { 'o/r#1': { situacao: 'nao-lido', aparelho: '' } });
});
test('projecaoDasTelas: retrato velho (>60s) também é nao-lido, não sem-aparelho', () => {
  const velha = engineDe({ observador: true, lidoEm: AGORA - 60001 });
  assert.deepEqual(telas.projecaoDasTelas(velha).quemCuida, { 'o/r#1': { situacao: 'nao-lido', aparelho: '' } });
});
