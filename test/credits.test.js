'use strict';
// Sistema > Sobre: créditos sincronizados com o GitHub (refreshContributors em
// lib/engine/gh-queries.js). O contrato que importa: a lista vem do repo do
// auto-update (colaborador novo aparece sem manutenção), bot não entra, falha
// de rede nunca esvazia lista boa, e o TTL/backoff segura a chamada pra não
// virar polling (créditos mudam devagar; 1 busca por dia basta).
// ATENÇÃO à ordem (mesma pegadinha do gh-queries-capped.test.js): gh-queries
// destrutura io.run no LOAD, então o patch precisa vir ANTES do require do server.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-credits-' + process.pid);

const io = require('../lib/io');
let calls = [];
let responder = async () => ({ ok: true, code: 0, stdout: '[]', stderr: '' });
io.run = async (cmd, args, opts) => { calls.push(args); return responder(args); };

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const CONTRIBS = JSON.stringify([
  { login: 'wandersonaadsantos', contributions: 500, type: 'User' },
  { login: 'thiagocarvalho-dev', contributions: 3, type: 'User' },
  { login: 'dependabot[bot]', contributions: 9, type: 'Bot' },
]);

function engineComToken() {
  const e = new Engine();
  e.config.updateRepo = 'wandersonaadsantos/farol';
  e.tokens = { [e.primaryUser() || '']: 'tok' };
  e.tokenFor = () => 'tok';
  e.log = () => {};
  return e;
}

test('sucesso: contribuidores entram, bot sai, idealizador é o dono do repo', async () => {
  const e = engineComToken();
  responder = async (args) => {
    if (String(args[1]).startsWith('repos/')) return { ok: true, code: 0, stdout: CONTRIBS, stderr: '' };
    return { ok: true, code: 0, stdout: 'Wanderson Santos\n', stderr: '' };
  };
  let pushed = false;
  e.pushState = () => { pushed = true; };
  await e.refreshContributors();
  assert.ok(e.credits, 'credits preenchido');
  assert.equal(e.credits.repo, 'wandersonaadsantos/farol');
  assert.equal(e.credits.owner.login, 'wandersonaadsantos', 'idealizador = dono do repo do update');
  assert.equal(e.credits.owner.name, 'Wanderson Santos', 'nome de exibição vem da API de users');
  assert.deepEqual(e.credits.contributors.map(c => c.login), ['wandersonaadsantos', 'thiagocarvalho-dev'], 'bot filtrado');
  assert.ok(pushed, 'push de estado avisa a UI quando a lista chega');
  assert.ok(e.snapshot().credits, 'snapshot expõe os créditos pra UI');
});

test('TTL: com lista boa em cache, novo ciclo não chama o gh de novo', async () => {
  const e = engineComToken();
  responder = async (args) => {
    if (String(args[1]).startsWith('repos/')) return { ok: true, code: 0, stdout: CONTRIBS, stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  e.pushState = () => {};
  await e.refreshContributors();
  calls = [];
  await e.refreshContributors();
  assert.equal(calls.length, 0, 'dentro do TTL de 24h nenhuma chamada sai');
});

test('falha: mantém o que tinha (null), loga WARN e o backoff segura a retentativa', async () => {
  const e = engineComToken();
  const logs = [];
  e.log = (level, msg) => logs.push({ level, msg });
  responder = async () => ({ ok: false, code: 1, stdout: '', stderr: 'boom' });
  await e.refreshContributors();
  assert.equal(e.credits, null, 'falha não inventa lista');
  assert.ok(logs.find(l => l.level === 'WARN' && /contributors/.test(l.msg)), 'falha deixa rastro no log');
  calls = [];
  await e.refreshContributors();
  assert.equal(calls.length, 0, 'backoff de 1h: a falha não vira polling de rede');
});

test('sem token no gh: não chama nada e não loga (estado esperado no primeiro boot)', async () => {
  const e = new Engine();
  e.config.updateRepo = 'wandersonaadsantos/farol';
  e.tokenFor = () => '';
  const logs = [];
  e.log = (level, msg) => logs.push({ level, msg });
  calls = [];
  await e.refreshContributors();
  assert.equal(calls.length, 0, 'sem credencial não há o que buscar');
  assert.equal(e.credits, null);
  assert.equal(logs.length, 0, 'log é só de falhas, e isso não é falha');
});
