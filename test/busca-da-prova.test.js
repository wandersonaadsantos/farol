import { criteriaFixture } from './helpers/criteria-fixture.js';
// O Farol vai atrás da prova, e depois de duas tentativas deixa de exigir (v2.72.6, 17/10/2026).
//
// Decisão do dono: "o Farol não pode esperar uma ação externa; o próprio Farol precisa ir atrás
// das provas e não exigir mais provas". Resultado aprovável com lacuna de prova relança NA HORA
// uma revisão complementar do mesmo commit (sem esperar o PR mudar nem o relógio de PR quieto),
// com o prompt dizendo o que faltou; no máximo duas por commit. A rodada que nasce com as duas
// gastas deixa de exigir a lacuna que sobrou: vira ressalva e a política da conta decide. CI
// vermelho, violação técnica confirmada e a parte do card deste PR dita não entregue seguem
// impedindo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-busca-da-prova-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '1f18057f09f3cef5043ec47e5eebbc5e8c44eb9c';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, author: { login: 'dev' } }) };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { VERSAO_DAS_REGRAS } = await import('../lib/technical-review/evidence.js');
const { isolateTechnicalTool, technicalReport } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { technicalRuntime } = await import('../lib/technical-review/runtime.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { PROFILE_FILE, profileFor } = await import('../lib/technical-review/profiles.js');
const esperaProva = (await import('../lib/engine/espera-prova.js')).default;
const busca = (await import('../lib/engine/busca-da-prova.js')).default;
const reviewMod = (await import('../lib/engine/review.js')).default;

const finishOriginal = technicalRuntime.finishTechnicalReview;
const targetOriginal = technicalRuntime.targetFor;
const snapshotOriginal = technicalRuntime.reviewSnapshot;
const { decisionForUi } = await import('../lib/engine/public-review.js');
const { staleCardMeta } = await import('../ui/pure/review.js');
after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  technicalRuntime.finishTechnicalReview = finishOriginal;
  technicalRuntime.targetFor = targetOriginal;
  technicalRuntime.reviewSnapshot = snapshotOriginal;
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
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.eventos = [];
  e.on('needs-decision', (p) => e.eventos.push(['needs-decision', p.item.key]));
  e.on('auto-approved', (p) => e.eventos.push(['auto-approved', p.result.key, (p.points || []).map((x) => x.text || x)]));
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
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
const SEM_PROTOCOLO = { protocolo: { prReviewer: 'pulado' } };

async function revisado(e, extra) {
  sessao(e, extra);
  await e.runHeadlessReview({ ...PR });
  return pendente(e);
}

// leva o PR até a rodada da prova esgotada: original, duas buscas, e devolve o motor pronto
async function ateEsgotar(e) {
  await revisado(e, SEM_PROTOCOLO);
  for (let i = 1; i <= busca.MAX_TENTATIVAS; i++) {
    assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, `busca ${i}`);
    assert.equal(pendente(e).esperaProva.tentativas, i);
    if (i < busca.MAX_TENTATIVAS) await revisado(e, SEM_PROTOCOLO);
  }
}

test('a busca é imediata: o primeiro ciclo relança no mesmo commit, sem o PR mudar e sem o relógio de PR quieto', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  const d = pendente(e);
  assert.equal(d.blockedKind, 'stale_head');
  assert.equal(d.blockedHead, HEAD);
  assert.equal(d.esperaProva.tentativas, 1);
  const gate = reviewMod.explicaReRound(e, { ...PR }, new Set(), Date.now());
  assert.equal(gate.estado, 'relanca', JSON.stringify(gate));
  assert.deepEqual(e.eventos, []);
});

test('o prompt da rodada complementar lista o que faltou, como dado delimitado', async () => {
  const e = motor();
  assert.doesNotMatch(e.headlessPromptFor(PR.url, 'dev'), /Revisão complementar/, 'sem busca, sem bloco');
  await revisado(e, SEM_PROTOCOLO);
  await esperaProva.reverQuandoAProvaMudar(e);
  const prompt = e.headlessPromptFor(PR.url, 'dev');
  assert.match(prompt, /## Revisão complementar \(tentativa 1 neste commit\)/);
  assert.match(prompt, /<<<LACUNAS-DA-TENTATIVA-ANTERIOR\n- protocolo de revisão não comprovado\nLACUNAS-DA-TENTATIVA-ANTERIOR/);
});

test('no máximo duas buscas por commit; a rodada seguinte aprova com a lacuna como ressalva', async () => {
  const e = motor();
  await ateEsgotar(e);
  // a rodada da prova esgotada volta com a MESMA lacuna
  await revisado(e, SEM_PROTOCOLO);
  assert.equal(envios.length, 1, 'aprovou');
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(envios[0].commit_id, HEAD);
  const aprovado = e.eventos.find((x) => x[0] === 'auto-approved');
  assert.ok(aprovado, JSON.stringify(e.eventos));
  assert.ok(aprovado[2].some((t) => /faltou prova depois das minhas 2 tentativas neste commit, então segue como ressalva: protocolo de revisão não comprovado/.test(t)), aprovado[2].join(' | '));
  assert.equal(e.eventos.some((x) => x[0] === 'needs-decision'), false, 'ninguém foi chamado');
  assert.equal(pendente(e), undefined);
});

test('falta de prova não é ressalva que transfere uma decisão ainda bloqueada', async () => {
  const e = motor(['approve', 'wait']);
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.ok(d.esperaProva);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
  await esperaProva.reverQuandoAProvaMudar(e);
  await revisado(e, {});
  assert.equal(envios.length, 1);
  assert.equal(pendente(e), undefined);
});

// Os três casos abaixo são da conta que NÃO reprova sozinha (onReject: wait). Com ela
// reprovando sozinha, CI vermelho e defeito do PR viram REQUEST_CHANGES automático
// (test/decisao-sem-mesa.test.js, 18/10/2026).
test('esgotada não converte CI vermelho: a aprovação espera o CI sozinha, sem postar e sem chamar ninguém', async () => {
  const e = motor();
  e.rejectPolicyFor = () => 'wait';
  await ateEsgotar(e);
  e.bloqueadoPorChecks = async () => ({ faltando: [{ nome: 'test', estado: 'vermelho' }] });
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(envios, []);
  assert.ok(d.esperaCi, 'espera automática do CI');
  assert.equal(d.esperaProva, undefined);
  assert.deepEqual(e.eventos, []);
});

test('esgotada não converte violação técnica confirmada: com a conta sem reprovar sozinha, vai para a mesa', async () => {
  const e = motor();
  e.rejectPolicyFor = () => 'wait';
  await ateEsgotar(e);
  technicalRuntime.finishTechnicalReview = async (ctx) => ({ ...technicalReport(ctx.head, ctx.repo), verdict: 'fail', rules: [{ rule: 'x', verdict: 'fail' }] });
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(envios, []);
  assert.equal(d.esperaProva, undefined);
  assert.ok(textos(d).includes('violação técnica confirmada'), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('esgotada não converte a parte do card deste PR dita não entregue: com a conta sem reprovar sozinha, vai para a mesa', async () => {
  const e = motor();
  e.rejectPolicyFor = () => 'wait';
  await ateEsgotar(e);
  const d = await revisado(e, { card: 'CARD-1', cardMet: false, cardParteDestePr: false });
  assert.deepEqual(envios, []);
  assert.equal(d.esperaProva, undefined, 'sem terceira busca: as tentativas deste commit acabaram');
  assert.ok(textos(d).includes('a parte do card que cabe a este PR não foi comprovada'), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('unidade: só a lacuna que não é dura vira ressalva, e o relatório com violação segue impedindo', () => {
  const base = { headSha: HEAD, ...criteriaFixture('approve'), analysisStatus: 'complete', checksVerifiedHead: HEAD, diffMedido: [], verificationCheckpoint: { total: 0, conflicts: [] },
    technicalReview: technicalReport(HEAD), protocolo: { prReviewer: 'pulado' }, coverage: { total: 0, reviewed: [], missing: [] } };
  assert.deepEqual(busca.lacunasExigidas(base), ['protocolo de revisão não comprovado']);
  assert.deepEqual(busca.lacunasExigidas({ ...base, provaEsgotada: true }), []);
  assert.equal(busca.pontosDaProvaEsgotada({ ...base, provaEsgotada: true }).length, 1);
  assert.deepEqual(busca.pontosDaProvaEsgotada(base), []);
  const violada = { ...base, provaEsgotada: true, technicalReview: { ...technicalReport(HEAD), findings: [{ x: 1 }] } };
  assert.deepEqual(busca.lacunasExigidas(violada), ['achados técnicos não resolvidos']);
  assert.equal(busca.relatorioComViolacao({ verdict: 'pass', rules: [], findings: [] }), false);
  assert.equal(busca.relatorioComViolacao({ verdict: 'pass', rules: [{ verdict: 'fail' }], findings: [] }), true);
});

test('publicação: com a prova esgotada a avaliação técnica inconclusiva não recusa; violação e prova não esgotada recusam', async () => {
  const repo = 'org/declarado';
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { [repo]: { declaration: { scopes: ['core'] } } } }));
  try {
    const head = 'a'.repeat(40);
    const pr = { key: `${repo}#1`, repo };
    const inconclusivo = { ...technicalReport(head, repo), profile: profileFor(repo).fingerprint, verdict: 'not-run', rules: [{ rule: 'x', verdict: 'not-run' }] };
    // o contexto que a revisão leu segue o mesmo (base e objeções): a revisão do PR #248 cobre a mudança
    technicalRuntime.targetFor = async () => ({ base: inconclusivo.base, head });
    technicalRuntime.reviewSnapshot = async () => ({ fingerprint: inconclusivo.humanReviewFingerprint });
    const motorDe = (report, provaEsgotada) => ({
      technicalApprovals: new Map([[pr.key, { report, evidence: [], provaEsgotada, evidenceVersion: VERSAO_DAS_REGRAS }]]), decisions: { pending: [] },
      bloqueadoPorChecks: async () => ({ verifiedHead: head, faltando: [] }),
    });
    const payload = { event: 'APPROVE', commit_id: head };
    assert.equal(await approvalRefusal(motorDe(inconclusivo, true), pr, payload), null);
    assert.equal((await approvalRefusal(motorDe(inconclusivo, false), pr, payload)).error, 'avaliação técnica inconclusiva');
    const violado = { ...inconclusivo, verdict: 'fail', rules: [{ rule: 'x', verdict: 'fail' }] };
    assert.equal((await approvalRefusal(motorDe(violado, true), pr, payload)).error, 'violação técnica confirmada');
    const semCommit = await approvalRefusal(motorDe(inconclusivo, true), pr, { event: 'APPROVE' });
    assert.equal(semCommit.error, 'aprovação sem commit confirmado', 'o commit continua obrigatório');
    const ciVermelho = motorDe(inconclusivo, true);
    ciVermelho.bloqueadoPorChecks = async () => ({ verifiedHead: head, faltando: [{ nome: 'test', estado: 'vermelho' }] });
    assert.equal((await approvalRefusal(ciVermelho, pr, payload)).waitForCi, true, 'os checks continuam obrigatórios');
  } finally { fs.rmSync(PROFILE_FILE, { force: true }); }
});

// Revisão do PR #248 (Codex, 17/10/2026). Cada caso abaixo reprovava no head 38f8300.

function comCadastro(repo, corpo) {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { [repo]: { declaration: { scopes: ['core'] } } } }));
  return Promise.resolve().then(corpo).finally(() => fs.rmSync(PROFILE_FILE, { force: true }));
}

test('PR #248, achado 1: com a prova esgotada, base nova ou objeção nova recusam a publicação', () => comCadastro('org/declarado', async () => {
  const repo = 'org/declarado';
  const head = 'a'.repeat(40);
  const pr = { key: `${repo}#1`, repo };
  const report = { ...technicalReport(head, repo), profile: profileFor(repo).fingerprint, verdict: 'not-run', rules: [{ rule: 'x', verdict: 'not-run' }] };
  const motor = (rep, extra = {}) => ({
    technicalApprovals: new Map([[pr.key, { report: rep, evidence: [], provaEsgotada: true, evidenceVersion: VERSAO_DAS_REGRAS }]]), decisions: { pending: [] }, saveDecisions: () => { },
    bloqueadoPorChecks: async () => ({ verifiedHead: head, faltando: [] }), ...extra,
  });
  const payload = { event: 'APPROVE', commit_id: head };
  technicalRuntime.targetFor = async () => ({ base: 'c'.repeat(40), head });
  technicalRuntime.reviewSnapshot = async () => ({ fingerprint: report.humanReviewFingerprint });
  const baseNova = await approvalRefusal(motor(report), pr, payload);
  assert.equal(baseNova && baseNova.error, 'a base mudou depois da avaliação técnica');
  technicalRuntime.targetFor = async () => ({ base: report.base, head });
  technicalRuntime.reviewSnapshot = async () => ({ fingerprint: 'outra' });
  const objecaoNova = await approvalRefusal(motor(report), pr, payload);
  assert.equal(objecaoNova && objecaoNova.error, 'histórico de objeções mudou depois da revisão');
  technicalRuntime.reviewSnapshot = async () => ({ fingerprint: report.humanReviewFingerprint });
  assert.equal(await approvalRefusal(motor(report), pr, payload), null, 'contexto igual: sai');
  // sem base nem impressão gravadas (a avaliação falhou antes de ler) não há com o que comparar.
  // Desde 18/10/2026 (a decisão sem mesa) o pedido de mudanças de uma pessoa não segura a
  // aprovação que a conta mandou sair, então ele não substitui a impressão que falta.
  const semContexto = { schema: 1, verdict: 'not-run', error: 'ferramenta ausente' };
  const comPedido = motor(semContexto, { bloqueadoPorHistorico: async () => ({ bloqueado: false, decisivos: [], pediramMudancas: ['colega'] }) });
  assert.equal(await approvalRefusal(comPedido, pr, payload), null);
  const semPedido = motor(semContexto, { bloqueadoPorHistorico: async () => ({ bloqueado: false, decisivos: [] }) });
  assert.equal(await approvalRefusal(semPedido, pr, payload), null);
  const leituraFalha = motor(report);
  technicalRuntime.targetFor = async () => { throw new Error('rede'); };
  assert.equal((await approvalRefusal(leituraFalha, pr, payload)).error, 'não foi possível reconfirmar a base e as objeções da revisão');
}));

test('PR #248, achado 2: com a prova esgotada e a política esperando você, o Aprovar fica ligado', () => {
  const head = 'a'.repeat(40);
  const inconclusivo = { ...technicalReport(head), verdict: 'not-run', rules: [{ rule: 'x', verdict: 'not-run' }] };
  // a prova gravada pelas regras vigentes (a de regras anteriores pede revisão nova, legacy-technical-evidence.test.js)
  const base = { id: 'd1', key: PR.key, status: 'pending', verdict: 'approve', headSha: head, technicalReview: inconclusivo, approvalEvidence: [], approvalEvidenceVersion: VERSAO_DAS_REGRAS, reasons: [] };
  const esgotada = decisionForUi({ ...base, provaEsgotada: true });
  assert.equal(esgotada.provaEsgotada, true, 'a marca chega à tela');
  assert.equal(esgotada.technical.state, 'ressalva');
  assert.match(esgotada.technical.message, /avaliação técnica inconclusiva; depois de duas tentativas minhas neste commit, segue como ressalva/);
  assert.equal(staleCardMeta(esgotada, null).approveDisabled, false);
  const exigida = decisionForUi(base);
  assert.equal(exigida.technical.state, 'pending', 'sem esgotar, segue exigida');
  assert.equal(staleCardMeta(exigida, null).approveDisabled, true);
  const violada = decisionForUi({ ...base, provaEsgotada: true, technicalReview: { ...inconclusivo, verdict: 'fail', rules: [{ rule: 'x', verdict: 'fail' }] } });
  assert.equal(violada.technical.state, 'violation', 'violação nunca vira ressalva');
  assert.equal(staleCardMeta(violada, null).approveDisabled, true);
});
