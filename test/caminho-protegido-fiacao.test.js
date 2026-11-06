// A fiação do caminho protegido nas sessões de verdade (06/11/2026, revisão do PR #350): o que o
// lançador RECEBE (guardas e MCP, com a exceção da execução isolada), a leitura observada que
// chega ao gate da revisão e à autoanálise, e o escopo gravado para a revisão no terminal.
// Os testes dirigem runHeadlessReview, runSelfAnalysis e launchReview com o lançador dublado,
// no mesmo molde de test/analysis-source-flows.test.js: nada aqui lê o fonte.
import { criteriaFixture } from './helpers/criteria-fixture.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-protegido-fiacao-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { sourceRuntime } = await import('../lib/engine/analysis-source.js');
const { observeReadEvent, observarLeitura } = await import('../lib/engine/read-evidence.js');
const { ARQUIVO_DE_GUARDAS } = await import('../lib/engine/guardas-da-sessao.js');
const { arquivoMaterializado } = await import('../lib/engine/pr-scope.js');
const { nomeMaterializado } = await import('../lib/review-source/caminho-protegido.js');
const { WORKSPACE } = await import('../lib/paths.js');
const io = (await import('../lib/io.js')).default;
const original = { ...sourceRuntime }, runOriginal = io.run;
afterEach(() => { Object.assign(sourceRuntime, original); io.run = runOriginal; });
after(() => fs.rmSync(home, { recursive: true, force: true }));

const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40);
const pr = { key: 'org/repo#1', repo: 'org/repo', number: 1, url: 'https://github.com/org/repo/pull/1', author: 'autor', headSha: H, requested: true };
const PROJECAO = '# projeção redigida\n+DEBUG=true\n';
const files = [
  { path: 'src/a.js', sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', patchStatus: 'available' },
  { path: '.env.example', sha: 'e'.repeat(40), status: 'modified', patch: PROJECAO, patchStatus: 'available' },
];
const GUARDAS = ['--settings', `"${ARQUIVO_DE_GUARDAS}"`];

// A execução isolada lê pela fonte (reader); as outras não precisam dele.
function source(arquivos = files, comLeitor = false) {
  const reader = comLeitor ? { tree: async () => ({ complete: true, entries: arquivos.map((f) => ({ path: f.path, readable: true, mode: '100644' })) }),
    read: async () => ({ status: 'available', text: 'source' }) } : {};
  return { status: 'complete', reason: '', reader,
    manifest: { scope: { account: 'fixture', repo: 'org/repo' }, H, B, M, files: arquivos, limitations: [] },
    inventory: { status: 'complete', headSha: H, baseSha: B, files: arquivos, changedFiles: arquivos.length },
    release: async () => {} };
}
function setup({ jira = true } = {}) {
  const e = new Engine();
  e.config = { ...e.config, reReviewResume: false, reviewContextMode: 'off', sync: {},
    jiraSites: jira ? [{ id: 'site-fixture', baseUrl: 'https://fixture.example.invalid', owners: ['outra-org'] }] : [],
    accounts: [{ user: 'fixture', owners: ['org'], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' }] };
  e.accountForPr = () => 'fixture'; e.tokenFor = () => 'fixture-token'; e.resolveClaudeAuth = () => ({ kind: 'dir' });
  e.headSha = async () => H;
  e.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: H });
  e.myReviewStates = async () => [];
  e.myPRs = [{ ...pr }]; e.decisions = { pending: [], resolved: [] }; e.selfAnalyses = {};
  e.writeMemory = e.writeInflight = e.pushState = e.processHeadless = e.log = () => {};
  e.postReview = async () => { throw new Error('Nenhuma publicação permitida na fixture.'); };
  e.fetchMergeState = async () => null;
  io.run = async (_command, args) => {
    if (args.includes('headRefOid')) return { ok: true, stdout: H };
    if (args.includes('--json')) return { ok: true, stdout: JSON.stringify({ headRefOid: H, baseRefOid: B, statusCheckRollup: [] }) };
    if (args.includes('--paginate')) return { ok: true, stdout: '[[]]' };
    return { ok: false, code: 1, stdout: '', stderr: 'Operação externa bloqueada pela fixture.' };
  };
  sourceRuntime.prepareSources = async () => source();
  return e;
}

// A leitura da projeção redigida como o stream do Claude a entrega: pedido e retorno conferível.
function lerProjecao(e, opts, comRetorno) {
  const session = e.activeReviews.get(opts.id);
  const filePath = arquivoMaterializado(session.scopeRoot, '.env.example');
  assert.equal(fs.readFileSync(filePath, 'utf8'), PROJECAO, 'a projeção está no nome redigido');
  const block = { type: 'tool_use', id: 'r-env', name: 'Read', input: { file_path: filePath } };
  observeReadEvent(e, opts, { type: 'assistant', message: { content: [block] } });
  observarLeitura(e, opts, block);
  if (!comRetorno) return;
  const linhas = PROJECAO.split('\n');
  observeReadEvent(e, opts, { type: 'user', tool_use_result: { type: 'text', file: { filePath, content: PROJECAO, startLine: 1, numLines: linhas.length } },
    message: { content: [{ type: 'tool_result', tool_use_id: 'r-env', content: linhas.map((l, i) => `${i + 1}→${l}`).join('\n') }] } });
}

function reviewResult() {
  return { ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', reasons: [],
    findings: [], reportMarkdown: 'Análise sintética.', reviewMarkdown: 'Análise sintética.',
    coverage: { total: 2, reviewed: ['src/a.js', '.env.example'], missing: [] },
    alcance: [{ alterado: 'src/a.js', chamadores: [], semChamador: 'Fixture não declara consumidor externo.' }],
    payloads: { approve: { event: 'APPROVE', body: 'Análise sintética.' }, request_changes: { event: 'REQUEST_CHANGES', body: 'Análise sintética.' } } };
}
function selfResult() {
  return { verdict: 'approvable', approvable: true, cardMet: true, blockers: [], externalBlockers: [], tips: [],
    coverageLimitations: [], reportMarkdown: 'Análise sintética.', summary: 'Fixture.' };
}
const LACUNA = /caminho protegido sem leitura observada da projeção redigida: \.env\.example/;
const motivosDe = (item) => JSON.stringify(item);

test('a revisão headless entrega ao lançador o MCP do Jira e as guardas juntos', async () => {
  const e = setup();
  let args = null;
  e.runClaudeStream = async (_prompt, opts) => { args = opts.extraArgs; return { text: JSON.stringify(reviewResult()) }; };
  await e.runHeadlessReview({ ...pr });
  assert.ok(Array.isArray(args), 'o lançador foi chamado');
  assert.ok(args.includes('--mcp-config') && args.includes('--strict-mcp-config'), JSON.stringify(args));
  const i = args.indexOf('--settings');
  assert.deepEqual(args.slice(i, i + 2), GUARDAS, 'as guardas da sessão chegam ao lançador');
});

test('a revisão headless sem Jira cadastrado ainda recebe as guardas', async () => {
  const e = setup({ jira: false });
  let args = null;
  e.runClaudeStream = async (_prompt, opts) => { args = opts.extraArgs; return { text: JSON.stringify(reviewResult()) }; };
  await e.runHeadlessReview({ ...pr });
  assert.deepEqual(args, GUARDAS);
});

test('a autoanálise entrega guardas e MCP, e a execução isolada não leva nenhum', async () => {
  for (const isolation of [undefined, 'restricted-read']) {
    const e = setup();
    if (isolation) sourceRuntime.prepareSources = async () => source([files[0]], true);
    let args = null;
    e.runClaudeStream = async (_prompt, opts) => { args = opts.extraArgs; return { text: JSON.stringify(selfResult()) }; };
    await e.runSelfAnalysis({ ...pr, isolation });
    if (isolation) { assert.deepEqual(args, [], 'execução isolada: nada além do que ela mesma monta'); continue; }
    assert.ok(args.includes('--mcp-config') && args.includes('--strict-mcp-config'), JSON.stringify(args));
    const i = args.indexOf('--settings');
    assert.deepEqual(args.slice(i, i + 2), GUARDAS);
  }
});

test('a leitura observada da projeção chega ao gate da revisão (leiturasProvadas)', async () => {
  for (const comRetorno of [false, true]) {
    const e = setup();
    e.runClaudeStream = async (_prompt, opts) => { lerProjecao(e, opts, comRetorno); return { text: JSON.stringify(reviewResult()) }; };
    await e.runHeadlessReview({ ...pr });
    const item = e.decisions.pending[0] || e.decisions.resolved[0];
    assert.ok(item, 'a decisão foi registrada');
    if (comRetorno) assert.doesNotMatch(motivosDe(item), LACUNA, 'leitura conferida cobre o protegido');
    else assert.match(motivosDe(item), LACUNA, 'só o pedido, sem entrega conferida, é lacuna');
  }
});

test('a autoanálise só conta o protegido lido com a entrega conferida', async () => {
  for (const comRetorno of [false, true]) {
    const e = setup();
    e.runClaudeStream = async (_prompt, opts) => { lerProjecao(e, opts, comRetorno); return { text: JSON.stringify(selfResult()) }; };
    await e.runSelfAnalysis({ ...pr });
    const scope = e.selfAnalyses[pr.key].observed.scope;
    assert.equal(scope.reviewed.includes('.env.example'), comRetorno, JSON.stringify(scope));
    assert.equal(scope.missing.includes('.env.example'), !comRetorno);
  }
});

/* ---------- revisão no terminal ---------- */

const PATCHES_DO_GITHUB = [
  { filename: 'src/a.js', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
  { filename: 'apps/.env.d/prod.env', status: 'modified', patch: '@@ -1 +1 @@\n-API_KEY=velho\n+API_KEY=novo' },
];

test('o terminal grava o escopo, passa escopo= e abre o claude com as guardas', async () => {
  const e = setup();
  e.queue = [{ ...pr }];
  e.bloqueiaAutomatico = async () => false;
  io.run = async (_command, args) => {
    if (args.join(' ').includes('pulls/1/files')) return { ok: true, stdout: JSON.stringify([PATCHES_DO_GITHUB]) };
    return { ok: true, stdout: '[]' };
  };
  const abertos = [];
  e.spawnConsole = (slash, label, keys) => { abertos.push({ slash, label, keys }); return { ok: true }; };
  const r = await e.launchReview([pr.url], 'terminal', 'clique');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(abertos.length, 1);
  const m = abertos[0].slash.match(/^\/pr-review (\S+) escopo=(\S+)$/);
  assert.ok(m, abertos[0].slash);
  assert.equal(m[1], pr.url);
  assert.doesNotMatch(m[2], /%|\\/, 'a raiz atravessa o .cmd do Windows: sem % e sem barra invertida');
  const raiz = path.join(WORKSPACE, ...m[2].split('/'));
  assert.equal(fs.readFileSync(path.join(raiz, 'src', 'a.js'), 'utf8'), PATCHES_DO_GITHUB[0].patch);
  const redigido = path.join(raiz, ...nomeMaterializado('apps/.env.d/prod.env').split('/'));
  const projecao = fs.readFileSync(redigido, 'utf8');
  assert.doesNotMatch(projecao, /velho/, 'o valor antigo do protegido não chega ao disco da sessão');
  assert.equal(fs.existsSync(path.join(raiz, 'apps', '.env.d')), false, 'nada no caminho original');

  const win = e.buildSessionScript(abertos[0].slash, 'fixture', 'cap');
  assert.ok(win.includes(`claude --settings "${ARQUIVO_DE_GUARDAS}" "${abertos[0].slash}"`), win);
  const mac = e.buildSessionScriptMac(abertos[0].slash, 't1', 'fixture', 'cap');
  assert.ok(mac.includes(`claude --settings '${ARQUIVO_DE_GUARDAS}' '${abertos[0].slash}'`), mac);
});

test('o terminal abre mesmo sem conseguir ler os patches, só sem escopo=', async () => {
  const e = setup();
  e.queue = [{ ...pr }];
  e.bloqueiaAutomatico = async () => false;
  io.run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'fora do ar' });
  const abertos = [];
  e.spawnConsole = (slash) => { abertos.push(slash); return { ok: true }; };
  await e.launchReview([pr.url], 'terminal', 'clique');
  assert.deepEqual(abertos, [`/pr-review ${pr.url}`]);
});

test('o protocolo do pr-reviewer descreve a raiz de escopo do terminal e o nome achatado', () => {
  const agente = fs.readFileSync(path.join(import.meta.dirname, '..', 'workspace-template', '.claude', 'agents', 'pr-reviewer.md'), 'utf8');
  assert.match(agente, /escopo=<raiz>/);
  assert.match(agente, /_farol_redigido_\/_apps%2Fweb%2F\.env\.local\.redigido/);
  const comando = fs.readFileSync(path.join(import.meta.dirname, '..', 'workspace-template', '.claude', 'commands', 'pr-review.md'), 'utf8');
  assert.match(comando, /escopo=<raiz>/);
});
