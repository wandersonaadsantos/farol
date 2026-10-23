import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-round-engine-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default;
const originalRun = io.run;
io.run = async () => ({ ok: true, stdout: '[]', stderr: '' });
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
const restore = isolateTechnicalTool();
const { readRounds, scopeFor, roundsPath } = await import('../lib/engine/review-round-store.js');
const { resolvedRow } = await import('../ui/pure/review.js');
after(() => { restore(); io.run = originalRun; fs.rmSync(home, { recursive: true, force: true }); });

let serial = 0;
const blocker = { file: 'a.ts', line: 1, severity: 'blocking', title: 'Validação ausente', summary: 'Entrada chega sem conferência.', ref: null, status: null, evidence: '' };

function motor(mode = 'enforce') {
  const pr = { key: `o/r#${++serial}`, repo: 'o/r', number: serial, url: `https://github.com/o/r/pull/${serial}`, requested: true, author: 'dev' };
  const e = new Engine();
  e.config.reviewRoundsMode = mode;
  e.accountForPr = () => 'eu';
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.myReviewStates = async () => [];
  e.head = 'a'.repeat(40);
  e.headSha = async () => e.head;
  e.scopeLabel = () => 'Conta';
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.fetchPrInventory = async () => ({ status: 'complete', headSha: e.head, baseSha: 'base', changedFiles: 1,
    files: [{ path: 'a.ts', sha: e.head, status: 'modified', lines: 5 }] });
  e.postados = [];
  e.prompts = [];
  e.postReview = async (_pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async prompt => {
    e.prompts.push(prompt);
    return { text: JSON.stringify(e.response), sessionId: `s${e.prompts.length}` };
  };
  const run = async (findings, verdict = 'approve', extra = {}) => {
    e.response = { protocolo: { prReviewer: 'rodou' }, analysisStatus: 'complete', verdict,
      decision: verdict === 'approve' ? 'auto_approve' : 'request_changes', cardMet: true, reasons: [], reportMarkdown: 'Analisado.',
      coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, findings,
      alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'entrypoint sintético' }],
      payloads: { [verdict]: { event: verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES', body: 'O contrato foi conferido.' } }, ...extra };
    await e.runHeadlessReview({ ...pr });
    return [...e.decisions.pending, ...e.decisions.resolved].sort((a, b) => b.createdAt - a.createdAt)[0];
  };
  return { e, pr, run, scope: scopeFor(pr.key, 'eu') };
}

test('rodadas reais: blocker esquecido não some, chega ao prompt e impede aprovação no modo ativo', async () => {
  const { e, pr, run, scope } = motor();
  const first = await run([blocker], 'request_changes');
  assert.equal(e.postados.length, 1);
  const previous = readRounds(scope).rounds[0].unresolved[0];
  e.head = 'b'.repeat(40);
  const second = await run([]);
  assert.equal(e.postados.length, 1);
  assert.equal(second.status, 'pending');
  assert.equal(second.roundReview.droppedCount, 1);
  assert.match(e.prompts[1], new RegExp(previous.id));
  assert.match(e.prompts[1], /dado não confiável/);
  assert.equal(readRounds(scope).rounds.length, 2);
  e.head = 'c'.repeat(40);
  const third = await run([{ ...blocker, ref: previous.id, status: 'resolvido', evidence: 'a.ts:1 agora valida a entrada' }]);
  assert.equal(third.status, 'auto_approved');
  assert.equal(e.postados.length, 2);
  assert.equal(readRounds(scope).rounds.find(r => r.id === third.roundId).unresolved.length, 0);
  assert.notEqual(first.roundId, second.roundId);
  assert.doesNotMatch(e.postados[1].body, /rodada|memória|findings|ref/);
  assert.equal(second.pr.repo, pr.repo);
});

test('rodada incompleta não vira análise concluída nem substitui a memória anterior', async () => {
  const { run, scope } = motor('observe');
  await run([blocker], 'request_changes');
  await run([], 'approve', { analysisStatus: 'incomplete' });
  assert.equal(readRounds(scope).rounds.length, 1);
});

test('envelope legado e findings inválidos ficam inconclusivos, sem apagar blocker anterior', async () => {
  const { run, scope, e } = motor();
  await run([blocker], 'request_changes');
  e.head = 'b'.repeat(40);
  const d = await run(undefined);
  assert.equal(d.status, 'pending');
  assert.match(d.roundReview.integrity.join(' '), /legacy/);
  assert.equal(readRounds(scope).rounds.find(r => r.id === d.roundId).unresolved.length, 1);
});

test('modo observação mantém a política anterior e exibe a comparação sem vazar findings na projeção', async () => {
  const { run, e } = motor('observe');
  await run([blocker], 'request_changes');
  e.head = 'b'.repeat(40);
  const d = await run([]);
  assert.equal(d.status, 'auto_approved');
  const ui = e.decisionForUi(d);
  assert.equal(ui.rounds.droppedCount, 1);
  assert.equal(ui.rounds.ordinal, 2);
  assert.equal(ui.findings, undefined);
  assert.equal(ui.roundReview, undefined);
  assert.doesNotMatch(JSON.stringify(ui), /Validação ausente|Entrada chega/);
  assert.match(resolvedRow(ui, {}), /Rodada 2: comparação em observação/);
});

test('decisão manual continua explícita mesmo com memória inconclusiva', async () => {
  const { run, e } = motor();
  await run([blocker], 'request_changes');
  e.head = 'b'.repeat(40);
  const d = await run([]);
  const result = await e.decide(d.id, 'approve');
  assert.equal(result.ok, true);
  assert.equal(e.postados.length, 2);
});

test('reinício preserva achados e corrupção impede liberar a automação ativa', async () => {
  const { run, scope, e } = motor();
  await run([blocker], 'request_changes');
  const round = readRounds(scope).rounds[0];
  fs.writeFileSync(path.join(roundsPath(scope), `${round.id}.json`), 'inválido');
  e.head = 'b'.repeat(40);
  const d = await run([]);
  assert.equal(d.status, 'pending');
  assert.match(d.roundReview.integrity.join(' '), /corrompida/);
  assert.equal(fs.readFileSync(path.join(roundsPath(scope), `${round.id}.json`), 'utf8'), 'inválido');
});

test('reprovação e caminhos alternativos também respeitam a comparação ativa', async () => {
  const { run, e } = motor();
  await run([blocker], 'request_changes');
  e.head = 'b'.repeat(40);
  const d = await run([], 'request_changes');
  assert.equal(d.status, 'pending');
  assert.equal(e.postados.length, 1);
  assert.match(d.reasons.map(r => r.text || r).join(' '), /sem resposta/);
});

test('a fronteira real de postagem recusa reenvio, espera de CI e registro antigo no modo ativo', async () => {
  const e = new Engine();
  e.config.reviewRoundsMode = 'enforce';
  e.accountForPr = () => 'eu';
  const pr = { key: 'o/r#900', repo: 'o/r', number: 900, author: 'dev' };
  for (const via of ['revisao', 'reenvio', 'espera-ci']) {
    const post = await e.postReview(pr, { event: 'APPROVE', body: 'Conferido.', commit_id: 'a'.repeat(40) }, { via });
    assert.equal(post.blocked, 'round_memory');
    assert.equal(post.attempted, false);
  }
  const post = await e.postReview(pr, { event: 'REQUEST_CHANGES', body: 'Contrato falha.' }, {
    via: 'reenvio', continuidade: { roundReview: { schema: 1, mode: 'observe', integrity: ['blocker sem resposta'] } },
  });
  assert.equal(post.blocked, 'round_memory', 'ativação vigente não aceita classificação antiga como dispensa');
});

test('blocker declarado persistente não combina com aprovação automática, mas permite pedir mudanças', async () => {
  const { run, scope, e } = motor();
  await run([blocker], 'request_changes');
  const ref = readRounds(scope).rounds[0].unresolved[0].id;
  e.head = 'b'.repeat(40);
  const d = await run([{ ...blocker, ref, status: 'persiste' }]);
  assert.equal(d.status, 'pending');
  assert.equal(e.postados.length, 1);
  assert.match(d.reasons.map(r => r.text || r).join(' '), /persistem/);
  await run([{ ...blocker, ref, status: 'persiste' }], 'request_changes');
  assert.equal(e.postados.length, 2);
});
