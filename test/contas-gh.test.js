// Contas do GitHub x contas do Farol (v2.62.0). O caso real, medido em 18/09/2026 no Farol do
// mantenedor: `alexpraxedes` monitorada sem login no gh (167 linhas de log no dia), o login
// `agente70reviewer` invisível ao Farol, `biudtech` em duas contas sem aviso, e a
// `Edicoes-CNBB` fora de `user/orgs` porque a conta é colaboradora, não membro.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-contas-gh-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { TEMPOS } = await import('../lib/constants.js');
const cg = (await import('../lib/engine/contas-gh.js')).default;
const { Engine } = await import('../server.js');

const runOriginal = io.run;
after(() => {
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const STATUS_REAL = JSON.stringify({ hosts: { 'github.com': [
  { login: 'wandersonaadsantos', active: true, state: 'success', tokenSource: 'keyring' },
  { login: 'wandersonbiuder', active: false, state: 'success', tokenSource: 'keyring' },
  { login: 'agente70reviewer', active: false, state: 'success', tokenSource: 'keyring' },
] } });

const CONTAS_REAIS = [
  { user: 'wandersonbiuder', owners: ['biudtech'] },
  { user: 'wandersonaadsantos', owners: ['lovelace-eng', 'useALWAys', 'wandersonaadsantos'] },
  { user: 'alexpraxedes', owners: ['biudtech'] },
];

test('lê as contas do gh auth status; saída sem a forma esperada é "não sei", não "nenhuma"', () => {
  assert.deepEqual(cg.contasDoAuthStatus(STATUS_REAL).map((c) => c.login), ['wandersonaadsantos', 'wandersonbiuder', 'agente70reviewer']);
  assert.equal(cg.contasDoAuthStatus(STATUS_REAL)[0].ativa, true);
  assert.equal(cg.contasDoAuthStatus(''), null);
  assert.equal(cg.contasDoAuthStatus('{"hosts":{}}'), null);
  assert.equal(cg.contasDoAuthStatus('gh: not logged in'), null);
});

test('o caso real: login não monitorado, conta sem login, org em duas contas e a org do colaborador', () => {
  const d = cg.diagnosticoDasContas({
    contas: CONTAS_REAIS,
    logins: cg.contasDoAuthStatus(STATUS_REAL),
    orgsPorConta: { wandersonbiuder: ['biudtech'], wandersonaadsantos: ['useALWAys', 'lovelace-eng'] },
    pedidosPorConta: { wandersonaadsantos: ['Edicoes-CNBB', 'lovelace-eng'] },
  });
  assert.equal(d.lidas, true);
  assert.deepEqual(d.naoMonitoradas, ['agente70reviewer']);
  assert.deepEqual(d.semLogin, ['alexpraxedes']);
  assert.deepEqual(d.orgsDuplicadas, [{ owner: 'biudtech', contas: ['wandersonbiuder', 'alexpraxedes'] }]);
  assert.deepEqual(d.sugestoes, [{ conta: 'wandersonaadsantos', owner: 'Edicoes-CNBB', origens: ['pedido'] }],
    'org já monitorada por alguém nunca é sugerida de novo');
});

test('sem leitura do gh, nada é afirmado sobre login', () => {
  const d = cg.diagnosticoDasContas({ contas: CONTAS_REAIS, logins: null });
  assert.equal(d.lidas, false);
  assert.deepEqual(d.naoMonitoradas, []);
  assert.deepEqual(d.semLogin, []);
});

test('conta silenciada não conta como dona nem recebe sugestão', () => {
  const contas = [{ user: 'a', owners: ['org'] }, { user: 'b', owners: ['org'], muted: true }];
  const d = cg.diagnosticoDasContas({ contas, logins: [], orgsPorConta: { b: ['nova'] } });
  assert.deepEqual(d.orgsDuplicadas, []);
  assert.deepEqual(d.sugestoes, []);
});

test('membro e pedido na mesma org viram uma sugestão só, com as duas origens', () => {
  const d = cg.diagnosticoDasContas({ contas: [{ user: 'a', owners: [] }], logins: [], orgsPorConta: { a: ['Org'] }, pedidosPorConta: { a: ['org'] } });
  assert.deepEqual(d.sugestoes, [{ conta: 'a', owner: 'Org', origens: ['membro', 'pedido'] }]);
});

test('sem token é estado: uma linha quando começa, e só volta a avisar depois de o token voltar', () => {
  const linhas = [];
  const e = { log: (nivel, msg) => linhas.push(msg) };
  assert.equal(cg.avisarSemToken(e, 'alex', 'alex sem token no gh'), true);
  assert.equal(cg.avisarSemToken(e, 'alex', 'alex sem token no gh'), false);
  assert.equal(cg.avisarSemToken(e, 'Alex', 'alex sem token no gh'), false, 'login do GitHub não distingue caixa');
  cg.tokenVoltou(e, 'alex');
  assert.equal(cg.avisarSemToken(e, 'alex', 'alex sem token no gh'), true);
  assert.equal(linhas.length, 2);
});

test('atribuição: marcada pela busca, pela org, ou de reserva', () => {
  const e = { accountList: () => CONTAS_REAIS, primaryUser: () => 'wandersonbiuder' };
  assert.deepEqual(cg.atribuicaoDoPr(e, { key: 'x/y#1', account: 'wandersonaadsantos' }), { conta: 'wandersonaadsantos', por: 'busca' });
  assert.deepEqual(cg.atribuicaoDoPr(e, { key: 'lovelace-eng/app#2' }), { conta: 'wandersonaadsantos', por: 'org' });
  assert.deepEqual(cg.atribuicaoDoPr(e, { key: 'Desconhecida/app#3' }), { conta: 'wandersonbiuder', por: 'reserva' });
  const sozinha = { accountList: () => [{ user: 'eu', owners: ['minha'] }], primaryUser: () => 'eu' };
  assert.deepEqual(cg.atribuicaoDoPr(sozinha, { key: 'Desconhecida/app#3' }), { conta: 'eu', por: 'unica' },
    'com uma conta só não existe identidade errada: segue como sempre foi');
});

test('owners dos PRs pedidos a cada conta, sem repetir org', () => {
  const e = {};
  cg.registrarPedidos(e, [
    { account: 'wandersonaadsantos', repo: 'Edicoes-CNBB/api' },
    { account: 'wandersonaadsantos', repo: 'edicoes-cnbb/web' },
    { account: 'wandersonbiuder', repo: 'biudtech/biud-frontend' },
  ]);
  assert.deepEqual(e.ownersPedidosPorConta, { wandersonaadsantos: ['Edicoes-CNBB'], wandersonbiuder: ['biudtech'] });
});

test('gh auth status roda no máximo a cada TEMPOS.CONTAS_GH_MS, sem GH_TOKEN herdado', async () => {
  const chamadas = [];
  io.run = async (cmd, args, opts) => { chamadas.push({ args, env: opts && opts.env }); return { ok: true, code: 0, stdout: STATUS_REAL, stderr: '' }; };
  process.env.GH_TOKEN = 'token-herdado';
  try {
    const e = {};
    const T = 1_000_000;
    await cg.lerLoginsDoGh(e, { agora: T });
    await cg.lerLoginsDoGh(e, { agora: T + TEMPOS.CONTAS_GH_MS - 1 });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].env.GH_TOKEN, undefined, 'a pergunta é o chaveiro inteiro, não a conta do GH_TOKEN');
    await cg.lerLoginsDoGh(e, { agora: T + TEMPOS.CONTAS_GH_MS });
    assert.equal(chamadas.length, 2);
    io.run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'rede' });
    await cg.lerLoginsDoGh(e, { agora: T + 3 * TEMPOS.CONTAS_GH_MS });
    assert.equal(e.contasGh.logins.length, 3, 'leitura que falha preserva a anterior');
  } finally {
    delete process.env.GH_TOKEN;
    io.run = runOriginal;
  }
});

test('postar num PR de reserva recusa antes de qualquer gh', async () => {
  const chamadas = [];
  io.run = async (...a) => { chamadas.push(a); return { ok: true, code: 0, stdout: '{}', stderr: '' }; };
  try {
    const e = new Engine();
    e.log = () => { };
    e.pushState = () => { };
    e.updateSettings({ accounts: [{ user: 'eu', owners: ['minha-org'] }, { user: 'outra', owners: ['outra-org'] }] });
    e.tokens = { eu: 'tok', outra: 'tok2' };
    e.token = 'tok';
    const r = await e.postReview({ key: 'Desconhecida/app#9', repo: 'Desconhecida/app', number: 9 }, { event: 'COMMENT', body: 'Ok por aqui.' });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, 'sem_conta_dona');
    // o ciclo de fundo do engine também chama o gh (token, contas); o que não pode existir é
    // chamada que toque o PR
    assert.equal(chamadas.filter((c) => (c[1] || []).some((a) => /pulls|reviews/.test(String(a)))).length, 0);
  } finally {
    io.run = runOriginal;
  }
});
