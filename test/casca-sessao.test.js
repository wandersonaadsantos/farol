// Código de pareamento e sessão da classe casca (Farol nativo, contrato do sidecar). A
// casca pareia com um código que o motor escreve e precisa manter a sessão enquanto está
// em uso: a classe casca ignora o limite absoluto de 90 dias, mas continua vencendo com
// 30 dias sem uso. FAROL_HOME temporário antes do import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-casca-sessao-'));
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { criarCodigo, tentarCodigo } = await import('../lib/local-auth/pareamento.js');
const { emitirSessao, verificarSessao, listarSessoes } = await import('../lib/local-auth/sessoes.js');
const { parear } = await import('../lib/local-auth/acesso.js');
const { LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { TEMPOS } = await import('../lib/constants.js');

beforeEach(() => { fs.rmSync(LOCAL_AUTH_DIR, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

// Usa a sessão a cada meio período ocioso, de t0 até `fim`: o toque mantém a sessão viva.
function usarAte(token, t0, fim) {
  let t = t0;
  while (t < fim) {
    t = Math.min(t + TEMPOS.SESSAO_LOCAL_OCIOSA_MS / 2, fim);
    assert.equal(verificarSessao(token, t), true, 'usada com frequência, não vence');
  }
}

test('código da classe casca gera sessão da classe casca', () => {
  const { codigo } = criarCodigo(Date.now(), { classe: 'casca' });
  const r = parear({ codigo, rotulo: 'Farol.app' });
  assert.equal(r.ok, true);
  const sessoes = listarSessoes();
  assert.equal(sessoes.at(-1).classe, 'casca');
  assert.equal(sessoes.at(-1).rotulo, 'Farol.app');
});

test('sessão casca sobrevive aos 90 dias absolutos, mas não a 30 dias ociosa', () => {
  const t0 = Date.now();
  const token = emitirSessao('casca', t0, { classe: 'casca' });
  const fim = t0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS + 1;
  usarAte(token, t0, fim);
  assert.equal(verificarSessao(token, fim + TEMPOS.SESSAO_LOCAL_OCIOSA_MS), false, 'ociosa vence');
});

test('sessão comum continua vencendo nos 90 dias', () => {
  const t0 = Date.now();
  const token = emitirSessao('navegador', t0);
  usarAte(token, t0, t0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS - 1);
  assert.equal(verificarSessao(token, t0 + TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS + 1), false);
});

test('código comum gera sessão sem classe', () => {
  const { codigo } = criarCodigo(Date.now());
  assert.equal(tentarCodigo(codigo).classe, '');
  const { codigo: c2 } = criarCodigo(Date.now());
  assert.equal(parear({ codigo: c2, rotulo: 'navegador' }).ok, true);
  assert.equal(listarSessoes().at(-1).classe, '');
});

test('código consumido ou vencido não pareia (sidecar órfão)', () => {
  const { codigo } = criarCodigo(Date.now(), { classe: 'casca' });
  assert.equal(parear({ codigo }).ok, true);
  assert.equal(parear({ codigo }).ok, false, 'uso único');
  const { codigo: c2 } = criarCodigo(Date.now() - TEMPOS.PAREAMENTO_VALIDADE_MS - 1, { classe: 'casca' });
  assert.equal(tentarCodigo(c2).ok, false, 'vencido');
});

test('criarCodigo devolve o código e a validade', () => {
  const agora = Date.now();
  const r = criarCodigo(agora, { classe: 'casca' });
  assert.equal(r.expiraEm, agora + TEMPOS.PAREAMENTO_VALIDADE_MS);
  assert.equal(tentarCodigo(r.codigo, agora).classe, 'casca');
});
