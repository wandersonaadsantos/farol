// Quem o Farol revisa sozinho, conferido na boca da sessão (05/11/2026). Medido em 225 revisões:
// 15 rodaram com o pedido já removido pelo autor (tenant-company#276: removido às 23:56, aprovado às
// 00:33), e 81 em head que já tinha decisão de gente. O PR pode mudar enquanto espera a vez na fila.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { criteriaFixture } from './helpers/criteria-fixture.js';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-boca-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '7a01c80578a4dfd492e96dfe83b8bcf77fe1309b';
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let gh;
let sessoes;
let postados;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) { postados += 1; return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' }; }
  if (sub.includes('--json reviewRequests,reviews')) {
    if (gh.leituraFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ reviewRequests: gh.pedidos, reviews: gh.meusReviews }) };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) return { ok: true, code: 0, stdout: JSON.stringify(gh.alheios), stderr: '' };
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', statusCheckRollup: [] }) };
  }
  if (sub.includes('--json state,headRefOid,author')) return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, author: { login: 'dev' } }) };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  sessoes = 0;
  postados = 0;
  gh = { pedidos: [{ __typename: 'User', login: 'eu' }], meusReviews: [], alheios: [], leituraFalha: false };
});

const PR = (n, marcas = { requested: true }) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', ...marcas });

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.autoReviewFor = () => true;
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.writeInflight = () => { };
  e.runClaudeStream = async () => {
    sessoes += 1;
    return { sessionId: 's1', text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] }, findings: [],
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' }, request_changes: { event: 'REQUEST_CHANGES', body: 'Revise.' }, comment: { event: 'COMMENT', body: 'Leitura.' } },
      reportMarkdown: '# ok',
    }) };
  };
  return e;
}

test('pedido direto em aberto: revisa', async () => {
  await motor().runOneHeadless(PR(1), 'eu');
  assert.equal(sessoes, 1);
});

test('pedido removido enquanto o PR esperava na fila: não abre sessão nem posta', async () => {
  gh.pedidos = [];
  await motor().runOneHeadless(PR(2), 'eu');
  assert.equal(sessoes, 0);
  assert.equal(postados, 0);
});

test('pedido só para um time: não é a conta marcada, não revisa sozinho', async () => {
  gh.pedidos = [{ __typename: 'Team', name: 'squad-zonas', slug: 'squad-zonas' }];
  await motor().runOneHeadless(PR(3), 'eu');
  assert.equal(sessoes, 0);
});

test('continuação de revisão minha: o GitHub tira o pedido quando eu reviso, e o round 2 segue', async () => {
  gh.pedidos = [];
  gh.meusReviews = [{ author: { login: 'EU' }, state: 'CHANGES_REQUESTED' }];
  await motor().runOneHeadless(PR(4), 'eu');
  assert.equal(sessoes, 1);
});

test('leitura do pedido que falha não bloqueia: falta de dado não inventa recusa', async () => {
  gh.leituraFalha = true;
  await motor().runOneHeadless(PR(5), 'eu');
  assert.equal(sessoes, 1);
});

for (const [nome, marcas] of [['clique', { manual: true, requested: false }], ['aparelho admin', { viaAdmin: true }], ['comando', { viaComando: true }]]) {
  test(`${nome} é o dono pedindo: atravessa a conferência do pedido`, async () => {
    gh.pedidos = [];
    await motor().runOneHeadless(PR(6, marcas), 'eu');
    assert.equal(sessoes, 1);
  });
}

test('decisão de gente no head enquanto esperava na fila: não abre sessão', async () => {
  gh.alheios = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];
  const e = motor();
  await e.runOneHeadless(PR(7), 'eu');
  assert.equal(sessoes, 0);
  assert.equal(e.seen.has('acme/app#7'), false, 'o PR segue elegível para a fila');
});

test('decisão só do acrity no head: segue revisando', async () => {
  gh.alheios = [{ quem: 'acrity-advesarial-code-review[bot]', tipo: 'Bot', state: 'CHANGES_REQUESTED', commit_id: HEAD }];
  await motor().runOneHeadless(PR(8), 'eu');
  assert.equal(sessoes, 1);
});

test('clique atravessa a decisão de gente no head', async () => {
  gh.alheios = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];
  await motor().runOneHeadless(PR(9, { manual: true, requested: false }), 'eu');
  assert.equal(sessoes, 1);
});

test('comentário antigo da conta não é continuação: pedido removido segue sem revisar', async () => {
  gh.pedidos = [];
  gh.meusReviews = [{ author: { login: 'eu' }, state: 'COMMENTED' }];
  await motor().runOneHeadless(PR(10), 'eu');
  assert.equal(sessoes, 0);
});

test('pendência viva é rodada já admitida: pedido removido não interrompe a recuperação', async () => {
  gh.pedidos = [];
  const e = motor();
  e.decisions.pending = [{ id: 'd11', key: 'acme/app#11', pr: PR(11), headSha: HEAD, status: 'pending' }];
  await e.runOneHeadless(PR(11), 'eu');
  assert.equal(sessoes, 1);
});

test('retentativa de PR cujo pedido saiu morre em vez de relançar a cada ciclo', async () => {
  gh.pedidos = [];
  const e = motor();
  e.retryAfterNet.set('acme/app#12', { tries: 0, pr: PR(12) });
  await e.runOneHeadless(PR(12), 'eu');
  assert.equal(sessoes, 0);
  assert.equal(e.retryAfterNet.has('acme/app#12'), false);
});

test('rodada automática segurada na boca solta a âncora', async () => {
  gh.alheios = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];
  const e = motor();
  e.reReviewLaunched = { 'acme/app#13': { head: HEAD, rodadas: 1 } };
  await e.runOneHeadless(PR(13, { requested: true, rodadaAutomatica: true }), 'eu');
  assert.equal(sessoes, 0);
  assert.notEqual(e.reReviewLaunched['acme/app#13']?.head, HEAD);
});

test('comando e aparelho admin atravessam a decisão de gente na boca: o recibo já disse aplicado', async () => {
  gh.alheios = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];
  await motor().runOneHeadless(PR(14, { viaComando: true }), 'eu');
  await motor().runOneHeadless(PR(15, { viaAdmin: true }), 'eu');
  assert.equal(sessoes, 2);
});

test('rodada liberada só para retirar o meu pedido não aprova por cima de quem já decidiu', async () => {
  gh.alheios = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];
  const e = motor();
  e.decisions.resolved = [{ key: 'acme/app#16', headSha: 'c'.repeat(40), status: 'auto_rejected', pr: { account: 'eu' } }];
  e.staleInfo = { 'acme/app#16': { stale: true, head: HEAD, lastState: 'CHANGES_REQUESTED' } };
  gh.meusReviews = [{ author: { login: 'eu' }, state: 'CHANGES_REQUESTED' }];
  await e.runOneHeadless(PR(16), 'eu');
  assert.equal(sessoes, 1, 'a rodada roda');
  assert.equal(postados, 0, 'nada de APPROVE');
  assert.equal(e.decisions.resolved.find((d) => d.key === 'acme/app#16' && d.status === 'approval_not_needed')?.action, 'skip');
});

test('fila: PR segurado não gasta gh enquanto o updatedAt não muda', async () => {
  gh.pedidos = [];
  const e = motor();
  const pr = PR(17, { requested: true, updatedAt: '2026-11-05T10:00:00Z' });
  let leituras = 0;
  const run = io.run;
  io.run = async (c, a) => { if ((a || []).join(' ').includes('reviewRequests')) leituras += 1; return run(c, a); };
  try {
    assert.equal(await e.bloqueiaAutomatico(pr), true);
    assert.equal(await e.bloqueiaAutomatico(pr), true);
    assert.equal(leituras, 1);
    gh.pedidos = [{ __typename: 'User', login: 'eu' }];
    assert.equal(await e.bloqueiaAutomatico({ ...pr, updatedAt: '2026-11-05T11:00:00Z' }), false, 'mudou: lê de novo');
    assert.equal(leituras, 2);
  } finally { io.run = run; }
});

test('PR com pedido automático meu não fica na memória: o staleInfo pode ainda não ter chegado', async () => {
  gh.alheios = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];
  gh.meusReviews = [{ author: { login: 'eu' }, state: 'CHANGES_REQUESTED' }];
  const e = motor();
  e.decisions.resolved = [{ key: 'acme/app#18', headSha: 'c'.repeat(40), status: 'auto_rejected', pr: { account: 'eu' } }];
  const pr = PR(18, { requested: true, updatedAt: '2026-11-05T10:00:00Z' });
  assert.equal(await e.bloqueiaAutomatico(pr), true, 'sem staleInfo ainda: segura neste passo');
  e.staleInfo = { 'acme/app#18': { stale: true, head: HEAD, lastState: 'CHANGES_REQUESTED' } };
  assert.equal(await e.bloqueiaAutomatico(pr), false, 'no mesmo updatedAt, a rodada que retira roda');
});

test('clique em PR segurado: a recuperação da rodada admitida não é barrada pela memória', async () => {
  gh.pedidos = [];
  const e = motor();
  const pr = PR(19, { requested: true, updatedAt: '2026-11-05T10:00:00Z' });
  assert.equal(await e.bloqueiaAutomatico(pr), true);
  e.decisions.pending = [{ id: 'd19', key: 'acme/app#19', pr: PR(19), headSha: HEAD, status: 'pending' }];
  assert.equal(await e.bloqueiaAutomatico(pr), false);
});
