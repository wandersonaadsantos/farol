// Engine anterior/final completos, transporte GitHub congelado e provedor sem modelo.
// Execute com FAROL_HOME privado. Não usa checkout de fontes nem credenciais reais.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { envSemRepositorioHerdado } from '../lib/git-env.js';
const option = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; };
const root = path.resolve(option('root', path.join(import.meta.dirname, '..')));
const mode = option('mode', 'off'), flow = option('flow', 'review'), scenario = option('scenario', 'breaking');
const navigation = option('navigation', 'off');
const startNumber = Number(option('start', '1'));
if (!['off', 'observe', 'assist'].includes(mode) || !['review', 'self'].includes(flow)) throw new Error('Modo ou fluxo inválido.');
if (!['off', 'on'].includes(navigation)) throw new Error('Orientação inválida.');
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const { Engine } = await load('server.js');
const io = (await load('lib/io.js')).default;
const { safeStringify } = await load('lib/io.js');
const { HOME, STATE_DIR } = await load('lib/paths.js');
if (!path.basename(HOME).startsWith('farol-engine-compare-')) throw new Error('FAROL_HOME deve ser fixture privada farol-engine-compare-*.');
const sha = text => createHash('sha1').update(text).digest('hex');
const blob = text => sha(`blob ${Buffer.byteLength(text)}\0${text}`);
const H = sha(`head/${scenario}`), B = sha('base-tip'), M = sha('merge-base');
const previous = Object.freeze({ 'src/amount.ts': 'export function amount(): number { return 42; }',
  'src/Page.tsx': "import {amount} from './amount.ts'; export const Page=()=> <div>{amount().toFixed(2)}</div>; // CONSUMER_EVIDENCE_61",
  'test/Page.test.tsx': "import {Page} from '../src/Page.tsx'; export const exercise=()=> <Page/>; // TEST_EVIDENCE_62" });
const nextApi = scenario === 'breaking' ? 'export function amount(): {total:number} { return {total:42}; }'
  : 'export function amount(): number { return 43; }';
const head = Object.freeze({ ...previous, 'src/amount.ts': nextApi });
const patch = `@@ -1 +1 @@\n-${previous['src/amount.ts']}\n+${nextApi}`;
const file = Object.freeze({ path: 'src/amount.ts', filename: 'src/amount.ts', sha: blob(nextApi), status: 'modified', additions: 1, deletions: 1, lines: 2, patch });
const blobs = new Map(Object.values({ ...previous, changed: nextApi }).map(text => [blob(text), text]));
let number = startNumber, calls = [], denied = [], sourceReads = 0, sourceTrees = 0;
const result = value => ({ ok: true, stdout: typeof value === 'string' ? value : safeStringify(value), stderr: '' });
function apiResponse(route, args) {
  const baseRoute = route.split('?')[0];
  if (route === 'user') return result({ login: 'fixture' });
  if (route === 'repos/org/frontend') return result({ id: 991, full_name: 'org/frontend', private: false });
  if (baseRoute.endsWith(`/pulls/${number}/files`)) return result(args.includes('--slurp') ? [[file]] : [file]);
  if (baseRoute.endsWith(`/pulls/${number}/reviews`)) return result([]);
  if (route.endsWith(`/pulls/${number}`)) return result({ number, url: `https://github.com/org/frontend/pull/${number}`, changedFiles: 1,
    head: H, base: B, headSha: H, baseSha: B, headRepo: 'org/frontend', headRepositoryId: 991, baseRepo: 'org/frontend', baseRepositoryId: 991 });
  if (route.includes('/compare/')) return result({ mergeBase: M });
  if (route.includes('/git/commits/')) {
    const commit = route.split('/').at(-1); return result({ sha: commit, tree: sha(`tree/${commit}`) });
  }
  if (route.includes('/git/trees/')) {
    const tree = baseRoute.split('/').at(-1), contents = tree === sha(`tree/${H}`) ? head : previous;
    return result({ sha: tree, truncated: false, tree: Object.entries(contents)
      .map(([path, text]) => ({ path, sha: blob(text), type: 'blob', mode: '100644', size: Buffer.byteLength(text) })) });
  }
  if (route.includes('/git/blobs/')) {
    const id = route.split('/').at(-1), text = blobs.get(id);
    if (text !== undefined) return result({ sha: id, encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') });
  }
  return null;
}
io.run = async (command, args = []) => {
  calls.push({ command, args });
  if (command === 'gh' && args[0] === 'api') {
    if (args.includes('--input') || args.includes('-X')) throw new Error('Publicação proibida no benchmark.');
    const route = args[1] === '--hostname' ? args[3] : args[1];
    const response = apiResponse(route, args); if (response) return response;
  }
  if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
    if (args.includes('headRefOid')) return result(H);
    return result({ headRefOid: H, baseRefOid: B, changedFiles: 1, state: 'OPEN', number, url: `https://github.com/org/frontend/pull/${number}` });
  }
  denied.push({ command, args }); return { ok: false, stdout: '', stderr: 'Operação não prevista pela fixture congelada.' };
};
if (fs.existsSync(path.join(root, 'lib/engine/analysis-source.js'))) {
  const { sourceRuntime } = await load('lib/engine/analysis-source.js'), original = sourceRuntime.prepareSources;
  sourceRuntime.prepareSources = async (...args) => {
    const handle = await original(...args);
    if (handle.reader) {
      const read = handle.reader.read, tree = handle.reader.tree;
      handle.reader.read = async (...input) => { sourceReads++; return read(...input); };
      handle.reader.tree = async (...input) => { sourceTrees++; return tree(...input); };
    }
    return handle;
  };
}
function fakeProviderEnvelope() {
  if (flow === 'self') return { verdict: 'needs_work', approvable: false, cardMet: null, blockers: ['Fixture sem execução de modelo.'],
    externalBlockers: [], tips: [], coverageLimitations: [], reportMarkdown: 'Fixture, nenhuma review de IA.' };
  return { analysisStatus: 'incomplete', verdict: 'request_changes', decision: 'needs_decision', cardMet: null,
    protocolo: { prReviewer: 'nao_rodou' }, coverage: { total: 1, reviewed: [], missing: ['src/amount.ts'] },
    reasons: ['Fixture sem execução de modelo.'], findings: [], payloads: {}, reportMarkdown: 'Fixture, nenhuma review de IA.' };
}
function duplicateLines(texts) {
  const seen = new Set(); let bytes = 0;
  for (const line of texts.join('\n').split(/\r?\n/)) {
    if (line.trim().length < 24) continue;
    if (seen.has(line)) bytes += Buffer.byteLength(line); else seen.add(line);
  }
  return bytes;
}
async function analysis() {
  calls = []; denied = []; sourceReads = 0; sourceTrees = 0;
  const cpu = process.cpuUsage(), started = performance.now(), memoryBefore = process.memoryUsage();
  const engine = new Engine();
  engine.config = { ...engine.config, sync: {}, jiraSites: [], claudeProfiles: [], reReviewResume: false, reviewContextMode: mode, reviewNavigationFacts: navigation === 'on',
    accounts: [{ user: 'fixture', owners: ['org'], onClean: 'wait', onCaveats: 'wait', onReject: 'wait', autoReview: false }] };
  engine.accountForPr = () => 'fixture'; engine.tokenFor = () => 'synthetic-token'; engine.ghEnv = () => ({});
  engine.resolveClaudeAuth = () => ({ kind: 'dir' }); engine.headSha = async () => H;
  engine.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: H }); engine.myReviewStates = async () => [];
  engine.fetchMergeState = async () => null; engine.selfAnalyses = {}; engine.decisions = { pending: [], resolved: [] };
  engine.writeMemory = engine.writeInflight = engine.pushState = engine.processHeadless = engine.log = () => {};
  engine.postReview = async () => { throw new Error('Publicação proibida.'); };
  let prompt = '', scopeText = '', modelCalls = 0;
  engine.runClaudeStream = async (text, options) => {
    modelCalls++; prompt = text;
    const session = engine.activeReviews.get(options.id);
    if (session?.scopeRoot) scopeText = fs.readFileSync(path.join(session.scopeRoot, file.path), 'utf8');
    return { text: safeStringify(fakeProviderEnvelope()) };
  };
  const pr = { key: `org/frontend#${number}`, repo: 'org/frontend', number, account: 'fixture', author: 'fixture', requested: true,
    url: `https://github.com/org/frontend/pull/${number}`, title: 'Frozen frontend comparison', headSha: H };
  engine.myPRs = [pr];
  await engine[flow === 'self' ? 'runSelfAnalysis' : 'runHeadlessReview'](pr);
  if (modelCalls !== 1) throw new Error('O engine não chegou exatamente uma vez ao limite do provedor.');
  const used = process.cpuUsage(cpu), memoryAfter = process.memoryUsage();
  const item = flow === 'self' ? engine.selfAnalyses[pr.key] : engine.decisions.pending[0] || engine.decisions.resolved[0];
  const commonFiles = ['CLAUDE.md', '.claude/agents/pr-reviewer.md'].map(relative => fs.readFileSync(path.join(STATE_DIR, '..', relative), 'utf8'));
  const input = [prompt, scopeText, ...commonFiles], completeBytes = input.reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  const extraEvidencePaths = [];
  if (!scopeText && !prompt.includes(nextApi)) extraEvidencePaths.push('src/amount.ts (ou patch do PR)');
  if (!prompt.includes('CONSUMER_EVIDENCE_61')) extraEvidencePaths.push('src/Page.tsx');
  if (!prompt.includes('TEST_EVIDENCE_62')) extraEvidencePaths.push('test/Page.test.tsx');
  return { pr: pr.key, elapsedMs: performance.now() - started, cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000,
    rssBeforeBytes: memoryBefore.rss, rssAfterBytes: memoryAfter.rss, heapAfterBytes: memoryAfter.heapUsed,
    fullPromptBytes: Buffer.byteLength(prompt), materializedPatchBytes: Buffer.byteLength(scopeText),
    commonInstructionBytes: commonFiles.reduce((sum, value) => sum + Buffer.byteLength(value), 0),
    completePreparedInputBytes: completeBytes, completePreparedInputTokenEstimate: Math.ceil(input.join('').length / 4),
    tokenMethod: 'caracteres UTF-16 / 4; não são tokens contados pelo provedor', exactRepeatedLineBytes: duplicateLines(input),
    recoveredEvidence: { consumerInPrompt: prompt.includes('CONSUMER_EVIDENCE_61'), testInPrompt: prompt.includes('TEST_EVIDENCE_62'),
      consumerText: 'amount().toFixed(2)', extraEvidencePaths,
      minimumAdditionalEvidenceReads: extraEvidencePaths.length, actualAgentReadsMeasured: false,
      omitted: ['Binding/contrato semântico não avaliado; modelo não executado.'] },
    acquisition: { ghCalls: calls.filter(c => c.command === 'gh').length, blobAcquisitions: calls.filter(c => c.args.some(a => a.includes('/git/blobs/'))).length,
      ghReadCalls: calls.filter(c => c.command === 'gh' && (c.args[0] === 'api' || c.args[1] === 'view')).length,
      sourceReadRequests: sourceReads, sourceTreeRequests: sourceTrees, modelSearches: 0, modelReads: 0, denied },
    contextEvidence: item?.contextEvidence || null, sourceCache: engine.sourceCacheStatus || null,
    model: { executed: false, boundaryStubCalls: modelCalls, decisionQualityMeasured: false } };
}
const first = await analysis(); number++;
const distinctAnalysis = await analysis();
const git = args => execFileSync('git', ['-C', root, ...args], { env: envSemRepositorioHerdado() });
console.log(safeStringify({ root, commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: envSemRepositorioHerdado() }).trim(),
  trackedDiffSha256: createHash('sha256').update(git(['diff', '--binary', 'HEAD'])).digest('hex'),
  trackedChangedFiles: git(['diff', '--name-only', 'HEAD']).toString('utf8').trim().split(/\r?\n/).filter(Boolean),
  runtime: process.version, arch: process.arch, platform: process.platform, mode, flow, scenario, navigation, frozen: { H, B, M }, first, distinctAnalysis,
  maxProcessRssKiB: process.resourceUsage().maxRSS,
  limitations: ['Transporte GitHub congelado; não mede latência remota nem decide qualidade de review.',
    'Prompt completo mais patch materializado e instruções comuns disponíveis; provedor stub não prova leitura automática desses arquivos.',
    'Contagens do preparo são distintas de buscas/leituras do agente, que são zero.',
    'Sem inferência de CPU a partir de tamanho do prompt; RSS é do processo inteiro, não reserva por review.'] }));
