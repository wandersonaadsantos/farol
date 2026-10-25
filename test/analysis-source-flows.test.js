import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-source-flows-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { sourceRuntime } = await import('../lib/engine/analysis-source.js');
const { PROFILE_FILE } = await import('../lib/technical-review/profiles.js');
const io = (await import('../lib/io.js')).default;
const original = { ...sourceRuntime }, runOriginal = io.run;
afterEach(() => { Object.assign(sourceRuntime, original); io.run = runOriginal; });
after(() => fs.rmSync(home, { recursive: true, force: true }));
const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40);
const pr = { key: 'org/repo#1', repo: 'org/repo', number: 1, url: 'https://github.com/org/repo/pull/1', author: 'autor', headSha: H, requested: true };
const files = [{ path: 'src/a.js', sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }];
function source(status = 'complete') {
  let releases = 0;
  return { status, reason: status === 'complete' ? '' : 'Fixture sem acesso à fonte.',
    manifest: { scope: { account: 'fixture', repo: 'org/repo' }, H, B, M, files, limitations: [] }, reader: {},
    inventory: { status, headSha: H, baseSha: B, files, changedFiles: files.length },
    release: async () => { releases++; }, releases: () => releases };
}
function setup(kind = 'dir') {
  const e = new Engine();
  e.config = { ...e.config, jiraSites: [], reReviewResume: false, reviewContextMode: 'off', sync: {},
    accounts: [{ user: 'fixture', owners: ['org'], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' }] };
  e.accountForPr = () => 'fixture'; e.tokenFor = () => ''; e.resolveClaudeAuth = () => ({ kind });
  e.headSha = async () => H;
  e.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: H });
  e.myReviewStates = async () => [];
  e.myPRs = [{ ...pr }]; e.decisions = { pending: [], resolved: [] }; e.selfAnalyses = {};
  e.writeMemory = e.writeInflight = e.pushState = e.processHeadless = e.log = () => {};
  e.postReview = async () => { throw new Error('Nenhuma publicação permitida na fixture.'); };
  e.fetchPrInventory = async () => { throw new Error('Não deve repetir inventário preparado.'); };
  e.fetchMergeState = async () => null;
  io.run = async (_command, args) => {
    if (args.includes('headRefOid')) return { ok: true, stdout: H };
    return { ok: false, code: 1, stdout: '', stderr: 'Operação externa bloqueada pela fixture.' };
  };
  return e;
}
function reviewResult() {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', reasons: [],
    findings: [], reportMarkdown: 'Análise sintética.', reviewMarkdown: 'Análise sintética.',
    coverage: { total: 1, reviewed: [], missing: ['src/a.js'] },
    alcance: [{ alterado: 'src/a.js', chamadores: [], semChamador: 'Fixture não declara consumidor externo.' }],
    contextEvidence: { sourceStatus: 'forged', mode: 'assist' },
    payloads: { approve: { event: 'APPROVE', body: 'Análise sintética.' }, request_changes: { event: 'REQUEST_CHANGES', body: 'Análise sintética.' } } };
}
function selfResult() {
  return { verdict: 'approvable', approvable: true, cardMet: true, blockers: [], externalBlockers: [], tips: [],
    coverageLimitations: [], reportMarkdown: 'Análise sintética.', summary: 'Fixture.',
    contextEvidence: { sourceStatus: 'forged', mode: 'assist' } };
}
function assertPrepared(prompt, session) {
  assert.match(prompt, /Fontes e patches preparados/);
  for (const sha of [H, B, M]) assert.ok(prompt.includes(sha));
  assert.equal(fs.readFileSync(path.join(session.scopeRoot, 'src/a.js'), 'utf8'), files[0].patch);
  assert.equal(session.totalArquivos, 1);
}
test('Engine review usa fonte comum sem perfil técnico e persiste diagnóstico que o modelo não pode forjar', async () => {
  const e = setup(), handle = source();
  assert.equal(fs.existsSync(PROFILE_FILE), false);
  sourceRuntime.prepareSources = async () => handle;
  let entered = 0;
  e.runClaudeStream = async (prompt, options) => {
    entered++; assertPrepared(prompt, e.activeReviews.get(options.id));
    return { text: JSON.stringify(reviewResult()) };
  };
  await e.runHeadlessReview({ ...pr });
  assert.equal(entered, 1); assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
  const item = e.decisions.pending[0] || e.decisions.resolved[0];
  assert.ok(item); assert.equal(item.contextEvidence.sourceStatus, 'complete'); assert.equal(item.contextEvidence.mode, 'off');
  assert.equal(item.technicalReview.semDeclaracao, true);
});
test('Engine autoanálise usa os mesmos patches e mantém Codex/AGY sem leitura observável inventada', async () => {
  for (const kind of ['codex', 'agy']) {
    const e = setup(kind), handle = source(); sourceRuntime.prepareSources = async () => handle;
    e.runClaudeStream = async (prompt, options) => {
      assertPrepared(prompt, e.activeReviews.get(options.id));
      return { text: JSON.stringify(selfResult()) };
    };
    await e.runSelfAnalysis({ ...pr });
    const item = e.selfAnalyses[pr.key];
    assert.equal(item.contextEvidence.sourceStatus, 'complete'); assert.equal(item.contextEvidence.mode, 'off');
    assert.equal(item.observed.scope.observavel, false); assert.deepEqual(item.observed.scope.reviewed, []);
    assert.deepEqual(item.observed.scope.total, ['src/a.js']); assert.equal(handle.releases(), 1);
    assert.equal(e.activeReviews.size, 0);
  }
});
test('cancelamento na aquisição de ambos fluxos impede modelo, não publica e devolve lease', async () => {
  for (const flow of ['runHeadlessReview', 'runSelfAnalysis']) {
    const e = setup(), handle = source(); let entered, finish, signal, model = 0;
    const acquisition = new Promise(resolve => { entered = resolve; });
    sourceRuntime.prepareSources = (_engine, _pr, options) => {
      signal = options.signal; entered(); return new Promise(resolve => { finish = resolve; });
    };
    e.runClaudeStream = async () => { model++; throw new Error('Não deve executar.'); };
    const running = e[flow]({ ...pr }); await acquisition;
    const id = [...e.activeReviews.keys()][0]; assert.ok(id);
    assert.deepEqual(e.cancelSession(id), { ok: true }); assert.equal(signal.aborted, true);
    finish(handle);
    await assert.rejects(running, error => error.cancelled === true);
    assert.equal(model, 0); assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
    assert.equal(e.decisions.pending.length + e.decisions.resolved.length, 0);
    assert.equal(e.selfAnalyses[pr.key], undefined);
  }
});
test('falha do modelo em ambos fluxos libera a fonte e não inventa resultado', async () => {
  for (const flow of ['runHeadlessReview', 'runSelfAnalysis']) {
    const e = setup(), handle = source(); sourceRuntime.prepareSources = async () => handle;
    e.runClaudeStream = async () => { throw new Error('Provedor indisponível na fixture.'); };
    await assert.rejects(e[flow]({ ...pr }), /Provedor indisponível/);
    assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
    assert.equal(e.decisions.pending.length + e.decisions.resolved.length, 0);
    assert.equal(e.selfAnalyses[pr.key], undefined);
  }
});
test('fonte indisponível mantém fallback inconclusivo, sem cobertura ou aprovação fabricadas', async () => {
  for (const flow of ['runHeadlessReview', 'runSelfAnalysis']) {
    const e = setup(), handle = source('unavailable'); sourceRuntime.prepareSources = async () => handle;
    e.fetchPrInventory = async () => ({ status: 'unavailable', reason: 'Fixture sem inventário.', headSha: H, baseSha: B, files: [], changedFiles: null });
    e.runClaudeStream = async prompt => {
      assert.equal(prompt.includes('## Fontes e patches preparados'), false);
      return { text: JSON.stringify(flow === 'runHeadlessReview' ? reviewResult() : selfResult()) };
    };
    await e[flow]({ ...pr });
    const item = flow === 'runHeadlessReview' ? e.decisions.pending[0] : e.selfAnalyses[pr.key];
    assert.ok(item); assert.equal(item.contextEvidence.sourceStatus, 'unavailable');
    if (flow === 'runSelfAnalysis') {
      assert.equal(item.observed.scope, null);
      assert.equal(e.snapshot().selfAnalyses[pr.key].quality.status, 'inconclusive');
    } else assert.equal(item.inventarioDiff.status, 'unavailable');
    assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
  }
});
test('falha do índice em assist permite fluxo existente e registra limitação nos dois resultados', async () => {
  for (const flow of ['runHeadlessReview', 'runSelfAnalysis']) {
    const e = setup(), handle = source(); e.config.reviewContextMode = 'assist';
    sourceRuntime.prepareSources = async () => handle;
    sourceRuntime.buildMap = async () => { throw new Error('Fixture de índice incompleto.'); };
    e.runClaudeStream = async (prompt, options) => {
      assertPrepared(prompt, e.activeReviews.get(options.id));
      assert.equal(prompt.includes('## Navegação do código na revisão fixada'), false);
      return { text: JSON.stringify(flow === 'runHeadlessReview' ? reviewResult() : selfResult()) };
    };
    await e[flow]({ ...pr });
    const item = flow === 'runHeadlessReview' ? e.decisions.pending[0] : e.selfAnalyses[pr.key];
    assert.equal(item.contextEvidence.indexStatus, 'unavailable');
    assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
  }
});
