import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-espera-prova-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '1f18057f09f3cef5043ec47e5eebbc5e8c44eb9c';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';

// o gh é a fronteira de rede: `gh` guarda o que o GitHub responderia AGORA
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let leiturasDoPr = 0;
let leiturasDeDependencia = 0;
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    leiturasDoPr++;
    if (gh.leituraFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: gh.state, headRefOid: gh.head, author: { login: 'dev' } }) };
  }
  if (sub.startsWith('pr view 7 --repo acme/lib --json state')) {
    leiturasDeDependencia++;
    return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.dependencia }), stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.state }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const esperaProva = (await import('../lib/engine/espera-prova.js')).default;
const reviewMod = (await import('../lib/engine/review.js')).default;
const pendencia = (await import('../lib/sync/pendencia.js')).default;
const fila = (await import('../lib/sync/fila.js')).default;
const { separarPendentes, staleCardMeta } = await import('../ui/pure/review.js');
const { technicalRuntime } = await import('../lib/technical-review/runtime.js');
const { technicalPublication } = await import('../lib/technical-review/publication.js');
const { technicalReport } = await import('./helpers/technical-proof.js');
const { intervaloDaProva } = await import('../lib/engine/recuperacao-prova.js');
const finishReal = technicalRuntime.finishTechnicalReview;
const publicationReal = technicalPublication.approvalRefusal;

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  technicalRuntime.finishTechnicalReview = finishReal;
  technicalPublication.approvalRefusal = publicationReal;
  envios = []; leiturasDoPr = 0; leiturasDeDependencia = 0;
  gh = { state: 'OPEN', head: HEAD, updatedAt: '2026-10-17T12:00:00Z', reviewDecision: 'REVIEW_REQUIRED', reviews: [], dependencia: 'OPEN', leituraFalha: false };
});

// `politica` = [limpo, com ressalvas]
function motor(politica = ['approve', 'approve']) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.approvePolicyFor = (_conta, limpo) => (limpo ? politica[0] : politica[1]);
  e.autoReviewFor = () => true;
  e.rejectPolicyFor = () => 'wait';
  e.decisions = { pending: [], resolved: [] };
  e.salvas = 0;
  e.saveDecisions = () => { e.salvas++; };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.toasts = [];
  e.eventos = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  e.on('needs-decision', (p) => e.eventos.push(['needs-decision', p.item.key]));
  e.on('auto-approved', (p) => e.eventos.push(['auto-approved', p.result.key]));
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = { key: 'acme/app#1', repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', title: 'PR', author: 'dev', requested: true, account: 'eu' };
const pendente = (e) => e.decisions.pending.find((x) => x.key === PR.key);
const textos = (d) => (d.reasons || []).map((r) => r.text || r);
// lacuna que a própria sessão preenche ao revisar de novo (envelope)
const SEM_PROTOCOLO = { protocolo: { prReviewer: 'pulado' } };
// lacuna que só o mundo resolve (estado). Desde 17/10/2026 a dependência sozinha é ressalva;
// a lacuna é a sessão dizendo que a parte do card deste PR não foi entregue, e a dependência
// citada segue sendo lida a cada ciclo, porque ela fechar é estado novo para revisar de novo.
const COM_DEPENDENCIA = { card: 'CARD-1', cardMet: false, cardParteDestePr: false, dependenciasAbertas: ['acme/lib#7 precisa entrar antes deste PR'] };

async function revisado(e, extra) {
  sessao(e, extra);
  await e.runHeadlessReview({ ...PR });
  return pendente(e);
}

test('aprovável com prova incompleta: nada é postado, e a pendência BUSCA A PROVA, sem pedir você', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(envios, [], 'nenhum APPROVE com lacuna (invariante 4)');
  assert.ok(d && d.esperaProva, 'a marca durável está no decisions.json');
  assert.equal(d.esperaProva.tentativas, 0);
  assert.equal(d.esperaProva.soEnvelope, true);
  assert.ok(d.esperaProva.lacunas.includes('protocolo de revisão não comprovado'), d.esperaProva.lacunas.join(' | '));
  assert.equal(d.reasons[0].espera, true, 'o motivo da espera é marcado, como na espera do CI');
  assert.deepEqual(e.eventos, [], 'sem needs-decision');
  assert.ok(e.toasts.some(t => /recuperação continua automaticamente/.test(t)), e.toasts.join(' | '));
  assert.equal(e.toasts.some((t) => /precisa da sua atenção/.test(t)), false);
  const tela = e.decisionForUi(d);
  assert.equal(tela.esperaProva.tentativas, 0, 'a tela sabe que é espera');
  assert.equal(e.reviewActions()[PR.key].esperaProva, true, 'o Panorama também');
  const { precisam, esperandoCi } = separarPendentes([tela]);
  assert.equal(precisam.length, 0, 'fora de Precisa de você');
  assert.equal(esperandoCi.length, 1);
  const meta = staleCardMeta(tela, null);
  assert.match(meta.statusHtml, /Concluindo a análise \(tentativa 1\)/);
  assert.match(meta.statusHtml, /Farol retoma sozinho/);
  assert.match(meta.verdictHtml, /RECUPERANDO A ANÁLISE/);
});

test('publicação manual recebe uma análise concluída, nunca uma decisão sem prova', async () => {
  const e = motor(['wait', 'wait']);
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.ok(d.esperaProva);
  assert.deepEqual(e.eventos, []);
  assert.deepEqual(envios, []);
  await esperaProva.reverQuandoAProvaMudar(e);
  const pronta = await revisado(e, {});
  assert.equal(pronta.esperaProva, undefined);
  assert.equal(e.decisionForUi(pronta).technical.state, 'pass');
  assert.deepEqual(envios, [], 'política manual não é permissão para publicar');
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('armar: só prova_tecnica_incompleta, sem violação confirmada, com a política aprovando', () => {
  const e = motor();
  const base = { headSha: HEAD, approvalEvidence: ['protocolo de revisão não comprovado'], reasons: [] };
  assert.ok(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', base, []));
  assert.equal(esperaProva.armar(e, PR, 'politica', base, []), null);
  assert.ok(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', { ...base, approvalEvidence: ['violação técnica confirmada'] }, []), 'nova análise deve fundamentar o pedido de mudanças, nunca aprovar a violação');
  assert.equal(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', { ...base, headSha: '' }, []), null, 'sem head lido não há o que conferir');
  assert.ok(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', { ...base, technicalRecheck: true }, []));
  assert.ok(esperaProva.armar(motor(['approve', 'wait']), PR, 'prova_tecnica_incompleta', base, [{ text: 'ressalva', kind: 'content' }]), 'a análise precisa terminar antes de classificar a publicação');
  const ci = esperaProva.armarEspera(e, PR, 'ci_em_andamento', { checksObrigatorios: [] }, []);
  assert.ok(ci && ci.extra.esperaCi, 'a espera do CI segue com o mesmo funil');
});

test('ciclo: commit novo larga a espera e carimba stale_head', async () => {
  const e = motor();
  await revisado(e, COM_DEPENDENCIA);
  gh.head = HEAD_NOVO;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  const d = pendente(e);
  assert.equal(d.blockedKind, 'stale_head');
  assert.equal(d.blockedHead, HEAD_NOVO);
  assert.equal(d.esperaProva, null, 'a espera foi largada: quem age é o round do commit novo');
  assert.equal(d.reasons.some((r) => r && r.espera === true), false);
  assert.match(textos(d)[0], /commit novo/);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
});

test('ciclo: PR fechado é do reconcilePending, leitura que falha espera, coordenação fora do ar não lê', async () => {
  const e = motor();
  await revisado(e, COM_DEPENDENCIA);
  gh.state = 'MERGED';
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(pendente(e).blockedKind, undefined);
  gh.state = 'OPEN';
  gh.leituraFalha = true;
  e.salvas = 0;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(e.salvas, 0);
  gh.leituraFalha = false;
  leiturasDoPr = 0;
  e.syncCoordenacaoAtiva = () => true;
  e.sync = { status: 'desconectado' };
  assert.equal(await esperaProva.varrerEsperas(e), 0);
  assert.equal(leiturasDoPr, 0, 'coordenação ligada e fora do ar: espera a conexão, como o reenvio');
});

test('mudança para publicação manual não abandona a análise ainda bloqueada', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  e.approvePolicyFor = () => 'wait';
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.ok(pendente(e).esperaProva);
  assert.deepEqual(e.eventos, []);
  const pronta = await revisado(e, {});
  assert.equal(pronta.esperaProva, undefined);
  assert.equal(e.decisionForUi(pronta).technical.state, 'pass');
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
  assert.deepEqual(envios, []);
});

test('outros aparelhos: a espera da prova viaja como fato e não pede ninguém', () => {
  const p = pendencia.projetarPendencia({ key: PR.key, pr: { account: 'eu' }, verdict: 'approve', esperaProva: { desde: 1 } }, { kId: Buffer.alloc(32, 1) });
  assert.equal(p.espera, 'prova');
  assert.equal(pendencia.esperaLida('prova'), 'prova');
  assert.equal(pendencia.deveNotificar('x', { notificadas: new Set(), vistos: {}, espera: 'prova' }), false);
  assert.equal(pendencia.esperaLida('outra'), '', 'lixo segue pendência comum');
  const f = fila.estadoDaFila(PR.key, { pendentes: new Map([[PR.key, 5]]), esperandoProva: new Set([PR.key]) });
  assert.deepEqual(f, { estado: 'decidir', motivo: 'espera-prova', desde: 5, ate: 0 });
});

// Revisão do Codex no PR #245 (17/10/2026): três furos, cada um provado aqui antes da correção.

test('execução estacionada por falha transitória é reagendada sem decisão manual', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  await esperaProva.reverQuandoAProvaMudar(e);
  e.autoReviewParked.add(PR.key);
  e.parkedMotivos = { [PR.key]: { tipo: 'falha', motivo: 'saiu com código 1' } };
  await esperaProva.reverQuandoAProvaMudar(e);
  const d = pendente(e);
  assert.ok(d.esperaProva.proximaEm > Date.now());
  assert.equal(d.blockedKind, undefined);
  assert.deepEqual(e.eventos, []);
  const tela = e.decisionForUi(d);
  assert.equal(separarPendentes([tela]).precisam.length, 0);
  const meta = staleCardMeta(tela, { estado: 'parado' });
  assert.match(meta.statusHtml, /Próxima tentativa/);
  assert.equal(meta.approveDisabled, true);
  assert.notEqual(meta.reviewBtn, 'primary');
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0, 'não relança antes da hora');
  d.esperaProva.proximaEm = Date.now() - 1;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(e.autoReviewParked.has(PR.key), false);
});

test('execução órfã é reagendada, sobrevive ao reinício e conclui sem clique', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  await esperaProva.reverQuandoAProvaMudar(e);
  e.reReviewLaunched[PR.key] = { head: HEAD, at: Date.now() - 3600 * 1000 };
  await esperaProva.reverQuandoAProvaMudar(e);
  assert.ok(pendente(e).esperaProva);
  assert.deepEqual(e.eventos, []);
  e.decisions = JSON.parse(JSON.stringify(e.decisions));
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  pendente(e).esperaProva.proximaEm = Date.now() - 1;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(reviewMod.explicaReRound(e, PR, new Set()).estado, 'relanca');
  await revisado(e, {});
  assert.equal(pendente(e), undefined);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(e.eventos.some(x => x[0] === 'needs-decision'), false);
});

test('recuo mantém duas tentativas rápidas e limita a frequência sem dispensar a prova', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 999].map(n => intervaloDaProva(n) / 60_000), [0, 0, 15, 30, 60, 120, 240, 360, 360]);
  assert.equal(intervaloDaProva(0, 1), 15 * 60_000, 'interrupção também recua');
});

test('análise incompleta por falha do verificador se recupera e aprova sem decisão humana', async () => {
  const e = motor();
  technicalRuntime.finishTechnicalReview = async () => ({ schema: 1, verdict: 'not-run', failure: 'assessment', error: 'detalhe privado' });
  const d = await revisado(e, { analysisStatus: 'incomplete' });
  assert.ok(d.esperaProva);
  assert.deepEqual(e.eventos, []);
  assert.deepEqual(envios, []);
  assert.match(e.decisionForUi(d).technical.message, /execução.*não concluiu/);
  assert.doesNotMatch(e.decisionForUi(d).technical.message, /detalhe privado/);
  await esperaProva.reverQuandoAProvaMudar(e);
  technicalRuntime.finishTechnicalReview = finishReal;
  await revisado(e, {});
  assert.equal(pendente(e), undefined);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(e.eventos.some(x => x[0] === 'needs-decision'), false);
});

test('análise parcial com avaliação técnica executada também é concluída automaticamente', async () => {
  const e = motor(['approve', 'wait']);
  const d = await revisado(e, { analysisStatus: 'incomplete' });
  assert.ok(d.esperaProva, 'falha de execução não deve ser confundida com ressalva do código');
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
  await esperaProva.reverQuandoAProvaMudar(e);
  await revisado(e, {});
  assert.equal(envios.length, 1);
  assert.equal(pendente(e), undefined);
});

test('achado confirmado se transforma em pedido de mudanças fundamentado pela nova análise', async () => {
  const e = motor();
  e.rejectPolicyFor = () => 'request_changes';
  technicalRuntime.finishTechnicalReview = async ctx => ({ ...technicalReport(ctx.head, ctx.repo), verdict: 'fail', rules: [{ rule: 'privada', verdict: 'fail' }] });
  await revisado(e, {});
  assert.ok(pendente(e).esperaProva);
  assert.deepEqual(envios, []);
  await esperaProva.reverQuandoAProvaMudar(e);
  await revisado(e, { verdict: 'request_changes', decision: 'needs_decision',
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'A remoção da validação permite gravar valores inválidos. Preserve a validação antes da gravação.' } } });
  assert.equal(pendente(e), undefined);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'REQUEST_CHANGES');
  assert.doesNotMatch(envios[0].body, /privada/);
  assert.deepEqual(e.eventos, []);
});

test('recusa técnica durante a publicação entra na recuperação única e não publica', async () => {
  const e = motor();
  technicalPublication.approvalRefusal = async () => ({ ok: false, attempted: false, blocked: 'technical_review', error: 'a base mudou depois da avaliação técnica', needsReview: true });
  const d = await revisado(e, {});
  assert.ok(d.esperaProva);
  assert.equal(d.technicalRecheck, false);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
  await esperaProva.reverQuandoAProvaMudar(e);
  technicalPublication.approvalRefusal = publicationReal;
  await revisado(e, {});
  assert.equal(pendente(e), undefined);
  assert.equal(envios.length, 1);
});

test('pendência antiga esgotada volta à recuperação sem perder o bloqueio técnico', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  delete d.esperaProva;
  d.provaEsgotada = true;
  e.decisions = JSON.parse(JSON.stringify(e.decisions));
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.ok(pendente(e).esperaProva);
  assert.equal(pendente(e).blockedKind, 'stale_head');
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
});

test('cancelamento explícito não é desfeito pela recuperação e aparece como impedimento', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  e.autoReviewParked.add(PR.key);
  e.parkedMotivos[PR.key] = { tipo: 'cancelado', motivo: 'cancelada por você' };
  for (let i = 0; i < 3; i++) assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.match(d.esperaProva.impedimento, /cancelada por você/);
  assert.match(staleCardMeta(e.decisionForUi(d)).statusHtml, /cancelada por você/);
  assert.deepEqual(e.eventos, []);
});

test('autenticação vencida pausa a execução e segue recuperável após restabelecer o perfil', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  e.autoReviewParked.add(PR.key);
  e.parkedMotivos[PR.key] = { tipo: 'falha', motivo: 'OAuth access token has expired' };
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.match(d.esperaProva.impedimento, /OAuth|login/);
  e.autoReviewParked.delete(PR.key); // O fluxo de login existente libera o estacionamento.
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(d.esperaProva.impedimento, '');
  assert.deepEqual(e.eventos, []);
});

test('fila, sessão e retry existentes impedem uma recuperação concorrente', async () => {
  for (const origem of ['fila', 'sessao', 'retry']) {
    const e = motor();
    await revisado(e, SEM_PROTOCOLO);
    if (origem === 'fila') e.headlessQueue.push(PR);
    if (origem === 'sessao') e.activeReviews.set('outra', { keys: [PR.key] });
    if (origem === 'retry') e.retryAfterNet.set(PR.key, { at: Date.now() });
    assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0, origem);
    assert.equal(pendente(e).esperaProva.tentativas, 0);
    assert.deepEqual(envios, []);
  }
});

test('automação desligada pausa a recuperação sem descartar a pendência', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  e.autoReviewFor = () => false;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.match(d.esperaProva.impedimento, /desativada/);
  e.autoReviewFor = () => true;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.deepEqual(e.eventos, []);
});

test('orçamento restabelecido libera a recuperação sem exigir uma revisão manual', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  e.autoReviewParked.add(PR.key);
  e.parkedMotivos[PR.key] = { tipo: 'orcamento', motivo: 'limite de orçamento' };
  e.budgetBlockedFor = () => true;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.match(d.esperaProva.impedimento, /Orçamento/);
  e.budgetBlockedFor = () => false;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(e.autoReviewParked.has(PR.key), false);
  assert.equal(d.esperaProva.impedimento, '');
  assert.deepEqual(e.eventos, []);
});

test('clique avulso e PR da própria conta não ganham recuperação com publicação automática', () => {
  const e = motor();
  const r = { headSha: HEAD, approvalEvidence: ['avaliação técnica atual ausente'] };
  assert.equal(esperaProva.armar(e, { ...PR, requested: false }, 'prova_tecnica_incompleta', r, []), null);
  assert.equal(esperaProva.armar(e, { ...PR, author: 'eu' }, 'prova_tecnica_incompleta', r, []), null);
});

test('reprovação automática também recupera a análise quando a aprovação é manual', async () => {
  const e = motor(['wait', 'wait']);
  e.rejectPolicyFor = () => 'request_changes';
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.ok(d.esperaProva);
  assert.deepEqual(e.eventos, []);
  await esperaProva.reverQuandoAProvaMudar(e);
  await revisado(e, { verdict: 'request_changes', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'A alteração remove a validação antes da gravação. Preserve essa validação.' } } });
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'REQUEST_CHANGES');
  assert.equal(pendente(e), undefined);
});

test('ressalva real após recuperar a prova continua obedecendo à aprovação manual', async () => {
  const e = motor(['approve', 'wait']);
  await revisado(e, SEM_PROTOCOLO);
  await esperaProva.reverQuandoAProvaMudar(e);
  const d = await revisado(e, { card: 'CARD-1', cardMet: false });
  assert.equal(d.esperaProva, undefined);
  assert.equal(e.decisionForUi(d).technical.state, 'pass', 'a decisão manual agora tem evidência suficiente');
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

function coordenado(e, recibo, { leituraFalha = false } = {}) {
  const apagados = [];
  e.config.sync = { enabled: true, coordination: { enabled: true } };
  e.syncCoordenacaoAtiva = () => true;
  e.sync = {
    status: 'conectado', uid: 'u1', deviceId: 'este', recibosVistos: { [PR.key]: {} }, agora: () => Date.now(),
    client: {
      get: async () => (leituraFalha ? { ok: false, code: 'indisponivel' } : { ok: true, data: recibo, etag: 'etag-1' }),
      del: async (caminho, opcoes) => { apagados.push([caminho, opcoes.ifMatch]); return { ok: true }; },
    },
  };
  return apagados;
}

test('furo 3: com coordenação, o recibo pendente DESTE aparelho para este head é invalidado antes do relançamento', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  const apagados = coordenado(e, { outcome: 'completed', publicationState: 'pending', deviceId: 'este', expiresAt: Date.now() + 1e9 });
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(apagados.length, 1, 'o recibo que barraria a admissão como "recibo" sai');
  assert.equal(apagados[0][1], 'etag-1', 'condicionado ao etag lido');
  assert.match(apagados[0][0], /\/receipts\/.+\/review_/);
  assert.equal(e.sync.recibosVistos[PR.key], undefined);
  assert.equal(pendente(e).blockedKind, 'stale_head');
});

test('furo 3: recibo publicado, de outro aparelho ou leitura que falha: não apaga e não relança', async () => {
  for (const [recibo, opcoes] of [
    [{ outcome: 'completed', publicationState: 'published', deviceId: 'este', expiresAt: Date.now() + 1e9 }, {}],
    [{ outcome: 'completed', publicationState: 'pending', deviceId: 'outro', expiresAt: Date.now() + 1e9 }, {}],
    [{ outcome: 'completed', publicationState: 'failed', deviceId: 'este', postagens: { approve: { state: 'uncertain' } }, expiresAt: Date.now() + 1e9 }, {}],
    [null, { leituraFalha: true }],
  ]) {
    const e = motor();
    await revisado(e, SEM_PROTOCOLO);
    const apagados = coordenado(e, recibo, opcoes);
    e.salvas = 0;
    assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
    assert.deepEqual(apagados, []);
    assert.equal(pendente(e).blockedKind, undefined);
    assert.equal(e.salvas, 0);
  }
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  const apagados = coordenado(e, null);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'sem recibo nenhum, relança normalmente');
  assert.deepEqual(apagados, []);
});

test('recibo legado de recusa antes do POST pode ser recuperado pelo mesmo aparelho', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  const apagados = coordenado(e, { outcome: 'completed', publicationState: 'failed', deviceId: 'este', expiresAt: Date.now() + 1e9 });
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(apagados.length, 1);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
});
