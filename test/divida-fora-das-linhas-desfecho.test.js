import { criteriaFixture } from './helpers/criteria-fixture.js';
// O desfecho com a dívida fora das linhas do PR (05/11/2026, biud-frontend#1818): a sessão aprova e
// a avaliação técnica só reprova regra em linha que o PR não alterou. Antes virava REQUEST_CHANGES
// automático; agora a aprovação segue a política da conta, com a dívida como ressalva. O achado no
// trecho alterado continua reprovando sozinho, como antes.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-divida-linhas-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = 'd50ee3773dab3ea7e0e0a5950e565838fc8ca336';
const check = (name) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-05T21:47:00Z' });

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', statusCheckRollup: [check('test')] }) };
  }
  if (sub.includes('--json state,headRefOid,author')) return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, author: { login: 'dev' } }) };
  if (sub.includes('rules/branches/main')) return { ok: true, code: 0, stdout: JSON.stringify(['test']), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool, technicalReport } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { technicalRuntime, relatorioTecnico } = await import('../lib/technical-review/runtime.js');
const { defeitosDoPr } = await import('../lib/engine/desfecho-automatico.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { envios = []; });

const TESTE = 'src/lib/auth/index.test.ts';
const SUPRESSAO = 'core.suppression.declared';
const supressor = (linha) => ({ rule: SUPRESSAO, file: TESTE, assinatura: `${SUPRESSAO}|${TESTE}|@ts-expect-error:motivo`,
  message: `supressor "@ts-expect-error" na linha ${linha} sem motivo; a ficha e "<supressor> <identificador> -- <motivo>"` });

// a avaliação técnica de verdade monta o relatório (relatorioTecnico) com o inventário que o engine
// passou; o stub só substitui a ferramenta
function avaliacao(achados, visto) {
  return async (ctx, _a, _c, opcoes = {}) => {
    visto.inventario = opcoes.inventario;
    const contexto = { ...technicalReport(ctx.head, ctx.repo), ...ctx, profile: { fingerprint: 'fixture' }, objections: { fingerprint: 'fixture' } };
    return relatorioTecnico(contexto, { catalogFingerprint: 'fixture', verdict: 'fail', coverage: {},
      rules: [{ rule: SUPRESSAO, verdict: 'fail', conhecidos: 0 }], findings: achados }, { privateEvidence: 'x.json', inventario: opcoes.inventario });
  };
}

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
  // o diff medido: o PR mexeu só no trecho das linhas 1938 a 1949 do arquivo de teste
  e.fetchPrFiles = async () => [{ path: TESTE, sha: 'blob-1', status: 'modified', lines: 7, patchStatus: 'available',
    patch: '@@ -1938,6 +1938,12 @@ describe\n ctx\n+novo\n ctx\n' }];
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve',
      cardMet: true, reasons: [], coverage: { total: 1, reviewed: [TESTE], missing: [] },
      payloads: {
        approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' },
        request_changes: { event: 'REQUEST_CHANGES', body: 'Revise o tratamento de erro antes do merge.' },
        comment: { event: 'COMMENT', body: 'Leitura completa.' },
      },
      reportMarkdown: '# ok',
    }),
    sessionId: 's1',
  });
  return e;
}

const PR = (n) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', requested: true });
const decisao = (e, n) => [...e.decisions.pending, ...e.decisions.resolved].find((x) => x.key === `acme/app#${n}`);
const textos = (d) => (d.reasons || []).map((r) => r.text || r);

test('supressor sem motivo em linha que o PR não alterou: aprova pela política, com a dívida como ressalva, sem pedido de mudanças', async () => {
  const e = motor();
  const visto = {};
  technicalRuntime.finishTechnicalReview = avaliacao([supressor(1973), supressor(2394)], visto);
  await e.runHeadlessReview(PR(1818));
  assert.equal(visto.inventario?.headSha, HEAD, 'o engine passa o diff medido do mesmo commit à avaliação técnica');
  const d = decisao(e, 1818);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE'], JSON.stringify({ status: d.status, ev: d.approvalEvidence, r: textos(d) }));
  assert.equal(d.status, 'auto_approved');
  assert.deepEqual(defeitosDoPr(d), [], 'nada de defeito do PR: a retirada do pedido anterior lê a mesma lista');
  assert.ok(!d.approvalEvidence.includes('violação técnica confirmada'), d.approvalEvidence.join(' | '));
  assert.equal(d.technicalReview.foraDasLinhas.achados, 2);
  // a aprovação sai com ressalva (a política da conta decidiu postar com ressalvas), e o card a mostra
  const ressalvas = (d.attention || []).map((p) => p.text || p);
  assert.ok(ressalvas.some((t) => /^2 achado\(s\) da avaliação técnica em linha que este PR não alterou/.test(t)), ressalvas.join(' | '));
  assert.match(ressalvas.join(' | '), /src\/lib\/auth\/index\.test\.ts:1973/);
});

test('o mesmo supressor numa linha do trecho alterado segue reprovando sozinho', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = avaliacao([supressor(1973), supressor(1940)], {});
  await e.runHeadlessReview(PR(1819));
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  const d = decisao(e, 1819);
  assert.equal(d.status, 'auto_rejected');
  assert.ok(d.approvalEvidence.includes('violação técnica confirmada'));
});
