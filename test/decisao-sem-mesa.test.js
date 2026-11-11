import { criteriaFixture } from './helpers/criteria-fixture.js';
// A decisão sem mesa (18/10/2026, v2.73.2). Regra do dono: "Se foi configurado pra aprovar
// sozinho ele aprova sozinho, se foi configurado pra reprovar sozinho ele reprova sozinho, sem
// depender da minha ação. Não quero desculpas pra entregar a decisão pra mim."
//
// Cada caso abaixo ia para "Precisa de você" até a v2.72.11 com a conta em automático:
//   - revisão mandada pelo dono por clique, admin, comando ou distribuição (`requested` falso);
//   - veredito aprovar com defeito do PR (violação técnica confirmada, achado técnico não
//     resolvido, a parte do card deste PR não entregue), com a conta reprovando sozinha;
//   - CI obrigatório vermelho no commit revisado, com a conta reprovando sozinha (esperava
//     para sempre);
//   - texto barrado pela trava de linguagem (reconstruído uma vez);
//   - resultado incompleto da sessão (análise incompleta, sem texto).
// O invariante 4 não afrouxa: APPROVE nunca sai com CI vermelho ou pendente, violação
// confirmada, commit não confirmado ou head que andou.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sem-mesa-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';
const check = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-10-18T12:00:00Z' });

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    if (gh.postFalha) return { ok: false, code: 1, stdout: '', stderr: gh.postFalha };
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) return { ok: true, code: 0, stdout: JSON.stringify(gh.reviewsAlheios), stderr: '' };
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: JSON.stringify(gh.meusReviews), stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: gh.head, baseRefName: 'main', statusCheckRollup: gh.rollup }) };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: gh.head, author: { login: 'dev' } }) };
  }
  if (sub.includes('--json mergeable')) return { ok: true, code: 0, stdout: JSON.stringify({ mergeable: gh.mergeable }), stderr: '' };
  if (sub.includes('rules/branches/main')) return { ok: true, code: 0, stdout: JSON.stringify(gh.exigidos), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.headDepois || gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool, technicalReport } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { technicalRuntime } = await import('../lib/technical-review/runtime.js');
const auto = (await import('../lib/engine/desfecho-automatico.js')).default;
const { publicReviewLanguageIssues } = await import('../lib/engine/public-review.js');
const { GAP_DA_PARTE_DO_CARD } = await import('../lib/technical-review/verdict.js');
const esperaProva = (await import('../lib/engine/espera-prova.js')).default;
const finishOriginal = technicalRuntime.finishTechnicalReview;

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  technicalRuntime.finishTechnicalReview = finishOriginal;
  gh = {
    head: HEAD, headDepois: '', exigidos: ['test', 'audit'], meusReviews: [], reviewsAlheios: [], postFalha: '', mergeable: '',
    rollup: [check('test', 'SUCCESS'), check('audit', 'SUCCESS')],
  };
});

// a conta em automático nas três classes, a não ser que o teste diga outra coisa
// `ciObrigatorio`: a chave "CI obrigatório antes da aprovação" (06/11/2026). Os casos daqui nasceram
// com ela ligada (comportamento de 17/10 a 06/11/2026), e o desligado tem casos próprios.
function motor({ checks = [], aprova = 'approve', reprova = 'request_changes', ciObrigatorio = true } = {}) {
  const e = new Engine();
  e.config.aguardarCiParaAprovar = ciObrigatorio;
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  // política da conta gravada por extenso e lida pelos métodos reais do motor (contas-config.js)
  e.config.accounts = [{ user: 'eu', owners: ['acme'], autoReview: true, onClean: aprova, onCaveats: aprova, onReject: reprova }];
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.toasts = [];
  e.eventos = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  for (const ev of ['needs-decision', 'auto-approved', 'auto-rejected', 'auto-commented']) {
    e.on(ev, (p) => e.eventos.push([ev, (p.item || p.result).key]));
  }
  e.bloqueadoPorChecks = async () => ({ faltando: checks });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: {
        approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' },
        request_changes: { event: 'REQUEST_CHANGES', body: 'Revise o tratamento de erro antes do merge.' },
        comment: { event: 'COMMENT', body: 'Leitura completa.' },
      },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = (n, marcas = { requested: true }) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', ...marcas });
const pendente = (e, n) => e.decisions.pending.find((x) => x.key === `acme/app#${n}`);
const resolvida = (e, n) => e.decisions.resolved.find((x) => x.key === `acme/app#${n}`);
const textos = (d) => (d.reasons || []).map((r) => r.text || r);
const semMesa = (e) => assert.equal(e.eventos.some(([t]) => t === 'needs-decision'), false, JSON.stringify(e.eventos));

for (const caso of ['ci', 'reenvio', 'commit novo']) {
  test(`silenciada depois da análise: conclusão persistida com ${caso}`, async () => {
    const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
    sessao(e);
    await e.runHeadlessReview(PR(130));
    assert.ok(pendente(e, 130).trabalhoIniciado);
    assert.equal(envios.length, 0);
    e.decisions = JSON.parse(JSON.stringify(e.decisions));
    e.config.accounts[0].muted = true;
    gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
    if (caso === 'commit novo') {
      gh.head = HEAD_NOVO;
      assert.equal(await e.varrerEsperas(), 0);
      assert.equal(envios.length, 0);
      return;
    }
    if (caso === 'reenvio') {
      gh.postFalha = 'HTTP 502: Bad Gateway';
      await e.varrerEsperas();
      assert.ok(pendente(e, 130).postRetry);
      gh.postFalha = '';
      envios = [];
      assert.equal(await e.retryFailedPosts(), 1);
    } else assert.equal(await e.varrerEsperas(), 1);
    assert.deepEqual(envios.map(p => p.event), ['APPROVE']);
    assert.equal(envios[0].commit_id, HEAD);
    assert.equal(resolvida(e, 130).status, 'auto_approved');
    assert.equal(e.config.accounts[0].muted, true);
  });
}

async function revisar(e, n, { marcas, extra } = {}) {
  sessao(e, extra);
  await e.runHeadlessReview(PR(n, marcas));
}

const violacao = (achados = [{ file: 'src/a.ts', line: 12, message: 'regra de negócio duplicada no controller' }]) => async (ctx) => ({
  ...technicalReport(ctx.head, ctx.repo), verdict: 'fail',
  rules: [{ rule: 'core.duplication.business-rule', verdict: 'fail', causa: 'a regra de desconto foi copiada em dois lugares' }],
  findings: achados,
});

test('veredito incoerente por falha interna não publica pedido de mudanças nem após esgotar tentativas', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = async ctx => ({ ...technicalReport(ctx.head, ctx.repo), verdict: 'not-run', failure: 'material' });
  sessao(e, {
    verdict: 'request_changes', decision: 'needs_decision',
    reasons: ['Sem defeito bloqueante; a ferramenta de verificação não terminou.'],
    findings: [{ severity: 'suggestion', title: 'Ajuste opcional', summary: 'Pode melhorar a mensagem.', file: 'src/a.ts', line: 1 }],
    reviewMarkdown: 'Não encontrei nada bloqueante no código. Deixo ajustes opcionais.',
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Não encontrei nada bloqueante no código. Deixo ajustes opcionais.', comments: [] } },
  });
  await e.runHeadlessReview(PR(150));
  assert.deepEqual(envios, [], 'falha interna não é defeito do PR');
  const primeira = pendente(e, 150);
  assert.ok(primeira.esperaProva, 'a análise inconsistente é recuperada pelo agendador existente');
  primeira.esperaProva.tentativas = esperaProva.MAX_TENTATIVAS;
  await e.runHeadlessReview(PR(150));
  assert.deepEqual(envios, [], 'esgotar tentativas não autoriza publicar a contradição nem aprovar');
  assert.ok(pendente(e, 150).approvalEvidence.some(g => /coer|incompat|contrad/.test(g)));
});

test('texto incoerente com defeito real é recuperado sem apagar o defeito', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = violacao();
  sessao(e, { findings: [], payloads: {
    approve: { event: 'APPROVE', body: 'Nenhum bloqueio.' },
    request_changes: { event: 'REQUEST_CHANGES', body: 'Não encontrei nada bloqueante no código.' },
  } });
  await e.runHeadlessReview(PR(151));
  assert.deepEqual(envios, []);
  const d = pendente(e, 151);
  assert.ok(d.esperaProva, 'a presença de defeito não transforma incoerência em espera manual');
  assert.ok(d.approvalEvidence.includes('violação técnica confirmada'));
  assert.ok(d.approvalEvidence.some(g => /incompat/.test(g)));
  await revisar(e, 151, { extra: { verdict: 'request_changes', findings: [
    { ...criteriaFixture('request_changes').findings[0], severity: 'blocking', title: 'Regra duplicada', summary: 'Unifique a regra antes do merge.', file: 'src/a.ts', line: 12 },
  ] } });
  assert.deepEqual(envios.map(p => p.event), ['REQUEST_CHANGES'], 'a revisão coerente continua reprovando o defeito real');
});

test('modo enforce recupera texto contraditório mesmo com blocker persistente', async () => {
  const e = motor();
  e.config.reviewRoundsMode = 'enforce';
  technicalRuntime.finishTechnicalReview = violacao();
  const blocker = { ...criteriaFixture('request_changes').findings[0], severity: 'blocking', title: 'Regra duplicada', summary: 'Unifique a regra.', file: 'src/a.ts', line: 12 };
  await revisar(e, 152, { extra: { verdict: 'request_changes', findings: [blocker], payloads: {
    request_changes: { event: 'REQUEST_CHANGES', body: 'Não encontrei nada bloqueante no código.' },
  } } });
  assert.deepEqual(envios, []);
  const d = pendente(e, 152);
  assert.ok(d.esperaProva, 'a comparação ativa não desvia a incoerência para decisão manual');
  assert.equal(d.roundReview.unresolvedCount, 1);
  assert.ok(d.approvalEvidence.includes('violação técnica confirmada'));
  await revisar(e, 152, { extra: { verdict: 'request_changes', findings: [{ ...blocker, ref: `${d.roundId}:f1`, status: 'persiste' }] } });
  assert.deepEqual(envios.map(p => p.event), ['REQUEST_CHANGES']);
});

// ---------------------------------------------------------------- origem

for (const [origem, marcas] of [
  ['clique no Panorama', { requested: false, manual: true }],
  ['URL colada', { manual: true }],
  ['Revisar agora do aparelho admin', { viaAdmin: true }],
  ['comando remoto', { viaComando: true }],
  ['distribuição entre aparelhos', { viaComando: true, viaDistribuicao: true }],
]) {
  test(`revisão mandada pelo dono (${origem}) aprova sozinha pela política, sem mesa`, async () => {
    const e = motor();
    await revisar(e, 1, { marcas });
    assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
    assert.equal(envios[0].commit_id, HEAD);
    assert.equal(resolvida(e, 1).status, 'auto_approved');
    assert.equal(resolvida(e, 1).pr.origemDono, true, 'a pendência guarda a origem para quem relança');
    semMesa(e);
  });
}

test('origem desconhecida (nenhuma marca): nada é postado, e o card diz por quê', async () => {
  const e = motor();
  await revisar(e, 2, { marcas: {} });
  assert.deepEqual(envios, []);
  assert.match(textos(pendente(e, 2))[0], /origem desconhecida/);
});

test('o clique do dono com a conta esperando você: a mesa é a escolha da conta', async () => {
  const e = motor({ aprova: 'wait' });
  await revisar(e, 3, { marcas: { manual: true } });
  assert.deepEqual(envios, []);
  assert.ok(pendente(e, 3));
  assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#3']]);
});

// ---------------------------------------------------------------- defeito do PR

test('veredito aprovar com violação técnica confirmada e a conta reprovando sozinha: REQUEST_CHANGES na hora, nunca APPROVE', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = violacao();
  await revisar(e, 10);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  const corpo = envios[0].body;
  assert.match(corpo, /^Antes do merge, isto precisa ser resolvido:/);
  assert.match(corpo, /violação confirmada de um padrão técnico/);
  // nome de regra, causa e achado vêm do catálogo privado da avaliação técnica: nunca no texto público (PR #253)
  assert.doesNotMatch(corpo, /core\.duplication|regra de desconto|src\/a\.ts/);
  assert.match(corpo, /Revise o tratamento de erro antes do merge\./, 'o pedido que a sessão escreveu vem junto');
  assert.equal(envios[0].commit_id, HEAD);
  assert.deepEqual(publicReviewLanguageIssues(envios[0], 'eu'), [], 'passa pela trava de linguagem');
  const d = resolvida(e, 10);
  assert.equal(d.status, 'auto_rejected');
  assert.equal(d.action, 'request_changes');
  assert.ok(textos(d).includes('violação técnica confirmada'), textos(d).join(' | '));
  assert.equal(pendente(e, 10), undefined);
  assert.deepEqual(e.eventos, [['auto-rejected', 'acme/app#10']]);
});

test('achado técnico não resolvido sem regra reprovada também é defeito do PR', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = async (ctx) => ({ ...technicalReport(ctx.head, ctx.repo), findings: [{ arquivo: 'b.ts', mensagem: 'erro engolido no catch' }] });
  await revisar(e, 11);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.match(envios[0].body, /achados técnicos que ainda não foram resolvidos/);
  assert.doesNotMatch(envios[0].body, /erro engolido/, 'o achado da ferramenta não vai ao texto público');
});

test('a parte do card deste PR dita não entregue: REQUEST_CHANGES com a conta reprovando sozinha', async () => {
  const e = motor();
  await revisar(e, 12, { extra: { card: 'CARD-1', cardMet: false, cardParteDestePr: false } });
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.match(envios[0].body, /a parte do card que cabe a este PR ainda não foi entregue/);
  assert.ok(textos(resolvida(e, 12)).includes(GAP_DA_PARTE_DO_CARD));
  semMesa(e);
});

test('defeito com a conta que não reprova sozinha: nada é postado (a mesa é a escolha da conta)', async () => {
  const e = motor({ reprova: 'wait' });
  technicalRuntime.finishTechnicalReview = violacao();
  await revisar(e, 13);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#13']]);
});

test('defeito com o head que andou durante a sessão: nada é postado, o round seguinte revisa o commit novo', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = violacao();
  gh.headDepois = HEAD_NOVO;
  sessao(e);
  // o head lido no começo é o HEAD; a releitura antes de postar devolve o novo
  let leituras = 0;
  e.headSha = async () => (leituras++ === 0 ? HEAD : HEAD_NOVO);
  await e.runHeadlessReview(PR(14));
  assert.deepEqual(envios, []);
  assert.equal(pendente(e, 14).blockedKind, 'stale_head');
});

test('pedido de mudanças pelo defeito que já está no GitHub neste head: não duplica', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = violacao();
  gh.meusReviews = [{ state: 'CHANGES_REQUESTED', submitted_at: '2026-10-18T12:00:00Z', commit_id: HEAD }];
  await revisar(e, 15);
  assert.deepEqual(envios, []);
  assert.equal(resolvida(e, 15).status, 'already_reviewed');
});

test('falha passageira ao postar o pedido por defeito: o reenvio de sempre posta o MESMO texto depois', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = violacao();
  gh.postFalha = 'HTTP 502: Bad Gateway';
  await revisar(e, 16);
  const d = pendente(e, 16);
  assert.deepEqual(d.postRetry, { event: 'request_changes', attempts: 0 });
  assert.equal(d.esperaProva, undefined, 'falha passageira é do reenvio, não da busca da prova');
  const primeiro = envios[envios.length - 1].body;
  gh.postFalha = '';
  envios = [];
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.equal(envios[0].body, primeiro);
  assert.equal(resolvida(e, 16).status, 'auto_rejected');
});

// ---------------------------------------------------------------- CI vermelho

test('modelo reprova por CI obrigatório confirmado sem inventar finding de código', async () => {
  const e = motor();
  e.bloqueadoPorChecks = async () => ({ verifiedHead: HEAD, faltando: [{ nome: 'audit', estado: 'vermelho' }] });
  const body = `Não encontrei nada bloqueante no código. Os checks obrigatórios estão falhando no commit ${HEAD.slice(0, 7)}.`;
  await revisar(e, 153, { extra: { verdict: 'request_changes', findings: [], payloads: { request_changes: { event: 'REQUEST_CHANGES', body } } } });
  assert.deepEqual(envios.map(p => p.event), ['REQUEST_CHANGES']);
  assert.equal(envios[0].body, body);
  assert.equal(envios[0].commit_id, HEAD);
  assert.equal(resolvida(e, 153).status, 'auto_rejected');
  assert.equal(pendente(e, 153), undefined, 'não fica recuperando uma reprovação coerente');
});

test('CI obrigatório vermelho encerra o head com REQUEST_CHANGES, sem outra review quando ficar verde', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }] });
  await revisar(e, 20);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES'], 'nunca APPROVE com CI vermelho');
  assert.match(envios[0].body, /`audit` estão falhando no commit 706cc81/);
  assert.equal(envios[0].commit_id, HEAD);
  assert.deepEqual(publicReviewLanguageIssues(envios[0], 'eu'), []);
  assert.equal(pendente(e, 20), undefined);
  assert.equal(resolvida(e, 20).status, 'auto_rejected');
  assert.equal(resolvida(e, 20).verdict, 'request_changes');
  semMesa(e);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  for (let ciclo = 0; ciclo < 3; ciclo++) assert.equal(await e.varrerEsperas(), 0);
  assert.equal(envios.length, 1, 'não repete o pedido de mudanças a cada ciclo');
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.equal(resolvida(e, 20).status, 'auto_rejected');
  semMesa(e);
});

test('CI que fica vermelho durante a espera publica uma reprovação e encerra a pendência', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 21);
  assert.deepEqual(envios, []);
  gh.rollup = [check('test', 'FAILURE'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.match(envios[0].body, /`test` estão falhando/);
  assert.equal(pendente(e, 21), undefined);
  assert.equal(resolvida(e, 21).status, 'auto_rejected');
  assert.equal(await e.varrerEsperas(), 0);
  assert.equal(envios.length, 1);
  semMesa(e);
});

test('o pedido de mudanças pelo CI que falhou ao postar: a espera continua e o ciclo tenta de novo', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }] });
  gh.postFalha = 'HTTP 502: Bad Gateway';
  await revisar(e, 24);
  const d = pendente(e, 24);
  assert.ok(d.esperaCi, 'segue esperando o CI');
  assert.equal(d.esperaCi.rcHead, undefined, 'o pedido não saiu');
  assert.equal(d.postRetry, null, 'não é o reenvio de uma aprovação: quem tenta de novo é a espera');
  semMesa(e);
  gh.postFalha = '';
  envios = [];
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.equal(pendente(e, 24), undefined);
  assert.equal(resolvida(e, 24).status, 'auto_rejected');
});

test('CI vermelho com a conta que não reprova sozinha: só espera, como antes', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }], reprova: 'wait' });
  await revisar(e, 22);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  await e.varrerEsperas();
  assert.deepEqual(envios, []);
  assert.ok(pendente(e, 22).esperaCi);
  semMesa(e);
});

test('CI apenas rodando nunca vira pedido de mudanças', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 23);
  gh.rollup = [check('test', '', 'IN_PROGRESS'), check('audit', 'SUCCESS')];
  for (let ciclo = 0; ciclo < 2; ciclo++) await e.varrerEsperas();
  assert.deepEqual(envios, []);
});

// ---------------------------------------------------------------- trava de linguagem

test('texto barrado pela trava de linguagem: reconstruído UMA vez sem o parágrafo barrado, e a aprovação sai', async () => {
  const e = motor();
  await revisar(e, 30, { extra: { payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.\n\nEsta revisão foi gerada pelo Farol.' } } } });
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE'], 'o texto barrado nunca chega ao gh');
  assert.equal(envios[0].body, 'Leitura completa, sem bloqueios.');
  assert.equal(resolvida(e, 30).status, 'auto_approved');
});

test('texto todo barrado: nada sai, e o card diz que foi a postagem (infra)', async () => {
  const e = motor();
  await revisar(e, 31, { extra: { payloads: { approve: { event: 'APPROVE', body: 'Esta revisão foi gerada pelo Farol.' } } } });
  assert.deepEqual(envios, []);
  const d = pendente(e, 31);
  assert.ok((d.reasons || []).some((r) => r.kind === 'infra' && /falha ao postar o APPROVE/.test(r.text)), textos(d).join(' | '));
});

// ---------------------------------------------------------------- resultado incompleto

// Resultado incompleto entra na recuperação durável do PR #253 (recuperacao-prova.js), quando a
// origem é do dono; a política da conta é aplicada depois que a análise fecha.
test('análise incompleta com a revisão mandada pelo dono: recuperação automática no mesmo commit, sem mesa', async () => {
  const e = motor();
  await revisar(e, 40, { marcas: { manual: true }, extra: { analysisStatus: 'incomplete', verdict: 'request_changes', payloads: { approve: { event: 'APPROVE', body: '' } } } });
  const d = pendente(e, 40);
  assert.ok(d.esperaProva, 'recuperação armada também para o clique do dono');
  assert.ok(d.esperaProva.lacunas.includes('análise incompleta'), d.esperaProva.lacunas.join(' | '));
  assert.match(textos(d)[0], /análise técnica pendente/);
  assert.deepEqual(envios, []);
  semMesa(e);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'relança no mesmo head');
  assert.equal(pendente(e, 40).blockedKind, 'stale_head');
  assert.equal(pendente(e, 40).blockedHead, HEAD);
});

test('aprovação em branco (sem texto) também é resultado incompleto: segue na recuperação depois das duas tentativas, com recuo', async () => {
  const e = motor();
  const branco = { payloads: { approve: { event: 'APPROVE', body: ' ' } } };
  await revisar(e, 41, { extra: branco });
  assert.ok(pendente(e, 41).esperaProva);
  pendente(e, 41).esperaProva.tentativas = esperaProva.MAX_TENTATIVAS;
  await revisar(e, 41, { extra: branco });
  const d = pendente(e, 41);
  assert.ok(d.esperaProva, 'resultado incompleto não vira ressalva: a recuperação continua');
  assert.ok(d.esperaProva.proximaEm > Date.now(), 'com recuo depois das duas tentativas rápidas');
  semMesa(e);
});

// biblioteca-cnbb-api#143 (30/10/2026): violação confirmada e uma regra inconclusiva. Defeito
// não arma recuperação e incompleto não reprovava: o PR parava na mesa com a conta reprovando sozinha.
test('análise incompleta com violação confirmada: a conta reprova sozinha, sem mesa', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = violacao();
  await revisar(e, 44, { extra: { analysisStatus: 'incomplete', verdict: 'request_changes', decision: 'needs_decision' } });
  assert.deepEqual(envios.map(p => p.event), ['REQUEST_CHANGES'], 'o defeito confirmado basta para pedir mudanças');
  assert.equal(envios[0].commit_id, HEAD);
  semMesa(e);
});

// Revisão do PR #326: incompleta para em analise_incompleta antes da checagem de coerência do
// approve, então o caminho do defeito confere a coerência direto. No fluxo completo a recuperação
// desvia antes do desfecho; aqui é a porta do desfecho (o que o concluirRevisao consulta).
test('caminho do defeito recusa resultado incompleto incoerente, mesmo com motivo analise_incompleta', async () => {
  const { caminhoNovo } = await import('../lib/engine/desfecho-da-revisao.js');
  // a política de reprovar vem da conta gravada, pela função real do motor (acaoAoReprovar)
  const { acaoAoReprovar } = await import('../lib/engine/contas-config.js');
  const motorMinimo = { config: {}, accountForPr: () => 'eu', accountList: () => [{ user: 'eu', onReject: 'request_changes' }] };
  motorMinimo.rejectPolicyFor = (user) => acaoAoReprovar(motorMinimo, user);
  const base = { verdict: 'approve', analysisStatus: 'incomplete', headSha: HEAD, approvalEvidence: ['violação técnica confirmada'],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Antes do merge, revise a duplicação da regra.' } } };
  const autoDec = { ok: false, motivo: 'analise_incompleta' };
  assert.equal(caminhoNovo(motorMinimo, PR(46, { manual: true }), { ...base, criteriaEvidence: { ok: false } }, autoDec, false), null,
    'evidência incoerente vai para a recuperação, não para o pedido de mudanças');
  assert.equal(caminhoNovo(motorMinimo, PR(47, { manual: true }), base, autoDec, false)?.tipo, 'defeito',
    'coerente, o defeito confirmado segue reprovando');
});

test('análise incompleta sem defeito confirmado continua sem reprovar sozinha', async () => {
  const e = motor();
  await revisar(e, 45, { marcas: { manual: true }, extra: { analysisStatus: 'incomplete', verdict: 'request_changes' } });
  assert.deepEqual(envios, [], 'sem defeito, o pedido de mudanças de uma análise incompleta não sai');
});

test('origem desconhecida com resultado incompleto não ganha recuperação com publicação', async () => {
  const e = motor();
  await revisar(e, 42, { marcas: {}, extra: { analysisStatus: 'incomplete' } });
  assert.equal(pendente(e, 42).esperaProva, undefined);
});

// Decisão do dono de 06/11/2026 (decidir na 1ª rodada): a lacuna que não é dura vira ressalva já
// na rodada que a encontrou e a política decide; nem a rodada complementar nem o recuo continuam.
test('lacuna que não é dura na primeira rodada: vira ressalva e aprova pela política, sem recuo', async () => {
  const e = motor();
  const semProtocolo = { protocolo: { prReviewer: 'pulado' } };
  await revisar(e, 43, { extra: semProtocolo });
  assert.equal(pendente(e, 43), undefined, 'sem espera da prova');
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(resolvida(e, 43).status, 'auto_approved');
  assert.ok((resolvida(e, 43).attention || []).some((r) => /faltou prova nesta revisão, então segue como ressalva/.test(r.text || r)));
  assert.equal(await esperaProva.varrerEsperas(e), 0);
});

// ---------------------------------------------------------------- reenvio do comentário de PR próprio

test('reenvio do comentário de PR próprio: posta COMMENT e resolve como commented_own_pr', async () => {
  const e = motor();
  e.decisions.pending.push({
    id: 'd1', key: 'acme/app#50', pr: { ...PR(50), author: 'eu' }, headSha: HEAD, verdict: 'approve', reasons: [],
    payloads: { comment: { event: 'COMMENT', body: 'Leitura completa.', comments: [] } },
    postRetry: { event: 'comment', attempts: 0 }, status: 'pending',
  });
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(resolvida(e, 50).status, 'commented_own_pr');
  assert.deepEqual(e.eventos, [['auto-commented', 'acme/app#50']]);
});

// ---------------------------------------------------------------- as peças puras

test('origemDoDono: só o booleano verdadeiro de uma das marcas conta', () => {
  assert.equal(auto.origemDoDono({ requested: true }), true);
  assert.equal(auto.origemDoDono({ manual: true }), true);
  assert.equal(auto.origemDoDono({ origemDono: true }), true);
  assert.equal(auto.origemDoDono({ requested: false }), false);
  assert.equal(auto.origemDoDono({ manual: 'true' }), false);
  assert.equal(auto.origemDoDono(null), false);
});

test('defeitosDoPr: só violação, achado e a parte do card; prova incompleta não é defeito', () => {
  assert.deepEqual(auto.defeitosDoPr({ approvalEvidence: ['protocolo de revisão não comprovado', 'violação técnica confirmada', 'ci_vermelho'] }), ['violação técnica confirmada']);
  assert.deepEqual(auto.defeitosDoPr({ approvalEvidence: ['avaliação técnica inconclusiva', 'declaração técnica do repositório ausente'] }), []);
  assert.deepEqual(auto.defeitosDoPr({ approvalEvidence: [GAP_DA_PARTE_DO_CARD, 'achados técnicos não resolvidos'] }), [GAP_DA_PARTE_DO_CARD, 'achados técnicos não resolvidos']);
  assert.deepEqual(auto.defeitosDoPr({}), []);
});

test('os textos que o Farol monta passam pela trava de linguagem, sem travessão', () => {
  const rc = auto.payloadDoDefeito({ technicalReview: { rules: [{ rule: 'privada', verdict: 'fail', causa: 'x duplicado' }], findings: [{ file: 'a.ts', message: 'y' }] } }, ['violação técnica confirmada']);
  assert.doesNotMatch(rc.body, /privada|x duplicado|a\.ts/, 'nada do catálogo privado no texto público');
  const ci = auto.payloadDoCiVermelho([{ nome: 'audit' }, { nome: 'lint' }], HEAD);
  for (const p of [rc, ci]) {
    assert.deepEqual(publicReviewLanguageIssues(p, 'eu'), [], p.body);
    assert.doesNotMatch(p.body, /—/);
    assert.equal(p.event, 'REQUEST_CHANGES');
  }
  assert.match(ci.body, /`audit`, `lint` estão falhando no commit 706cc81/);
});

// engine-ai#1031 (11/11/2026): o pedido de mudanças dizia "há violação confirmada" sem dizer onde, e o
// autor corrigiu três coisas que não eram a causa. O lugar é do próprio PR; regra e causa seguem privadas.
test('a violação diz onde está o achado que bloqueia, sem regra, causa nem dívida descontada', () => {
  const technicalReview = {
    rules: [{ rule: 'core.suppression.declared', verdict: 'fail', causa: 'supressor proibido' }],
    findings: [
      { rule: 'core.suppression.declared', file: 'apps/x/turno.controller.ts', message: 'supressor "eslint-disable-next-line" na linha 643 e proibido; remova a supressao e corrija a causa' },
      { rule: 'core.suppression.declared', file: 'common/antigo.ts', message: 'supressor "eslint-disable-next-line" na linha 305 e proibido', foraDasLinhas: true },
      { rule: 'core.suppression.declared', file: 'sem-linha.ts', message: 'arquivo avaliado como violação' },
    ],
  };
  const rc = auto.payloadDoDefeito({ technicalReview }, ['violação técnica confirmada']);
  assert.match(rc.body, /`apps\/x\/turno\.controller\.ts:643`/);
  assert.doesNotMatch(rc.body, /antigo\.ts|sem-linha|core\.suppression|supressor|remova/);
  assert.deepEqual(publicReviewLanguageIssues(rc, 'eu'), [], rc.body);
  const muitos = { rules: technicalReview.rules, findings: Array.from({ length: 8 }, (_, i) => ({ rule: 'r', file: `f${i}.ts`, message: `x na linha ${i + 1}` })) };
  const corpo = auto.payloadDoDefeito({ technicalReview: muitos }, ['violação técnica confirmada']).body;
  assert.match(corpo, /`f4\.ts:5`/);
  assert.doesNotMatch(corpo, /f5\.ts/);
  assert.match(corpo, /e mais 3/);
});

test('reconstruirPayload: tira só o barrado; sem texto sobrando ou sem mudança, devolve null', () => {
  const p = { event: 'APPROVE', body: 'Ok.\n\nEsta revisão foi gerada pelo Farol.', comments: [{ path: 'a', line: 1, side: 'RIGHT', body: 'Revisado pelo Farol.' }, { path: 'b', line: 2, side: 'RIGHT', body: 'Bom nome.' }] };
  const r = auto.reconstruirPayload(p, 'eu');
  assert.equal(r.body, 'Ok.');
  assert.deepEqual(r.comments.map((c) => c.path), ['b']);
  assert.equal(auto.reconstruirPayload({ event: 'APPROVE', body: 'Ok.' }, 'eu'), null, 'nada barrado, nada a reconstruir');
  assert.equal(auto.reconstruirPayload({ event: 'APPROVE', body: 'Esta revisão foi gerada pelo Farol.' }, 'eu'), null);
});

test('payloadDoPrProprio prefere o comentário que a revisão escreveu', () => {
  const r = { verdict: 'approve', payloads: { approve: { event: 'APPROVE', body: 'a' }, comment: { event: 'COMMENT', body: 'c' } } };
  assert.deepEqual(auto.payloadDoPrProprio(r), { event: 'COMMENT', body: 'c', comments: [] });
  assert.deepEqual(auto.payloadDoPrProprio({ verdict: 'approve', payloads: { approve: { event: 'APPROVE', body: 'a' } } }).body, 'a');
  assert.equal(auto.payloadDoPrProprio({ verdict: 'approve', payloads: {} }), null);
});

// ---------------------------------------------------------------- revisão do Codex sobre 8c1a1e2

test('espera legada com pedido de mudanças já publicado é encerrada sem segunda review', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 60);
  pendente(e, 60).esperaCi.rcHead = HEAD;
  gh.meusReviews = [{ state: 'CHANGES_REQUESTED', submitted_at: new Date(Date.now() + 1000).toISOString(), commit_id: HEAD }];
  await e.reconcilePending();
  assert.equal(pendente(e, 60), undefined);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios, []);
});

test('Codex 1: uma aprovação minha neste commit continua resolvendo a espera do CI', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 61);
  gh.meusReviews = [{ state: 'APPROVED', submitted_at: new Date(Date.now() + 1000).toISOString(), commit_id: HEAD }];
  await e.reconcilePending();
  assert.equal(pendente(e, 61), undefined);
});

test('Codex 2: comentário anterior e alheio da conta no mesmo commit não cala o comentário do PR próprio', async () => {
  const e = motor();
  gh.meusReviews = [{ state: 'COMMENTED', submitted_at: '2026-10-18T10:00:00Z', commit_id: HEAD, body: 'vou olhar depois' }];
  sessao(e);
  await e.runHeadlessReview({ ...PR(62), author: 'eu' });
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(resolvida(e, 62).status, 'commented_own_pr');
});

test('Codex 2: o MESMO comentário já publicado neste commit não é repetido', async () => {
  const e = motor();
  gh.meusReviews = [{ state: 'COMMENTED', submitted_at: '2026-10-18T10:00:00Z', commit_id: HEAD, body: 'Leitura completa.' }];
  sessao(e);
  await e.runHeadlessReview({ ...PR(63), author: 'eu' });
  assert.deepEqual(envios, []);
  assert.equal(resolvida(e, 63).status, 'already_reviewed');
});

test('Codex 7: o texto reconstruído na espera do CI é o que fica para o reenvio', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 64, { extra: { payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.\n\nEsta revisão foi gerada pelo Farol.' } } } });
  gh.postFalha = 'HTTP 502: Bad Gateway';
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  await e.varrerEsperas();
  const d = pendente(e, 64);
  assert.deepEqual(d.postRetry, { event: 'approve', attempts: 0, atencaoAoPublicar: [] }, 'o reenvio leva os pontos do card que publicar (aqui, nenhum)');
  assert.equal(d.payloads.approve.body, 'Leitura completa, sem bloqueios.', 'o reenvio manda o texto que passou na trava');
  gh.postFalha = '';
  envios = [];
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.body), ['Leitura completa, sem bloqueios.']);
});

test('Codex 8: o comentário automático chega à tela (SSE) e à notificação nativa', () => {
  const http = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
  const main = fs.readFileSync(path.join(import.meta.dirname, '..', 'main.js'), 'utf8');
  const app = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
  // desde 28/10/2026 os eventos que viram notificação passam por comAviso, que repassa o
  // evento cru à tela e acrescenta o aviso-nativo das cascas (test/casca-sse.test.js)
  assert.match(http, /\[[^\]\n]*'auto-commented'[^\]\n]*\]\.forEach\(comAviso\)/);
  assert.match(http, /function comAviso\(evento\) \{\n\s*engine\.on\(evento, p => \{\n\s*broadcast\(evento, p\);/);
  assert.match(main, /engine\.on\('auto-commented'/);
  assert.match(app, /addEventListener\('auto-commented'/);
});

// ---------------------------------------------------------------- causa do bloqueio (05/11/2026)

// Medido em 05/11/2026 em três PRs reais: o REQUEST_CHANGES automático se apoiava em conflito com a
// base e CI que não rodou (tenant-company#293), em seletores de e2e de arquivos fora do diff
// (biud-frontend#1784) e num critério do card (engine-ai#880). Estado do PR não é defeito do código:
// todo bloqueio declara a causa, e só `defeito_codigo` e `card` reprovam sozinhos.
const bloqueio = (causa, extra = {}) => {
  const f = criteriaFixture('request_changes').findings[0];
  return { ...f, causa, title: `Bloqueio ${causa}`, criteria: { ...f.criteria, key: `bloqueio-${causa}` }, ...extra };
};
const reprovando = (causas) => ({ verdict: 'request_changes', decision: 'needs_decision', findings: causas.map((c) => bloqueio(c)) });

test('shouldAutoReject recusa quando os bloqueios são só de estado', async () => {
  const { shouldAutoReject } = await import('../lib/engine/approval-policy.js');
  const e = motor();
  const base = { analysisStatus: 'complete', headSha: HEAD, payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Revise o tratamento de erro antes do merge.' } } };
  for (const causas of [['conflito'], ['ci'], ['dependencia'], ['fora_do_diff'], ['ci', 'conflito']]) {
    assert.equal(shouldAutoReject(e, PR(70), { ...base, ...reprovando(causas) }), false, causas.join('+'));
    assert.equal(auto.bloqueiosSoDeEstado(reprovando(causas)), true);
  }
  assert.equal(auto.bloqueiosSoDeEstado({ findings: [] }), false, 'sem bloqueio não há o que restringir');
  assert.equal(auto.bloqueiosSoDeEstado({}), false, 'envelope legado segue a regra de antes');
  assert.equal(auto.causaDaEspera(reprovando(['conflito', 'ci'])), 'ci');
  assert.equal(auto.causaDaEspera(reprovando(['conflito', 'dependencia'])), 'conflito');
  assert.equal(auto.causaDaEspera(reprovando(['fora_do_diff'])), 'mesa');
});

test('shouldAutoReject segue aceitando defeito_codigo e card', async () => {
  for (const [n, causas] of [[71, ['defeito_codigo']], [72, ['card']], [73, ['ci', 'defeito_codigo']]]) {
    const e = motor();
    await revisar(e, n, { extra: reprovando(causas) });
    assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES'], causas.join('+'));
    assert.equal(resolvida(e, n).status, 'auto_rejected');
    envios = [];
  }
});

test('violação técnica confirmada continua reprovando sem olhar causa', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = violacao();
  await revisar(e, 74, { extra: reprovando(['fora_do_diff']) });
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES'], 'o que a avaliação técnica provou reprova');
  assert.equal(resolvida(e, 74).status, 'auto_rejected');
});

// a marca do conflito precisa do updatedAt do PR para caducar (espera-conflito.js)
const COM_DATA = { requested: true, updatedAt: '2026-11-05T10:00:00Z' };

test('bloqueio só de conflito vai à espera do conflito, sem postar', async () => {
  const e = motor();
  await revisar(e, 75, { marcas: COM_DATA, extra: reprovando(['conflito']) });
  assert.deepEqual(envios, [], 'nada vai ao PR, nem APPROVE nem REQUEST_CHANGES');
  const d = pendente(e, 75);
  assert.equal(d.blockedKind, 'conflito');
  assert.match(textos(d)[0], /não em defeito do código/);
  assert.equal(e.esperaConflito['acme/app#75'].head, HEAD);
  semMesa(e);
});

// O conflito declarado pelo modelo é conferido no GitHub antes de virar espera (onda final,
// 05/11/2026): o modelo pode ter lido um conflito que não existe, e a espera do conflito só
// acaba com commit novo.
// 08/11/2026 (ordem do dono, estado-desmentido.js): o conflito que o GitHub desmente não sustenta o
// pedido; sem defeito do código, a aprovação sai pela política da conta, com ressalva.
test('conflito declarado com o GitHub dizendo MERGEABLE aprova pela política, sem marca de conflito', async () => {
  gh.mergeable = 'MERGEABLE';
  const e = motor();
  await revisar(e, 84, { extra: reprovando(['conflito']) });
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(envios[0].body, 'Leitura completa, sem bloqueios.', 'o texto de aprovação que a revisão escreveu é o que sai');
  assert.equal(pendente(e, 84), undefined);
  assert.equal((e.esperaConflito || {})['acme/app#84'], undefined);
  semMesa(e);
});

for (const mergeable of ['CONFLICTING', 'UNKNOWN']) {
  test(`conflito declarado com o GitHub dizendo ${mergeable} segue na espera do conflito`, async () => {
    gh.mergeable = mergeable;
    const e = motor();
    await revisar(e, 85, { marcas: COM_DATA, extra: reprovando(['conflito']) });
    assert.deepEqual(envios, []);
    assert.equal(pendente(e, 85).blockedKind, 'conflito');
    assert.equal(e.esperaConflito['acme/app#85'].head, HEAD);
    semMesa(e);
  });
}

test('bloqueio só de ci arma a espera do CI e nunca aprova o que a revisão reprovou', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 76, { extra: reprovando(['ci']) });
  assert.deepEqual(envios, []);
  const d = pendente(e, 76);
  assert.ok(d.esperaCi, 'a espera do CI de sempre');
  assert.match(textos(d)[0], /não em defeito do código/);
  // o card não promete a aprovação que nunca sai, nem quando a varredura troca a linha da espera
  const semPromessa = (x) => {
    assert.ok(textos(x).includes('espero o CI obrigatório neste commit; com ele verde, a decisão volta para você'), textos(x).join(' | '));
    assert.doesNotMatch(textos(x).join(' | '), /a aprovação está esperando o CI|sai sozinha/);
  };
  semPromessa(d);
  semMesa(e);
  gh.rollup = [check('test', '', 'IN_PROGRESS'), check('audit', '', 'IN_PROGRESS')];
  assert.equal(await e.varrerEsperas(), 0);
  semPromessa(pendente(e, 76));
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios, [], 'CI verde não transforma o pedido de mudanças em APPROVE');
  assert.ok(pendente(e, 76), 'a decisão volta para você');
  assert.equal(pendente(e, 76).esperaCi, null);
});

for (const [lado, opcoes, marcas] of [
  ['conta que espera você', { reprova: 'wait' }, { requested: true }],
  ['origem desconhecida', {}, {}],
]) {
  test(`bloqueio só de ci com ${lado}: mesa, sem armar a espera do CI`, async () => {
    const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }], ...opcoes });
    await revisar(e, 82, { marcas, extra: reprovando(['ci']) });
    assert.deepEqual(envios, []);
    const d = pendente(e, 82);
    assert.equal(d.esperaCi, undefined, 'a espera do CI é da conta que reprova sozinha');
    assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#82']]);
  });
}

test('ci e conflito com o CI já verde: a espera do conflito segura antes da mesa', async () => {
  const e = motor();
  await revisar(e, 83, { extra: reprovando(['ci', 'conflito']) });
  assert.deepEqual(envios, []);
  const d = pendente(e, 83);
  assert.equal(d.esperaCi, undefined);
  assert.equal(d.blockedKind, 'conflito');
  semMesa(e);
});

test('bloqueio só de ci com o CI vermelho: o pedido pelo CI segue a regra de 18/10/2026', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }] });
  await revisar(e, 77, { extra: reprovando(['ci']) });
  assert.deepEqual(envios, [], 'o texto da revisão não sai sozinho');
  assert.ok(pendente(e, 77).esperaCi);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.match(envios[0].body, /`audit` estão falhando/);
});

for (const causa of ['dependencia', 'fora_do_diff']) {
  test(`bloqueio só de ${causa} vai à mesa com o motivo dito`, async () => {
    const e = motor();
    await revisar(e, 78, { extra: reprovando([causa]) });
    assert.deepEqual(envios, []);
    const d = pendente(e, 78);
    assert.equal(d.esperaCi, undefined);
    assert.equal(d.blockedKind, undefined);
    assert.match(textos(d)[0], /não em defeito do código/);
    assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#78']]);
  });
}

test('bloqueio sem causa é envelope fora do contrato: recuperação, nunca o PR', async () => {
  const e = motor();
  await revisar(e, 79, { extra: { ...reprovando(['defeito_codigo']), findings: [bloqueio(undefined)] } });
  assert.deepEqual(envios, []);
  assert.ok(pendente(e, 79).esperaProva, 'cai na recuperação durável');
});

test('envelope legado (findings undefined) com verdict request_changes não posta e não aprova', async () => {
  const e = motor();
  await revisar(e, 80, { extra: { verdict: 'request_changes', decision: 'needs_decision', findings: undefined } });
  assert.deepEqual(envios, []);
  const d = pendente(e, 80);
  assert.notEqual(d.blockedKind, 'conflito');
  assert.doesNotMatch(textos(d).join(' | '), /não em defeito do código/, 'a regra nova só vale com findings');
});

test('pendência do conflito vira revisão nova quando chega commit', async () => {
  const e = motor();
  await revisar(e, 81, { extra: reprovando(['conflito']) });
  e.headSha = async () => HEAD_NOVO;
  const { marcarCommitNovo } = await import('../lib/engine/pendencia-commit-novo.js');
  assert.equal(await marcarCommitNovo(e), 1);
  assert.equal(pendente(e, 81).blockedKind, 'stale_head');
  assert.equal(pendente(e, 81).blockedHead, HEAD_NOVO);
});

/* ---------- "CI obrigatório antes da aprovação" desligado (padrão desde 06/11/2026) ----------
   Pedido do dono: o estado do CI obrigatório não segura, não adia e não barra a decisão. O merge
   só fica barrado pelo GitHub onde o check é obrigatório no ruleset. Cada caso abaixo é o par desligado de um caso ligado acima. */

test('desligada: CI vermelho com a conta reprovando sozinha sai como APPROVE, nunca como pedido pelo CI', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }], ciObrigatorio: false });
  await revisar(e, 90);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(envios[0].commit_id, HEAD);
  assert.doesNotMatch(envios[0].body, /audit|check/, 'o estado do CI não entra no texto do PR');
  const r = resolvida(e, 90);
  assert.equal(r.status, 'auto_approved');
  assert.match(r.attention.map((p) => p.text).join(' | '), /vermelho no head \(audit\)/, 'o CI fica como nota no app');
  assert.equal(pendente(e, 90), undefined);
  semMesa(e);
});

test('desligada: CI rodando não arma espera; a aprovação sai na hora', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }], ciObrigatorio: false });
  await revisar(e, 91);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(pendente(e, 91), undefined);
  assert.equal(e.toasts.some((t) => /esperando o CI/.test(t)), false);
});

// 08/11/2026 (ordem do dono, estado-desmentido.js): com o CI fora da decisão, o pedido que só o CI
// sustentava não tem o que sustentar; a aprovação sai pela política da conta, com ressalva.
test('desligada: pedido de mudanças sustentado só pelo CI vermelho aprova pela política, nunca o pedido', async () => {
  const e = motor({ ciObrigatorio: false });
  e.bloqueadoPorChecks = async () => ({ verifiedHead: HEAD, faltando: [{ nome: 'audit', estado: 'vermelho' }] });
  const body = `Não encontrei nada bloqueante no código. Os checks obrigatórios estão falhando no commit ${HEAD.slice(0, 7)}.`;
  await revisar(e, 92, { extra: { verdict: 'request_changes', findings: [], payloads: { request_changes: { event: 'REQUEST_CHANGES', body } } } });
  assert.deepEqual(envios.map((x) => x.event), ['APPROVE']);
  assert.match(envios[0].body, /CI obrigatório fica fora desta aprovação/);
  assert.equal(pendente(e, 92), undefined);
  semMesa(e);
});

test('desligada: bloqueio declarado só de ci não arma a espera do CI e aprova pela política', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }], ciObrigatorio: false });
  await revisar(e, 93, { extra: reprovando(['ci']) });
  assert.deepEqual(envios.map((x) => x.event), ['APPROVE']);
  assert.equal(pendente(e, 93), undefined, 'sem espera do CI e sem mesa');
  assert.equal(await e.varrerEsperas(), 0);
  assert.equal(envios.length, 1, 'nada sai de novo');
});

test('desligada depois de armada: a espera de um pedido só pelo CI vai para você, sem laço', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 94, { extra: reprovando(['ci']) });
  assert.ok(pendente(e, 94).esperaCi, 'ligada: espera');
  e.config.aguardarCiParaAprovar = false;
  assert.equal(await e.varrerEsperas(), 0);
  const d = pendente(e, 94);
  assert.equal(d.esperaCi, null);
  assert.match(textos(d)[0], /a espera do CI foi desligada/);
  assert.deepEqual(envios, [], 'CI fora da decisão não vira APPROVE do que a revisão reprovou');
  assert.ok(e.eventos.some(([t]) => t === 'needs-decision'));
  assert.equal(await e.varrerEsperas(), 0, 'nada volta a esperar');
  assert.deepEqual(envios, []);
});

test('desligada depois de armada: a aprovação que esperava o CI vermelho sai no próximo ciclo, sem pedido pelo CI', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 95);
  assert.ok(pendente(e, 95).esperaCi);
  gh.rollup = [check('test', 'FAILURE'), check('audit', 'SUCCESS')];
  e.config.aguardarCiParaAprovar = false;
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(resolvida(e, 95).status, 'auto_approved');
});

/* ---------- o aviso no card da aprovação (06/11/2026) ----------
   O APPROVE sai, e o card do app diz quando o GitHub pode não segurar o merge: repositório sem
   check obrigatório no ruleset, ou a chave desligada com o check obrigatório fora do verde. */
const avisos = (e, n) => (resolvida(e, n).attention || []).map((p) => p.text).join(' | ');

test('aviso: chave desligada e check obrigatório vermelho, o card da aprovação diz que saiu assim', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }], ciObrigatorio: false });
  await revisar(e, 96);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.doesNotMatch(envios[0].body, /ruleset|segura o merge/, 'o aviso nunca vai para o PR');
  assert.match(avisos(e, 96), /aprovado com check obrigatório vermelho no head \(audit\): o ruleset segura o merge até ele passar, salvo bypass/);
});

test('aviso: repositório sem check obrigatório no ruleset, com o CI vermelho, com a chave ligada ou desligada', async () => {
  for (const [n, ciObrigatorio] of [[97, true], [98, false]]) {
    envios = [];
    const e = motor({ ciObrigatorio });
    e.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: HEAD, semExigencia: true, naoVerdes: [{ nome: 'lint', estado: 'vermelho' }] });
    await revisar(e, n);
    assert.deepEqual(envios.map((p) => p.event), ['APPROVE'], `chave ${ciObrigatorio}`);
    assert.doesNotMatch(envios[0].body, /ruleset/, 'o aviso nunca vai para o PR');
    assert.match(avisos(e, n), /aprovado sem check de CI obrigatório no ruleset da branch de destino: se a branch também não tiver proteção clássica, o GitHub não barra o merge, e o CI não está verde no head \(lint vermelho\)/, `chave ${ciObrigatorio}`);
  }
});

test('aviso: com os checks obrigatórios verdes num repositório que os exige, o card não ganha aviso', async () => {
  const e = motor({ ciObrigatorio: false });
  // a leitura de um repositório que exige check e o tem verde: sem semExigencia, com o head conferido
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [], verifiedHead: HEAD });
  await revisar(e, 99);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.doesNotMatch(avisos(e, 99), /aprovado (sem|com) check obrigatório/);
});

test('aviso: com o APPROVE falhando, o motivo não diz "aprovado"', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }], ciObrigatorio: false });
  gh.postFalha = 'HTTP 422: erro passageiro de teste';
  await revisar(e, 100);
  const d = pendente(e, 100) || resolvida(e, 100);
  const texto = (d.reasons || []).concat(d.attention || []).map((p) => p.text).join(' | ');
  assert.match(texto, /check obrigatório vermelho no head \(audit\)/, 'o estado do CI segue dito');
  assert.doesNotMatch(texto, /aprovado (com|sem) check/, 'o card não afirma uma aprovação que não saiu');
});

test('aviso: a aprovação que só sai no reenvio ganha o mesmo aviso no card', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }], ciObrigatorio: false });
  gh.postFalha = 'HTTP 502: Bad Gateway';
  await revisar(e, 101);
  assert.ok(pendente(e, 101).postRetry, 'falha passageira arma o reenvio');
  gh.postFalha = '';
  envios = [];
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.match(avisos(e, 101), /aprovado com check obrigatório vermelho no head \(audit\): o ruleset segura o merge/);
  assert.doesNotMatch(avisos(e, 101), /falha ao postar/, 'o motivo de infra sai com a publicação');
});

test('aviso: a espera desligada cuja aprovação só sai no reenvio também ganha o aviso', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 102);
  assert.ok(pendente(e, 102).esperaCi);
  gh.rollup = [check('test', 'FAILURE'), check('audit', 'SUCCESS')];
  e.config.aguardarCiParaAprovar = false;
  gh.postFalha = 'HTTP 502: Bad Gateway';
  assert.equal(await e.varrerEsperas(), 0);
  assert.ok(pendente(e, 102).postRetry, 'falha passageira arma o reenvio');
  gh.postFalha = '';
  envios = [];
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.match(avisos(e, 102), /aprovado com check obrigatório vermelho no head \(test\)/);
});
