import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-audits-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default, previousRun = io.run;
const { auditFixture } = await import('./helpers/audit-fixture.js');
const { command, view, tick, candidates } = await import('../lib/review-audit/commands.js');
const { running } = await import('../lib/review-audit/runner.js');
const store = await import('../lib/review-audit/store.js');
const { targetFor, snapshotFor } = await import('../lib/review-audit/source.js');
const { blindResult, reportResult, DEFAULT_POLICY, policy, digest } = await import('../lib/review-audit/contract.js');
const { blindPrompt } = await import('../lib/review-audit/prompt.js');
const { automaticAdmission, costFor } = await import('../lib/review-audit/sampling.js');
const { auditProposals } = await import('../lib/review-audit/proposals.js');
const { command: specialistCommand } = await import('../lib/specialists/commands.js');
const { readVersions } = await import('../lib/specialists/store.js');
const { auditJob } = await import('../ui/pure/review-audits.js');
const provider = path.join(import.meta.dirname, '..', 'tools', 'smoke-fixtures', 'audit-provider.js');
const previousStub = process.env.FAROL_HEADLESS_CMD;
process.env.FAROL_HEADLESS_CMD = `"${process.execPath}" "${provider}"`;
after(() => {
  io.run = previousRun;
  if (previousStub === undefined) delete process.env.FAROL_HEADLESS_CMD; else process.env.FAROL_HEADLESS_CMD = previousStub;
  assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(home, { recursive: true, force: true });
});
function fixture() { const f = auditFixture(new Engine()); io.run = f.run; return f; }
async function audit(f) {
  const start = await command(f.engine, { action: 'start', decisionId: f.decision.id, account: 'dev', confirmed: true });
  assert.equal(start.ok, true, start.error); await running(f.engine); return store.read(start.id, 'result');
}

test('tick real escolhe maior risco, executa amostra paga uma vez e para na quantidade configurada', async () => {
  const low = fixture(), high = fixture(); high.decision.roundReview = { unresolvedCount: 3 };
  high.engine.decisions.resolved = [low.decision, high.decision];
  high.engine.config.auditSampling = { enabled: true, accounts: ['dev'], dailyLimit: 1, budgetUsd: 1, reserveUsd: 0.5 };
  await tick(high.engine); await running(high.engine);
  const values = view(high.engine).jobs;
  assert.equal(values.length, 1); assert.equal(values[0].job.target.decisionId, high.decision.id);
  assert.equal(values[0].job.mode, 'automatic'); assert.equal(values[0].result.status, 'completed');
  await tick(high.engine); assert.equal(store.jobs().length, 1);
});

test('decisão produzida pela revisão real preserva inventário e pode ser auditada', async () => {
  const f = fixture(), e = f.engine, inventory = f.decision.inventarioDiff;
  const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
  const restore = isolateTechnicalTool(), runSession = e.runClaudeStream.bind(e);
  e.decisions = { pending: [], resolved: [] };
  e.fetchPrInventory = async () => inventory;
  e.headSha = async () => f.remote.second; e.myReviewStates = async () => [];
  e.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: f.remote.second });
  e.approvePolicyFor = () => 'wait'; e.rejectPolicyFor = () => 'wait';
  e.postReview = () => assert.fail('revisão configurada para aguardar');
  e.runClaudeStream = async () => ({ sessionId: 'review-fixture', text: JSON.stringify({
    protocolo: { prReviewer: 'rodou' }, analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve',
    cardMet: true, reasons: [], reportMarkdown: 'Contrato conferido.', findings: f.round.findings,
    coverage: { total: 1, reviewed: ['src/a.ts'], missing: [] },
    alcance: [{ alterado: 'src/a.ts', chamadores: [], semChamador: 'entrypoint sintético' }],
    payloads: { approve: { event: 'APPROVE', body: 'Contrato conferido.' } },
  }) });
  try {
    await e.runHeadlessReview({ ...f.decision.pr, key: f.decision.key, url: `https://github.com/${f.decision.pr.repo}/pull/1`, author: 'other', requested: true });
  } finally { e.runClaudeStream = runSession; restore(); }
  const decision = [...e.decisions.pending, ...e.decisions.resolved][0];
  assert.ok(decision, 'o engine gravou uma decisão');
  assert.deepEqual(decision.inventarioDiff.files, inventory.files);
  assert.ok(candidates(e).some(c => c.id === decision.id));
  f.decision = decision;
  assert.equal((await audit(f)).status, 'completed');
});

test('só a auditoria ativa aparece em execução; a anterior continua interrompida', async () => {
  const old = fixture(), id = digest(['old-running', old.decision.id]).slice(0, 32);
  store.write(id, 'job', { schema: 1, id, at: Date.now(), mode: 'manual', target: targetFor(old.engine, old.decision.id, 'dev'), usageIds: [`f-${randomUUID()}`, `f-${randomUUID()}`] });
  const f = fixture();
  const result = await command(f.engine, { action: 'start', decisionId: f.decision.id, account: 'dev', confirmed: true });
  assert.equal(result.ok, true);
  try {
    const current = view(f.engine).jobs;
    assert.equal(current.find(v => v.job.id === id).status, 'interrupted');
    assert.equal(current.find(v => v.job.id === result.id).status, 'running');
  } finally { await running(f.engine); }
  assert.equal(view(f.engine).jobs.find(v => v.job.id === id).status, 'interrupted');
});

test('auditoria usa dois processos novos, retrato histórico e consumo reais; não publica ou muda decisões', async () => {
  const f = fixture(), before = JSON.stringify(f.engine.decisions);
  f.engine.postReview = () => assert.fail('auditoria não posta');
  const result = await audit(f); assert.equal(result.status, 'completed');
  assert.notEqual(result.sessions[0], result.sessions[1]);
  assert.equal(JSON.stringify(f.engine.decisions), before);
  const value = view(f.engine).jobs.find(v => v.job.target.decisionId === f.decision.id);
  assert.equal(value.cost.source, 'measured'); assert.equal(value.cost.usd, 0.24);
  assert.equal(f.engine.usageSessions.sessions.filter(s => value.job.usageIds.includes(s.id)).length, 2);
  const snapshot = store.read(value.job.id, 'snapshot'); assert.equal(snapshot.head, f.remote.second);
  const blind = blindPrompt(snapshot); assert.doesNotMatch(blind, /Revisão original aprovada|Valor mutável/);
  const retry = await command(f.engine, { action: 'start', decisionId: f.decision.id, account: 'dev', confirmed: true });
  assert.equal(retry.repeated, true); assert.equal(running(f.engine), null);
});

test('fontes antigas continuam auditáveis depois de push; conta ou inventário incompatível não roda', async () => {
  const f = fixture(); f.remote.state.head = 'c'.repeat(40);
  assert.equal((await audit(f)).status, 'completed');
  assert.throws(() => targetFor(f.engine, f.decision.id, 'other'));
  f.decision.inventarioDiff.changedFiles = 2; assert.throws(() => targetFor(f.engine, f.decision.id, 'dev'));
});

test('sem confirmação, com perfil ocupado, silenciado ou sem orçamento não abre sessão', async () => {
  const f = fixture(), args = { action: 'start', decisionId: f.decision.id, account: 'dev' };
  assert.equal((await command(f.engine, args)).ok, false);
  f.engine.config.accounts[0].muted = true; assert.equal((await command(f.engine, { ...args, confirmed: true })).ok, false);
  f.engine.config.accounts[0].muted = false; f.engine.budgetBlockedFor = () => ({ id: 'blocked' });
  assert.equal((await command(f.engine, { ...args, confirmed: true })).ok, false);
  assert.equal(running(f.engine), null);
});

test('admissão concorrente em outro engine é recusada pelo lock; erro de modelo não vira parecer', async () => {
  const f = fixture(), other = fixture(); io.run = f.run;
  const args = { action: 'start', decisionId: f.decision.id, account: 'dev', confirmed: true };
  const first = await command(f.engine, args); assert.equal(first.ok, true);
  const second = await command(other.engine, { ...args, decisionId: other.decision.id }); assert.equal(second.ok, false);
  await running(f.engine);
  const broken = fixture(); broken.engine.runClaudeStream = async () => ({ text: '{malformed', sessionId: 'bad' });
  assert.equal((await audit(broken)).status, 'inconclusive');
});

test('configuração tem versão esperada; falha de disco não ativa amostragem só na memória', async () => {
  const f = fixture(), current = view(f.engine);
  const next = { enabled: true, accounts: ['dev'], dailyLimit: 1, budgetUsd: 1, reserveUsd: 0.5 };
  assert.equal((await command(f.engine, { action: 'configure', expected: 'wrong', policy: next })).ok, false);
  f.engine.saveConfig = () => { throw Object.assign(new Error('disk'), { code: 'EIO' }); };
  assert.equal((await command(f.engine, { action: 'configure', expected: current.policyVersion, policy: next })).ok, false);
  assert.equal(f.engine.config.auditSampling.enabled, false);
});

test('diff incompleto, symlink, segredo e excesso de fonte são inconclusivos, sem corte', async () => {
  for (const failure of ['partial', 'symlink', 'secret', 'large']) {
    const f = fixture(), run = f.run;
    if (failure === 'symlink') f.remote.state.mode = '120000';
    if (failure === 'secret') f.remote.state.commits[f.remote.first]['src/a.ts'] = 'password=verysecret';
    if (failure === 'large') f.remote.state.commits[f.remote.first]['src/a.ts'] = 'a'.repeat(270000);
    if (failure === 'partial') io.run = async (...args) => String(args[1]?.[1]).includes('/compare/') ? { ok: true, stdout: '{}' } : run(...args);
    const result = await audit(f); assert.equal(result.status, 'inconclusive'); assert.equal(result.report, undefined);
  }
});

test('classificações exigem cada referência original, observação cega e citação exata', async () => {
  const f = fixture(), snapshot = await snapshotFor(f.engine, targetFor(f.engine, f.decision.id, 'dev'));
  const blind = blindResult(JSON.stringify({ observations: [], limitations: [] }), snapshot);
  assert.throws(() => reportResult(JSON.stringify({ items: [], limitations: [] }), snapshot, blind, { findings: f.round.findings }));
  const item = { kind: 'incorrect', ref: f.round.findings[0].id, title: 'Conclusão', explanation: 'Explicação', evidence: [{ path: 'src/a.ts', side: 'head', start: 1, end: 1, quote: 'inventado' }] };
  assert.throws(() => reportResult(JSON.stringify({ items: [item], limitations: [] }), snapshot, blind, { findings: f.round.findings }));
  assert.throws(() => blindResult(JSON.stringify({ observations: [], limitations: ['private@example.com'] }), snapshot));
});

test('suspeita independente sem confirmação pode ser inconclusiva sem perder cobertura e unicidade', async () => {
  const f = fixture(), snapshot = await snapshotFor(f.engine, targetFor(f.engine, f.decision.id, 'dev'));
  const blind = blindResult(JSON.stringify({ observations: [{ title: 'Contrato ausente', explanation: 'Consumidor não fornecido.',
    evidence: [{ path: 'src/a.ts', side: 'head', start: 1, end: 1, quote: 'export const value = 1;' }] }], limitations: [] }), snapshot);
  const item = { kind: 'inconclusive', ref: null, blindRef: 'b1', title: 'Contrato ausente', explanation: 'Não há prova suficiente para afirmar omissão.', evidence: [] };
  const report = (items, findings = []) => reportResult(JSON.stringify({ items, limitations: [] }), snapshot, blind, { findings });
  assert.equal(report([item]).items[0].kind, 'inconclusive');
  assert.throws(() => report([{ ...item, blindRef: null }]));
  assert.throws(() => report([{ ...item, blindRef: 'b2' }]));
  assert.throws(() => report([item, item]));
  for (const kind of ['confirmed', 'incorrect']) assert.throws(() => report([{ ...item, kind }]));
  assert.throws(() => report([item], f.round.findings), 'achados originais ainda exigem resposta');
  const original = { ...item, ref: f.round.findings[0].id, blindRef: null };
  assert.equal(report([original, item], f.round.findings).items.length, 2);
  assert.throws(() => report([original, original, item], f.round.findings));
});

test('avaliação humana tem CAS e contestação; proposta exige concordância e curadoria separada', async () => {
  const f = fixture(); await audit(f);
  const value = view(f.engine).jobs.find(v => v.job.target.decisionId === f.decision.id), id = value.job.id, item = value.result.report.items[0].id;
  const scope = { account: 'dev', repo: f.decision.pr.repo, branch: 'main' };
  assert.deepEqual(auditProposals(f.engine, scope), []);
  const a = await command(f.engine, { action: 'assess', id, item, expected: null, verdict: 'agree', note: 'Conferi a declaração constante no trecho.' }); assert.equal(a.ok, true);
  const proposals = auditProposals(f.engine, scope); assert.equal(proposals.length, 1);
  assert.deepEqual(auditProposals(f.engine, { ...scope, account: 'other' }), []);
  assert.equal(readVersions(scope).current, null);
  assert.equal((await command(f.engine, { action: 'assess', id, item, expected: null, verdict: 'disagree', note: 'Outro contrato.' })).ok, false);
  const entry = { kind: 'lesson', title: 'Constantes', text: proposals[0].text, sources: [{ path: 'src/a.ts', start: 1, end: 1 }] };
  const p = await specialistCommand(f.engine, { action: 'preview', scope, entry, originKey: proposals[0].key }); assert.equal(p.ok, true, p.error);
  const saved = await specialistCommand(f.engine, { action: 'curate', scope, confirmed: true, previewId: p.previewId }); assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.current.entries[0].origin.type, 'audit');
  const disagree = await command(f.engine, { action: 'assess', id, item, expected: a.assessment.id, verdict: 'disagree', note: 'O contrato do consumidor muda a conclusão.' }); assert.equal(disagree.ok, true);
  assert.deepEqual(auditProposals(f.engine, scope), []);
  const updated = await specialistCommand(f.engine, { action: 'view', scope }); assert.equal(updated.statuses[0].status, 'stale');
  assert.equal(view(f.engine).metrics.disagree, 1);
});

test('amostragem nasce desligada, respeita risco, quantidade, orçamento e custo desconhecido', async () => {
  const f = fixture(); assert.equal(DEFAULT_POLICY.enabled, false); assert.throws(() => policy({ enabled: true, accounts: [], dailyLimit: 3, budgetUsd: 1, reserveUsd: 0.5 }));
  await tick(f.engine); assert.equal(running(f.engine), null);
  f.engine.config.auditSampling = { enabled: true, accounts: ['dev'], dailyLimit: 1, budgetUsd: 1, reserveUsd: 0.5 };
  // Outros testes usam o mesmo diretório; a janela seguinte evita somar sua amostra.
  const future = new Date(Date.now() + 86400000);
  assert.equal(automaticAdmission(f.engine, [], future).ok, true);
  assert.equal(automaticAdmission(f.engine, [{ at: +future, mode: 'automatic', usageIds: [] }], future).ok, false);
  const job = { at: +future, mode: 'manual', usageIds: ['missing'] };
  assert.equal(automaticAdmission(f.engine, [job], future).ok, false); assert.equal(costFor(f.engine, job).usd, null);
  f.engine.usageSessions.sessions.push({ id: 'estimated', costSource: 'estimado', costUsd: 0.8 });
  assert.equal(automaticAdmission(f.engine, [{ ...job, usageIds: ['estimated'] }], future).ok, false);
});

test('rota HTTP real protege sessão, origem e método; relatório neutraliza HTML', async () => {
  const f = fixture(); await audit(f);
  const value = view(f.engine).jobs.find(v => v.job.target.decisionId === f.decision.id);
  value.result.report.items[0].explanation = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(auditJob(value), /<img/);
  const { startServer } = await import('../lib/http-server.js');
  const { emitirSessao } = await import('../lib/local-auth/sessoes.js');
  f.engine.config.port = 0; f.engine.config.localAuth = 'exigir';
  const server = startServer(f.engine); await new Promise(r => server.once('listening', r));
  const send = (method = 'POST', headers = {}) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ action: 'view' });
    const req = httpRequest(`http://127.0.0.1:${server.address().port}/api/review-audits`, { method, agent: false, headers: { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(body);
  });
  try {
    assert.equal(await send(), 401); const headers = { Authorization: `Bearer ${emitirSessao('fixture')}` };
    assert.equal(await send('POST', headers), 200); assert.equal(await send('GET', headers), 405);
    assert.equal(await send('POST', { ...headers, Origin: 'https://outside.invalid' }), 403);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('interrupção preserva tentativa e exige repetição manual; corrupção nunca vira histórico vazio', async () => {
  const f = fixture(), id = digest(['interrupted', f.decision.id]).slice(0, 32);
  store.write(id, 'job', { schema: 1, id, at: Date.now(), mode: 'manual', target: targetFor(f.engine, f.decision.id, 'dev'), usageIds: [`f-${randomUUID()}`, `f-${randomUUID()}`] });
  assert.equal(execFileSync(process.execPath, [path.join(import.meta.dirname, 'helpers', 'audit-lock-owner.js'), store.ROOT],
    { encoding: 'utf8', timeout: 15000 }), 'locked', 'o processo encerra sem liberar seu lock');
  const args = { action: 'start', decisionId: f.decision.id, account: 'dev', confirmed: true };
  assert.equal((await command(f.engine, args)).repeated, true); assert.equal(running(f.engine), null);
  const retry = await command(f.engine, { ...args, retry: true }); assert.equal(retry.ok, true); await running(f.engine);
  assert.equal(store.read(id, 'result').status, 'interrupted'); assert.equal(store.read(retry.id, 'result').status, 'completed');
  const file = path.join(store.ROOT, retry.id, 'result.json'), before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{broken');
  try { assert.equal((await command(f.engine, { action: 'view' })).ok, false); assert.equal(fs.readFileSync(file, 'utf8'), '{broken'); }
  finally { fs.writeFileSync(file, before); }
});
