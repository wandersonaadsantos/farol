// Consistência da autoanálise e do estado de merge (selfpr.js), que alimentam os gates
// do botão Merge: o SHA que carimba a autoanálise (gate 1 do mergeSelfPR), a base que
// alimenta o gate de ruleset (tarefa B7) e a reconciliação do mergeStates (B8).
// Cenários adversariais: push no meio da análise, análise sem SHA, escrita concorrente.
// Mesma técnica de espião do merge-gates.test.js (instalado ANTES do require do server).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-selfpr-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = await import('../server.js');
const { qualityOf } = await import('../lib/engine/selfpr.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

const URL_PR = 'https://github.com/acme/app/pull/42';
const CHAVE = 'acme/app#42';
const MEU_PR = { key: CHAVE, repo: 'acme/app', number: 42, url: URL_PR, title: 'PR meu' };

// P0a: o alvo do refreshMergeStates deixou de ser "approvable === true" e passou a
// ser a elegibilidade calculada sobre EVIDENCIA. Sem `observed` nenhum PR entra na
// lista, e os testes de mecanica abaixo (ruleset, reconciliacao, limpeza) parariam de
// exercitar o que prometem. A evidencia completa aqui e o que os mantem honestos.
function analiseElegivel(over = {}) {
  const head = over.headSha === undefined ? 'e'.repeat(40) : over.headSha;
  return {
    approvable: true, blockers: [], cardMet: true, headSha: head,
    observed: {
      headSha: head,
      sessionOutcome: 'complete',
      scope: { total: ['src/a.js'], reviewed: ['src/a.js'], missing: [] },
      verification: { status: 'satisfied' },
      card: { requirement: 'readable', code: '' }
    },
    ...over
  };
}

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
    // contrato estrito do P0b: enum real de verdict, listas de verdade, sem coerção
    approvable: true, verdict: 'approvable', summary: 'ok',
    blockers: [], tips: [], coverageLimitations: [], reportMarkdown: '# ok', ...extra
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
  engine.selfAnalyses = { [CHAVE]: analiseElegivel({ headSha: null }) };
  engine.mergeStates = { [CHAVE]: { status: 'CLEAN', at: Date.now() } };
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (sub.includes('headRefName')) {
      return Promise.resolve({ ok: true, stdout: JSON.stringify({ headRefName: 'f', baseRefName: 'develop', headRefOid: 'ccc333' }), stderr: '' });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  await engine.enrichMyPRBranches();
  const reg = engine.selfAnalyses[CHAVE];
  assert.ok(reg, 'o registro PERSISTE: envelhecer deixou de apagar o relatório que a sessão pagou');
  assert.equal(reg.observed.stale, true, 'mas nasce carimbado como desatualizado');
  assert.equal(qualityOf(reg).status, 'ineligible', 'sem SHA não dá pra provar que a análise vale pro commit atual');
  assert.ok(qualityOf(reg).reasons.some(r => r.code === 'ANALYSIS_STALE'), 'e o motivo é nomeado, não genérico');
  assert.equal(engine.mergeStates[CHAVE], undefined, 'o botão Merge não pode viver de análise incomprovável');
});

test('análise desatualizada não é recarimbada a cada ciclo', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR }];
  engine.selfAnalyses = { [CHAVE]: analiseElegivel({ headSha: 'aaa111' }) };
  const avisos = [];
  engine.log = (lvl, msg) => avisos.push(`${lvl}: ${msg}`);
  runImpl = (cmd, args) => args.join(' ').includes('headRefName')
    ? Promise.resolve({ ok: true, stdout: JSON.stringify({ headRefName: 'f', baseRefName: 'develop', headRefOid: 'ccc333' }), stderr: '' })
    : Promise.resolve({ ok: true, stdout: '', stderr: '' });
  await engine.enrichMyPRBranches();
  const avisosDepoisDoPrimeiro = avisos.length;
  await engine.enrichMyPRBranches();
  assert.equal(avisos.length, avisosDepoisDoPrimeiro, 'o WARN sai UMA vez; o log é de falha, não de estado');
  assert.equal(engine.selfAnalyses[CHAVE].observed.stale, true, 'e o carimbo continua de pé');
});

/* ---------- B7: a base que alimenta o gate de ruleset ---------- */

test('fetchMergeState devolve baseRefName (o fallback do ruleset deixa de ser código morto)', async () => {
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (sub.startsWith('pr view')) {
      return Promise.resolve({ ok: true, stdout: JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', isDraft: false, state: 'OPEN', baseRefName: 'develop' }), stderr: '' });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  const ms = await novoEngine().fetchMergeState(URL_PR);
  assert.equal(ms.status, 'BLOCKED');
  assert.equal(ms.baseRefName, 'develop', 'a base vem junto, pro ruleset ser checável sem depender de pr.base');
});

test('refreshMergeStates em BLOCKED sem pr.base checa o ruleset com a base do fetchMergeState', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR, base: '' }];      // ainda não passou pelo enrichMyPRBranches
  engine.selfAnalyses = { [CHAVE]: analiseElegivel() };
  engine.fetchMergeState = async () => ({ mergeable: 'MERGEABLE', status: 'BLOCKED', isDraft: false, state: 'OPEN', baseRefName: 'develop', at: Date.now() });
  engine.fetchAutoMergeAllowed = async () => true;
  const consultas = [];
  engine.fetchRuleBlocked = async (repo, base) => { consultas.push({ repo, base }); return true; };
  await engine.refreshMergeStates();
  assert.deepEqual(consultas, [{ repo: 'acme/app', base: 'develop' }], 'o gate de ruleset recebe a base real');
  assert.equal(engine.mergeStates[CHAVE].adminBlocked, true, 'admin não é oferecido quando o ruleset bloqueia');
});

/* ---------- B8: reconciliação do mergeStates ---------- */

function msFresco(extra) {
  return { mergeable: 'MERGEABLE', status: 'CLEAN', isDraft: false, state: 'OPEN', baseRefName: 'develop', at: Date.now(), ...extra };
}

test('escrita concorrente do runSelfAnalysis durante o refresh não é engolida', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR }];
  engine.selfAnalyses = { [CHAVE]: analiseElegivel() };
  engine.fetchAutoMergeAllowed = async () => true;
  engine.fetchMergeState = async () => {
    // simula a autoanálise de OUTRO PR terminando no meio do await deste ciclo
    engine.mergeStates['acme/app#77'] = msFresco();
    return msFresco();
  };
  await engine.refreshMergeStates();
  assert.ok(engine.mergeStates[CHAVE], 'o alvo do ciclo entrou');
  assert.ok(engine.mergeStates['acme/app#77'], 'a entrada gravada durante o ciclo não pode sumir até o próximo polling');
});

test('entrada velha de PR que deixou de ser alvo continua saindo no refresh', async () => {
  const engine = novoEngine();
  engine.myPRs = [];
  engine.selfAnalyses = {};
  engine.mergeStates = { 'acme/app#99': msFresco({ at: Date.now() - 60000 }) };
  await engine.refreshMergeStates();
  assert.equal(engine.mergeStates['acme/app#99'], undefined, 'estado velho de não-alvo é limpo como sempre');
});

test('fetch que falhou continua derrubando a entrada do alvo (semântica original)', async () => {
  const engine = novoEngine();
  engine.myPRs = [{ ...MEU_PR }];
  engine.selfAnalyses = { [CHAVE]: analiseElegivel() };
  engine.mergeStates = { [CHAVE]: msFresco({ at: Date.now() - 60000 }) };
  engine.fetchMergeState = async () => null;
  await engine.refreshMergeStates();
  assert.equal(engine.mergeStates[CHAVE], undefined, 'sem leitura fresca, o botão não fica em pé por dado velho');
});
