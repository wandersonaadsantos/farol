import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-rounds-'));
process.env.FAROL_HOME = home;
const { normalizeFindings, classifyFindings, roundMemoryBlock, roundGap } = await import('../lib/engine/review-findings.js');
const store = await import('../lib/engine/review-round-store.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const scope = store.scopeFor('o/r#1', 'EU');
const id = 'a'.repeat(32);
const blocker = { id: `${id}:f1`, file: 'a.ts', line: 1, severity: 'blocking', title: 'Contrato', summary: 'O consumidor falha.', ref: null, status: null, evidence: '' };
function round(extra = {}) {
  return { schema: 1, id, scope, parents: [], headSha: 'h1', baseSha: 'b1', at: 1,
    findings: [blocker], unresolved: [blocker], files: [{ path: 'a.ts', sha: 'blob1' }], ...extra };
}
function context() { return { parents: [round()], baseSha: 'b1', mode: 'observe', status: 'ready' }; }
const files = [{ path: 'a.ts', sha: 'blob1' }];

test('achados ausentes são legado, formato incorreto é inválido e lista vazia é declaração explícita', () => {
  assert.equal(normalizeFindings(undefined).status, 'legacy');
  assert.equal(normalizeFindings({}).status, 'invalid');
  assert.equal(normalizeFindings([]).status, 'complete');
});

test('não corta 61 blockers nem resume a memória em 40 itens', () => {
  const raw = Array.from({ length: 61 }, (_, i) => ({ ...blocker, title: `Achado ${i}` }));
  const normalized = normalizeFindings(raw);
  assert.equal(normalized.findings.length, 61);
  const r = round({ findings: raw, unresolved: raw.map((f, i) => ({ ...f, id: `f${i}` })) });
  const block = roundMemoryBlock({ ...context(), parents: [r] });
  assert.match(block, /Achado 60/);
});

test('campos externos inválidos impedem conclusão, sem virar suggestion ou desaparecer silenciosamente', () => {
  for (const field of [{ severity: 'inventada' }, { line: 1.5 }, { summary: null }, { title: 'x'.repeat(20001) }, { status: 'ok' }]) {
    const r = normalizeFindings([{ ...blocker, ...field }]);
    assert.equal(r.status, 'invalid');
    assert.equal(r.issues.length, 1);
  }
  assert.equal(normalizeFindings([{ ...blocker, severity: 'praise' }]).findings.length, 0);
});

test('blocker sem resposta permanece pendente mesmo se o arquivo não está mais no diff', () => {
  const r = classifyFindings(context(), normalizeFindings([]), []);
  assert.deepEqual(r.unresolved, [blocker]);
  assert.equal(r.dropped.length, 1);
});

test('resolução exige referência e evidência; retirada não é downgrade silencioso', () => {
  const answer = { ...blocker, ref: blocker.id, status: 'resolvido', severity: 'suggestion' };
  assert.equal(classifyFindings(context(), normalizeFindings([answer]), files).unresolved.length, 1);
  const r = classifyFindings(context(), normalizeFindings([{ ...answer, evidence: 'b.ts:14 agora valida o contrato' }]), files);
  assert.equal(r.unresolved.length, 0);
  assert.equal(r.resolvedOnUnchanged.length, 1, 'é indício de contexto, não prova de resolução falsa');
});

test('referência de outro PR ou repetida é inconclusiva e não apaga o blocker', () => {
  const answer = { ...blocker, ref: blocker.id, status: 'retirado', evidence: 'a premissa não procede: b.ts:2' };
  const r = classifyFindings(context(), normalizeFindings([answer, answer]), files);
  assert.equal(r.unresolved.length, 1);
  assert.match(r.issues[0], /repetida/);
  assert.equal(classifyFindings(context(), normalizeFindings([{ ...answer, ref: 'outro-pr' }]), files).unresolved.length, 1);
});

test('head novo com base alterada não permite inferir arquivo inalterado pelo blob', () => {
  const c = { ...context(), baseSha: 'b2' };
  const r = classifyFindings(c, normalizeFindings([blocker]), files);
  assert.equal(r.late.length, 0);
  assert.equal(r.changedContext, true);
});

test('comparação incerta, renomeação ou localização ausente não inventam achado tardio', () => {
  assert.equal(classifyFindings(context(), normalizeFindings([blocker]), null).late.length, 0);
  assert.equal(classifyFindings(context(), normalizeFindings([{ ...blocker, file: null }]), files).late.length, 0);
  assert.equal(classifyFindings(context(), normalizeFindings([{ ...blocker, file: 'renomeado.ts' }]), files).late.length, 0);
});

test('modo observação registra suspeitas sem ativar novo gate; enforce exige tratamento', () => {
  const review = { schema: 1, mode: 'observe', integrity: ['blocker sem resposta'], lateCount: 1 };
  assert.equal(roundGap({ roundReview: review }), '');
  assert.match(roundGap({ roundReview: { ...review, mode: 'enforce' } }), /blocker sem resposta/);
});

test('diário: duas análises concorrentes sobrevivem, repetição é idempotente e conflito não sobrescreve', () => {
  const a = round(), b = round({ id: 'b'.repeat(32) });
  store.saveRound(a); store.saveRound(b); store.saveRound(a);
  assert.equal(store.readRounds(scope).rounds.length, 2);
  assert.equal(store.frontier(store.readRounds(scope).rounds).length, 2);
  assert.throws(() => store.saveRound({ ...a, verdict: 'alterado' }), /conflito/);
  assert.equal(store.readRounds(scope).rounds.find(r => r.id === a.id).verdict, undefined);
});

test('filho une as duas fronteiras sem depender de relógio ou contador compartilhado', () => {
  const a = round(), b = round({ id: 'b'.repeat(32) });
  const child = round({ id: 'c'.repeat(32), parents: [a.id, b.id], at: 0 });
  assert.deepEqual(store.frontier([a, b, child]), [child]);
});

test('corrupção e schema desconhecido são preservados e nunca viram memória vazia', () => {
  const dir = store.roundsPath(scope), file = path.join(dir, 'd'.repeat(32) + '.json');
  fs.writeFileSync(file, 'corrompido');
  assert.equal(store.readRounds(scope).ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'corrompido');
  assert.throws(() => store.saveRound(round({ schema: 2 })), /inválida/);
});

test('resultado da publicação fica separado da análise e é idempotente', () => {
  const before = fs.readFileSync(path.join(store.roundsPath(scope), `${id}.json`), 'utf8');
  const outcome = { decisionId: 'd1', at: 3, status: 'pending', publicationState: 'failed' };
  store.recordOutcome(scope, id, outcome); store.recordOutcome(scope, id, outcome);
  assert.equal(fs.readdirSync(path.join(store.roundsPath(scope), 'outcomes', id)).length, 1);
  assert.equal(fs.readFileSync(path.join(store.roundsPath(scope), `${id}.json`), 'utf8'), before);
});

test('conta e PR isolam a memória, inclusive variantes de caixa do login', () => {
  assert.equal(scope, store.scopeFor('o/r#1', 'eu'));
  assert.equal(store.readRounds(store.scopeFor('o/r#2', 'eu')).rounds.length, 0);
  assert.equal(store.readRounds(store.scopeFor('o/r#1', 'outra')).rounds.length, 0);
});

test('ciclo em um ramo não fica escondido por outra rodada válida', () => {
  const a = round({ parents: ['b'.repeat(32)] });
  const b = round({ id: 'b'.repeat(32), parents: [a.id] });
  const independent = round({ id: 'f'.repeat(32) });
  assert.match(store.historyIssues([a, b, independent]).join(' '), /ciclo/);
});

test('processos distintos preservam as duas escritas no mesmo PR', async () => {
  const shared = store.scopeFor('o/r#concurrent', 'eu');
  const moduleUrl = new URL('../lib/engine/review-round-store.js', import.meta.url).href;
  const run = promisify(execFile);
  await Promise.all(['1', '2'].map(char => {
    const record = round({ scope: shared, id: char.repeat(32) });
    const script = `const {saveRound}=await import(${JSON.stringify(moduleUrl)}); saveRound(${JSON.stringify(record)});`;
    return run(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, FAROL_HOME: home } });
  }));
  const read = store.readRounds(shared);
  assert.equal(read.ok, true);
  assert.equal(read.rounds.length, 2);
});

test('resolução feita sem inventário ou com memória inconclusiva não apaga blocker para o próximo round', () => {
  const answer = { ...blocker, ref: blocker.id, status: 'resolvido', evidence: 'alteração conferida' };
  const normalized = normalizeFindings([answer]);
  assert.equal(classifyFindings(context(), normalized, null).unresolved.length, 1);
  assert.equal(classifyFindings({ ...context(), status: 'unavailable' }, normalized, files).unresolved.length, 1);
});
