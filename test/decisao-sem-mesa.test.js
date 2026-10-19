// A decisão sem mesa (18/10/2026, v2.72.12). Regra do dono: "Se foi configurado pra aprovar
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
    head: HEAD, headDepois: '', exigidos: ['test', 'audit'], meusReviews: [], reviewsAlheios: [], postFalha: '',
    rollup: [check('test', 'SUCCESS'), check('audit', 'SUCCESS')],
  };
});

// a conta em automático nas três classes, a não ser que o teste diga outra coisa
function motor({ checks = [], aprova = 'approve', reprova = 'request_changes' } = {}) {
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
      protocolo: { prReviewer: 'rodou' }, analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
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

async function revisar(e, n, { marcas, extra } = {}) {
  sessao(e, extra);
  await e.runHeadlessReview(PR(n, marcas));
}

const violacao = (achados = [{ file: 'src/a.ts', line: 12, message: 'regra de negócio duplicada no controller' }]) => async (ctx) => ({
  ...technicalReport(ctx.head, ctx.repo), verdict: 'fail',
  rules: [{ rule: 'core.duplication.business-rule', verdict: 'fail', causa: 'a regra de desconto foi copiada em dois lugares' }],
  findings: achados,
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
  assert.match(corpo, /a regra de desconto foi copiada em dois lugares/);
  assert.match(corpo, /`src\/a\.ts:12`: regra de negócio duplicada no controller/);
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
  assert.match(envios[0].body, /`b\.ts`: erro engolido no catch/);
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

test('CI obrigatório vermelho e a conta reprovando sozinha: REQUEST_CHANGES citando os checks, e a aprovação sai quando ficar verde', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }] });
  await revisar(e, 20);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES'], 'nunca APPROVE com CI vermelho');
  assert.match(envios[0].body, /`audit` estão falhando no commit 706cc81/);
  assert.equal(envios[0].commit_id, HEAD);
  assert.deepEqual(publicReviewLanguageIssues(envios[0], 'eu'), []);
  const d = pendente(e, 20);
  assert.ok(d.esperaCi, 'segue esperando o CI');
  assert.equal(d.esperaCi.rcHead, HEAD, 'o pedido saiu uma vez por head');
  semMesa(e);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  for (let ciclo = 0; ciclo < 3; ciclo++) assert.equal(await e.varrerEsperas(), 0);
  assert.equal(envios.length, 1, 'não repete o pedido de mudanças a cada ciclo');
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES', 'APPROVE']);
  assert.equal(envios[1].commit_id, HEAD);
  assert.equal(resolvida(e, 20).status, 'auto_approved');
  semMesa(e);
});

test('CI que fica vermelho DURANTE a espera: o pedido sai no ciclo, uma vez, e a espera continua', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }] });
  await revisar(e, 21);
  assert.deepEqual(envios, []);
  gh.rollup = [check('test', 'FAILURE'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.match(envios[0].body, /`test` estão falhando/);
  assert.equal(pendente(e, 21).esperaCi.rcHead, HEAD);
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
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.equal(pendente(e, 24).esperaCi.rcHead, HEAD);
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

test('análise incompleta com a conta em automático: revisa de novo sozinho no mesmo commit, sem mesa', async () => {
  const e = motor();
  await revisar(e, 40, { extra: { analysisStatus: 'incomplete', verdict: 'request_changes', payloads: { approve: { event: 'APPROVE', body: '' } } } });
  const d = pendente(e, 40);
  assert.ok(d.esperaProva, 'busca automática armada');
  assert.equal(d.esperaProva.envelope, true);
  assert.deepEqual(d.esperaProva.lacunas, ['análise incompleta']);
  assert.match(textos(d)[0], /a revisão voltou incompleta \(análise incompleta\); reviso de novo sozinho/);
  assert.deepEqual(envios, []);
  semMesa(e);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'relança no mesmo head');
  assert.equal(pendente(e, 40).blockedKind, 'stale_head');
  assert.equal(pendente(e, 40).blockedHead, HEAD);
});

test('aprovação em branco (sem texto) também é resultado incompleto: revisa de novo, no máximo duas vezes', async () => {
  const e = motor();
  const branco = { payloads: { approve: { event: 'APPROVE', body: ' ' } } };
  await revisar(e, 41, { extra: branco });
  assert.equal(pendente(e, 41).esperaProva.envelope, true);
  pendente(e, 41).esperaProva.tentativas = esperaProva.MAX_TENTATIVAS;
  await revisar(e, 41, { extra: branco });
  const d = pendente(e, 41);
  assert.equal(d.esperaProva, undefined, 'as tentativas deste commit acabaram');
  assert.ok(textos(d).some((t) => /aprovou sem escrever nada/.test(t)), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#41']]);
});

test('resultado incompleto com a conta que decide tudo: a mesa é a escolha da conta', async () => {
  const e = motor({ aprova: 'wait', reprova: 'wait' });
  await revisar(e, 42, { extra: { analysisStatus: 'incomplete' } });
  assert.equal(pendente(e, 42).esperaProva, undefined);
  assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#42']]);
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
  const rc = auto.payloadDoDefeito({ technicalReview: { rules: [{ verdict: 'fail', causa: 'x duplicado' }], findings: [{ file: 'a.ts', message: 'y' }] } }, ['violação técnica confirmada']);
  const ci = auto.payloadDoCiVermelho([{ nome: 'audit' }, { nome: 'lint' }], HEAD);
  for (const p of [rc, ci]) {
    assert.deepEqual(publicReviewLanguageIssues(p, 'eu'), [], p.body);
    assert.doesNotMatch(p.body, /—/);
    assert.equal(p.event, 'REQUEST_CHANGES');
  }
  assert.match(ci.body, /`audit`, `lint` estão falhando no commit 706cc81/);
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

test('Codex 1: o pedido de mudanças que o próprio Farol postou pelo CI não resolve a espera na reconciliação', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }] });
  await revisar(e, 60);
  assert.equal(pendente(e, 60).esperaCi.rcHead, HEAD);
  gh.meusReviews = [{ state: 'CHANGES_REQUESTED', submitted_at: new Date(Date.now() + 1000).toISOString(), commit_id: HEAD }];
  await e.reconcilePending();
  assert.ok(pendente(e, 60), 'a espera continua: aquele pedido é o do CI, não uma decisão de fora');
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES', 'APPROVE']);
});

test('Codex 1: uma aprovação minha neste commit continua resolvendo a espera do CI', async () => {
  const e = motor({ checks: [{ nome: 'audit', estado: 'vermelho' }] });
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
  assert.deepEqual(d.postRetry, { event: 'approve', attempts: 0 });
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
  assert.match(http, /engine\.on\('auto-commented', p => broadcast\('auto-commented', p\)\)/);
  assert.match(main, /engine\.on\('auto-commented'/);
  assert.match(app, /addEventListener\('auto-commented'/);
});
