// Achados de 05/11/2026 às 19:20: o Revisar tudo lançou três PRs com head já decidido, por cima do
// gate, e o primeiro a sair da fila abriu duas sessões. Base do cenário: test/boca-da-sessao.test.js.
// (cabeçalho original:) Quem o Farol revisa sozinho, conferido na boca da sessão (05/11/2026). Medido em 225 revisões:
// 15 rodaram com o pedido já removido pelo autor (tenant-company#276: removido às 23:56, aprovado às
// 00:33), e 81 em head que já tinha decisão de gente. O PR pode mudar enquanto espera a vez na fila.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { criteriaFixture } from './helpers/criteria-fixture.js';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-lote-dup-'));
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
  e.sessoesDesteMotor = 0;
  e.runClaudeStream = async () => {
    sessoes += 1;
    e.sessoesDesteMotor += 1;
    return { sessionId: 's1', text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] }, findings: [],
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' }, request_changes: { event: 'REQUEST_CHANGES', body: 'Revise.' }, comment: { event: 'COMMENT', body: 'Leitura.' } },
      reportMarkdown: '# ok',
    }) };
  };
  return e;
}


const DECIDIDO = [{ quem: 'ana', tipo: 'User', state: 'APPROVED', commit_id: HEAD }];

async function lancar(e, pr, extras) {
  e.queue = [pr];
  return e.launchReview([pr.url], 'auto', 'clique', extras);
}

test('Revisar tudo respeita o head decidido: o PR segurado não abre sessão', async () => {
  gh.alheios = DECIDIDO;
  const e = motor();
  const r = await lancar(e, PR(1), { lote: true });
  await new Promise((r2) => setTimeout(r2, 50));
  assert.equal(sessoes, 0);
  assert.equal(r.ok, false, 'segurado já no lançamento: nem entra na fila de sessões');
  assert.equal(e.seen.has('acme/app#1'), false, 'continua na fila visível, sem virar visto');
});

test('Revisar tudo respeita o pedido removido', async () => {
  gh.pedidos = [];
  const e = motor();
  await lancar(e, PR(2), { lote: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sessoes, 0);
});

test('Revisar tudo segue revisando o PR livre', async () => {
  const e = motor();
  await lancar(e, PR(3), { lote: true });
  for (let i = 0; i < 40 && !sessoes; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(sessoes, 1);
});

test('clique num PR específico segue atravessando o head decidido', async () => {
  gh.alheios = DECIDIDO;
  const e = motor();
  await lancar(e, PR(4), {});
  for (let i = 0; i < 40 && !sessoes; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(sessoes, 1);
});

test('o mesmo PR pedido de novo enquanto começa não abre segunda sessão', async () => {
  const e = motor();
  const pr = { ...PR(5), account: 'eu', manual: true };
  const primeira = e.enqueueHeadless({ ...pr });
  const segunda = e.enqueueHeadless({ ...pr });
  assert.equal(primeira.ok, true);
  assert.deepEqual(segunda, { ok: false, code: 'duplicado' });
  for (let i = 0; i < 80 && !sessoes; i++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sessoes, 1);
});

test('depois que a revisão termina, o PR pode ser revisado de novo', async () => {
  const e = motor();
  const pr = { ...PR(6), account: 'eu', manual: true };
  e.enqueueHeadless({ ...pr });
  for (let i = 0; i < 80 && !(sessoes && !e.headlessIniciando?.size); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(e.enqueueHeadless({ ...pr }).ok, true);
});

test('Revisar tudo não desestaciona nem desfaz a saída de cena', async () => {
  const e = motor();
  e.autoReviewParked.add('acme/app#7');
  e.skipComentado['acme/app#8'] = { head: HEAD, quem: ['bia'] };
  await lancar(e, PR(7), { lote: true });
  await lancar(e, PR(8), { lote: true });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(e.sessoesDesteMotor, 0);
  assert.equal(e.autoReviewParked.has('acme/app#7'), true);
  assert.ok(e.skipComentado['acme/app#8']);
});
