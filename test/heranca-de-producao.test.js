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
let leiturasDaComparacao = 0;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) { postados += 1; envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')).event); return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' }; }
  if (/pulls\/\d+ --jq \{base: \.base\.ref\}/.test(sub)) return { ok: true, code: 0, stdout: JSON.stringify({ base: gh.base }), stderr: '' };
  if (/compare\/production\.\.\./.test(sub)) {
    leiturasDaComparacao += 1;
    if (gh.compareFalha) return { ok: false, code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    if (gh.compareErro) return { ok: false, code: 1, stdout: '', stderr: gh.compareErro };
    if (sub.includes(`production...${HEAD}`)) return { ok: true, code: 0, stdout: JSON.stringify({ behind: gh.behind, files: gh.diferentes.map((f) => ({ filename: f })) }), stderr: '' };
    return { ok: true, code: 0, stdout: JSON.stringify({ files: gh.mexidosNaBase.map((f) => ({ filename: f })) }), stderr: '' };
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
  gh = { pedidos: [{ __typename: 'User', login: 'eu' }], meusReviews: [], alheios: [], leituraFalha: false, diferentes: [], compareFalha: false, base: 'development', behind: 0, mexidosNaBase: [], compareErro: '' };
  envios = [];
  leiturasDaComparacao = 0;
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
const BLOCKER = { ...criteriaFixture('request_changes').findings[0], causa: 'defeito_codigo', title: 'Falta teste da posição', summary: 'Nenhum teste passa por definirPosicaoDosAvisos.', file: ARQ, line: 1 };
const HERDADO = { ...BLOCKER, herdadoDaProducao: true, evidence: 'O mesmo arquivo de teste está assim na production desde 31/10.' };
const APROVA = { event: 'APPROVE', body: 'Conteúdo trazido da production sem defeito próprio.' };

function comSessao(e, { achados = [HERDADO], aprova = APROVA } = {}) {
  e.fetchPrInventory = async () => ({ status: 'complete', headSha: HEAD, baseSha: 'b'.repeat(40), changedFiles: 1, files: [{ path: ARQ, sha: HEAD, status: 'modified', additions: 1, deletions: 0, changes: 1, lines: 1 }] });
  e.runClaudeStream = async () => {
    sessoes += 1;
    return { sessionId: 's1', text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('request_changes'), analysisStatus: 'complete', verdict: 'request_changes', decision: 'auto_reject', cardMet: true,
      reasons: ['Falta teste.'], findings: achados,
      coverage: { total: 1, reviewed: [ARQ], missing: [] },
      alcance: [{ alterado: ARQ, chamadores: [], semChamador: 'teste' }],
      payloads: { ...(aprova ? { approve: aprova } : {}), request_changes: { event: 'REQUEST_CHANGES', body: 'Falta o teste da posição.' }, comment: { event: 'COMMENT', body: 'Leitura.' } },
      reportMarkdown: '# ok',
    }) };
  };
  return e;
}
const decisao = (e, n) => [...e.decisions.pending, ...e.decisions.resolved].find((x) => x.key === `acme/app#${n}`);

test('backmerge: ponto declarado herdado, em arquivo herdado de verdade, não vira pedido de mudanças', async () => {
  const e = comSessao(motor());
  await e.runOneHeadless(PR(1), 'eu');
  assert.equal(envios.includes('REQUEST_CHANGES'), false);
  const d = decisao(e, 1);
  assert.equal(d.verdict, 'approve');
  assert.ok((d.reasons || []).some((r) => /dívida que já estava em produção/.test(r.text || r)));
});

const SEGUE_BLOQUEANDO = [
  ['sem a declaração da sessão', () => ({ achados: [BLOCKER] })],
  ['arquivo em que a base tinha trabalho próprio (resolução de conflito)', () => { gh.mexidosNaBase = [ARQ]; return {}; }],
  ['arquivo que difere da ponta da production', () => { gh.diferentes = [ARQ]; return {}; }],
  ['head que não contém a ponta da production (não é merge-back)', () => { gh.behind = 3; return {}; }],
  ['PR para a própria production', () => { gh.base = 'production'; return {}; }],
  ['repositório sem production', () => { gh.compareFalha = true; return {}; }],
];
SEGUE_BLOQUEANDO.forEach(([nome, preparar], i) => {
  test(`segue bloqueando: ${nome}`, async () => {
    const opcoes = preparar();
    const e = comSessao(motor(), opcoes);
    await e.runOneHeadless(PR(10 + i), 'eu');
    assert.deepEqual(envios, ['REQUEST_CHANGES']);
  });
});

test('sem texto de aprovação nada é rebaixado: a decisão fica como estava', async () => {
  const e = comSessao(motor(), { aprova: null });
  await e.runOneHeadless(PR(20), 'eu');
  assert.equal(decisao(e, 20).verdict, 'request_changes');
  assert.equal(decisao(e, 20).roundReview?.unresolvedCount, 1, 'o bloqueio segue vivo na memória: nada foi rebaixado');
});

test('causa de estado do PR declarada herdada não é rebaixada nem vira aprovar', async () => {
  const e = comSessao(motor(), { achados: [{ ...HERDADO, causa: 'ci' }] });
  await e.runOneHeadless(PR(21), 'eu');
  assert.notEqual(decisao(e, 21).verdict, 'approve');
});

test('repositório sem production não paga a comparação de novo', async () => {
  gh.compareFalha = true;
  const e = comSessao(motor());
  await e.runOneHeadless(PR(22), 'eu');
  const depoisDaPrimeira = leiturasDaComparacao;
  await e.runOneHeadless(PR(23), 'eu');
  assert.equal(leiturasDaComparacao, depoisDaPrimeira);
});

test('ponto de rodada anterior sai como retirado e a memória não o conta como resolvido em arquivo inalterado', async () => {
  const { rebaixarHeranca } = await import('../lib/engine/heranca-de-producao.js');
  const { classifyFindings, normalizeFindings } = await import('../lib/engine/review-findings.js');
  const result = { findings: [{ ...HERDADO, ref: 'r1:f1', status: 'persiste' }, { ...BLOCKER, file: 'src/novo.ts' }] };
  assert.equal(rebaixarHeranca(result, [ARQ]), 1);
  assert.equal(result.findings[0].status, 'retirado');
  assert.match(result.findings[0].evidence, /conferido pelo app/);
  assert.equal(result.findings[0].herancaConfirmada, true);
  assert.equal(result.findings[1].severity, 'blocking', 'o arquivo que o PR cria segue bloqueando');
  const anterior = { id: 'r1', baseSha: 'b', files: [{ path: ARQ, sha: 'x' }], findings: [{ id: 'r1:f1', severity: 'blocking', file: ARQ }], unresolved: [{ id: 'r1:f1', severity: 'blocking', file: ARQ }] };
  const c = classifyFindings({ parents: [anterior], baseSha: 'b' }, normalizeFindings([result.findings[0]]), [{ path: ARQ, sha: 'x' }]);
  assert.equal(c.resolvedOnUnchanged.length, 0);
  assert.equal(c.unresolved.length, 0);
});

test('a declaração da sessão sozinha não isenta a memória: só a herança confirmada pelo app', async () => {
  const { classifyFindings, normalizeFindings } = await import('../lib/engine/review-findings.js');
  const { aplicarHerancaDeProducao } = await import('../lib/engine/heranca-de-producao.js');
  // PR comum (não é merge-back): a sessão tenta pôr a marca do app num ponto retirado em arquivo inalterado
  gh.behind = 5;
  const result = { verdict: 'approve', findings: [{ ...HERDADO, ref: 'r1:f1', status: 'retirado', herancaConfirmada: true }] };
  await aplicarHerancaDeProducao(motor(), PR(29), HEAD, { files: [{ path: ARQ }] }, result, (t) => ({ text: t }));
  const anterior = { id: 'r1', baseSha: 'b', files: [{ path: ARQ, sha: 'x' }], findings: [{ id: 'r1:f1', severity: 'blocking', file: ARQ }], unresolved: [{ id: 'r1:f1', severity: 'blocking', file: ARQ }] };
  const c = classifyFindings({ parents: [anterior], baseSha: 'b' }, normalizeFindings(result.findings), [{ path: ARQ, sha: 'x' }]);
  assert.equal(c.resolvedOnUnchanged.length, 1, 'a sessão não consegue gravar a marca do app');
});

test('a herança roda antes da memória de rodadas: é ali que a marca da sessão é apagada', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  const heranca = fonte.indexOf('await aplicarHerancaDeProducao(');
  const memoria = fonte.indexOf('await roundsMod.finishRoundReview(');
  assert.ok(heranca > 0 && memoria > heranca);
  assert.equal(fonte.split('finishRoundReview(').length - 1, 1, 'um caminho só até a memória');
});

test('a marca de herança confirmada vinda da sessão é apagada antes da conferência', async () => {
  const { aplicarHerancaDeProducao } = await import('../lib/engine/heranca-de-producao.js');
  const result = { verdict: 'request_changes', findings: [{ ...BLOCKER, herancaConfirmada: true }] };
  await aplicarHerancaDeProducao(motor(), PR(30), HEAD, { files: [] }, result, (t) => ({ text: t }));
  assert.equal(result.findings[0].herancaConfirmada, undefined);
});

test('falha passageira da comparação não desliga a regra para o repositório', async () => {
  const { arquivosHerdados } = await import('../lib/engine/heranca-de-producao.js');
  gh.compareFalha = true;
  const e = motor();
  await arquivosHerdados(e, PR(31), HEAD, [ARQ]);
  assert.equal(e.semProducao?.has('acme/app') || false, true, 'o 404 guarda');
  const e2 = motor();
  gh.compareFalha = false;
  gh.compareErro = 'HTTP 502';
  await arquivosHerdados(e2, PR(32), HEAD, [ARQ]);
  assert.equal(e2.semProducao?.has('acme/app') || false, false, '502 não guarda');
});
