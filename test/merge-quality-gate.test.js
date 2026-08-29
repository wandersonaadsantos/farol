// P0a: a autoanálise deixa de AUTORIZAR merge. O parecer do modelo vira opinião e a
// elegibilidade de qualidade passa a ser CALCULADA pelo Farol sobre evidência.
//
// O defeito medido em 29/08/2026: o único gate de qualidade de todo o caminho de merge
// era `analysis.approvable !== true` (selfpr.js), um booleano produzido pelo LLM, e o
// mesmo gate servia o `--admin`, que bypassa branch protection. Ou seja, a proteção de
// branch deixava de ser segunda barreira justamente onde a decisão de qualidade era mais
// fraca. A regra estava copiada em QUATRO sítios (mergeSelfPR, refreshMergeStates, o
// fetch pós-análise e o canMerge da UI), então fechar só a porta do merge deixaria as
// autoridades derivadas de pé.
//
// Estes testes fixam a DECISÃO ARQUITETURAL, não a implementação: dada a mesma
// evidência, o valor de `approvable` não pode mudar o resultado.
//
// Espião no `run` instalado antes do require do server, mesma técnica do merge-gates.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-qualgate-' + process.pid);
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
const { evaluateQualityEligibility } = await import('../lib/engine/selfpr.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const URL_PR = 'https://github.com/acme/app/pull/42';
const CHAVE = 'acme/app#42';

// parecer do MODELO: o que ele tem direito de afirmar
function parecer(over = {}) {
  return { approvable: true, blockers: [], cardMet: true, ...over };
}

// evidência do ENGINE: o que o app sabe objetivamente
function evidencia(over = {}) {
  return {
    sessionOutcome: 'complete',
    scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js', 'src/b.js'], missing: [] },
    verification: { status: 'satisfied' },
    ...over
  };
}

const codes = (r) => (r.reasons || []).map(x => x.code).sort();

/* ---------- controle positivo ----------
   Sem este teste a suíte inteira passaria com uma função que sempre recusa, e aí ela
   provaria contenção sem provar gate. É o caso que separa "fechado" de "quebrado". */

test('evidência completa e sem blocker é elegível', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia());
  assert.equal(r.status, 'eligible');
  assert.deepEqual(r.reasons, []);
});

/* ---------- evidência faltando: inconclusive ---------- */

test('registro legado, sem evidência nenhuma do engine, é inconclusivo', () => {
  const r = evaluateQualityEligibility(parecer(), undefined);
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('COVERAGE_UNKNOWN'));
});

test('cobertura incompleta é inconclusivo e nomeia os arquivos que faltaram', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia({
    scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js'], missing: ['src/b.js'] }
  }));
  assert.equal(r.status, 'inconclusive');
  const motivo = r.reasons.find(x => x.code === 'COVERAGE_INCOMPLETE');
  assert.deepEqual(motivo.detail.missing, ['src/b.js']);
});

test('sessão abortada é inconclusivo, mesmo com cobertura completa', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia({ sessionOutcome: 'aborted' }));
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('ANALYSIS_INCOMPLETE'));
});

/* ---------- evidência definitiva contra: ineligible ---------- */

test('blocker é evidência contra, não evidência faltando', () => {
  const r = evaluateQualityEligibility(parecer({ blockers: ['quebra o guard'] }), evidencia());
  assert.equal(r.status, 'ineligible');
  assert.deepEqual(codes(r), ['BLOCKER_PRESENT']);
});

test('blocker com cobertura faltando acumula as duas razões e ineligible vence', () => {
  const r = evaluateQualityEligibility(
    parecer({ blockers: ['quebra o guard', 'regressão no hub'] }),
    evidencia({ scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js'], missing: ['src/b.js'] } })
  );
  assert.equal(r.status, 'ineligible', 'prioridade: ineligible > inconclusive > eligible');
  assert.deepEqual(codes(r), ['BLOCKER_PRESENT', 'COVERAGE_INCOMPLETE']);
  assert.equal(r.reasons.find(x => x.code === 'BLOCKER_PRESENT').detail.count, 2);
});

/* ---------- card e verificação: quatro valores, não três ---------- */

test('card não atendido é ineligible; card desconhecido é inconclusivo', () => {
  const naoAtende = evaluateQualityEligibility(parecer({ cardMet: false }), evidencia());
  assert.equal(naoAtende.status, 'ineligible');
  assert.ok(codes(naoAtende).includes('CARD_UNSATISFIED'));

  const desconhecido = evaluateQualityEligibility(parecer({ cardMet: null }), evidencia());
  assert.equal(desconhecido.status, 'inconclusive');
  assert.ok(codes(desconhecido).includes('CARD_UNKNOWN'));
});

test('verificação que falhou é ineligible; exigida e não executada é inconclusivo', () => {
  const falhou = evaluateQualityEligibility(parecer(), evidencia({ verification: { status: 'failed' } }));
  assert.equal(falhou.status, 'ineligible');
  assert.ok(codes(falhou).includes('VERIFICATION_FAILED'));

  const naoRodou = evaluateQualityEligibility(parecer(), evidencia({ verification: { status: 'unknown' } }));
  assert.equal(naoRodou.status, 'inconclusive');
  assert.ok(codes(naoRodou).includes('VERIFICATION_MISSING'));
});

test('verificação não aplicável pela política satisfaz, não bloqueia', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia({ verification: { status: 'not_applicable' } }));
  assert.equal(r.status, 'eligible');
});

/* ---------- a decisão arquitetural ---------- */

test('approvable não tem autoridade: mesma evidência, mesmo resultado', () => {
  const cenarios = [
    evidencia(),
    evidencia({ scope: { total: ['a'], reviewed: [], missing: ['a'] } })
  ];
  for (const ev of cenarios) {
    const comTrue = evaluateQualityEligibility(parecer({ approvable: true }), ev);
    const comFalse = evaluateQualityEligibility(parecer({ approvable: false }), ev);
    assert.equal(comTrue.status, comFalse.status, 'o parecer do modelo não muda a elegibilidade');
    assert.deepEqual(codes(comTrue), codes(comFalse));
  }
});

/* ---------- integração: as portas ---------- */

function prView(over = {}) {
  return JSON.stringify({
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    author: { login: 'eu' }, headRefName: 'feature/x', baseRefName: 'develop',
    title: 'PR de teste', ...over
  });
}

function roteador() {
  return (cmd, args) => {
    const sub = args.join(' ');
    if (sub.startsWith('pr view')) return Promise.resolve({ ok: true, stdout: prView(), stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
}

function novoEngine(analise) {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.config.mergeBlockedRepos = [];
  engine.selfAnalyses = { [CHAVE]: analise };
  engine.myPRs = [{ key: CHAVE, repo: 'acme/app', url: URL_PR }];
  engine.saveSelfAnalyses = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  return engine;
}

const mergeChamado = () => chamadas.filter(c => c.args.join(' ').startsWith('pr merge'));

beforeEach(() => { chamadas.length = 0; runImpl = null; });

test('mergeSelfPR recusa análise approvable:true sem cobertura comprovada', async () => {
  runImpl = roteador();
  const r = await novoEngine({ key: CHAVE, approvable: true }).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'nenhum merge tentado');
});

test('--admin não reduz o gate de qualidade', async () => {
  runImpl = roteador();
  const analise = {
    key: CHAVE, approvable: true,
    observed: { sessionOutcome: 'complete', scope: { total: ['a', 'b'], reviewed: ['a'], missing: ['b'] } }
  };
  const r = await novoEngine(analise).mergeSelfPR(URL_PR, { mode: 'admin' });
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'admin não pode furar o gate de qualidade');
});

test('contradição interna (approvable true com blocker) recusa', async () => {
  runImpl = roteador();
  const analise = {
    key: CHAVE, approvable: true, blockers: ['quebra o guard'], cardMet: true,
    observed: evidencia()
  };
  const r = await novoEngine(analise).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0);
});

test('autoridade derivada: refreshMergeStates não consulta o gh para análise inelegível', async () => {
  runImpl = roteador();
  const engine = novoEngine({ key: CHAVE, approvable: true }); // sem observed = inconclusivo
  let consultou = 0;
  engine.fetchMergeState = async () => { consultou++; return null; };
  engine.fetchAutoMergeAllowed = async () => false;
  await engine.refreshMergeStates();
  assert.equal(consultou, 0, 'PR inelegível não pode nem entrar na lista de alvos');
});
