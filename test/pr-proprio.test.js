// PR da própria conta nunca vira revisão headless (28/09/2026).
//
// Caso medido: um PR do engine-ai era da conta deste Farol, e um aparelho do grupo
// abriu revisão headless nele com a mesma conta. A label `<conta>:revisando`
// ficou oito minutos no PR, com o autor "revisando" o próprio trabalho. As três portas:
// a regra pura, o launchReview (clique, URL avulsa) e o enqueueHeadless (re-revisão,
// comando e distribuição passam por ele).
// Runner nativo, ZERO deps. Engine real com FAROL_HOME temporário.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-pr-proprio-'));

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');
const { ehPrProprio, ehMeu } = await import('../lib/engine/pr-proprio.js');
const porta = (await import('../lib/engine/porta-de-execucao.js')).default;
const { STATE_DIR } = await import('../lib/paths.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

function engineDe(conta) {
  const e = new Engine();
  e.config.accounts = [{ user: conta, owners: ['biudtech'] }];
  e.token = 'tok';
  e.tokens = { [conta]: 'tok' };
  e.tokenOk = true;
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.pushState = () => { };
  e.bloqueiaAutomatico = async () => false;
  return e;
}

const URL_314 = 'https://github.com/biudtech/engine-ai/pull/314';
const prDo = (author) => ({ key: 'biudtech/engine-ai#314', url: URL_314, repo: 'biudtech/engine-ai', number: 314, author });

test('ehPrProprio: mesma conta sem diferenciar caixa; dado faltando nunca prova', () => {
  assert.equal(ehPrProprio('wandersonbiuder', 'wandersonbiuder'), true);
  assert.equal(ehPrProprio('WandersonBiuder', 'wandersonbiuder'), true);
  assert.equal(ehPrProprio('Alexpraxedes', 'wandersonbiuder'), false);
  assert.equal(ehPrProprio('', 'wandersonbiuder'), false);
  assert.equal(ehPrProprio('wandersonbiuder', ''), false);
  assert.equal(ehPrProprio(undefined, undefined), false);
});

test('launchReview: PR do panorama cujo autor é a conta não enfileira e avisa', async () => {
  const e = engineDe('wandersonbiuder');
  e.panorama = [prDo('wandersonbiuder')];
  const enfileirados = [];
  const toasts = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  e.on('toast', (t) => toasts.push(t));
  const r = await e.launchReview([URL_314], 'auto', 'clique');
  assert.equal(r.ok, false);
  assert.equal(enfileirados.length, 0, 'nem o clique abre revisão headless em PR próprio');
  assert.ok(toasts.some(t => /autoanálise/.test(t.text)), 'o aviso aponta a autoanálise');
  assert.equal(e.seen.has(prDo('').key), false, 'PR barrado não é marcado como visto');
});

test('launchReview: URL avulsa (sem autor) de PR que está em Meus PRs é barrada sem ir ao GitHub', async () => {
  const e = engineDe('wandersonbiuder');
  e.myPRs = [prDo('wandersonbiuder')];
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  e.on('toast', () => { });
  const r = await e.launchReview([URL_314], 'auto', 'clique');
  assert.equal(r.ok, false);
  assert.equal(enfileirados.length, 0);
  assert.equal(chamadas.length, 0, 'a prova é a lista em memória, sem chamada gh');
});

test('launchReview: PR de outra pessoa segue normalmente', async () => {
  const e = engineDe('wandersonbiuder');
  e.panorama = [prDo('Alexpraxedes')];
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  e.on('toast', () => { });
  const r = await e.launchReview([URL_314], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.equal(enfileirados.length, 1);
  assert.equal(chamadas.some(c => c.args.includes('author')), false, 'autor conhecido não custa chamada gh');
});

test('enqueueHeadless: re-revisão, comando e distribuição também não entram com PR próprio', () => {
  const e = engineDe('wandersonbiuder');
  const r = e.enqueueHeadless({ ...prDo('wandersonbiuder'), viaComando: true });
  assert.deepEqual(r, { ok: false, code: 'pr-proprio' });
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(porta.motivoParaNaoExecutar(e, prDo('wandersonbiuder')), 'pr-proprio', 'a regra mora na porta de execução');
  assert.deepEqual(porta.executaveis(e, [prDo('wandersonbiuder')]), []);
});

test('ehMeu: autor de outra pessoa nunca é trocado pela lista Meus PRs', () => {
  const e = engineDe('wandersonbiuder');
  e.myPRs = [prDo('wandersonbiuder')];
  assert.equal(ehMeu(e, prDo('Alexpraxedes')), false);
  assert.equal(ehMeu(e, prDo('')), true);
  e.myPRs = [];
  assert.equal(ehMeu(e, prDo('')), false, 'sem prova, não barra');
});
