// O orçamento valendo no funil de verdade: as buscas do ciclo NÃO saem em rajada.
//
// O módulo puro já prova a conta (test/orcamento-busca.test.js). Aqui a pergunta é
// outra: o lib/engine/gh-queries.js espera a vez antes de gastar, e espera por CONTA?
// Foi a rajada que produziu os 38 bloqueios medidos no farol.log em poucos dias.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-orcamento-funil-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// mesmo padrão dos outros testes de identidade: o espião entra ANTES do server.js
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [], env: (opts || {}).env, em: Date.now() });
  return Promise.resolve({ ok: true, code: 0, stdout: '[]', stderr: '' });
};

const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');
const { ESPACO_MIN_MS, TETO_POR_JANELA } = await import('../lib/engine/orcamento-busca.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; });

function engineComContas() {
  const e = new Engine();
  e.config.accounts = [{ user: 'ana', owners: ['acme'] }, { user: 'bia', owners: ['outra'] }];
  e.tokens = { ana: 'tok-ana', bia: 'tok-bia' };
  return e;
}

// Relógio falso: o espaçamento real é de segundos, e o teste não pode gastar o relógio
// de verdade. O tempo só anda quando o código PEDE para dormir, então o que o caso mede
// é exatamente quanto o funil decidiu esperar.
function comRelogioFalso(t0 = 1_700_000_000_000) {
  const realNow = Date.now;
  let agora = t0;
  Date.now = () => agora;
  const dormidas = [];
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { dormidas.push(ms || 0); agora += (ms || 0); return realTimeout(fn, 0); };
  return {
    dormidas,
    restaurar() { Date.now = realNow; globalThis.setTimeout = realTimeout; },
  };
}

test('as buscas da mesma conta saem espaçadas, não em rajada', async () => {
  const e = engineComContas();
  const relogio = comRelogioFalso();
  try {
    // o que o ciclo faz hoje pela conta: owner, review-requested, reviewed-by
    await e.searchPRs(['--owner', 'acme'], 'ana');
    await e.searchPRs(['--review-requested=@me'], 'ana');
    await e.searchPRs(['--reviewed-by=@me'], 'ana');
  } finally { relogio.restaurar(); }
  assert.equal(chamadas.length, 3, 'as três buscas rodaram');
  assert.deepEqual(relogio.dormidas, [ESPACO_MIN_MS, ESPACO_MIN_MS],
    'a primeira sai na hora; da segunda em diante, cada uma espera o espaçamento');
});

test('a espera é por conta: a fila de uma não atrasa a da outra', async () => {
  const e = engineComContas();
  const relogio = comRelogioFalso();
  try {
    await e.searchPRs(['--owner', 'acme'], 'ana');
    await e.searchPRs(['--owner', 'outra'], 'bia');
  } finally { relogio.restaurar(); }
  assert.equal(chamadas.length, 2);
  assert.deepEqual(relogio.dormidas, [], 'contas diferentes, cotas diferentes: ninguém espera');
});

test('a autoria (Meus PRs) também passa pelo orçamento', async () => {
  const e = engineComContas();
  const relogio = comRelogioFalso();
  try {
    await e.searchPRs(['--owner', 'acme'], 'ana');
    await e.myAuthoredPRs('ana');
  } finally { relogio.restaurar(); }
  assert.equal(chamadas.length, 2);
  assert.deepEqual(relogio.dormidas, [ESPACO_MIN_MS],
    'buscar autoria é busca como qualquer outra e gasta a mesma cota');
});

// A propriedade que interessa, e que o espaçamento produz sozinho: por mais buscas que o
// ciclo peça, NENHUMA janela de um minuto passa do teto. O limite do GitHub é 30 por
// minuto; o teste afirma o nosso, que é menor de propósito.
test('nenhuma janela de um minuto passa do teto, por mais que o ciclo peça', async () => {
  const e = engineComContas();
  const relogio = comRelogioFalso();
  const instantes = [];
  try {
    for (let i = 0; i < TETO_POR_JANELA + 8; i++) {
      await e.searchPRs(['--owner', 'acme'], 'ana');
      instantes.push(Date.now());
    }
  } finally { relogio.restaurar(); }
  assert.equal(chamadas.length, TETO_POR_JANELA + 8, 'todas as buscas acontecem, nenhuma é descartada');
  for (const t of instantes) {
    const naJanela = instantes.filter((x) => x > t - 60_000 && x <= t).length;
    assert.ok(naJanela <= TETO_POR_JANELA,
      `janela terminando em ${t} teve ${naJanela} buscas, acima do teto de ${TETO_POR_JANELA}`);
  }
});

// Conta que JÁ está bloqueada nem chega no orçamento: ela não gasta espera nenhuma,
// porque nem roda o gh (insistir prolonga o bloqueio).
test('conta em espera por limite não dorme nem chama o gh', async () => {
  const e = engineComContas();
  e.limitesDeBuscaGh = new Map([['ana', Date.now() + 120_000]]);
  const relogio = comRelogioFalso();
  let r;
  try { r = await e.searchPRs(['--owner', 'acme'], 'ana'); } finally { relogio.restaurar(); }
  assert.equal(r, null);
  assert.equal(chamadas.length, 0);
  assert.deepEqual(relogio.dormidas, []);
});
