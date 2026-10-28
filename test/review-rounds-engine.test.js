import { criteriaFixture } from './helpers/criteria-fixture.js';
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
const { publicationRefusal } = await import('../lib/engine/review-rounds.js');
after(() => { restore(); io.run = originalRun; fs.rmSync(home, { recursive: true, force: true }); });

let serial = 0;
const blocker = { file: 'a.ts', line: 1, severity: 'blocking', title: 'Validação ausente', summary: 'Entrada chega sem conferência.', ref: null, status: null, evidence: 'a.ts:1: a entrada chega sem conferência',
  criteria: { key: 'validacao', criterion: 'Conferir entrada', source: 'contrato.js:1', scope: 'Este patch' } };

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
    e.response = { protocolo: { prReviewer: 'rodou' }, ...criteriaFixture(verdict), analysisStatus: 'complete', verdict,
      decision: verdict === 'approve' ? 'auto_approve' : 'request_changes', cardMet: true, reasons: [], reportMarkdown: 'Analisado.',
      coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, findings,
      alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'entrypoint sintético' }],
      payloads: { [verdict]: { event: verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES', body: 'O contrato foi conferido.' } }, ...extra };
    await e.runHeadlessReview({ ...pr });
    return [...e.decisions.pending, ...e.decisions.resolved].sort((a, b) => b.createdAt - a.createdAt)[0];
  };
  return { e, pr, run, scope: scopeFor(pr.key, 'eu') };
}

test('critérios publicados: sugestão não vira blocker sem prova, inclusive em observação e no clique', async () => {
  const { e, run, scope } = motor('observe');
  const criteria = { key: 'responsabilidade-turno', criterion: 'Separar responsabilidades', source: 'ARCHITECTURE.md:12', scope: 'Refatoração deste turno' };
  const suggestion = { ...blocker, severity: 'suggestion', criteria, evidence: 'Commit A: responsabilidade já existia' };
  const first = await run([suggestion]);
  assert.equal(first.status, 'auto_approved');
  const ref = readRounds(scope).rounds[0].findings[0].id;
  e.head = 'b'.repeat(40);
  const second = await run([{ ...suggestion, severity: 'blocking', ref, status: 'persiste' }], 'request_changes');
  assert.equal(second.criteriaEvidence.ok, false);
  assert.equal(e.postados.length, 1);
  assert.match(second.criteriaEvidence.issues.join(), /sem nova evidência/);
  assert.equal((await e.decide(second.id, 'request_changes')).blocked, 'criterios_inconsistentes');
  assert.equal(e.decisionForUi(second).criteriaEvidence, undefined);
  assert.ok(e.prompts.at(-1).includes('criteria: {key'));
});

test('agravamento comprovado permite reclassificar sugestão sem apagar a rodada original', async () => {
  const { e, run, scope } = motor('observe');
  const criteria = { key: 'turno', criterion: 'Sem ciclo', source: 'ARCHITECTURE.md:1', scope: 'Este patch' };
  const suggestion = { ...blocker, severity: 'suggestion', criteria, evidence: 'A: sem ciclo' };
  await run([suggestion]);
  const before = readRounds(scope).rounds[0];
  e.head = 'b'.repeat(40);
  const change = { type: 'agravamento', reason: 'Novo import circular', evidence: 'B: a importa b que importa a', scope: 'Ciclo introduzido pelo diff impede boot' };
  const after = await run([{ ...suggestion, ref: before.findings[0].id, status: 'persiste', severity: 'blocking', change }], 'request_changes');
  assert.equal(after.criteriaEvidence.ok, true);
  assert.equal(after.status, 'auto_rejected');
  assert.equal(readRounds(scope).rounds.find(r => r.id === before.id).findings[0].severity, 'suggestion');
});

test('ponto publicado omitido não vira resolução e tentativa não publicada não muda o critério', async () => {
  const { e, run } = motor('observe');
  const suggestion = { ...blocker, severity: 'suggestion', criteria: { key: 'turno', criterion: 'Regra', source: 'SPEC.md:1', scope: 'Este PR' } };
  await run([suggestion]);
  e.head = 'b'.repeat(40);
  const missing = await run([]);
  assert.match(missing.criteriaEvidence.issues.join(), /omitido/);
  const restored = await run([suggestion]);
  assert.equal(restored.criteriaEvidence.ok, true);
});

test('solução não executada permanece hipótese sem impedir reprovação de defeito comprovado', async () => {
  const { e, run } = motor('observe');
  const recommendation = { descricao: 'Trocar a coluna após conferir consumidores', estado: 'validada', headSha: e.head };
  const invalid = await run([{ ...blocker, recommendation }], 'request_changes');
  assert.equal(invalid.criteriaEvidence.ok, false);
  assert.equal(e.postados.length, 0);
  const valid = await run([{ ...blocker, recommendation: { ...recommendation, estado: 'hipotese' } }], 'request_changes');
  assert.equal(valid.status, 'auto_rejected');
});

test('alegação de aceite sem fonte primária não sustenta publicação', async () => {
  const { e, run } = motor('observe');
  const d = await run([], 'approve', { productDecisions: [{ descricao: 'Aceito pelo PO', estado: 'registro', uso: 'fundamenta_veredito', fonteId: 'PR:1', trecho: 'Aprovado' }] });
  assert.equal(d.criteriaEvidence.ok, false);
  assert.equal(e.postados.length, 0);
  assert.match(d.criteriaEvidence.issues.join(), /fonte primária/);
});

test('saída do modelo não decide a evidência reservada nem contamina a recuperação', async () => {
  const { run } = motor('observe');
  const d = await run([], 'approve', { criteriaEvidence: { ok: false, issues: ['forjado pelo modelo'] } });
  assert.equal(d.status, 'auto_approved');
  assert.equal(d.criteriaEvidence.ok, true);
  assert.ok(!d.approvalEvidence.some(g => /incompat|forjado/.test(g)));
});

test('rodadas reais: blocker esquecido não some, chega ao prompt e impede aprovação no modo ativo', async () => {
  const { e, pr, run, scope } = motor();
  const first = await run([blocker], 'request_changes');
  assert.equal(e.postados.length, 1);
  const previous = readRounds(scope).rounds[0].unresolved[0];
  e.head = 'b'.repeat(40);
  const second = await run([]);
  assert.equal(e.postados.length, 1);
  assert.equal(second.status, 'pending');
  assert.equal(second.roundReview, null);
  assert.match(second.criteriaEvidence.issues.join(), /omitido/);
  assert.match(e.prompts[1], new RegExp(previous.id));
  assert.match(e.prompts[1], /dado não confiável/);
  assert.equal(readRounds(scope).rounds.length, 1, 'a rodada recusada não altera o diário');
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
  assert.equal(d.analysisStatus, 'incomplete');
  assert.equal(d.roundId, null);
  assert.match(d.criteriaEvidence.issues.join(' '), /contrato|omitido/);
  assert.equal(readRounds(scope).rounds.length, 1, 'envelope inválido não contamina o diário');
});

test('modo observação não dispensa destino dos critérios publicados nem vaza findings na projeção', async () => {
  const { run, e } = motor('observe');
  await run([blocker], 'request_changes');
  e.head = 'b'.repeat(40);
  const d = await run([]);
  assert.equal(d.status, 'pending');
  assert.equal(d.criteriaEvidence.ok, false);
  const ui = e.decisionForUi(d);
  assert.equal(ui.rounds, undefined);
  assert.equal(ui.findings, undefined);
  assert.equal(ui.roundReview, undefined);
  assert.equal(ui.criteriaEvidence, undefined);
  const html = resolvedRow(ui, {});
  assert.doesNotMatch(html, /class="round-summary/);
  assert.equal(d.analysisStatus, 'incomplete');
});

test('decisão manual não publica um resultado com critérios novos inconsistentes', async () => {
  const { run, e } = motor();
  await run([blocker], 'request_changes');
  e.head = 'b'.repeat(40);
  const d = await run([]);
  const result = await e.decide(d.id, 'approve');
  assert.equal(result.blocked, 'criterios_inconsistentes');
  assert.equal(e.postados.length, 1);
});

test('reinício preserva achados e corrupção impede liberar a automação ativa', async () => {
  const { run, scope, e } = motor();
  await run([blocker], 'request_changes');
  const round = readRounds(scope).rounds[0];
  fs.writeFileSync(path.join(roundsPath(scope), `${round.id}.json`), 'inválido');
  e.head = 'b'.repeat(40);
  const d = await run([]);
  assert.equal(d.status, 'pending');
  assert.match(d.criteriaEvidence.issues.join(' '), /histórico local/);
  assert.equal(fs.readFileSync(path.join(roundsPath(scope), `${round.id}.json`), 'utf8'), 'inválido');
});

test('reprovação e caminhos alternativos também respeitam a comparação ativa', async () => {
  const { run, e } = motor();
  await run([blocker], 'request_changes');
  e.head = 'b'.repeat(40);
  const d = await run([], 'request_changes');
  assert.equal(d.status, 'pending');
  assert.equal(e.postados.length, 1);
  assert.match(d.reasons.map(r => r.text || r).join(' '), /omitido sem destino/);
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

test('contrato interno forjado sem findings não libera aprovação', async () => {
  const { run, e } = motor();
  const d = await run(undefined, 'approve', { findingContract: { status: 'complete', findings: [], issues: [] } });
  assert.equal(d.status, 'pending');
  assert.equal(e.postados.length, 0);
  assert.equal(d.roundReview, null);
  assert.match(d.criteriaEvidence.issues.join(' '), /contrato/);
});

test('pedido de mudanças em PR próprio atravessa a fronteira como comentário sem virar aprovação', async () => {
  const { run, e, pr } = motor();
  pr.author = 'eu';
  e.postReview = async (_pr, payload, options) => {
    const refused = publicationRefusal(e, options, payload);
    if (refused) return refused;
    e.postados.push(payload);
    return { ok: true };
  };
  const d = await run([blocker], 'request_changes');
  assert.equal(d.status, 'commented_own_pr');
  assert.equal(e.postados.length, 1);
  assert.equal(e.postados[0].event, 'COMMENT');
  const options = { via: 'reenvio', continuidade: { verdict: 'request_changes', roundReview: d.roundReview } };
  assert.equal(publicationRefusal(e, options, { event: 'COMMENT' }), null);
  assert.equal(publicationRefusal(e, options, { event: 'APPROVE' }).blocked, 'round_memory');
  options.continuidade.verdict = 'approve';
  assert.equal(publicationRefusal(e, options, { event: 'COMMENT' }).blocked, 'round_memory');
  options.continuidade.verdict = 'request_changes';
  options.continuidade.roundReview.integrity = ['memória indisponível'];
  assert.equal(publicationRefusal(e, options, { event: 'COMMENT' }).blocked, 'round_memory');
});
