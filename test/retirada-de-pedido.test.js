import { criteriaFixture } from './helpers/criteria-fixture.js';
// Regra do dono (05/11/2026, biud-frontend#1779): "se o problema que deu o resultado request
// changes foi resolvido, automaticamente deverá remover o request changes, mas isso não quer
// dizer aprovação automática". Retirar e aprovar são decisões separadas.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-retirada-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD_VELHO = '8b8f3f8c59c9f06d28c6752039613796d9ac71e4';
const HEAD = '7a01c80578a4dfd492e96dfe83b8bcf77fe1309b';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';
const REVIEW_ID = 5779550702;
const check = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-11-05T12:00:00Z' });
const pedido = (extra) => ({ id: REVIEW_ID, state: 'CHANGES_REQUESTED', commit: HEAD_VELHO, at: '2026-11-05T03:38:29Z', ...extra });

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/reviews\/\d+\/dismissals/.test(sub)) {
    const corpo = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
    envios.push({ event: 'DISMISS', id: Number(sub.match(/reviews\/(\d+)\/dismissals/)[1]), message: corpo.message, metodo: args[args.indexOf('-X') + 1] });
    if (gh.retiradaFalha) return { ok: false, code: 1, stdout: '', stderr: gh.retiradaFalha };
    return { ok: true, code: 0, stdout: '{}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  // a leitura da retirada é a única que pede o id do review
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('id: .id')) {
    // o gh recusa --slurp com --jq: a leitura real tem de ser linha a linha
    if (sub.includes('--slurp')) return { ok: false, code: 1, stdout: '', stderr: 'the `--slurp` option is not supported with `--jq` or `--template`' };
    if (gh.leituraFalha) return { ok: false, code: 1, stdout: '', stderr: gh.leituraFalha };
    return { ok: true, code: 0, stdout: gh.meus.map((x) => JSON.stringify(x)).join('\n'), stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) return { ok: true, code: 0, stdout: JSON.stringify(gh.alheios || []), stderr: '' };
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: gh.estado, headRefOid: gh.head, baseRefName: 'main', statusCheckRollup: gh.rollup }) };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: gh.head, author: { login: 'dev' } }) };
  }
  if (sub.includes('rules/branches/main')) return { ok: true, code: 0, stdout: JSON.stringify(['test']), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.estado }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { provaDaRetirada, retirarPedidoResolvido, textoDaRetirada, marcaDaRodada, marcaDoCi } = await import('../lib/engine/retirada-de-pedido.js');
const { publicTextLanguageIssues } = await import('../lib/engine/public-review.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  gh = { head: HEAD_VELHO, estado: 'OPEN', retiradaFalha: '', leituraFalha: '', rollup: [check('test', 'SUCCESS')], meus: [pedido()] };
});

const KEY = (n) => `acme/app#${n}`;
const PR = (n) => ({ key: KEY(n), repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', requested: true });
const eventos = () => envios.map((x) => x.event);
const ARQUIVO = 'src/a.ts';
const BLOCKER = { ...criteriaFixture('request_changes').findings[0], title: 'Desvio silencioso', summary: 'O motivo se perde.', file: ARQUIVO, line: 1 };

function motor({ aprova = 'approve', reprova = 'request_changes', checks = () => [] } = {}) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.approvePolicyFor = () => aprova;
  e.rejectPolicyFor = () => reprova;
  e.autoReviewFor = () => true;
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.bloqueadoPorChecks = async () => ({ faltando: checks() });
  // o arquivo muda de conteúdo a cada head: "resolvido em arquivo inalterado" não se aplica
  e.fetchPrInventory = async () => ({ status: 'complete', headSha: gh.head, baseSha: 'b'.repeat(40), changedFiles: 1, files: [{ path: ARQUIVO, sha: gh.head, status: 'modified', additions: 1, deletions: 0, changes: 1 }] });
  return e;
}

function envelope(extra) {
  return JSON.stringify({
    protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    coverage: { total: 1, reviewed: [ARQUIVO], missing: [] }, findings: [],
    alcance: [{ alterado: ARQUIVO, chamadores: [], semChamador: 'entrypoint sintético' }],
    payloads: {
      approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' },
      request_changes: { event: 'REQUEST_CHANGES', body: 'Revise o tratamento de erro antes do merge.' },
      comment: { event: 'COMMENT', body: 'Leitura completa.' },
    },
    reportMarkdown: '# ok', ...extra,
  });
}

// Primeira rodada de verdade: o Farol pede mudanças por um blocker no commit velho.
async function rodadaQuePede(e, n) {
  e.runClaudeStream = async () => ({
    sessionId: 's1',
    text: envelope({
      ...criteriaFixture('request_changes'), verdict: 'request_changes', decision: 'auto_reject', reasons: ['O desvio é silencioso.'],
      findings: [BLOCKER],
    }),
  });
  await e.runHeadlessReview(PR(n));
  assert.equal(e.decisions.resolved.find((d) => d.key === KEY(n))?.status, 'auto_rejected', 'a primeira rodada pediu mudanças sozinha');
  envios = [];
  gh.head = HEAD;
}

// Segunda rodada: responde o blocker da memória pelo id que o prompt entregou.
function sessaoQueResolve(e, extra) {
  e.runClaudeStream = async (prompt) => {
    const ref = String(prompt).match(/"blockerRefs":\["([^"]+)"/)?.[1];
    assert.ok(ref, 'o prompt da segunda rodada traz o blocker da primeira');
    return {
      sessionId: 's2',
      text: envelope({ findings: [{ ...BLOCKER, summary: 'Corrigido.', ref, status: 'resolvido', evidence: 'O motivo agora chega à tela.' }], ...extra }),
    };
  };
}

async function duasRodadas(n, opcoes, extra) {
  const e = motor(opcoes);
  await rodadaQuePede(e, n);
  sessaoQueResolve(e, extra);
  await e.runHeadlessReview(PR(n));
  return e;
}

test('problema resolvido: retira o pedido citando o commit, antes de qualquer aprovação', async () => {
  await duasRodadas(1);
  assert.deepEqual(eventos(), ['DISMISS', 'APPROVE']);
  assert.equal(envios[0].id, REVIEW_ID);
  assert.equal(envios[0].metodo, 'PUT');
  assert.ok(envios[0].message.includes(HEAD.slice(0, 7)));
  assert.match(envios[0].message, /não é aprovação/);
});

test('retirar não é aprovar: com a conta esperando você, sai só a retirada', async () => {
  const e = await duasRodadas(2, { aprova: 'wait' });
  assert.deepEqual(eventos(), ['DISMISS']);
  const pendente = e.decisions.pending.find((x) => x.key === KEY(2));
  assert.ok(pendente, 'a aprovação continua decisão pendente');
  assert.equal(pendente.pedidoRetirado.head, HEAD);
  assert.equal(pendente.reasons.some((r) => /pedido de mudanças/.test(r.text || r)), false, 'a retirada não vira motivo nem ressalva');
});

test('blocker sem resposta na memória segura a retirada', async () => {
  const e = motor();
  await rodadaQuePede(e, 3);
  e.runClaudeStream = async () => ({ sessionId: 's2', text: envelope() });
  await e.runHeadlessReview(PR(3));
  assert.equal(eventos().includes('DISMISS'), false);
});

test('blocker que persiste: novo pedido de mudanças, sem retirada', async () => {
  const e = motor();
  await rodadaQuePede(e, 4);
  e.runClaudeStream = async (prompt) => ({
    sessionId: 's2',
    text: envelope({
      ...criteriaFixture('request_changes'), verdict: 'request_changes', decision: 'auto_reject', reasons: ['Continua silencioso.'],
      findings: [{ ...BLOCKER, summary: 'Continua.', ref: String(prompt).match(/"blockerRefs":\["([^"]+)"/)?.[1], status: 'persiste' }],
    }),
  });
  await e.runHeadlessReview(PR(4));
  assert.equal(eventos().includes('DISMISS'), false);
});

test('sem rodada anterior na memória não há como afirmar que foi resolvido', async () => {
  const e = motor();
  e.decisions.resolved = [{ key: KEY(5), headSha: HEAD_VELHO, status: 'auto_rejected', pr: { account: 'eu' } }];
  gh.head = HEAD;
  e.runClaudeStream = async () => ({ sessionId: 's1', text: envelope() });
  await e.runHeadlessReview(PR(5));
  assert.deepEqual(eventos(), ['APPROVE']);
});

test('conta em espera você com CI rodando: retira quando o CI fecha verde, e não aprova', async () => {
  let checks = [{ nome: 'test', estado: 'rodando' }];
  const e = await duasRodadas(6, { aprova: 'wait', checks: () => checks });
  assert.deepEqual(eventos(), []);
  checks = [];
  await e.varrerEsperas();
  assert.deepEqual(eventos(), ['DISMISS']);
  await e.varrerEsperas();
  assert.deepEqual(eventos(), ['DISMISS'], 'a marca sai depois de retirar: nada de segundo envio');
});

test('conta que aprova com CI rodando: retira e só então aprova', async () => {
  let checks = [{ nome: 'test', estado: 'rodando' }];
  const e = await duasRodadas(7, { checks: () => checks });
  assert.deepEqual(eventos(), []);
  checks = [];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(eventos(), ['DISMISS', 'APPROVE']);
});

test('commit novo antes do CI fechar limpa a marca sem retirar', async () => {
  const e = await duasRodadas(8, { aprova: 'wait', checks: () => [{ nome: 'test', estado: 'rodando' }] });
  gh.head = HEAD_NOVO;
  await e.varrerEsperas();
  assert.deepEqual(eventos(), []);
  assert.equal(e.decisions.pending.find((x) => x.key === KEY(8)).retiradaPendente, null);
});

test('pedido pelo CI vermelho sai quando o check fecha verde no mesmo commit, sem aprovar', async () => {
  const e = motor();
  e.decisions.resolved = [{ key: KEY(9), id: 'd9', headSha: HEAD, status: 'auto_rejected', pr: { ...PR(9) }, retiradaPendente: { tipo: 'ci', head: HEAD, tentativas: 0 } }];
  gh.head = HEAD;
  gh.meus = [pedido({ commit: HEAD })];
  gh.rollup = [check('test', 'FAILURE')];
  await e.varrerEsperas();
  assert.deepEqual(eventos(), [], 'com o check vermelho o pedido fica');
  gh.rollup = [check('test', 'SUCCESS')];
  await e.varrerEsperas();
  assert.deepEqual(eventos(), ['DISMISS']);
});

test('CI vermelho depois da prova da rodada: com o check verde saem o pedido novo e o antigo', async () => {
  const e = await duasRodadas(14, { checks: () => [{ nome: 'test', estado: 'vermelho' }] });
  assert.deepEqual(eventos(), ['REQUEST_CHANGES']);
  envios = [];
  const pedidoPeloCi = e.decisions.resolved.find((d) => d.key === KEY(14) && d.headSha === HEAD);
  assert.equal(pedidoPeloCi.status, 'auto_rejected');
  gh.meus = [pedido({ id: 1 }), pedido({ id: 2, commit: HEAD, at: '2026-11-05T04:00:00Z' })];
  await e.varrerEsperas();
  assert.deepEqual(envios.map((x) => x.id), [1, 2]);
});

test('CI vermelho sem prova da rodada: com o check verde sai só o pedido do commit', async () => {
  const e = comHistorico(15, [HEAD_VELHO]);
  e.decisions.resolved.push({ key: KEY(15), id: 'd15', headSha: HEAD, status: 'auto_rejected', pr: PR(15), retiradaPendente: marcaDoCi(HEAD) });
  gh.head = HEAD;
  gh.meus = [pedido({ id: 1 }), pedido({ id: 2, commit: HEAD, at: '2026-11-05T04:00:00Z' })];
  await e.varrerEsperas();
  assert.deepEqual(envios.map((x) => x.id), [2]);
});

test('a marca do CI herda a prova da rodada só do mesmo head', () => {
  assert.equal(marcaDoCi(HEAD, marcaDaRodada(HEAD)).comRodada, true);
  assert.equal(marcaDoCi(HEAD, marcaDoCi(HEAD, marcaDaRodada(HEAD))).comRodada, true);
  assert.equal(marcaDoCi(HEAD, marcaDaRodada(HEAD_VELHO)).comRodada, false);
  assert.equal(marcaDoCi(HEAD).comRodada, false);
});

test('conta silenciada depois da análise conclui a retirada pelo recibo da revisão admitida', async () => {
  let checks = [{ nome: 'test', estado: 'rodando' }];
  const e = await duasRodadas(16, { aprova: 'wait', checks: () => checks });
  const pendente = e.decisions.pending.find((x) => x.key === KEY(16));
  assert.ok(pendente.trabalhoIniciado, 'a revisão deixou o recibo');
  e.config.accounts[0].muted = true;
  checks = [];
  await e.varrerEsperas();
  assert.deepEqual(eventos(), ['DISMISS']);
});

test('head sem confirmação no fim da rodada adia a retirada para a varredura', async () => {
  const e = motor({ aprova: 'wait' });
  await rodadaQuePede(e, 17);
  sessaoQueResolve(e);
  const lerHead = e.headSha.bind(e);
  let leituras = 0;
  e.headSha = async (pr) => (leituras++ === 0 ? lerHead(pr) : '');
  await e.runHeadlessReview(PR(17));
  assert.deepEqual(eventos(), []);
  const marca = e.decisions.pending.find((x) => x.key === KEY(17)).retiradaPendente;
  assert.equal(marca.head, HEAD);
  gh.head = HEAD_NOVO;
  await e.varrerEsperas();
  assert.deepEqual(eventos(), [], 'o commit novo nunca revisado não recebe a retirada');
});

test('falha passageira ao retirar tenta de novo no ciclo seguinte, sem segurar a pendência', async () => {
  gh.retiradaFalha = 'HTTP 502';
  const e = await duasRodadas(10, { aprova: 'wait' });
  assert.deepEqual(eventos(), ['DISMISS']);
  gh.retiradaFalha = '';
  await e.varrerEsperas();
  assert.deepEqual(eventos(), ['DISMISS', 'DISMISS']);
});

test('falha ao retirar não impede a aprovação já liberada', async () => {
  gh.retiradaFalha = 'HTTP 502';
  await duasRodadas(11);
  assert.deepEqual(eventos(), ['DISMISS', 'APPROVE']);
});

test('retirada que falhou numa rodada dispensada pela decisão de gente fica marcada para a varredura', async () => {
  const e = motor();
  await rodadaQuePede(e, 18);
  sessaoQueResolve(e);
  gh.alheios = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];
  e.staleInfo = { [KEY(18)]: { stale: true, head: HEAD, lastState: 'CHANGES_REQUESTED' } };
  gh.retiradaFalha = 'HTTP 502';
  await e.runHeadlessReview(PR(18));
  assert.deepEqual(eventos(), ['DISMISS'], 'tentou retirar e não aprovou por cima');
  const item = e.decisions.resolved.find((d) => d.key === KEY(18) && d.status === 'approval_not_needed');
  assert.equal(item.retiradaPendente?.head, HEAD);
  gh.retiradaFalha = '';
  await e.varrerEsperas();
  assert.deepEqual(eventos(), ['DISMISS', 'DISMISS']);
});

test('head que andou durante a sessão segura a retirada', async () => {
  const e = motor({ aprova: 'wait' });
  await rodadaQuePede(e, 12);
  sessaoQueResolve(e);
  let leituras = 0;
  e.headSha = async () => (leituras++ === 0 ? HEAD : HEAD_NOVO);
  await e.runHeadlessReview(PR(12));
  assert.deepEqual(eventos(), []);
});

// As fronteiras de `retirarPedidoResolvido`, com o histórico montado para chegar a cada uma.
function comHistorico(n, commits = [HEAD_VELHO], extra = {}) {
  const e = motor(extra);
  e.decisions.resolved = commits.map((headSha) => ({ key: KEY(n), headSha, roundId: `r-${headSha}`, status: 'auto_rejected', pr: { account: 'eu' } }));
  return e;
}
const retirar = (e, n, opcoes) => retirarPedidoResolvido(e, PR(n), HEAD, opcoes);

test('pedido à mão no mesmo commit do automático segura: são indistinguíveis', async () => {
  gh.meus = [pedido({ id: 1 }), pedido({ id: 2, at: '2026-11-05T04:00:00Z' })];
  assert.deepEqual(await retirar(comHistorico(20), 20), { ok: false, motivo: 'pedido_manual' });
  assert.deepEqual(eventos(), []);
});

test('pedido à mão em commit sem decisão automática segura', async () => {
  gh.meus = [pedido({ id: 1, commit: 'c'.repeat(40) }), pedido({ id: 2, at: '2026-11-05T04:00:00Z' })];
  assert.deepEqual(await retirar(comHistorico(21), 21), { ok: false, motivo: 'pedido_manual' });
  assert.deepEqual(eventos(), []);
});

test('pedido à mão posto depois de dispensar o automático do mesmo commit segura', async () => {
  gh.meus = [pedido({ id: 1, state: 'DISMISSED' }), pedido({ id: 2, at: '2026-11-05T04:00:00Z' })];
  assert.deepEqual(await retirar(comHistorico(31), 31), { ok: false, motivo: 'pedido_manual' });
  assert.deepEqual(eventos(), []);
});

test('pedido cuja rodada não foi gravada segura: o que ele pediu nunca foi respondido', async () => {
  const e = comHistorico(32);
  e.decisions.resolved[0].roundId = null;
  assert.deepEqual(await retirar(e, 32), { ok: false, motivo: 'pedido_manual' });
  assert.deepEqual(eventos(), []);
});

test('marca do CI retira só o pedido do próprio commit, sem levar os antigos', async () => {
  const e = comHistorico(33, [HEAD_VELHO, HEAD]);
  gh.meus = [pedido({ id: 1 }), pedido({ id: 2, commit: HEAD, at: '2026-11-05T04:00:00Z' })];
  assert.deepEqual(await retirar(e, 33, { mesmoCommit: true }), { ok: true });
  assert.deepEqual(envios.map((x) => x.id), [2]);
});

test('a varredura insiste na falha passageira até o teto, e depois desiste', async () => {
  const e = motor();
  const item = { key: KEY(34), id: 'd34', headSha: HEAD_VELHO, roundId: 'r', status: 'auto_rejected', pr: PR(34), retiradaPendente: { tipo: 'rodada', head: HEAD, tentativas: 0 } };
  e.decisions.resolved = [item];
  gh.head = HEAD;
  gh.retiradaFalha = 'HTTP 502';
  for (let i = 1; i <= 4; i++) {
    await e.varrerEsperas();
    assert.equal(envios.length, i);
    assert.equal(item.retiradaPendente.tentativas, i);
  }
  await e.varrerEsperas();
  assert.equal(envios.length, 5);
  assert.equal(item.retiradaPendente, null, 'no teto a marca sai');
  await e.varrerEsperas();
  assert.equal(envios.length, 5);
});

test('decisão automática de outra conta não autoriza a retirada desta', async () => {
  const e = motor();
  e.decisions.resolved = [{ key: KEY(22), headSha: HEAD_VELHO, status: 'auto_rejected', pr: { account: 'outra' } }];
  assert.deepEqual(await retirar(e, 22), { ok: false, motivo: 'sem_pedido_anterior' });
  assert.deepEqual(eventos(), []);
});

test('vários pedidos automáticos ativos saem juntos', async () => {
  gh.meus = [pedido({ id: 1, commit: 'a'.repeat(40) }), pedido({ id: 2, at: '2026-11-05T04:00:00Z' })];
  assert.deepEqual(await retirar(comHistorico(23, ['a'.repeat(40), HEAD_VELHO]), 23), { ok: true });
  assert.deepEqual(envios.map((x) => x.id), [1, 2]);
});

test('pedido no próprio head não é retirado na rodada: nada mudou no código', async () => {
  gh.meus = [pedido({ commit: HEAD })];
  assert.deepEqual(await retirar(comHistorico(24, [HEAD_VELHO, HEAD]), 24), { ok: false, motivo: 'sem_pedido_anterior' });
  assert.deepEqual(eventos(), []);
});

test('pedido já retirado não vira segunda escrita', async () => {
  gh.meus = [pedido({ state: 'DISMISSED' })];
  assert.deepEqual(await retirar(comHistorico(25), 25), { ok: false, motivo: 'sem_pedido_anterior' });
  assert.deepEqual(eventos(), []);
});

test('vale a última decisão entre todas as páginas, não a primeira linha', async () => {
  gh.meus = [{ id: 2, state: 'APPROVED', commit: HEAD_VELHO, at: '2026-11-05T09:00:00Z' }, pedido()];
  assert.deepEqual(await retirar(comHistorico(26), 26), { ok: false, motivo: 'sem_pedido_anterior' });
  assert.deepEqual(eventos(), []);
});

test('leitura que falha não retira', async () => {
  gh.leituraFalha = 'HTTP 502';
  assert.deepEqual(await retirar(comHistorico(27), 27), { ok: false, motivo: 'leitura_falhou' });
  assert.deepEqual(eventos(), []);
});

test('PR fechado não recebe retirada', async () => {
  gh.estado = 'MERGED';
  assert.deepEqual(await retirar(comHistorico(28), 28), { ok: false, motivo: 'pr_fechado' });
  assert.deepEqual(eventos(), []);
});

test('conta silenciada não age', async () => {
  const e = comHistorico(29);
  e.config.accounts[0].muted = true;
  assert.deepEqual(await retirar(e, 29), { ok: false, motivo: 'conta' });
  assert.deepEqual(eventos(), []);
});

test('cancelamento ou posse perdida na última conferência não escreve', async () => {
  const perdeu = () => { throw new Error('lease perdido'); };
  await assert.rejects(retirar(comHistorico(30), 30, { antesDeEnviar: perdeu }), /lease perdido/);
  assert.deepEqual(eventos(), []);
});

// O gate é puro. A base é o resultado real da segunda rodada, e o teste de aceite prova que cada
// recusa abaixo vem do campo alterado, não de um fixture que já reprovava por outro motivo.
async function resultadoReal(n) {
  const e = motor({ aprova: 'wait' });
  await rodadaQuePede(e, n);
  sessaoQueResolve(e);
  const original = e.recordDecision.bind(e);
  let visto = null;
  e.recordDecision = (pr, result, extra) => { visto = { ...result }; return original(pr, result, extra); };
  await e.runHeadlessReview(PR(n));
  return { e, base: visto };
}

test('gate da retirada aceita a evidência completa', async () => {
  const { e, base } = await resultadoReal(40);
  assert.equal(provaDaRetirada(e, PR(40), base), 'sim');
});

const memoria = (extra) => (b) => ({ roundReview: { ...b.roundReview, ...extra } });
const RECUSAS = [
  ['blocker persistente na memória', memoria({ unresolvedCount: 1 })],
  ['memória de rodadas ausente', () => ({ roundReview: null })],
  ['primeira rodada, sem anterior', memoria({ parentIds: [] })],
  ['memória não verificada', memoria({ integrity: ['referência sem resposta'] })],
  ['resolvido em arquivo inalterado', memoria({ resolvedOnUnchangedCount: 1 })],
  ['análise incompleta', () => ({ analysisStatus: 'incomplete' })],
  ['veredito de reprovação', () => ({ verdict: 'request_changes' })],
  ['defeito técnico confirmado', () => ({ approvalEvidence: ['violação técnica confirmada'] })],
  ['prova esgotada que dispensou lacuna', () => ({ provaEsgotada: true, coverage: { total: 1, reviewed: [], missing: [ARQUIVO] } })],
  ['cobertura com pendência', () => ({ coverage: { total: 1, reviewed: [], missing: [ARQUIVO] } })],
];
RECUSAS.forEach(([nome, mudar], i) => {
  test(`gate da retirada recusa: ${nome}`, async () => {
    const { e, base } = await resultadoReal(50 + i);
    assert.equal(provaDaRetirada(e, PR(50 + i), { ...base, ...mudar(base) }), 'nao');
  });
});

// biud-esg#522: a última tentativa permitida fechou tudo; a marca sozinha não segura o pedido
test('prova esgotada sem lacuna dispensada retira como qualquer rodada', async () => {
  const { e, base } = await resultadoReal(60);
  assert.equal(provaDaRetirada(e, PR(60), { ...base, provaEsgotada: true }), 'sim');
});

const SO_CI = [
  ['check vermelho', () => ({ checksObrigatorios: [{ nome: 'test', estado: 'vermelho' }] })],
  ['check pendente', () => ({ checksObrigatorios: [{ nome: 'test', estado: 'rodando' }] })],
  ['checks de outro head', () => ({ checksVerifiedHead: HEAD_VELHO })],
];
SO_CI.forEach(([nome, mudar], i) => {
  test(`só falta o CI: ${nome}`, async () => {
    const { e, base } = await resultadoReal(70 + i);
    assert.equal(provaDaRetirada(e, PR(70 + i), { ...base, ...mudar(base) }), 'ci');
  });
});

test('origem desconhecida não retira', async () => {
  const { e, base } = await resultadoReal(80);
  assert.equal(provaDaRetirada(e, { ...PR(80), requested: false }, base), 'nao');
});

test('o texto da retirada passa pela trava de linguagem', () => {
  assert.deepEqual(publicTextLanguageIssues(textoDaRetirada(HEAD), 'body', 'eu'), []);
});
