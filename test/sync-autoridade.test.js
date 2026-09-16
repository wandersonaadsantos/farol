// Frescor da autoridade do admin (CT-ADM-POL). A regra tem seis frases, e cada uma tem um
// caso aqui, porque cada uma existe por um jeito diferente de se enganar:
//   1. valor do snapshot inicial não prova frescor;
//   2. reentrega sem mudança não prova;
//   3. keep-alive não prova;
//   4. frescor exige mudança para sequência MAIOR, observada depois do início da conexão;
//   5. a maior sequência vista é persistida, então valor antigo reentregue não vale;
//   6. sem mudança por três intervalos, vence;
//   7. até o primeiro valor fresco, o sinal é desconhecido.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-autoridade-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const aut = await import('../lib/sync/autoridade.js');
const ak = await import('../lib/sync/admin-chave.js');
const sig = await import('../lib/sync/assinatura.js');
const { SYNC } = await import('../lib/constants.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });
beforeEach(() => { aut.apagarSequenciaVista(); });

const PAR = ak.gerarParDeAdmin();
const OUTRO = ak.gerarParDeAdmin();
const UID = 'u1';
const DEV = 'dAdmin';
const GEN = 2;
const T0 = 1_800_000_000_000;
const INTERVALO = SYNC.AUTORIDADE_INTERVALO_MS;

function sinal(sequencia, extra = {}) {
  const valor = { dev: DEV, generation: GEN, sequencia, beatAt: T0, ...extra };
  return { ...valor, sig: sig.assinar(PAR.jwk, { uid: UID, caminho: 'live/control/beat', generation: GEN, valor }) };
}

function ctx(extra = {}) {
  return { agora: T0, conexaoIniciadaEm: T0 - 1000, uid: UID, publicKey: PAR.publicKey, generationVigente: GEN, doSnapshot: false, ...extra };
}

test('7. até o primeiro valor fresco, a autoridade é desconhecida', () => {
  const e = aut.novoEstadoDeAutoridade();
  assert.equal(e.fresca, false);
  assert.equal(aut.autoridadeFresca(e, { agora: T0, intervaloMs: INTERVALO }), false);
});

test('1. valor do snapshot inicial não prova frescor, mas conta como visto', () => {
  const e = aut.observarAutoridade(aut.novoEstadoDeAutoridade(), sinal(5), ctx({ doSnapshot: true }));
  assert.equal(e.fresca, false, 'snapshot não prova nada');
  assert.equal(e.sequenciaVista, 5, 'mas fica registrado como visto');
  assert.equal(aut.autoridadeFresca(e, { agora: T0, intervaloMs: INTERVALO }), false);
});

test('4. mudança para sequência maior, depois do início da conexão, prova frescor', () => {
  let e = aut.observarAutoridade(aut.novoEstadoDeAutoridade(), sinal(5), ctx({ doSnapshot: true }));
  e = aut.observarAutoridade(e, sinal(6), ctx({ agora: T0 + 1000 }));
  assert.equal(e.fresca, true);
  assert.equal(e.sequenciaVista, 6);
  assert.equal(e.ultimaMudancaEm, T0 + 1000);
  assert.equal(aut.autoridadeFresca(e, { agora: T0 + 1000, intervaloMs: INTERVALO }), true);
});

test('2. reentrega sem mudança não prova frescor', () => {
  let e = aut.observarAutoridade(aut.novoEstadoDeAutoridade(), sinal(6), ctx());
  const antes = { ...e };
  e = aut.observarAutoridade(e, sinal(6), ctx({ agora: T0 + 5000 }));
  assert.equal(e.sequenciaVista, 6);
  assert.equal(e.ultimaMudancaEm, antes.ultimaMudancaEm, 'a reentrega não renova o relógio');
});

test('3. keep-alive não prova: sinal vazio não muda nada', () => {
  const inicial = aut.observarAutoridade(aut.novoEstadoDeAutoridade(), sinal(6), ctx());
  for (const vazio of [null, undefined, {}, { sig: '' }]) {
    const e = aut.observarAutoridade(inicial, vazio, ctx({ agora: T0 + 5000 }));
    assert.deepEqual(e, inicial, JSON.stringify(vazio));
  }
});

test('4b. sequência maior recebida ANTES do início da conexão atual não prova frescor', () => {
  const e = aut.observarAutoridade(aut.novoEstadoDeAutoridade(), sinal(7), ctx({ agora: T0 - 5000, conexaoIniciadaEm: T0 }));
  assert.equal(e.fresca, false, 'observado antes desta conexão não conta');
  assert.equal(e.sequenciaVista, 7, 'mas continua sendo o maior visto');
});

test('5. a maior sequência vista é persistida: valor antigo depois de reinício não vale', () => {
  let e = aut.observarAutoridade(aut.novoEstadoDeAutoridade(), sinal(9), ctx());
  aut.gravarSequenciaVista(e.sequenciaVista);
  // "reinício": estado novo, lido do disco
  const depoisDoReinicio = aut.novoEstadoDeAutoridade(aut.lerSequenciaVista());
  assert.equal(depoisDoReinicio.sequenciaVista, 9);
  e = aut.observarAutoridade(depoisDoReinicio, sinal(8), ctx({ agora: T0 + 1000 }));
  assert.equal(e.fresca, false, 'sequência menor nunca é aceita como nova');
  e = aut.observarAutoridade(depoisDoReinicio, sinal(9), ctx({ agora: T0 + 1000 }));
  assert.equal(e.fresca, false, 'a mesma sequência também não');
});

test('6. sem mudança por três intervalos, a autoridade vence', () => {
  const e = aut.observarAutoridade(aut.novoEstadoDeAutoridade(), sinal(6), ctx());
  const limite = SYNC.AUTORIDADE_INTERVALOS_ATE_VENCER * INTERVALO;
  assert.equal(aut.autoridadeFresca(e, { agora: T0 + limite - 1, intervaloMs: INTERVALO }), true);
  assert.equal(aut.autoridadeFresca(e, { agora: T0 + limite + 1, intervaloMs: INTERVALO }), false);
});

test('assinatura inválida, geração errada ou outro aparelho não atualizam nada', () => {
  const base = aut.novoEstadoDeAutoridade();
  const comOutraChave = { ...sinal(6), sig: sig.assinar(OUTRO.jwk, { uid: UID, caminho: 'live/control/beat', generation: GEN, valor: { dev: DEV, generation: GEN, sequencia: 6, beatAt: T0 } }) };
  assert.deepEqual(aut.observarAutoridade(base, comOutraChave, ctx()), base, 'assinatura de outra chave');
  assert.deepEqual(aut.observarAutoridade(base, sinal(6, { generation: 99 }), ctx()), base, 'geração diferente da vigente');
  assert.deepEqual(aut.observarAutoridade(base, sinal(6), ctx({ generationVigente: 3 })), base, 'geração vigente mudou');
});

test('a sequência persistida sobrevive a leitura repetida e ignora lixo no arquivo', () => {
  aut.gravarSequenciaVista(12);
  assert.equal(aut.lerSequenciaVista(), 12);
  fs.writeFileSync(aut.caminhoDaSequencia(), 'nao e json');
  assert.equal(aut.lerSequenciaVista(), 0, 'arquivo corrompido não vira sequência');
});
