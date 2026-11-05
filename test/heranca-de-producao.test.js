// Dívida herdada da production não bloqueia (biud-frontend#1822). Base do cenário: boca-da-sessao.
// (cabeçalho original:) Quem o Farol revisa sozinho, conferido na boca da sessão (05/11/2026). Medido em 225 revisões:
// 15 rodaram com o pedido já removido pelo autor (tenant-company#276: removido às 23:56, aprovado às
// 00:33), e 81 em head que já tinha decisão de gente. O PR pode mudar enquanto espera a vez na fila.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { criteriaFixture } from './helpers/criteria-fixture.js';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-heranca-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '7a01c80578a4dfd492e96dfe83b8bcf77fe1309b';
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let gh;
let sessoes;
let postados;
let envios = [];
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) { postados += 1; envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')).event); return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' }; }
  if (/compare\/production\.\.\./.test(sub)) {
    if (gh.compareFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 404' };
    return { ok: true, code: 0, stdout: JSON.stringify(gh.diferentes), stderr: '' };
  }
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
  gh = { pedidos: [{ __typename: 'User', login: 'eu' }], meusReviews: [], alheios: [], leituraFalha: false, diferentes: [], compareFalha: false };
  envios = [];
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


const ARQ = 'src/lib/aviso/aviso.test.tsx';
const BLOCKER = { ...criteriaFixture('request_changes').findings[0], title: 'Falta teste da posição', summary: 'Nenhum teste passa por definirPosicaoDosAvisos.', file: ARQ, line: 1 };

function comSessaoQuePede(e) {
  e.fetchPrInventory = async () => ({ status: 'complete', headSha: HEAD, baseSha: 'b'.repeat(40), changedFiles: 1, files: [{ path: ARQ, sha: HEAD, status: 'modified', additions: 1, deletions: 0, changes: 1, lines: 1 }] });
  e.runClaudeStream = async () => {
    sessoes += 1;
    return { sessionId: 's1', text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('request_changes'), analysisStatus: 'complete', verdict: 'request_changes', decision: 'auto_reject', cardMet: true,
      reasons: ['Falta teste.'], findings: [BLOCKER],
      coverage: { total: 1, reviewed: [ARQ], missing: [] },
      alcance: [{ alterado: ARQ, chamadores: [], semChamador: 'teste' }],
      payloads: { approve: { event: 'APPROVE', body: 'Conteúdo igual ao que já está em produção.' }, request_changes: { event: 'REQUEST_CHANGES', body: 'Falta o teste da posição.' }, comment: { event: 'COMMENT', body: 'Leitura.' } },
      reportMarkdown: '# ok',
    }) };
  };
  return e;
}

test('backmerge: bloqueio em arquivo idêntico à production não vira pedido de mudanças', async () => {
  gh.diferentes = [];
  const e = comSessaoQuePede(motor());
  await e.runOneHeadless(PR(1), 'eu');
  assert.equal(sessoes, 1);
  assert.equal(envios.includes('REQUEST_CHANGES'), false);
  const d = [...e.decisions.pending, ...e.decisions.resolved].find((x) => x.key === 'acme/app#1');
  assert.ok((d.reasons || []).some((r) => /dívida herdada/.test(r.text || r)), 'o motivo fica visível');
  assert.equal(d.verdict, 'approve', 'sem bloqueio próprio, o veredito volta a ser da política da conta');
});

test('arquivo que difere da production continua bloqueando', async () => {
  gh.diferentes = [ARQ];
  const e = comSessaoQuePede(motor());
  await e.runOneHeadless(PR(2), 'eu');
  assert.deepEqual(envios, ['REQUEST_CHANGES']);
});

test('sem conseguir comparar com a production nada é rebaixado', async () => {
  gh.compareFalha = true;
  const e = comSessaoQuePede(motor());
  await e.runOneHeadless(PR(3), 'eu');
  assert.deepEqual(envios, ['REQUEST_CHANGES']);
});

test('comparação no teto de 300 arquivos não rebaixa: não dá para saber o que ficou de fora', async () => {
  gh.diferentes = Array.from({ length: 300 }, (_, i) => `x/${i}.ts`);
  const e = comSessaoQuePede(motor());
  await e.runOneHeadless(PR(4), 'eu');
  assert.deepEqual(envios, ['REQUEST_CHANGES']);
});

test('ponto de rodada anterior em arquivo herdado sai como retirado, com a evidência', async () => {
  const { rebaixarHeranca } = await import('../lib/engine/heranca-de-producao.js');
  const result = { findings: [{ ...BLOCKER, ref: 'r1:f1', status: 'persiste' }, { ...BLOCKER, file: 'src/novo.ts' }] };
  assert.equal(rebaixarHeranca(result, [ARQ]), 1);
  assert.equal(result.findings[0].severity, 'suggestion');
  assert.equal(result.findings[0].status, 'retirado');
  assert.match(result.findings[0].evidence, /idêntico ao da production/);
  assert.equal(result.findings[1].severity, 'blocking', 'o arquivo que o PR cria segue bloqueando');
});
