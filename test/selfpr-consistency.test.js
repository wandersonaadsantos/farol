'use strict';
// Consistência da autoanálise e do estado de merge (selfpr.js), que alimentam os gates
// do botão Merge: o SHA que carimba a autoanálise (gate 1 do mergeSelfPR), a base que
// alimenta o gate de ruleset (tarefa B7) e a reconciliação do mergeStates (B8).
// Cenários adversariais: push no meio da análise, análise sem SHA, escrita concorrente.
// Mesma técnica de espião do merge-gates.test.js (instalado ANTES do require do server).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-selfpr-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const io = require('../lib/io');
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = require('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

const URL_PR = 'https://github.com/acme/app/pull/42';
const CHAVE = 'acme/app#42';
const MEU_PR = { key: CHAVE, repo: 'acme/app', number: 42, url: URL_PR, title: 'PR meu' };

function novoEngine() {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.saveSelfAnalyses = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  return engine;
}

function envelope(extra) {
  return JSON.stringify({
    approvable: true, verdict: 'aprovável', confidence: 'alta', summary: 'ok',
    blockers: [], tips: [], reportMarkdown: '# ok', ...extra
  });
}

// roteia o gh: headRefOid devolve o SHA "atual" (mutável pelo teste, simula push)
function roteadorSha(sha) {
  return (cmd, args) => {
    const sub = args.join(' ');
    if (sub.includes('headRefOid')) return Promise.resolve({ ok: true, stdout: sha.valor, stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
}

/* ---------- A6: o SHA que carimba a autoanálise ---------- */

test('o SHA é capturado ANTES da sessão e carimba a análise', async () => {
  const sha = { valor: 'aaa111' };
  runImpl = roteadorSha(sha);
  const engine = novoEngine();
  let lidosAntesDaSessao = 0;
  engine.runClaudeStream = async () => {
    lidosAntesDaSessao = chamadas.filter(c => c.args.join(' ').includes('headRefOid')).length;
    return { text: envelope(), sessionId: 'sess1' };
  };
  engine.fetchMergeState = async () => null;
  await engine.runSelfAnalysis(MEU_PR);
  assert.equal(lidosAntesDaSessao, 1, 'uma leitura de SHA antes da sessão começar');
  assert.equal(engine.selfAnalyses[CHAVE].headSha, 'aaa111', 'a análise vale pro commit que ela leu');
});

test('push DURANTE a análise descarta o resultado com registro claro (TOCTOU)', async () => {
  const sha = { valor: 'aaa111' };
  runImpl = roteadorSha(sha);
  const engine = novoEngine();
  const avisos = [];
  engine.log = (lvl, msg) => avisos.push(`${lvl}: ${msg}`);
  engine.runClaudeStream = async () => {
    sha.valor = 'bbb222';               // alguém deu push no meio da análise
    return { text: envelope(), sessionId: 'sess1' };
  };
  await engine.runSelfAnalysis(MEU_PR);
  assert.equal(engine.selfAnalyses[CHAVE], undefined, 'análise de commit velho não pode alimentar o gate de merge');
  assert.ok(avisos.some(m => /commit novo durante a análise/.test(m)), 'o descarte fica registrado no log');
});

test('análise sem SHA registrado é descartada quando o head atual é conhecido', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR }];
  engine.selfAnalyses = { [CHAVE]: { approvable: true, headSha: null } };
  engine.mergeStates = { [CHAVE]: { status: 'CLEAN', at: Date.now() } };
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (sub.includes('headRefName')) {
      return Promise.resolve({ ok: true, stdout: JSON.stringify({ headRefName: 'f', baseRefName: 'develop', headRefOid: 'ccc333' }), stderr: '' });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  await engine.enrichMyPRBranches();
  assert.equal(engine.selfAnalyses[CHAVE], undefined, 'sem SHA não dá pra provar que a análise vale pro commit atual');
  assert.equal(engine.mergeStates[CHAVE], undefined, 'o botão Merge não pode viver de análise incomprovável');
});
