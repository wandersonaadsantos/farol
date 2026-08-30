import test, { after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-stale-pend-'));
const { Engine } = await import('../server.js');

// O FAROL_HOME de teste e apagado no fim. Sem isto cada rodada da suite deixa um
// diretorio para tras: medido em 6 por rodada, somando mais de mil na maquina.
after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});


function engineMinima() {
  const e = Object.create(Engine.prototype);
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => {};
  e.resolveIntoHistory = function (item) { this.decisions.resolved.unshift({ ...item, resolvedAt: Date.now() }); };
  return e;
}

const PR = { key: 'acme/repo#7', repo: 'acme/repo', number: 7, url: 'https://github.com/acme/repo/pull/7', title: 't', author: 'dev' };

test('recordDecision: desfecho NÃO-pendente (auto_approved) também supersede a pendência stale_head do mesmo PR', () => {
  const e = engineMinima();
  e.decisions.pending.push({ id: 'velha', key: PR.key, blockedKind: 'stale_head', status: 'pending', reasons: [] });
  e.recordDecision(PR, { verdict: 'approve', reasons: [] }, { status: 'auto_approved', action: 'approve' });
  assert.equal(e.decisions.pending.length, 0, 'a pendência morta tinha que sair da mesa');
  assert.ok(e.decisions.resolved.some(d => d.id === 'velha' && d.status === 'superseded'));
});

test('recordDecision: pendência viva (sem blockedKind) NUNCA é superseded por desfecho novo', () => {
  const e = engineMinima();
  e.decisions.pending.push({ id: 'viva', key: PR.key, status: 'pending', reasons: [] });
  e.recordDecision(PR, { verdict: 'approve', reasons: [] }, { status: 'auto_approved', action: 'approve' });
  assert.equal(e.decisions.pending.length, 1, 'pendência de julgamento é sua, ninguém tira da mesa');
});

test('recordDecision preserva pr.account na pendência (I1: a fila headless relança pela identidade certa)', () => {
  const e = engineMinima();
  const prComConta = { ...PR, account: 'conta-dona-do-pr' };
  const item = e.recordDecision(prComConta, { verdict: 'approve', reasons: [] }, { status: 'pending' });
  assert.equal(item.pr.account, 'conta-dona-do-pr');
  assert.equal(e.decisions.pending[0].pr.account, 'conta-dona-do-pr');
});

test('recordDecision sem pr.account grava string vazia, nunca undefined (allowlist sempre tem a chave)', () => {
  const e = engineMinima();
  const item = e.recordDecision(PR, { verdict: 'approve', reasons: [] }, { status: 'pending' });
  assert.equal(item.pr.account, '');
});

// FIX 2: o gate de draft do round automático precisa do dado real quando o PR
// só existe na pendência (candidatosReRound reconstrói o alvo A PARTIR dela).
test('recordDecision preserva pr.isDraft na pendência', () => {
  const e = engineMinima();
  const prDraft = { ...PR, isDraft: true };
  const item = e.recordDecision(prDraft, { verdict: 'approve', reasons: [] }, { status: 'pending' });
  assert.equal(item.pr.isDraft, true);
  assert.equal(e.decisions.pending[0].pr.isDraft, true);
});

test('recordDecision sem pr.isDraft grava false, nunca undefined', () => {
  const e = engineMinima();
  const item = e.recordDecision(PR, { verdict: 'approve', reasons: [] }, { status: 'pending' });
  assert.equal(item.pr.isDraft, false);
});

test('os dois pontos de bloqueio por stale_head carimbam blockedKind e blockedHead', () => {
  const review = fs.readFileSync(new URL('../lib/engine/review.js', import.meta.url), 'utf8');
  const decision = fs.readFileSync(new URL('../lib/engine/decision.js', import.meta.url), 'utf8');
  // review.js: o recordDecision do pending tem que poder receber o carimbo
  assert.match(review, /staleHeadNovo/, 'review.js precisa capturar o head novo observado no gate');
  assert.match(review, /blockedKind: 'stale_head'/, 'review.js precisa carimbar o pending bloqueado');
  // decision.js: o decide() já gravava blockedKind; agora também o head observado
  assert.match(decision, /item\.blockedHead = head/, 'decide() precisa gravar o head observado');
});
