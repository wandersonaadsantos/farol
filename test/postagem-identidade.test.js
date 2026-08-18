// A trava de IDENTIDADE do postReview: sem o token DA CONTA dona do PR, não posta.
//
// Achado por mutação em 17/08/2026: trocando `if (!engine.tokenFor(acc))` por
// `if (false)`, a suíte inteira passava (1265 verdes). Ou seja, dava pra apagar a
// única coisa que impede um review de sair assinado pela conta ERRADA e nenhum gate
// acusaria.
//
// Por que isso importa mais do que parece: o Farol é multiconta por desenho (uma
// pessoal, uma de trabalho). O `ghEnv(acc)` monta o ambiente com o token daquela
// conta; sem ele, o `gh` cai na conta ATIVA do keyring, que é a que estiver por
// último. É o cenário A1 citado no comentário da trava, e o efeito é um review
// aparecendo no PR de um cliente assinado pela conta pessoal, ou o contrário.
//
// Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-post-ident-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = { key: 'acme/api#1', repo: 'acme/api', number: 1, url: 'u', author: 'alice' };
const APPROVE = { event: 'APPROVE', body: 'O gate ficou correto.' };

// engine que registra se o `gh` chegou a ser chamado. Só o token varia.
function engineComToken(token) {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'conta-dona';
  e.tokenFor = () => token;
  e.refreshTokens = async () => { };
  e.token = 'qualquer';
  e.ghEnv = () => ({});
  e.chamouGh = false;
  return e;
}

test('sem token da conta dona, o review NÃO vai pro GitHub', async () => {
  const e = engineComToken(null);
  const r = await e.postReview(PR, APPROVE);
  assert.equal(r.ok, false, 'não posta');
  assert.match(r.error, /sem token/, 'e diz por quê');
  assert.ok(!r.attempted, 'o gh nunca foi chamado: a trava é ANTES da credencial');
});

test('a recusa por identidade acontece antes de qualquer arquivo temporário', async () => {
  // o payload chega a ser escrito em disco pra passar ao `gh --input`; a trava tem
  // que barrar antes disso, senão sobra corpo de review em STATE_DIR
  const e = engineComToken(null);
  const antes = fs.readdirSync(path.join(process.env.FAROL_HOME, 'workspace', 'state')).length;
  await e.postReview(PR, APPROVE);
  const depois = fs.readdirSync(path.join(process.env.FAROL_HOME, 'workspace', 'state')).length;
  assert.equal(depois, antes, 'nenhum arquivo de payload ficou pra trás');
});

test('token de string vazia conta como ausente', async () => {
  // falha fechado: '' é o que o gh devolve quando a conta existe mas perdeu o token
  const e = engineComToken('');
  const r = await e.postReview(PR, APPROVE);
  assert.equal(r.ok, false);
  assert.match(r.error, /sem token/);
});

test('a mensagem de recusa nomeia a conta, pra dar o que corrigir', async () => {
  const e = engineComToken(null);
  const r = await e.postReview(PR, APPROVE);
  assert.match(r.error, /conta-dona/, 'quem lê o log precisa saber QUAL conta destravar');
});
