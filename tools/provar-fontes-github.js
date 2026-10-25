// Prova remota limitada e somente leitura; modelos e publicação ficam bloqueados.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { semAsVariaveis } from '../lib/env.js';
import io, { parseJson, safeStringify } from '../lib/io.js';
import { prepareSources } from '../lib/review-source/index.js';
import { snapshotFor } from '../lib/technical-review/material.js';
import { cleanup } from '../lib/technical-review/cleanup.js';
import { Engine } from '../server.js';

const argv = process.argv.slice(2);
const option = name => argv[argv.indexOf(name) + 1];
const url = option('--public-pr'), output = option('--output');
const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/.exec(url || '');
const home = semAsVariaveis([]).FAROL_HOME;
if (!argv.includes('--public-pr') || !argv.includes('--output') || !match || !output || !home
  || !fs.realpathSync(home).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep)) {
  throw new Error('Informe --public-pr <URL pública> --output <JSON> e FAROL_HOME temporário existente.');
}
const started = performance.now(), originalRun = io.run, requests = [], blocked = [];
let handle, material;
const report = { schema: 1, runtime: process.versions.node, arch: process.arch, url,
  isolation: { temporaryHome: true, personalCheckout: false, repositoryExecution: false, paidModel: false, publication: false },
  status: 'running' };
function proofResult(flow) {
  if (flow === 'runHeadlessReview') return { analysisStatus: 'incomplete', verdict: 'approve', decision: 'needs_decision',
    reasons: ['Fixture sem análise de modelo.'], findings: [], reportMarkdown: 'Prova de aquisição, sem análise de modelo.',
    payloads: {}, coverage: { total: 0, reviewed: [], missing: [] } };
  return { verdict: 'needs_work', approvable: false, cardMet: false, blockers: [], externalBlockers: [], tips: [],
    coverageLimitations: ['Fixture sem análise de modelo.'], summary: 'Prova de aquisição.', reportMarkdown: 'Sem análise de modelo.' };
}
io.run = async (command, args = [], options) => {
  if (command !== 'gh') {
    if (!['git', 'powershell.exe', 'ps'].includes(command)) throw new Error('Processo externo fora da prova foi bloqueado.');
    return originalRun(command, args, options);
  }
    const read = args[0] === 'api' && !args.includes('--input') && !args.includes('--method')
      && !args.includes('-X') && !args.includes('-f') && !args.includes('-F');
    const token = args[0] === 'auth' && args[1] === 'token';
    const view = args[0] === 'pr' && args[1] === 'view';
    if (!(read || token || view)) {
      blocked.push(args.slice(0, 2).join(' '));
      return { ok: false, code: 1, stdout: '', stderr: 'Efeito remoto bloqueado pela prova somente leitura.' };
    }
    if (!token && requests.length >= 80) return { ok: false, code: 1, stdout: '', stderr: 'Orçamento de leituras remotas atingido.' };
    if (!token) requests.push(args[0] === 'api' ? args.find(a => /^(?:repos\/|user$)/.test(a)) || 'metadata' : 'pr view');
  return originalRun(command, args, options);
};
try {
  const accountResult = await io.run('gh', ['api', 'user', '--jq', '.login']);
  const account = accountResult.ok ? accountResult.stdout.trim() : '';
  if (!/^[\w-]{1,39}$/.test(account)) throw new Error('Autenticação GitHub não disponível para a prova.');
  const repo = match[1], number = Number(match[2]);
  const metadataResult = await io.run('gh', ['api', `repos/${repo}/pulls/${number}`, '--jq',
    '{number,private:.base.repo.private,head:.head.sha,base:.base.sha,changedFiles:.changed_files,author:.user.login}']);
  const metadata = parseJson(metadataResult.stdout);
  if (!metadataResult.ok || metadata?.private !== false || metadata.number !== number
    || !Number.isInteger(metadata.changedFiles) || metadata.changedFiles > 30) throw new Error('PR público pequeno não confirmado.');
  const engine = new Engine();
  engine.log = () => {};
  engine.config = { ...engine.config, jiraSites: [], reReviewResume: false, reviewContextMode: 'off',
    accounts: [{ user: account, owners: [repo.split('/')[0]], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' }],
    sourceCacheLimits: { maxBytes: 128 * 1024 ** 2, globalMaxBytes: 256 * 1024 ** 2 } };
  engine.config.ghUser = account;
  engine.accountForPr = () => account;
  engine.resolveClaudeAuth = () => ({ kind: 'codex' });
  await engine.refreshTokens();
  if (!engine.tokenFor(account)) throw new Error('Credencial da conta indisponível no mecanismo existente.');
  const pr = { key: `${repo}#${number}`, repo, number, url, author: metadata.author, headSha: metadata.head, requested: true };
  handle = await prepareSources(engine, pr, { expectedHead: metadata.head, expectedBase: metadata.base });
  if (handle.status !== 'complete') throw new Error(handle.reason || 'Fonte remota incompleta.');
  report.identity = { repo, number, H: handle.manifest.H, B: handle.manifest.B, M: handle.manifest.M,
    authScopeHash: crypto.createHash('sha256').update(account).digest('hex'), inventoryFiles: handle.manifest.files.length };
  const contents = [];
  let readBytes = 0;
  for (const file of handle.manifest.files) {
    if (file.status === 'removed' || file.sensitive) continue;
    const data = await handle.reader.read(file.path, 'head');
    if (data.status !== 'available') { contents.push({ path: file.path, status: data.status }); continue; }
    readBytes += Buffer.byteLength(data.text);
    if (readBytes > 2 * 1024 ** 2) throw new Error('Orçamento de conteúdo atingido.');
    contents.push({ path: file.path, status: data.status, blob: data.blob, commit: data.commit, bytes: data.size });
  }
  report.contents = contents;
  material = await snapshotFor(engine, pr, { head: metadata.head, base: metadata.base },
    { sources: handle, sessionId: 'public-github-proof' });
  const example = contents.find(item => item.status === 'available');
  if (!example) throw new Error('Nenhum conteúdo verificável recuperado.');
  const bytes = fs.readFileSync(path.join(material, example.path));
  const hash = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (hash !== example.blob) throw new Error('Materialização Git divergiu do blob recuperado pela API.');
  report.git = { remoteMaterialized: true, examplePath: example.path, exampleBlobMatchesApi: true };
  await cleanup({ snapshot: material }); material = null;
  engine.headSha = async () => metadata.head;
  engine.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: metadata.head });
  engine.myReviewStates = async () => [];
  engine.myPRs = [{ ...pr }]; engine.selfAnalyses = {}; engine.decisions = { pending: [], resolved: [] };
  engine.writeMemory = engine.writeInflight = engine.pushState = engine.processHeadless = () => {};
  engine.fetchMergeState = async () => null;
  engine.postReview = async () => { throw new Error('Publicação não permitida.'); };
  report.flows = [];
  for (const flow of ['runHeadlessReview', 'runSelfAnalysis']) {
    let entered = false;
    engine.runClaudeStream = async prompt => {
      entered = true;
      report.flows.push({ flow, modelStub: true, fullPromptBytes: Buffer.byteLength(prompt),
        fixedHeadInPrompt: prompt.includes(metadata.head), commonSourcesInPrompt: prompt.includes('Fontes e patches preparados') });
      return { text: safeStringify(proofResult(flow)) };
    };
    await engine[flow]({ ...pr });
    if (!entered) throw new Error('Fluxo não chegou à fronteira substituída do modelo.');
  }
  if (report.flows.some(flow => !flow.commonSourcesInPrompt || !flow.fixedHeadInPrompt)) throw new Error('Integração não comprovou fonte comum.');
  report.cache = await handle.usage();
  report.status = 'passed';
} catch (error) {
  report.status = 'blocked-or-failed';
  report.reason = String(error.message).replaceAll(home, '<temporary-home>');
  process.exitCode = 1;
} finally {
  if (material) await cleanup({ snapshot: material }).catch(() => {});
  if (handle) await handle.release().catch(() => {});
  io.run = originalRun;
  report.readRequests = requests.length; report.blockedMutationAttempts = blocked;
  report.elapsedMs = performance.now() - started;
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), safeStringify(report));
  console.log(safeStringify({ status: report.status, identity: report.identity, readRequests: report.readRequests, reason: report.reason }));
}

