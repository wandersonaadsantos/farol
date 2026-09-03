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
  // uma linha por evento: o rodarSessao não pode repetir a mesma notícia com outro texto
  const linhas = e.atividades.filter(t => /Retomando/.test(t));
  assert.equal(linhas.length, 1, 'a esteira anuncia a retomada uma vez só');
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

/* ---------- guarda de head: commit novo durante a espera do retry ---------- */
// A espera do retry pode ser longa (limite de plano tem cap 12 e hora de reset), e o
// bloco de retomada pede pra não reler o que já foi lido. Se o head andou nesse meio
// tempo, retomar seria pedir pra não reler justamente o que mudou.

test('head diferente do knownHead da queda derruba a retomada', async () => {
  const e = engineCom({ reReviewResume: false });
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345', knownHead: 'aaaaaaaaaaaa' });
  const args = e.chamadas[0].extraArgs;
  assert.equal(args.indexOf('--resume'), -1, 'commit novo = sessão nova');
  assert.ok(!e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), 'sem retomada, sem bloco');
  assert.ok(e.atividades.some(t => /recebeu commit novo depois da queda/.test(t)),
    'a esteira diz por que não retomou');
  assert.equal(e.atividades.filter(t => /Retomando/.test(t)).length, 0, 'nada de anunciar retomada que não houve');
});

test('head igual ao knownHead da queda retoma normalmente', async () => {
  const e = engineCom({ reReviewResume: false });
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345', knownHead: HEAD });
  const args = e.chamadas[0].extraArgs;
  assert.equal(args[args.indexOf('--resume') + 1], 'abc-12345');
});

test('head desconhecido de um dos lados mantém a retomada', async () => {
  // sem knownHead (queda antes de o head ser conhecido)
  const semKnown = engineCom({ reReviewResume: false });
  await semKnown.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345' });
  const a1 = semKnown.chamadas[0].extraArgs;
  assert.equal(a1[a1.indexOf('--resume') + 1], 'abc-12345', 'falta de dado nunca vira decisão nova');
  // sem head atual (gh não respondeu agora); o knownHead é o único head conhecido
  const semAtual = engineCom({ reReviewResume: false });
  semAtual.headSha = async () => '';
  await semAtual.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345', knownHead: 'aaaaaaaaaaaa' });
  const a2 = semAtual.chamadas[0].extraArgs;
  assert.equal(a2[a2.indexOf('--resume') + 1], 'abc-12345', 'sem head atual não há como afirmar que andou');
});

/* ---------- a guarda de head vale sem ninguém injetar knownHead ---------- */
// O knownHead vinha só do relançamento da re-revisão, então nos caminhos comuns
// (launchReview, check, recuperação de boot) a guarda nunca armava. Agora quem
// estampa é o próprio runHeadlessReview, com o head que a sessão de fato leu.
test('queda transitória carimba o head lido, e commit novo na espera derruba a retomada', async () => {
  const e = engineCom();
  let headAtual = HEAD;
  e.headSha = async () => headAtual;
  let n = 0;
  e.runClaudeStream = async (prompt, opts) => {
    n++;
    e.chamadas.push({ prompt, extraArgs: [...(opts.extraArgs || [])] });
    if (n === 1) throw Object.assign(new Error('fetch failed'), { sessionId: 'abc-12345' });
    return { text: JSON.stringify({ result: JSON.stringify(ENVELOPE) }), sessionId: 'nova-sessao-2' };
  };
  await e.runOneHeadless({ ...PR_BASE }, 'eu');
  const guardado = e.retryAfterNet.get(PR_BASE.key);
  assert.ok(guardado, 'falha de rede vira retry');
  assert.equal(guardado.pr.retomarSid, 'abc-12345');
  assert.equal(guardado.pr.knownHead, HEAD, 'head da sessão que caiu carimbado sem ajuda do teste');
  assert.equal(PR_BASE.knownHead, undefined, 'o carimbo não polui o knownHead do objeto que vive entre rounds');

  headAtual = 'facada99887766';
  await e.runHeadlessReview(guardado.pr);
  assert.equal(e.chamadas.length, 2, 'o relançamento rodou');
  assert.equal(e.chamadas[1].extraArgs.includes('--resume'), false, 'head novo não retoma');
  assert.equal(e.chamadas[1].prompt.includes(retomadaAposFalhaBlock()), false, 'nem o bloco entra');
});

test('mesmo head depois da queda retoma normalmente (sem knownHead injetado)', async () => {
  const e = engineCom();
  let n = 0;
  e.runClaudeStream = async (prompt, opts) => {
    n++;
    e.chamadas.push({ prompt, extraArgs: [...(opts.extraArgs || [])] });
    if (n === 1) throw Object.assign(new Error('fetch failed'), { sessionId: 'abc-12345' });
    return { text: JSON.stringify({ result: JSON.stringify(ENVELOPE) }), sessionId: 'nova-sessao-3' };
  };
  await e.runOneHeadless({ ...PR_BASE }, 'eu');
  const guardado = e.retryAfterNet.get(PR_BASE.key);
  await e.runHeadlessReview(guardado.pr);
  const args = e.chamadas[1].extraArgs;
  assert.equal(args[args.indexOf('--resume') + 1], 'abc-12345', 'head igual retoma');
});

/* ---------- degradação pra sessão nova sai sem o bloco de retomada ---------- */
// O bloco manda não reler o que já foi lido. Numa sessão que nasce agora isso é
// ordem pra pular leitura que ninguém fez, então ele só vale na tentativa com
// --resume.
test('resume recusado pelo CLI: a sessão nova roda sem o bloco e sem --resume', async () => {
  const e = engineCom();
  let n = 0;
  e.runClaudeStream = async (prompt, opts) => {
    n++;
    e.chamadas.push({ prompt, extraArgs: [...(opts.extraArgs || [])] });
    if (n === 1) throw new Error('No conversation found with session id abc-12345');
    return { text: JSON.stringify({ result: JSON.stringify(ENVELOPE) }), sessionId: 'nova-sessao-4' };
  };
  await e.runHeadlessReview({ ...PR_BASE, retomarSid: 'abc-12345' });
  assert.equal(e.chamadas.length, 2, 'tentou retomar e degradou');
  assert.ok(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), 'a tentativa com --resume leva o bloco');
  assert.equal(e.chamadas[1].prompt.includes(retomadaAposFalhaBlock()), false, 'a sessão nova não leva o bloco');
  assert.equal(e.chamadas[1].extraArgs.includes('--resume'), false);
});
