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
const BLOB = 'c'.repeat(40);
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
const supressor = (linha) => ({ rule: SUPRESSAO, file: TESTE, intervaloVerificado: { inicio: linha, fim: linha, blob: BLOB }, assinatura: `${SUPRESSAO}|${TESTE}|@ts-expect-error:motivo`,
  message: `supressor "@ts-expect-error" na linha ${linha} sem motivo; a ficha e "<supressor> <identificador> -- <motivo>"` });

// a avaliação técnica de verdade monta o relatório (relatorioTecnico) com o inventário que o engine
// passou; o stub só substitui a ferramenta
function avaliacao(achados, visto) {
  return async (ctx, _a, _c, opcoes = {}) => {
    visto.inventario = opcoes.inventario;
    const contexto = { ...technicalReport(ctx.head, ctx.repo), ...ctx, profile: { fingerprint: 'fixture' }, objections: { fingerprint: 'fixture' } };
    return relatorioTecnico(contexto, { catalogFingerprint: 'fixture', verdict: 'fail', coverage: {},
      rules: [{ rule: SUPRESSAO, verdict: 'fail', conhecidos: 0 }], findings: achados },
    { privateEvidence: 'x.json', inventario: opcoes.inventario, achadosDaSessao: opcoes.achadosDaSessao });
  };
}

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'], autoReview: true,
    onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' }];
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
  e.fetchPrFiles = async () => [{ path: TESTE, sha: BLOB, status: 'modified', lines: 7, patchStatus: 'available',
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

function achadoDaSessao(extra = {}) {
  return { severity: 'blocking', causa: 'defeito_codigo', technicalRule: SUPRESSAO,
    title: 'Supressão sem motivo', summary: 'A supressão precisa de justificativa.',
    file: TESTE, line: 1973, evidence: 'O comentário de supressão não tem motivo.',
    criteria: { key: 'supressao-sem-motivo', criterion: 'Supressão justificada', source: SUPRESSAO, scope: 'Este PR' }, ...extra };
}

function sessaoComDivida(e, { corrigir = true, erro, bloqueada = false, malformada = false, defeitoReal = false } = {}) {
  const rodar = e.runClaudeStream;
  let chamadas = 0;
  e.runClaudeStream = async (prompt) => {
    chamadas++;
    if (chamadas > 1 && erro) throw erro;
    if (chamadas === 2 && bloqueada) return { blocked: true, coordination: { admitted: false, reason: 'indisponivel' } };
    if (chamadas === 2 && malformada) return { text: '{ invalido', sessionId: 's1' };
    const resposta = await rodar();
    const result = JSON.parse(resposta.text);
    result.verdict = 'request_changes'; result.decision = 'needs_decision';
    result.findings = [achadoDaSessao()];
    result.payloads.approve.body = 'Texto antigo, a supressão ainda impediria o merge.';
    result.payloads.request_changes.body = 'A supressão nesta linha precisa de motivo antes do merge.';
    if (chamadas > 1 && corrigir) {
      if (!bloqueada) assert.match(prompt, /dívida|Dívida/);
      result.verdict = 'approve';
      result.findings = [achadoDaSessao({ severity: 'suggestion' })];
      result.payloads.approve.body = 'As alterações do fluxo estão corretas. A supressão do trecho antigo fica como melhoria separada.';
    }
    if (defeitoReal) {
      result.findings.push(achadoDaSessao({ line: 1940, title: 'Supressão nova sem motivo',
        criteria: { key: 'supressao-nova-sem-motivo', criterion: 'Supressão justificada', source: SUPRESSAO, scope: 'Este PR' } }));
      result.verdict = 'request_changes';
      if (chamadas > 1 && corrigir) result.payloads.request_changes.body = 'A supressão introduzida na linha 1940 precisa de uma justificativa antes do merge.';
    }
    return { ...resposta, text: JSON.stringify(result) };
  };
  return () => chamadas;
}

for (const politica of ['approve', 'wait']) test(`dívida repetida pela sessão é corrigida na mesma conversa e respeita ressalvas=${politica}`, async () => {
  const e = motor();
  // Sem ressalvas aprovaria: no caso wait, só a classe correta mantém a pendência.
  e.config.accounts[0].onCaveats = politica;
  technicalRuntime.finishTechnicalReview = avaliacao([supressor(1973)], {});
  const chamadas = sessaoComDivida(e);
  const n = politica === 'approve' ? 1820 : 1821;
  await e.runHeadlessReview(PR(n));
  assert.equal(chamadas(), 2, 'uma correção dirigida, sem nova revisão inteira');
  const d = decisao(e, n);
  assert.equal(d.verdict, 'approve');
  assert.equal(d.analysisStatus, 'complete');
  assert.equal(d.roundReview.unresolvedCount, 0);
  assert.equal(d.esperaProva, undefined);
  assert.equal(d.technicalReview.foraDasLinhas.achados, 1);
  assert.ok((d.attention || d.reasons).some(r => /dívida anterior/.test(r.text || r)), 'a ressalva continua visível no desfecho');
  if (politica === 'wait') {
    assert.equal(d.status, 'pending');
    assert.deepEqual(envios, []);
    return;
  }
  assert.equal(d.status, 'auto_approved');
  assert.deepEqual(envios.map(p => p.event), ['APPROVE']);
  assert.equal(envios[0].body, 'As alterações do fluxo estão corretas. A supressão do trecho antigo fica como melhoria separada.');
});

test('correção sem progresso termina inconclusiva, sem pedido falso, aprovação fabricada ou outra sessão no polling', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = avaliacao([supressor(1973)], {});
  const chamadas = sessaoComDivida(e, { corrigir: false });
  await e.runHeadlessReview(PR(1823));
  const d = decisao(e, 1823);
  assert.equal(chamadas(), 2, 'a mesma resposta inválida encerra a correção sem progresso');
  assert.deepEqual(envios, []);
  assert.equal(d.analysisStatus, 'incomplete');
  assert.equal(d.technicalReview.escopoSessaoInconclusivo, true);
  assert.equal(d.esperaProva, undefined);
  assert.match(textos(d).join(' '), /dívida anterior e defeito deste PR/);
  assert.ok(e.decisionForUi(d).reasons.some(r => r.kind === 'gate' && /dívida anterior e defeito deste PR/.test(r.text)), 'a origem do app e o motivo concreto sobrevivem à projeção pública');
  assert.equal(await e.varrerEsperas(), 0);
  assert.equal(await e.varrerEsperas(), 0);
  assert.equal(chamadas(), 2);
  assert.equal(d.esperaProva, undefined, 'o polling não arma uma repetição paga idêntica');
  const anterior = e.runClaudeStream;
  e.runClaudeStream = async (...args) => {
    const resposta = await anterior(...args);
    const novo = JSON.parse(resposta.text);
    novo.verdict = 'approve';
    novo.findings = [achadoDaSessao({ severity: 'suggestion' })];
    novo.payloads.approve.body = 'O fluxo alterado está correto; a supressão antiga pode ser tratada separadamente.';
    return { ...resposta, text: JSON.stringify(novo), sessionId: 's2' };
  };
  await e.runHeadlessReview({ ...PR(1823), manual: true });
  assert.equal(chamadas(), 3, 'uma revisão pedida explicitamente ainda pode produzir prova nova');
  const nova = decisao(e, 1823);
  assert.equal(nova.status, 'auto_approved', JSON.stringify({ reasons: nova.reasons, gaps: nova.approvalEvidence, technical: nova.technicalReview, round: nova.roundReview }));
  assert.equal(nova.technicalReview.escopoSessaoInconclusivo, undefined);
  assert.deepEqual(envios.map(p => p.event), ['APPROVE']);
});

test('interrupção de rede durante a correção continua sendo falha recuperável, sem congelar o escopo', async () => {
  const e = motor();
  const reports = [];
  const fechar = avaliacao([supressor(1973)], {});
  technicalRuntime.finishTechnicalReview = async (...args) => { const r = await fechar(...args); reports.push(r); return r; };
  const erro = new Error('ECONNRESET: connection reset by peer');
  const chamadas = sessaoComDivida(e, { erro });
  await assert.rejects(e.runHeadlessReview(PR(1824)), error => error === erro);
  assert.equal(chamadas(), 2);
  assert.ok(reports.every(r => r.escopoSessaoInconclusivo !== true));
  assert.deepEqual(envios, []);
});

for (const politica of ['request_changes', 'wait']) test(`pausa de admissão não publica texto antigo nem esgota a correção, com defeito real e reprovação=${politica}`, async () => {
  const e = motor();
  e.config.accounts[0].onReject = politica;
  technicalRuntime.finishTechnicalReview = avaliacao([supressor(1973), supressor(1940)], {});
  const chamadas = sessaoComDivida(e, { bloqueada: true, defeitoReal: true });
  const n = politica === 'request_changes' ? 1825 : 1826;
  await e.runHeadlessReview(PR(n));
  const pausada = decisao(e, n);
  assert.deepEqual(envios, [], 'nem o outro defeito permite publicar a cobrança antiga da dívida');
  assert.equal(pausada.analysisStatus, 'incomplete');
  assert.equal(pausada.technicalReview.escopoSessaoInconclusivo, undefined);
  assert.equal(pausada.technicalReview.escopoSessaoPendente, true);
  assert.ok(pausada.esperaProva, 'impedimento temporário mantém recuperação automática');
  assert.ok(pausada.technicalReview.rules.some(r => r.verdict === 'fail' && !r.dividaForaDasLinhas), 'o defeito real permanece na prova');
  assert.ok(e.decisionForUi(pausada).reasons.some(r => r.kind === 'gate' && /não foi admitida/.test(r.text)), 'a pausa tem diagnóstico visível');
  pausada.esperaProva.proximaEm = Date.now() + 60_000;
  assert.equal(await e.varrerEsperas(), 0, 'a recuperação respeita o recuo, sem sessão imediata');
  assert.equal(chamadas(), 2);
  pausada.esperaProva.proximaEm = 0;
  assert.equal(await e.varrerEsperas(), 1, 'quando chega a vez, a recuperação pode relançar a análise');
  await e.runHeadlessReview(PR(n));
  const retomada = decisao(e, n);
  assert.equal(chamadas(), 3);
  assert.equal(retomada.analysisStatus, 'complete');
  assert.equal(retomada.technicalReview.escopoSessaoInconclusivo, undefined);
  assert.equal(retomada.technicalReview.escopoSessaoPendente, undefined);
  assert.equal(retomada.esperaProva, undefined);
  assert.equal(retomada.status, politica === 'request_changes' ? 'auto_rejected' : 'pending');
  assert.deepEqual(envios.map(p => p.event), politica === 'request_changes' ? ['REQUEST_CHANGES'] : []);
  if (envios.length) assert.ok(!envios[0].body.includes('nesta linha precisa de motivo'), 'a publicação usa o parecer corrigido');
});

test('sem identificador de conversa, a correção permanece recuperável e não recebe selo de esgotamento', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = avaliacao([supressor(1973)], {});
  const chamadas = sessaoComDivida(e);
  const executar = e.runClaudeStream;
  e.runClaudeStream = async (...args) => ({ ...await executar(...args), sessionId: null });
  await e.runHeadlessReview(PR(1827));
  const d = decisao(e, 1827);
  assert.equal(chamadas(), 1);
  assert.deepEqual(envios, []);
  assert.equal(d.technicalReview.escopoSessaoInconclusivo, undefined);
  assert.equal(d.technicalReview.escopoSessaoPendente, true);
  assert.ok(d.esperaProva);
});

for (const politica of ['request_changes', 'wait']) test(`continuação malformada não transforma o objeto reclassificado em parecer novo, com defeito real e reprovação=${politica}`, async () => {
  const e = motor();
  e.config.accounts[0].onReject = politica;
  technicalRuntime.finishTechnicalReview = avaliacao([supressor(1973), supressor(1940)], {});
  const chamadas = sessaoComDivida(e, { malformada: true, defeitoReal: true });
  const n = politica === 'request_changes' ? 1828 : 1829;
  await e.runHeadlessReview(PR(n));
  const d = decisao(e, n);
  assert.equal(chamadas(), 2);
  assert.deepEqual(envios, [], 'o texto original ainda cobra dívida e não pode ser publicado');
  assert.equal(d.analysisStatus, 'incomplete');
  assert.equal(d.technicalReview.escopoSessaoInconclusivo, true);
  assert.equal(d.esperaProva, undefined);
  assert.equal(await e.varrerEsperas(), 0);
  assert.match(textos(d).join(' '), /Reescreva o envelope/);
});
