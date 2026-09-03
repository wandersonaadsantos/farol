// Retomada depois de falha transitória: quando a sessão da revisão cai por
// instabilidade de conexão ou por tempo esgotado, o relançamento continua a MESMA
// sessão (`--resume`) em vez de recomeçar do zero relendo o PR inteiro. Isso NÃO é
// opt-in (não passa por config.reReviewResume): é a mesma revisão, no mesmo head,
// que só caiu no meio. O round incremental da re-revisão (resumeSid) segue opt-in.
// Harness igual ao do dedup-round.test.js: engine real com FAROL_HOME temporário,
// sessão Claude stubada, fan-out neutralizado. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-retomada-falha-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const { retomadaAposFalhaBlock } = await import('../lib/engine/review.js');

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const HEAD = 'c0ffee1234ab';
const PR_BASE = {
  key: 'o/r#9', repo: 'o/r', number: 9, url: 'https://github.com/o/r/pull/9',
  requested: true, title: 'fix: algo', author: 'alguem'
};

const ENVELOPE = {
  analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', cardMet: true,
  reasons: [], reportMarkdown: 'relatório', payloads: {}
};

// captura o que foi pra linha de comando e pro prompt; postReview nunca é atingido
// (decision needs_decision), então a revisão termina sem tocar no GitHub.
function engineCom({ reReviewResume = false } = {}) {
  const chamadas = [];
  const atividades = [];
  const e = new Engine();
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => 'wait';
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.headSha = async () => HEAD;
  e.myReviewsWithTime = async () => [];
  e.postReview = async () => ({ ok: true });
  e.config = { ...e.config, reReviewResume };
  const pushOriginal = e.pushActivity.bind(e);
  e.pushActivity = (id, kind, text, agent, stage) => {
    atividades.push(text);
    return pushOriginal(id, kind, text, agent, stage);
  };
  e.runClaudeStream = async (prompt, opts) => {
    chamadas.push({ prompt, extraArgs: [...(opts.extraArgs || [])] });
    return { text: JSON.stringify({ result: JSON.stringify(ENVELOPE) }), sessionId: 'nova-sessao-1' };
  };
  e.chamadas = chamadas;
  e.atividades = atividades;
  return e;
}

test('retomarSid válido entra como --resume mesmo com reReviewResume desligado', async () => {
  const e = engineCom({ reReviewResume: false });
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345' });
  assert.equal(e.chamadas.length, 1, 'uma sessão só');
  const args = e.chamadas[0].extraArgs;
  const i = args.indexOf('--resume');
  assert.ok(i >= 0, 'a retomada por falha não depende de opt-in');
  assert.equal(args[i + 1], 'abc-12345');
});

test('retomada por falha injeta o bloco de continuidade no prompt e avisa na atividade', async () => {
  const e = engineCom({ reReviewResume: false });
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345' });
  assert.ok(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), 'o prompt carrega o bloco de retomada');
  assert.ok(e.atividades.some(t => /Retomando a sessão interrompida por instabilidade/.test(t)),
    'a linha de atividade explica por que não está relendo tudo');
});

test('sid fora do formato nunca entra na linha de comando', async () => {
  const e = engineCom({ reReviewResume: false });
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'x; rm -rf /' });
  const args = e.chamadas[0].extraArgs;
  assert.equal(args.indexOf('--resume'), -1, 'sid inválido degrada pra sessão nova, nunca pra shell');
  assert.ok(!e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), 'sem retomada, sem bloco de retomada');
});

test('sem retomarSid o comportamento é o de sempre (nada de --resume, nada de bloco)', async () => {
  const e = engineCom({ reReviewResume: false });
  await e.runHeadlessReview({ ...PR_BASE });
  assert.equal(e.chamadas[0].extraArgs.indexOf('--resume'), -1);
  assert.ok(!e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()));
});

test('retomarSid tem precedência sobre o resumeSid do round incremental', async () => {
  const e = engineCom({ reReviewResume: true });
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345', resumeSid: 'zzz-98765' });
  const args = e.chamadas[0].extraArgs;
  assert.equal(args[args.indexOf('--resume') + 1], 'abc-12345');
});

test('sem retomarSid, o resumeSid opt-in segue valendo e sem bloco de retomada', async () => {
  const e = engineCom({ reReviewResume: true });
  await e.runHeadlessReview({ ...PR_BASE, resumeSid: 'zzz-98765' });
  const args = e.chamadas[0].extraArgs;
  assert.equal(args[args.indexOf('--resume') + 1], 'zzz-98765');
  assert.ok(!e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), 'round incremental não é falha');
});

test('bloco de retomada é puro e sem travessão', () => {
  assert.equal(retomadaAposFalhaBlock(), retomadaAposFalhaBlock());
  assert.ok(!retomadaAposFalhaBlock().includes('—'), 'texto do app não usa travessão');
});

/* ---------- relançamento: o objeto guardado chega inteiro ao enqueueHeadless ---------- */

test('_repescarRetry relança o objeto guardado, preservando retomarSid e knownHead', async () => {
  const e = new Engine();
  const enfileirados = [];
  const pr = { ...PR_BASE, retomarSid: 'abc-12345', knownHead: HEAD, requested: true };
  e.accountForPr = () => 'trabalho';
  e.isMuted = () => false;
  e.tokens = { trabalho: 'tok' };
  e.budgetBlockedFor = () => false;
  e.skipComentado = {};
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  e.prState = async () => 'OPEN';
  e.emit = () => { };
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.retryAfterNet.set(pr.key, { tries: 1, pr, notBefore: null });

  await e._repescarRetry([], new Set());

  assert.equal(enfileirados.length, 1);
  assert.equal(enfileirados[0].retomarSid, 'abc-12345', 'o sid da sessão caída sobrevive ao relançamento');
  assert.equal(enfileirados[0].knownHead, HEAD);
  assert.equal(enfileirados[0].requested, true);
});
