import { criteriaFixture } from './helpers/criteria-fixture.js';
// A primeira rodada decide (decisão do dono de 06/11/2026, que encerra a rodada complementar da
// v2.72.6). Resultado aprovável com lacuna de prova que não é dura (cobertura, protocolo,
// checkpoint, falha da ferramenta técnica) vira ressalva já na rodada que a encontrou, e a
// política da conta decide: sem espera da prova e sem segunda sessão no mesmo commit. CI
// vermelho, violação técnica confirmada e a parte do card deste PR dita não entregue seguem
// impedindo. A recuperação imediata no mesmo commit continua para o que segue exigido (análise
// incompleta, lacuna dura que não é defeito do PR), com o prompt dizendo o que faltou.
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

// A análise incompleta segue exigida: é o veículo da recuperação no mesmo commit.
const INCOMPLETA = { analysisStatus: 'incomplete' };

test('a recuperação é imediata: o primeiro ciclo relança no mesmo commit, sem o PR mudar e sem o relógio de PR quieto', async () => {
  const e = motor();
  await revisado(e, INCOMPLETA);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  const d = pendente(e);
  assert.equal(d.blockedKind, 'stale_head');
  assert.equal(d.blockedHead, HEAD);
  assert.equal(d.esperaProva.tentativas, 1);
  const gate = reviewMod.explicaReRound(e, { ...PR }, new Set(), Date.now());
  assert.equal(gate.estado, 'relanca', JSON.stringify(gate));
  assert.deepEqual(e.eventos, []);
});

test('o prompt da recuperação lista o que faltou, como dado delimitado', async () => {
  const e = motor();
  assert.doesNotMatch(e.headlessPromptFor(PR.url, 'dev'), /Revisão complementar/, 'sem recuperação, sem bloco');
  await revisado(e, INCOMPLETA);
  await esperaProva.reverQuandoAProvaMudar(e);
  const prompt = e.headlessPromptFor(PR.url, 'dev');
  assert.match(prompt, /## Revisão complementar \(tentativa 1 neste commit\)/);
  assert.match(prompt, /<<<LACUNAS-DA-TENTATIVA-ANTERIOR\n- análise incompleta\nLACUNAS-DA-TENTATIVA-ANTERIOR/);
});

// A decisão de 06/11/2026, travada: só lacuna de cobertura (não dura) na rodada 1, conta aprovando
// com ressalvas. O APPROVE sai nesta rodada, com a ressalva, sem espera da prova e sem outra sessão.
test('decidir na 1ª rodada: só lacuna de cobertura, conta aprovando com ressalvas, posta APPROVE com a ressalva e não cria espera da prova', async () => {
  const e = motor(['approve', 'approve']);
  sessao(e, { coverage: { total: 2, reviewed: ['src/a.js'], missing: ['src/b.js'] } });
  const original = e.runClaudeStream;
  let sessoes = 0;
  e.runClaudeStream = async (...args) => { sessoes++; return original(...args); };
  await e.runHeadlessReview({ ...PR });
  assert.equal(sessoes, 1, 'uma sessão só');
  assert.equal(envios.length, 1, JSON.stringify(e.eventos));
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(envios[0].commit_id, HEAD);
  const aprovado = e.eventos.find((x) => x[0] === 'auto-approved');
  assert.ok(aprovado, JSON.stringify(e.eventos));
  const deCobertura = aprovado[2].filter((t) => /cobertura da leitura/i.test(t));
  assert.equal(deCobertura.length, 1, `a ressalva da cobertura sai uma vez: ${aprovado[2].join(' | ')}`);
  assert.match(deCobertura[0], /^faltou prova nesta revisão, então segue como ressalva: a cobertura da leitura tem \d+ pendência\(s\): src\/b\.js/);
  assert.equal(pendente(e), undefined, 'nada fica pendente');
  assert.equal(e.decisions.pending.some((d) => d.esperaProva), false, 'sem espera da prova');
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0, 'a varredura não relança nada');
  assert.equal(sessoes, 1, 'sem segunda sessão no mesmo commit');
  assert.equal(e.eventos.some((x) => x[0] === 'needs-decision'), false, 'ninguém foi chamado');
});

test('lacuna que não é dura na rodada 1 com a conta esperando você nas ressalvas: mesa com a ressalva, sem espera da prova', async () => {
  const e = motor(['approve', 'wait']);
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(envios, []);
  assert.equal(d.esperaProva, undefined);
  assert.deepEqual(d.approvalEvidence, [], 'nada segue exigido: o Aprovar da mesa fica com você');
  assert.ok(textos(d).some((t) => /^faltou prova nesta revisão, então segue como ressalva: protocolo de revisão não comprovado/.test(t)), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
  assert.equal(staleCardMeta(decisionForUi(d), null).approveDisabled, false);
});

test('falta de prova que segue exigida não é ressalva que transfere uma decisão ainda bloqueada', async () => {
  const e = motor(['approve', 'wait']);
  const d = await revisado(e, INCOMPLETA);
  assert.ok(d.esperaProva);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
  assert.equal(staleCardMeta(decisionForUi(d), null).approveDisabled, true, 'análise incompleta não libera o Aprovar');
  await esperaProva.reverQuandoAProvaMudar(e);
  await revisado(e, {});
  assert.equal(envios.length, 1);
  assert.equal(pendente(e), undefined);
});

// Os três casos abaixo são da conta que NÃO reprova sozinha (onReject: wait). Com ela
// reprovando sozinha, CI vermelho e defeito do PR viram REQUEST_CHANGES automático
// (test/decisao-sem-mesa.test.js, 18/10/2026).
test('a ressalva da rodada não converte CI vermelho: a aprovação espera o CI sozinha, sem postar e sem chamar ninguém', async () => {
  const e = motor();
  e.rejectPolicyFor = () => 'wait';
  e.bloqueadoPorChecks = async () => ({ faltando: [{ nome: 'test', estado: 'vermelho' }] });
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(envios, []);
  assert.ok(d.esperaCi, 'espera automática do CI');
  assert.equal(d.esperaProva, undefined);
  assert.deepEqual(e.eventos, []);
});

test('a ressalva da rodada não converte violação técnica confirmada: com a conta sem reprovar sozinha, vai para a mesa', async () => {
  const e = motor();
  e.rejectPolicyFor = () => 'wait';
  technicalRuntime.finishTechnicalReview = async (ctx) => ({ ...technicalReport(ctx.head, ctx.repo), verdict: 'fail', rules: [{ rule: 'x', verdict: 'fail' }] });
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(envios, []);
  assert.equal(d.esperaProva, undefined);
  assert.ok(textos(d).includes('violação técnica confirmada'), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('a ressalva da rodada não converte a parte do card deste PR dita não entregue: com a conta sem reprovar sozinha, vai para a mesa', async () => {
  const e = motor();
  e.rejectPolicyFor = () => 'wait';
  const d = await revisado(e, { ...SEM_PROTOCOLO, card: 'CARD-1', cardMet: false, cardParteDestePr: false });
  assert.deepEqual(envios, []);
  assert.equal(d.esperaProva, undefined, 'defeito do PR não é recuperação');
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

// Revisão independente de 06/11/2026: sem diff medido a cobertura volta a ser só o que o modelo
// declarou, e sem relatório técnico (com declaração cadastrada) nada foi avaliado. Os dois seguem
// exigidos e na recuperação, mesmo com toda rodada decidindo; sem declaração continua ressalva.
test('diff não medido e avaliação técnica ausente seguem exigidos na 1ª rodada; sem declaração segue ressalva', () => {
  const base = { headSha: HEAD, ...criteriaFixture('approve'), analysisStatus: 'complete', checksVerifiedHead: HEAD, diffMedido: [],
    verificationCheckpoint: { total: 0, conflicts: [] }, technicalReview: technicalReport(HEAD), protocolo: { prReviewer: 'rodou' },
    coverage: { total: 0, reviewed: [], missing: [] }, provaEsgotada: true };
  assert.deepEqual(busca.lacunasExigidas(base), [], 'controle');
  const semDiff = { ...base, diffMedido: undefined };
  assert.deepEqual(busca.lacunasExigidas(semDiff), ['diff não medido independentemente']);
  assert.deepEqual(busca.pontosDaProvaEsgotada(semDiff), [], 'não vira ressalva');
  const semRelatorio = { ...base, technicalReview: null };
  assert.deepEqual(busca.lacunasExigidas(semRelatorio), ['avaliação técnica atual ausente']);
  assert.deepEqual(busca.pontosDaProvaEsgotada(semRelatorio), [], 'não vira ressalva');
  assert.ok(armou(motor(), semRelatorio), 'entra na recuperação');
  assert.ok(armou(motor(), semDiff), 'entra na recuperação');
  const semDeclaracao = { ...base, technicalReview: { semDeclaracao: true } };
  assert.deepEqual(busca.lacunasExigidas(semDeclaracao), [], 'repositório sem declaração segue ressalva');
});

// Edicoes-CNBB/biblioteca-cnbb-web#182, 05/11/2026: a mesma divergência entre passadas, num
// arquivo inalterado, voltou em 7 commits e cada um gastou as duas buscas antes de virar
// ressalva. O checkpoint é só de acréscimo: outra tentativa nunca desfaz a divergência.
const DIVERGENCIA = 'divergência de veredito em src/a.ts:75 ("o alerta some ao salvar") entre passadas de verificação';
function comDivergencia(extra) {
  return { headSha: HEAD, ...criteriaFixture('approve'), analysisStatus: 'complete', checksVerifiedHead: HEAD, diffMedido: [],
    verificationCheckpoint: { total: 2, confirmedCount: 1, conflicts: [{ entries: [{ file: 'src/a.ts', line: 75, claim: 'o alerta some ao salvar' }] }] },
    technicalReview: technicalReport(HEAD), protocolo: { prReviewer: 'rodou' }, coverage: { total: 0, reviewed: [], missing: [] },
    verdict: 'approve', reasons: [], ...extra };
}
const armou = (e, r) => esperaProva.armarEspera(e, { ...PR }, 'prova_tecnica_incompleta', { ...r, approvalEvidence: busca.lacunasExigidas(r) }, busca.pontosDaProvaEsgotada(r));

test('divergência entre passadas sozinha vira ressalva já, sem nova busca', () => {
  const r = comDivergencia();
  assert.deepEqual(busca.lacunasExigidas(r), []);
  assert.deepEqual(busca.pontosDaProvaEsgotada(r).map((p) => p.text),
    [`outra tentativa não desfaz a divergência entre passadas, então segue como ressalva: ${DIVERGENCIA}`]);
  assert.equal(armou(motor(), r), null);
});

test('divergência junto de outra lacuna de prova: a busca continua pela outra', () => {
  const r = comDivergencia({ protocolo: { prReviewer: 'pulado' } });
  assert.deepEqual(busca.lacunasExigidas(r), [DIVERGENCIA, 'protocolo de revisão não comprovado']);
  assert.deepEqual(busca.pontosDaProvaEsgotada(r), []);
  assert.ok(armou(motor(), r));
});

test('divergência não dispensa lacuna dura nem violação', () => {
  const duro = comDivergencia({ cardParteDestePr: false });
  assert.deepEqual(busca.lacunasExigidas(duro), ['a parte do card que cabe a este PR não foi comprovada']);
  const violada = comDivergencia({ technicalReview: { ...technicalReport(HEAD), findings: [{ x: 1 }] } });
  assert.deepEqual(busca.lacunasExigidas(violada), ['achados técnicos não resolvidos']);
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
  // A execução que não concluiu é a lacuna que a rodada dispensa; relatório sem ferramenta
  // nenhuma (avaliação técnica atual ausente) segue exigido desde 06/11/2026 (abaixo).
  // com a identidade da regra que o runtime grava na falha (runtime.js, identidadeDaFalha)
  const semContexto = { schema: 1, verdict: 'not-run', failure: 'assessment', error: 'ferramenta ausente',
    version: report.version, toolCommit: report.toolCommit, profile: report.profile };
  const comPedido = motor(semContexto, { bloqueadoPorHistorico: async () => ({ bloqueado: false, decisivos: [], pediramMudancas: ['colega'] }) });
  assert.equal(await approvalRefusal(comPedido, pr, payload), null);
  const semPedido = motor(semContexto, { bloqueadoPorHistorico: async () => ({ bloqueado: false, decisivos: [] }) });
  assert.equal(await approvalRefusal(semPedido, pr, payload), null);
  const semFerramenta = await approvalRefusal(motor({ schema: 1, verdict: 'not-run', error: 'ferramenta ausente' }), pr, payload);
  assert.equal(semFerramenta && semFerramenta.error, 'avaliação técnica atual ausente', 'com declaração, sem avaliação nenhuma não é ressalva');
  assert.equal(semFerramenta.needsReview, true);
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
  assert.match(esgotada.technical.message, /avaliação técnica inconclusiva; segue como ressalva desta revisão/);
  assert.equal(staleCardMeta(esgotada, null).approveDisabled, false);
  const exigida = decisionForUi(base);
  assert.equal(exigida.technical.state, 'pending', 'sem esgotar, segue exigida');
  assert.equal(staleCardMeta(exigida, null).approveDisabled, true);
  const violada = decisionForUi({ ...base, provaEsgotada: true, technicalReview: { ...inconclusivo, verdict: 'fail', rules: [{ rule: 'x', verdict: 'fail' }] } });
  assert.equal(violada.technical.state, 'violation', 'violação nunca vira ressalva');
  assert.equal(staleCardMeta(violada, null).approveDisabled, true);
});
