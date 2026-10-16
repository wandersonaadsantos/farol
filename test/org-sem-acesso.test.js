// Organização que a conta não consegue buscar (15/10/2026). Medido no celular: a conta do
// Alex tinha 11 orgs, a busca de `team-ascent-consulting` respondia `Invalid search query`
// a cada ciclo, e o Panorama dela nunca subia, então o admin não via os PRs pedidos a ela.
// ATENÇÃO à ordem: gh-queries destrutura io.run no LOAD, então o patch vem ANTES do server.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-org-sem-acesso-'));

const io = (await import('../lib/io.js')).default;
let resposta = { ok: true, code: 0, stdout: '[]', stderr: '' };
io.run = async () => resposta;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const orgSemAcesso = (await import('../lib/engine/org-sem-acesso.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const SEM_ACESSO = 'Invalid search query "state:open type:pr user:team-x".';

function motor() {
  const e = new Engine();
  e.tokens = { alex: 'tok' };
  e.logs = [];
  e.log = (nivel, msg) => e.logs.push({ nivel, msg });
  return e;
}

test('org sem acesso fica marcada para a conta, avisa uma vez e sai da marca quando volta a responder', async () => {
  const e = motor();
  resposta = { ok: false, code: 1, stdout: '', stderr: SEM_ACESSO };
  assert.equal(await e.searchPRs(['--owner', 'team-x'], 'alex'), null, 'a busca continua devolvendo falha');
  assert.equal(await e.searchPRs(['--owner', 'team-x'], 'alex'), null);
  assert.equal(orgSemAcesso.semAcesso(e, 'Alex', 'Team-X'), true, 'comparação sem caixa');
  assert.equal(orgSemAcesso.semAcesso(e, 'outra', 'team-x'), false, 'a marca é da conta, não da org');
  const avisos = e.logs.filter((l) => /team-x/.test(l.msg));
  assert.equal(avisos.length, 1, 'um aviso só, e não um por ciclo');
  assert.match(avisos[0].msg, /não consegue buscar PRs da organização team-x/);
  resposta = { ok: true, code: 0, stdout: '[]', stderr: '' };
  assert.deepEqual(await e.searchPRs(['--owner', 'team-x'], 'alex'), []);
  assert.equal(orgSemAcesso.semAcesso(e, 'alex', 'team-x'), false);
});

test('falha de rede não é org sem acesso: segue no log de sempre e não marca nada', async () => {
  const e = motor();
  resposta = { ok: false, code: 1, stdout: '', stderr: 'Post "https://api.github.com/graphql": unexpected EOF' };
  assert.equal(await e.searchPRs(['--owner', 'team-x'], 'alex'), null);
  assert.equal(orgSemAcesso.semAcesso(e, 'alex', 'team-x'), false);
  assert.ok(e.logs.some((l) => /gh search falhou/.test(l.msg)));
});
