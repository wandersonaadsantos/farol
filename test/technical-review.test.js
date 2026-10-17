import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { envGitLimpo } from './helpers/git-limpo.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-technical-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { TOOL, technicalGap, technicalSummary } = await import('../lib/technical-review/verdict.js');
const { PROFILE_FILE, profileFor } = await import('../lib/technical-review/profiles.js');
const { approvalGaps } = await import('../lib/technical-review/evidence.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { finishTechnicalReview, technicalPrompt, audit, technicalRuntime } = await import('../lib/technical-review/runtime.js');
const { shouldAutoApprove } = await import('../lib/engine/decision.js');
const { decisionForUi } = await import('../lib/engine/public-review.js');
const { debtVerdict } = await import('../lib/technical-review/debt.js');
const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default;
const { launchTechnicalRechecks } = await import('../lib/technical-review/recheck.js');
const { targetFor } = await import('../lib/technical-review/material.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
function report(extra = {}) {
  return { schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: 'org/repo',
    base: 'b'.repeat(40), head, profile: 'profile', catalogFingerprint: 'catalog',
    humanReviewFingerprint: 'human', verdict: 'pass', rules: [{ rule: 'core.file.single-responsibility', verdict: 'pass' }], findings: [], ...extra };
}
function result(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true,
    headSha: head, checksVerifiedHead: head, checksObrigatorios: [], technicalReview: report(), reasons: [],
    diffMedido: ['a.md'], coverage: { total: 1, reviewed: ['a.md'], missing: [] },
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' },
    payloads: { approve: { event: 'APPROVE', body: 'O comportamento foi conferido.' } }, ...extra };
}
const engine = { config: { aguardarCiParaAprovar: false }, accountForPr: () => 'reviewer',
  attentionPoints: () => [], approvePolicyFor: () => 'approve' };

test('conformidade técnica e prova suficiente permitem a preferência de aprovar', () => {
  assert.deepEqual(approvalGaps(result()), []);
  assert.equal(shouldAutoApprove(engine, { requested: true }, result()).ok, true);
});
for (const [name, patch] of Object.entries({
  violacao: { technicalReview: report({ verdict: 'fail', findings: [{ file: 'a.ts', message: 'regra duplicada' }] }) },
  julgamento: { technicalReview: report({ rules: [{ verdict: 'fail' }] }) },
  abstencao: { technicalReview: report({ verdict: 'not-run' }) },
  contradicao: { technicalReview: report({ rules: [{ verdict: 'not-run' }] }) },
  versao: { technicalReview: report({ toolCommit: 'antigo' }) },
  outroHead: { technicalReview: report({ head: 'c'.repeat(40) }) },
  semAvaliacao: { technicalReview: undefined },
  leitura: { coverage: { total: 1, reviewed: [], missing: ['a.md'] } },
  checkpoint: { verificationCheckpoint: { malformed: true } },
  checksDesconhecidos: { checksVerifiedHead: null },
  dependencia: { dependenciasAbertas: ['API ainda não disponível'] },
})) test(`política de ressalvas não atravessa ${name}`, () => {
  assert.equal(shouldAutoApprove(engine, { requested: true }, result(patch)).ok, false);
});

test('CI obrigatório segura mesmo com a opção antiga de espera desligada', () => {
  const r = result({ checksObrigatorios: [{ nome: 'test', estado: 'vermelho' }] });
  assert.equal(shouldAutoApprove(engine, { requested: true }, r).motivo, 'ci_vermelho');
});

test('alteração de declaração e troca de repositório invalidam prova', () => {
  assert.match(technicalGap(report(), { profile: 'outra' }), /declaração/);
  assert.match(technicalGap(report(), { repo: 'org/outra' }), /repositório/);
});

test('clique, endosso e reenvio sem avaliação não publicam aprovação', async () => {
  for (const via of ['clique', 'coassinatura', 'reenvio', 'sessao', 'espera-ci']) {
    const r = await approvalRefusal({ ...engine, decisions: { pending: [] } },
      { key: 'org/repo#1', repo: 'org/repo' }, { event: 'APPROVE', commit_id: head, via });
    assert.equal(r.blocked, 'technical_review');
    assert.equal(r.attempted, false);
  }
  assert.equal(await approvalRefusal(engine, {}, { event: 'COMMENT' }), null);
});

test('Engine real não alcança o transporte de publicação sem prova técnica', async () => {
  const e = Object.create(Engine.prototype);
  e.config = { accounts: [{ user: 'reviewer', owners: ['org'] }] };
  e.accountForPr = () => 'reviewer'; e.isMuted = () => false;
  e.token = 'fixture'; e.tokenFor = () => 'fixture'; e.log = () => {};
  e.syncCoordenacaoAtiva = () => false;
  const original = io.run;
  let transport = 0;
  io.run = async () => { transport++; throw new Error('transporte não deveria ser alcançado'); };
  try {
    const refusal = await e.postReview({ key: 'org/repo#1', repo: 'org/repo', number: 1 },
      { event: 'APPROVE', body: 'A mudança está pronta.', commit_id: head });
    assert.equal(refusal.blocked, 'technical_review');
    assert.equal(transport, 0);
  } finally { io.run = original; }
});

test('mudança comprovada de contexto agenda uma revisão própria sem repetição', () => {
  const item = { technicalRecheck: true, key: 'org/repo#1', pr: { repo: 'org/repo', requested: true } };
  let queued = 0;
  const e = { decisions: { pending: [item] }, accountForPr: () => 'reviewer', autoReviewFor: () => true,
    isMuted: () => false, tokenFor: () => 'fixture', enqueueHeadless: () => { queued++; return { ok: true }; }, saveDecisions: () => {} };
  launchTechnicalRechecks(e); launchTechnicalRechecks(e);
  assert.equal(queued, 1);
  item.technicalRecheck = true; item.pr.requested = false;
  launchTechnicalRechecks(e);
  assert.equal(queued, 1);
});

test('alvo técnico exige a identidade do PR, estado aberto e commit confirmado', async () => {
  const original = io.run;
  const pr = { repo: 'org/repo', number: 1, url: 'https://github.com/org/repo/pull/1' };
  const e = { accountForPr: () => 'reviewer', ghEnv: () => ({}) };
  let target = { url: pr.url, number: 1, state: 'OPEN', headRefOid: head, baseRefOid: 'b'.repeat(40) };
  io.run = async () => ({ ok: true, stdout: JSON.stringify(target) });
  try {
    assert.equal((await targetFor(e, pr, head)).head, head);
    target = { ...target, url: 'https://github.com/other/repo/pull/1' };
    await assert.rejects(targetFor(e, pr, head), /identidade/);
    target = { ...target, url: pr.url, state: 'MERGED' };
    await assert.rejects(targetFor(e, pr, head), /estado/);
  } finally { io.run = original; }
});

test('cadastro ausente ou corrompido não inventa declaração', () => {
  const file = path.join(root, 'profiles.json');
  assert.equal(profileFor('org/repo', file), null);
  fs.writeFileSync(file, '{');
  assert.equal(profileFor('org/repo', file), null);
  assert.equal(fs.existsSync(file + '.bad'), false);
});

test('aprovação reconfirma base, objeções, declaração e CI na fronteira comum', async () => {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { 'org/repo': { declaration: { scopes: ['core'] } } } }));
  const profile = profileFor('org/repo');
  const proof = report({ profile: profile.fingerprint });
  const e = { ...engine, technicalApprovals: new Map([['org/repo#1', { report: proof, evidence: [] }]]),
    bloqueadoPorChecks: async () => ({ verifiedHead: head, faltando: [] }) };
  const original = { ...technicalRuntime };
  technicalRuntime.requireTool = async () => 'tool';
  technicalRuntime.targetFor = async () => ({ head, base: proof.base });
  technicalRuntime.reviewSnapshot = async () => ({ fingerprint: 'human' });
  const pr = { key: 'org/repo#1', repo: 'org/repo' };
  const payload = { event: 'APPROVE', commit_id: head };
  try {
    assert.equal(await approvalRefusal(e, pr, payload), null);
    technicalRuntime.reviewSnapshot = async () => ({ fingerprint: 'changed' });
    assert.equal((await approvalRefusal(e, pr, payload)).blocked, 'technical_review');
    technicalRuntime.reviewSnapshot = async () => ({ fingerprint: 'human' });
    technicalRuntime.targetFor = async () => ({ head, base: 'c'.repeat(40) });
    assert.equal((await approvalRefusal(e, pr, payload)).blocked, 'technical_review');
    technicalRuntime.targetFor = async () => ({ head, base: proof.base });
    e.bloqueadoPorChecks = async () => ({ verifiedHead: head, faltando: [{ nome: 'test', estado: 'rodando' }] });
    assert.equal((await approvalRefusal(e, pr, payload)).blocked, 'technical_review');
  } finally { Object.assign(technicalRuntime, original); }
});

test('documentação sem regra acionada exige prova explícita de aplicabilidade', () => {
  const docs = report({ rules: [], coverage: { selecionadas: 1, arquivosDaEntrega: 1, foraDoMaterial: ['core.example'] } });
  assert.equal(technicalGap(docs), '');
  assert.match(technicalGap({ ...docs, coverage: {} }), /aplicabilidade/);
});

test('ferramenta indisponível é inconclusiva e não interrompe a análise de código', async () => {
  const context = { error: 'ferramenta ausente' };
  assert.match(technicalPrompt(context), /Continue a análise/);
  assert.equal((await finishTechnicalReview(context, [])).verdict, 'not-run');
});

test('projeção mostra resultado técnico sem expor catálogo ou achados privados', () => {
  const ui = decisionForUi({ technicalReview: report(), verdict: 'approve' });
  assert.equal(ui.technical.state, 'pass');
  assert.equal(ui.technicalReview, undefined);
  assert.equal(ui.technical.catalogFingerprint, undefined);
  assert.match(technicalSummary(report({ verdict: 'fail' })).message, /violação/);
});

const toolHome = path.join(os.homedir(), '.farol', 'toolchains', `eng-behaviour@${TOOL.version}`);
test('ferramenta real acusa supressão e exige julgamento sem tocar o consumidor', {
  skip: !fs.existsSync(path.join(toolHome, 'dist', 'index.js')) && 'runtime privado não instalado neste executor',
}, async () => {
  const repo = path.join(root, 'consumer');
  fs.mkdirSync(repo);
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true, env: envGitLimpo() });
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  fs.writeFileSync(path.join(repo, 'a.js'), 'export const value = 1;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(repo, 'a.js'), '// eslint-disable-next-line no-console -- motivo\nconsole.log(1);\n');
  fs.mkdirSync(path.join(repo, 'src', 'design-system'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'design-system', 'Card.tsx'),
    'export function Card() { return <div style={{ padding: 16, color: "#fff" }} />; }\nfunction Other() { return <span />; }\n');
  fs.writeFileSync(path.join(repo, 'src', 'save.ts'), 'export function save(input) { return input; }\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'change']);
  const changed = git(['rev-parse', 'HEAD']).trim();
  const profile = { declaration: { scopes: ['core', 'frontend', 'backend'], componentDirs: ['src/design-system'], sourceDirs: ['src'], deliveryMayRepeat: true, isolationScope: 'tenant' } };
  const output = await audit({ toolHome, snapshot: repo, repo: 'org/consumer', base, head: changed, profile });
  assert.equal(output.verdict, 'fail');
  assert.equal(output.rules.find(r => r.rule === 'core.suppression.declared').verdict, 'fail');
  assert.equal(output.rules.find(r => r.rule === 'core.file.single-responsibility').verdict, 'not-run');
  assert.equal(output.rules.find(r => r.rule === 'frontend.component.one-component-per-file').verdict, 'fail');
  assert.equal(output.rules.find(r => r.rule === 'frontend.design-system.canonical-source').verdict, 'fail');
  assert.equal(output.rules.find(r => r.rule === 'backend.input.checked-before-effect').verdict, 'not-run');
  assert.equal(git(['status', '--porcelain']), '');
  assert.equal(fs.existsSync(path.join(repo, 'eng-behaviour.json')), false);

  const context = { snapshot: repo, base, head: changed, profile: { baselines: [{ rule: 'fixture', known: ['fixture|a.js|violacao'] }] } };
  const known = { rules: [{ rule: 'fixture', conhecidos: 1, acionadores: ['a.js'] }] };
  assert.equal(await debtVerdict(context, known), 'not-run');
  const comparison = { rule: 'fixture', file: 'a.js', confidence: 'alta', state: 'aggravated',
    rationale: 'Fixture da fronteira de validação da comparação, sem atestar conformidade do código.',
    evidence: [{ revision: 'base', file: 'a.js', line: 1, observation: 'A versão anterior é alcançável.' },
      { revision: 'head', file: 'a.js', line: 1, observation: 'A versão alterada é alcançável.' }] };
  assert.equal(await debtVerdict(context, known, [comparison]), 'fail');
  assert.equal(await debtVerdict(context, known, [{ ...comparison, confidence: 'baixa' }]), 'not-run');
  assert.equal(await debtVerdict(context, known, [{ ...comparison, state: 'unchanged' }]), 'pass');

  fs.writeFileSync(path.join(repo, 'README.md'), 'Documentação atualizada.\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'docs']);
  const docsHead = git(['rev-parse', 'HEAD']).trim();
  const docs = await audit({ toolHome, snapshot: repo, repo: 'org/consumer', base: changed, head: docsHead, profile });
  assert.equal(docs.verdict, 'pass');
  assert.equal(docs.rules.length, 0);
});
