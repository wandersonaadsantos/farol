import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-review-cancel-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const original = fanout.prMetrics;
fanout.prMetrics = async () => null;
after(() => { fanout.prMetrics = original; fs.rmSync(home, { recursive: true, force: true }); });

const HEAD = 'a'.repeat(40);
const PR = { key: 'acme/app#972', repo: 'acme/app', number: 972,
  url: 'https://github.com/acme/app/pull/972', author: 'dev', requested: true };
const envelope = { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve',
  reasons: [], reportMarkdown: 'Análise concluída.', payloads: { approve: { event: 'APPROVE', body: 'Revisado.' } } };

function engine() {
  const e = new Engine();
  e.config = { ...e.config, jiraSites: [], reReviewResume: false };
  e.decisions = { pending: [], resolved: [] };
  e.accountForPr = () => 'conta';
  e.tokenFor = () => '';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => [];
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  e.myReviewStates = async () => [];
  e.approvePolicyFor = () => 'approve';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = e.writeInflight = e.saveDecisions = e.pushState = e.processHeadless = e.log = () => {};
  e.postados = [];
  e.postReview = async (pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async () => ({ text: JSON.stringify(envelope) });
  return e;
}

function cancelarAtiva(e) {
  const id = [...e.activeReviews.keys()][0];
  assert.ok(id);
  assert.deepEqual(e.cancelSession(id), { ok: true });
  return id;
}

function semResultado(e) {
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.pending.length, 0);
  assert.equal(e.decisions.resolved.length, 0);
  assert.equal(e.activeReviews.size, 0);
}

test('cancelar na preparação sem processo impede iniciar o provedor', async () => {
  const e = engine();
  let chamadas = 0;
  e.headSha = async () => { cancelarAtiva(e); return HEAD; };
  e.runClaudeStream = async () => { chamadas++; throw new Error('não deveria iniciar'); };
  await assert.rejects(e.runHeadlessReview({ ...PR }), { cancelled: true });
  assert.equal(chamadas, 0);
  semResultado(e);
});

test('cancelar durante o modelo mata a árvore uma vez e não publica resultado tardio', async () => {
  const e = engine();
  const mortos = [];
  e.killTree = pid => mortos.push(pid);
  e.runClaudeStream = async (prompt, opts) => {
    e.running.set(opts.id, { child: { pid: 123 }, cancelled: false });
    cancelarAtiva(e);
    assert.deepEqual(e.cancelSession(opts.id), { ok: true });
    e.running.delete(opts.id);
    return { text: JSON.stringify(envelope) };
  };
  await assert.rejects(e.runHeadlessReview({ ...PR }), { cancelled: true });
  assert.deepEqual(mortos, [123]);
  semResultado(e);
});

test('cancelar no fechamento impede postagem e decisão pendente', async () => {
  for (const aprovar of [true, false]) {
    const e = engine();
    e.shouldAutoApprove = () => ({ ok: aprovar, motivo: 'politica' });
    e.bloqueadoPorChecks = async () => {
      assert.equal([...e.activeReviews.values()][0].fase, 'fechando');
      cancelarAtiva(e);
      return { faltando: [] };
    };
    await assert.rejects(e.runHeadlessReview({ ...PR }), { cancelled: true });
    semResultado(e);
  }
});

test('cancelar depois do dedup, imediatamente antes do envio, impede publicação', async () => {
  const e = engine();
  e.shouldAutoApprove = () => ({ ok: true });
  e.myReviewStates = async () => { cancelarAtiva(e); return []; };
  await assert.rejects(e.runHeadlessReview({ ...PR }), { cancelled: true });
  semResultado(e);
});

test('envio já iniciado recusa cancelamento e mantém o desfecho verdadeiro', async () => {
  const e = engine();
  e.shouldAutoApprove = () => ({ ok: true });
  e.postReview = async (pr, payload) => {
    const sessao = [...e.activeReviews.values()][0];
    assert.equal(sessao.cancellable, false);
    assert.equal(e.cancelSession(sessao.id).ok, false);
    assert.equal(sessao.cancelled, undefined);
    e.postados.push(payload);
    return { ok: true };
  };
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.postados.length, 1);
  assert.equal(e.decisions.resolved[0].status, 'auto_approved');
});

test('cancelamento no worker estaciona sem retry e mantém o PR na fila', async () => {
  const e = engine();
  e.fetchPrFiles = async () => { cancelarAtiva(e); return []; };
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.parkedMotivos[PR.key].tipo, 'cancelado');
  assert.equal(e.retryAfterNet.has(PR.key), false);
  assert.equal(e.queue.some(p => p.key === PR.key), true);
  semResultado(e);
});

test('sessão já encerrada devolve erro sem inventar sucesso', () => {
  assert.equal(engine().cancelSession('encerrada').ok, false);
});

test('reparo de envelope cancelado não vira falha de contrato nem abre outra rodada', async () => {
  const e = engine();
  let chamadas = 0;
  e.runClaudeStream = async () => {
    chamadas++;
    if (chamadas === 1) return { text: 'Falta entregar o resultado.', sessionId: '12345678-abcd-1234-abcd-123456789012' };
    cancelarAtiva(e);
    throw Object.assign(new Error('cancelada por você'), { cancelled: true });
  };
  await assert.rejects(e.runHeadlessReview({ ...PR }), { cancelled: true });
  assert.equal(chamadas, 2);
  semResultado(e);
});

test('provedor real recusa iniciar sessão de review já cancelada', async () => {
  const e = engine();
  e.activeReviews.set('cancelada', { mode: 'auto', cancellable: true, cancelled: true });
  e.resolveClaudeAuth = () => { throw new Error('não deve consultar o provedor'); };
  const { runClaudeStream } = await import('../lib/engine/session.js');
  await assert.rejects(runClaudeStream(e, 'não executar', { id: 'cancelada' }), { cancelled: true });
  assert.equal(e.running.size, 0);
});

test('falha concorrente do provedor não transforma cancelamento em retry de rede', async () => {
  const e = engine();
  e.runClaudeStream = async () => { cancelarAtiva(e); throw new Error('fetch failed'); };
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.parkedMotivos[PR.key].tipo, 'cancelado');
  assert.equal(e.retryAfterNet.has(PR.key), false);
  semResultado(e);
});
