'use strict';
// searchPRs no teto do --limit 100: o gh corta em silêncio e, com best-match como
// ordenação, QUAIS 100 entram é imprevisível (PR pedido a mim pode ficar de fora
// sem nenhum sinal). fetchDeliveries no mesmo arquivo já trata o caso (capped);
// aqui trava o análogo do searchPRs: WARN no log quando o teto é atingido.
// ATENÇÃO à ordem: gh-queries destrutura io.run no LOAD, então o patch de io.run
// precisa vir ANTES do require do server (o runner isola cada arquivo num processo).
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-ghcap-' + process.pid);

const io = require('../lib/io');
let ghStdout = '[]';
io.run = async () => ({ ok: true, code: 0, stdout: ghStdout, stderr: '' });

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function itens(n) {
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({
    url: `https://github.com/acme/app/pull/${i + 1}`, title: `PR ${i + 1}`, isDraft: false,
    author: { login: 'alice' }, number: i + 1,
    repository: { nameWithOwner: 'acme/app' }, updatedAt: '2026-08-01T10:00:00Z'
  })));
}

test('searchPRs no teto de 100 loga WARN de resultado truncado', async () => {
  const e = new Engine();
  e.tokens = { me: 'tok' }; // identidade de conta (Onda 1): busca de conta sem token é pulada
  const logs = [];
  e.log = (level, msg) => logs.push({ level, msg });
  ghStdout = itens(100);
  const list = await e.searchPRs(['--owner', 'acme'], 'me');
  assert.equal(list.length, 100, 'a lista em si segue vindo inteira');
  const warn = logs.find(l => l.level === 'WARN' && /teto do --limit/.test(l.msg));
  assert.ok(warn, 'avisa que o radar pode estar incompleto');
  assert.match(warn.msg, /--owner acme/, 'o log diz QUAL busca truncou');
});

test('abaixo do teto não loga nada (log é só de falhas)', async () => {
  const e = new Engine();
  e.tokens = { me: 'tok' }; // identidade de conta (Onda 1): busca de conta sem token é pulada
  const logs = [];
  e.log = (level, msg) => logs.push({ level, msg });
  ghStdout = itens(99);
  const list = await e.searchPRs(['--owner', 'acme'], 'me');
  assert.equal(list.length, 99);
  assert.equal(logs.length, 0, 'nenhum ruído no log');
});
