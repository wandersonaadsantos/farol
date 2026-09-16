// A tela de pareamento (B2, 2.1) precisa distinguir "errou e ainda pode tentar" de
// "não há código pendente" e de "bloqueado por tentativas". O motor já sabia disso e
// devolvia só `false`. `tentarCodigo` expõe o motivo e quantas tentativas sobraram;
// `consumirCodigo` continua booleano, para não mexer em quem já o usa.
//
// O que NÃO é dito de propósito: se o código errado existia e venceu, se já tinha sido
// usado ou se nunca existiu. Nada no disco distingue os três depois que o registro sai.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-tentativa-'));
process.env.FAROL_HOME = BASE;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { criarCodigo, consumirCodigo, tentarCodigo, revogarCodigos } = await import('../lib/local-auth/pareamento.js');
const { LOCAL_AUTH, TEMPOS } = await import('../lib/constants.js');
const acesso = (await import('../lib/local-auth/acesso.js')).default;

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => revogarCodigos());

const ERRADO = 'AAAAAAAAAA';

test('código certo: ok, sem motivo e sem contagem', () => {
  const codigo = criarCodigo();
  assert.deepEqual(tentarCodigo(codigo), { ok: true, code: '', restantes: null });
});

test('errado com código pendente: diz quantas tentativas sobraram', () => {
  criarCodigo();
  assert.deepEqual(tentarCodigo(ERRADO), { ok: false, code: 'codigo_invalido', restantes: LOCAL_AUTH.CODIGO_MAX_ERROS - 1 });
  assert.deepEqual(tentarCodigo(ERRADO), { ok: false, code: 'codigo_invalido', restantes: LOCAL_AUTH.CODIGO_MAX_ERROS - 2 });
});

test('a última tentativa bloqueia, e o código pendente some', () => {
  const codigo = criarCodigo();
  for (let i = 0; i < LOCAL_AUTH.CODIGO_MAX_ERROS - 1; i++) tentarCodigo(ERRADO);
  assert.deepEqual(tentarCodigo(ERRADO), { ok: false, code: 'bloqueado', restantes: 0 });
  assert.deepEqual(tentarCodigo(codigo), { ok: false, code: 'sem_codigo_pendente', restantes: null }, 'nem o código certo vale depois do bloqueio');
});

test('sem nenhum código pendente: não há tentativa para contar', () => {
  assert.deepEqual(tentarCodigo(ERRADO), { ok: false, code: 'sem_codigo_pendente', restantes: null });
});

test('código vencido cai em sem código pendente, não em errado', () => {
  const codigo = criarCodigo(1000);
  assert.deepEqual(tentarCodigo(codigo, 1000 + TEMPOS.PAREAMENTO_VALIDADE_MS), { ok: false, code: 'sem_codigo_pendente', restantes: null });
});

test('consumirCodigo continua booleano para quem já o usava', () => {
  const codigo = criarCodigo();
  assert.equal(consumirCodigo(codigo), true);
  assert.equal(consumirCodigo(codigo), false);
});

test('a rota de pareamento leva o motivo e a contagem para a tela', () => {
  criarCodigo();
  const r = acesso.parear({ codigo: ERRADO, rotulo: 'Chrome de teste' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'codigo_invalido');
  assert.equal(r.restantes, LOCAL_AUTH.CODIGO_MAX_ERROS - 1);
  const certo = criarCodigo();
  const bom = acesso.parear({ codigo: certo, rotulo: 'Chrome de teste' });
  assert.equal(bom.ok, true);
  assert.match(bom.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(bom.code, undefined, 'sucesso não carrega motivo');
});
