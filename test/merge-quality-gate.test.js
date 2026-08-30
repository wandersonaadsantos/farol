// P0a: a autoanálise deixa de AUTORIZAR merge. O parecer do modelo vira opinião e a
// elegibilidade de qualidade passa a ser CALCULADA pelo Farol sobre evidência.
//
// O defeito medido em 29/08/2026: o único gate de qualidade de todo o caminho de merge
// era `analysis.approvable !== true` (selfpr.js), um booleano produzido pelo LLM, e o
// mesmo gate servia o `--admin`, que bypassa branch protection. Ou seja, a proteção de
// branch deixava de ser segunda barreira justamente onde a decisão de qualidade era mais
// fraca. A regra estava copiada em QUATRO sítios (mergeSelfPR, refreshMergeStates, o
// fetch pós-análise e o canMerge da UI), então fechar só a porta do merge deixaria as
// autoridades derivadas de pé.
//
// Estes testes fixam a DECISÃO ARQUITETURAL, não a implementação: dada a mesma
// evidência, o valor de `approvable` não pode mudar o resultado.
//
// Espião no `run` instalado antes do require do server, mesma técnica do merge-gates.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-qualgate-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = await import('../server.js');
const { evaluateQualityEligibility } = await import('../lib/engine/selfpr.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const URL_PR = 'https://github.com/acme/app/pull/42';
const CHAVE = 'acme/app#42';
const SHA = 'f'.repeat(40);

// parecer do MODELO: o que ele tem direito de afirmar
function parecer(over = {}) {
  return { approvable: true, blockers: [], cardMet: true, headSha: SHA, ...over };
}

// evidência do ENGINE: o que o app sabe objetivamente
function evidencia(over = {}) {
  return {
    headSha: SHA,
    sessionOutcome: 'complete',
    card: { requirement: 'readable', code: '' },
    scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js', 'src/b.js'], missing: [] },
    verification: { status: 'satisfied' },
    ...over
  };
}

const codes = (r) => (r.reasons || []).map(x => x.code).sort();

/* ---------- controle positivo ----------
   Sem este teste a suíte inteira passaria com uma função que sempre recusa, e aí ela
   provaria contenção sem provar gate. É o caso que separa "fechado" de "quebrado". */

test('evidência completa e sem blocker é elegível', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia());
  assert.equal(r.status, 'eligible');
  assert.deepEqual(r.reasons, []);
});

/* ---------- evidência faltando: inconclusive ---------- */

test('registro legado, sem evidência nenhuma do engine, é inconclusivo', () => {
  const r = evaluateQualityEligibility(parecer(), undefined);
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('COVERAGE_UNKNOWN'));
});

test('cobertura incompleta é inconclusivo e nomeia os arquivos que faltaram', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia({
    scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js'], missing: ['src/b.js'] }
  }));
  assert.equal(r.status, 'inconclusive');
  const motivo = r.reasons.find(x => x.code === 'COVERAGE_INCOMPLETE');
  assert.deepEqual(motivo.detail.missing, ['src/b.js']);
});

test('sessão abortada é inconclusivo, mesmo com cobertura completa', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia({ sessionOutcome: 'aborted' }));
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('ANALYSIS_INCOMPLETE'));
});

/* ---------- evidência definitiva contra: ineligible ---------- */

test('blocker é evidência contra, não evidência faltando', () => {
  const r = evaluateQualityEligibility(parecer({ blockers: ['quebra o guard'] }), evidencia());
  assert.equal(r.status, 'ineligible');
  assert.deepEqual(codes(r), ['BLOCKER_PRESENT']);
});

test('blocker com cobertura faltando acumula as duas razões e ineligible vence', () => {
  const r = evaluateQualityEligibility(
    parecer({ blockers: ['quebra o guard', 'regressão no hub'] }),
    evidencia({ scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js'], missing: ['src/b.js'] } })
  );
  assert.equal(r.status, 'ineligible', 'prioridade: ineligible > inconclusive > eligible');
  assert.deepEqual(codes(r), ['BLOCKER_PRESENT', 'COVERAGE_INCOMPLETE']);
  assert.equal(r.reasons.find(x => x.code === 'BLOCKER_PRESENT').detail.count, 2);
});

/* ---------- card e verificação: quatro valores, não três ---------- */

test('card não atendido é ineligible; card desconhecido é inconclusivo', () => {
  const naoAtende = evaluateQualityEligibility(parecer({ cardMet: false }), evidencia());
  assert.equal(naoAtende.status, 'ineligible');
  assert.ok(codes(naoAtende).includes('CARD_UNSATISFIED'));

  const desconhecido = evaluateQualityEligibility(parecer({ cardMet: null }), evidencia());
  assert.equal(desconhecido.status, 'inconclusive');
  assert.ok(codes(desconhecido).includes('CARD_UNKNOWN'));
});

test('verificação que falhou é ineligible; exigida e não executada é inconclusivo', () => {
  const falhou = evaluateQualityEligibility(parecer(), evidencia({ verification: { status: 'failed' } }));
  assert.equal(falhou.status, 'ineligible');
  assert.ok(codes(falhou).includes('VERIFICATION_FAILED'));

  const naoRodou = evaluateQualityEligibility(parecer(), evidencia({ verification: { status: 'unknown' } }));
  assert.equal(naoRodou.status, 'inconclusive');
  assert.ok(codes(naoRodou).includes('VERIFICATION_MISSING'));
});

test('verificação não aplicável pela política satisfaz, não bloqueia', () => {
  const r = evaluateQualityEligibility(parecer(), evidencia({ verification: { status: 'not_applicable' } }));
  assert.equal(r.status, 'eligible');
});

/* ---------- a decisão arquitetural ---------- */

test('approvable não tem autoridade: mesma evidência, mesmo resultado', () => {
  const cenarios = [
    evidencia(),
    evidencia({ scope: { total: ['a'], reviewed: [], missing: ['a'] } })
  ];
  for (const ev of cenarios) {
    const comTrue = evaluateQualityEligibility(parecer({ approvable: true }), ev);
    const comFalse = evaluateQualityEligibility(parecer({ approvable: false }), ev);
    assert.equal(comTrue.status, comFalse.status, 'o parecer do modelo não muda a elegibilidade');
    assert.deepEqual(codes(comTrue), codes(comFalse));
  }
});

/* ---------- estrutura inválida NUNCA vira satisfação ----------
   Esta bateria é a condição para o parser estrito sair da contenção e virar P1: se a
   função pura já falha fechada contra dado malformado do modelo, o parser deixa de ser
   a única defesa. Dado inválido tem que virar "não sei", nunca "está tudo certo". */

test('blockers ausente, null ou não-lista é desconhecido, não é "sem blocker"', () => {
  for (const valor of [undefined, null, 'nenhum', 0, {}]) {
    const a = parecer();
    if (valor === undefined) delete a.blockers; else a.blockers = valor;
    const r = evaluateQualityEligibility(a, evidencia());
    assert.notEqual(r.status, 'eligible', `blockers=${JSON.stringify(valor)} não pode liberar`);
    assert.ok(codes(r).includes('BLOCKERS_UNKNOWN'), `blockers=${JSON.stringify(valor)}`);
  }
});

test('lista vazia de blockers é declaração legítima de "não achei nada"', () => {
  const r = evaluateQualityEligibility(parecer({ blockers: [] }), evidencia());
  assert.equal(r.status, 'eligible');
});

test('cardMet como string não é coercido para atendido', () => {
  const r = evaluateQualityEligibility(parecer({ cardMet: 'true' }), evidencia());
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('CARD_UNKNOWN'));
});

test('cobertura malformada cai em desconhecida, não em completa', () => {
  const malformadas = [
    { total: 'src/a.js', reviewed: ['src/a.js'], missing: [] },
    { total: ['src/a.js'], reviewed: 'src/a.js', missing: [] },
    { reviewed: [], missing: [] },
    'completa'
  ];
  for (const scope of malformadas) {
    const r = evaluateQualityEligibility(parecer(), evidencia({ scope }));
    assert.equal(r.status, 'inconclusive', `scope=${JSON.stringify(scope)}`);
    assert.ok(codes(r).includes('COVERAGE_UNKNOWN'));
  }
});

test('verificação em formato inesperado não satisfaz', () => {
  for (const verification of ['satisfied', null, {}, { status: 'sim' }]) {
    const r = evaluateQualityEligibility(parecer(), evidencia({ verification }));
    assert.equal(r.status, 'inconclusive', `verification=${JSON.stringify(verification)}`);
    assert.ok(codes(r).includes('VERIFICATION_MISSING'));
  }
});

test('contradição verdict x approvable não muda a elegibilidade', () => {
  // A contradição deixou de ser autoridade contraditória (nenhum dos dois autoriza),
  // então ela é registro ruim, assunto do parser, e não deste gate.
  const base = { blockers: [], cardMet: true };
  const contraditorios = [
    { verdict: 'needs_work', approvable: true },
    { verdict: 'approvable', approvable: false },
    { verdict: 'aprovável', approvable: true }
  ];
  const esperado = evaluateQualityEligibility({ ...base }, evidencia());
  for (const extra of contraditorios) {
    const r = evaluateQualityEligibility({ ...base, ...extra }, evidencia());
    assert.equal(r.status, esperado.status, JSON.stringify(extra));
    assert.deepEqual(codes(r), codes(esperado));
  }
});

/* ---------- integração: as portas ---------- */

function prView(over = {}) {
  return JSON.stringify({
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    author: { login: 'eu' }, headRefName: 'feature/x', baseRefName: 'develop',
    title: 'PR de teste', ...over
  });
}

function roteador() {
  return (cmd, args) => {
    const sub = args.join(' ');
    if (sub.startsWith('pr view')) return Promise.resolve({ ok: true, stdout: prView(), stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
}

function novoEngine(analise) {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.config.mergeBlockedRepos = [];
  engine.selfAnalyses = { [CHAVE]: analise };
  engine.myPRs = [{ key: CHAVE, repo: 'acme/app', url: URL_PR }];
  engine.saveSelfAnalyses = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  return engine;
}

const mergeChamado = () => chamadas.filter(c => c.args.join(' ').startsWith('pr merge'));

beforeEach(() => { chamadas.length = 0; runImpl = null; });

test('mergeSelfPR recusa análise approvable:true sem cobertura comprovada', async () => {
  runImpl = roteador();
  const r = await novoEngine({ key: CHAVE, approvable: true }).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'nenhum merge tentado');
});

test('--admin não reduz o gate de qualidade', async () => {
  runImpl = roteador();
  const analise = {
    key: CHAVE, approvable: true,
    observed: { sessionOutcome: 'complete', scope: { total: ['a', 'b'], reviewed: ['a'], missing: ['b'] } }
  };
  const r = await novoEngine(analise).mergeSelfPR(URL_PR, { mode: 'admin' });
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'admin não pode furar o gate de qualidade');
});

test('contradição interna (approvable true com blocker) recusa', async () => {
  runImpl = roteador();
  const analise = {
    key: CHAVE, approvable: true, blockers: ['quebra o guard'], cardMet: true,
    observed: evidencia()
  };
  const r = await novoEngine(analise).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0);
});

/* ---------- a fronteira com a UI ----------
   `quality` é estado DERIVADO e não pode ser persistido: gravado no disco, um registro
   marcado eligible sobreviveria à evidência que o justificava. O disco guarda o parecer
   bruto; quem calcula é a projeção, agora, a cada snapshot. */

test('o snapshot publica quality calculado, e o disco continua só com o parecer', () => {
  const engine = novoEngine({ key: CHAVE, approvable: true }); // sem observed
  const publicado = engine.snapshot().selfAnalyses[CHAVE];
  assert.equal(publicado.quality.status, 'inconclusive');
  assert.ok(publicado.quality.reasons.some(r => r.code === 'COVERAGE_UNKNOWN'));
  assert.equal(publicado.approvable, true, 'o parecer segue publicado, como parecer');
  assert.equal(engine.selfAnalyses[CHAVE].quality, undefined, 'nada de quality no registro persistido');
});

test('o snapshot recalcula: mesma análise com evidência completa publica eligible', () => {
  const engine = novoEngine({
    key: CHAVE, approvable: false, blockers: [], cardMet: true, headSha: SHA, observed: evidencia()
  });
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].quality.status, 'eligible',
    'approvable false não impede: quem decide é a evidência');
});

test('autoridade derivada: refreshMergeStates não consulta o gh para análise inelegível', async () => {
  runImpl = roteador();
  const engine = novoEngine({ key: CHAVE, approvable: true }); // sem observed = inconclusivo
  let consultou = 0;
  engine.fetchMergeState = async () => { consultou++; return null; };
  engine.fetchAutoMergeAllowed = async () => false;
  await engine.refreshMergeStates();
  assert.equal(consultou, 0, 'PR inelegível não pode nem entrar na lista de alvos');
});

/* ================= P0b: o contrato de `observed` ================= */

/* ---------- freshness: a evidência pertence ao snapshot analisado ---------- */

test('observed de outro head não produz eligible', () => {
  const a = parecer({ headSha: 'b'.repeat(40) });
  const o = evidencia({ headSha: 'a'.repeat(40) });
  const r = evaluateQualityEligibility(a, o);
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('EVIDENCE_STALE'));
});

test('evidência sem headSha não prova pertencer ao snapshot', () => {
  const a = parecer({ headSha: 'a'.repeat(40) });
  const r = evaluateQualityEligibility(a, evidencia({ headSha: '' }));
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('EVIDENCE_STALE'));
});

test('mesmo head nos dois lados libera a dimensão', () => {
  const sha = 'a'.repeat(40);
  const r = evaluateQualityEligibility(parecer({ headSha: sha }), evidencia({ headSha: sha }));
  assert.equal(r.status, 'eligible');
});

/* ---------- desfecho da sessão é do engine ---------- */

test('cancelamento e erro nunca satisfazem o desfecho', () => {
  for (const outcome of ['cancelled', 'failed', 'unknown', '', null, undefined, 'complete ']) {
    const r = evaluateQualityEligibility(parecer(), evidencia({ sessionOutcome: outcome }));
    assert.notEqual(r.status, 'eligible', `outcome=${JSON.stringify(outcome)}`);
    assert.ok(codes(r).includes('ANALYSIS_INCOMPLETE'));
  }
});

/* ---------- o modelo só REDUZ cobertura, nunca amplia ---------- */

test('limitação declarada pelo modelo reduz a cobertura observada', () => {
  const a = parecer({ coverageLimitations: ['src/b.js'] });
  const o = evidencia({ scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js', 'src/b.js'], missing: [] } });
  const r = evaluateQualityEligibility(a, o);
  assert.equal(r.status, 'inconclusive');
  const motivo = r.reasons.find(x => x.code === 'COVERAGE_INCOMPLETE');
  assert.deepEqual(motivo.detail.missing, ['src/b.js']);
});

test('o modelo não amplia cobertura: arquivo que o engine não observou não conta', () => {
  // o parecer alega ter avaliado os dois; o engine só observou um
  const a = parecer({ coverageClaimed: ['src/a.js', 'src/b.js'], coverageLimitations: [] });
  const o = evidencia({ scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js'], missing: ['src/b.js'] } });
  const r = evaluateQualityEligibility(a, o);
  assert.equal(r.status, 'inconclusive');
  assert.ok(codes(r).includes('COVERAGE_INCOMPLETE'));
});

test('limitação em formato inválido não é ignorada em silêncio', () => {
  for (const lim of ['src/b.js', 42, {}]) {
    const r = evaluateQualityEligibility(parecer({ coverageLimitations: lim }), evidencia());
    assert.equal(r.status, 'inconclusive', JSON.stringify(lim));
    assert.ok(codes(r).includes('COVERAGE_LIMITS_MALFORMED'));
  }
});

test('limitação ausente ou lista vazia é o caso normal e não penaliza', () => {
  assert.equal(evaluateQualityEligibility(parecer(), evidencia()).status, 'eligible');
  assert.equal(evaluateQualityEligibility(parecer({ coverageLimitations: [] }), evidencia()).status, 'eligible');
});

/* ================= parser estrito (dependência do primeiro eligible) ================= */

const { parseSelfResult } = await import('../lib/engine/selfpr.js');
const envelopeOk = {
  verdict: 'approvable', approvable: true, cardMet: true,
  blockers: [], tips: [], coverageLimitations: [], reportMarkdown: '# ok', summary: 's'
};
const parse = (over) => parseSelfResult({ parseEnvelope: (t) => t }, JSON.stringify({ ...envelopeOk, ...over }));

test('envelope válido passa e mantém os campos estruturados', () => {
  const d = parse({});
  assert.equal(d.verdict, 'approvable');
  assert.deepEqual(d.blockers, []);
  assert.deepEqual(d.coverageLimitations, []);
});

test('verdict fora do enum é recusado, inclusive o legado em português', () => {
  for (const verdict of ['aprovável', 'approve', '', null, 42, 'APPROVABLE']) {
    assert.throws(() => parse({ verdict }), /contrato/i, `verdict=${JSON.stringify(verdict)}`);
  }
});

test('blockers precisa ser lista de verdade; conveniência não vira lista vazia', () => {
  for (const blockers of ['nenhum', null, 0, {}, [1, 2]]) {
    assert.throws(() => parse({ blockers }), /contrato/i, `blockers=${JSON.stringify(blockers)}`);
  }
  assert.doesNotThrow(() => parse({ blockers: ['x'], verdict: 'needs_work', approvable: false }));
});

test('cardMet só aceita booleano ou null explícito, nunca coerção', () => {
  for (const cardMet of ['true', 1, 0, 'sim', {}]) {
    assert.throws(() => parse({ cardMet }), /contrato/i, `cardMet=${JSON.stringify(cardMet)}`);
  }
  for (const cardMet of [true, false, null]) assert.doesNotThrow(() => parse({ cardMet }));
});

test('ausência de campo obrigatório não vira vazio', () => {
  for (const campo of ['verdict', 'blockers', 'reportMarkdown']) {
    const env = { ...envelopeOk };
    delete env[campo];
    assert.throws(() => parseSelfResult({ parseEnvelope: (t) => t }, JSON.stringify(env)), /contrato/i, campo);
  }
});

test('coverageLimitations tem que ser lista de caminhos quando vier', () => {
  for (const lim of ['src/a.js', 42, [1], {}]) {
    assert.throws(() => parse({ coverageLimitations: lim }), /contrato/i, JSON.stringify(lim));
  }
  assert.doesNotThrow(() => parse({ coverageLimitations: ['src/a.js'] }));
  const semCampo = { ...envelopeOk };
  delete semCampo.coverageLimitations;
  assert.doesNotThrow(() => parseSelfResult({ parseEnvelope: (t) => t }, JSON.stringify(semCampo)));
});

test('o parser não deixa a contradição virar dado válido', () => {
  assert.throws(() => parse({ verdict: 'approvable', approvable: false }), /contrato/i);
  assert.throws(() => parse({ verdict: 'needs_work', approvable: true }), /contrato/i);
  assert.throws(() => parse({ verdict: 'approvable', blockers: ['x'] }), /contrato/i);
});

/* ================= P0b: a restauração, e o que continua recusando ================= */

function analiseCompleta(over = {}) {
  const head = over.headSha === undefined ? 'e'.repeat(40) : over.headSha;
  return {
    key: CHAVE, approvable: true, verdict: 'approvable', blockers: [], cardMet: true,
    coverageLimitations: [], headSha: head,
    observed: {
      headSha: head, sessionOutcome: 'complete',
      scope: { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js', 'src/b.js'], missing: [] },
      verification: { status: 'satisfied', confirmed: 2, refuted: 0 },
      card: { requirement: 'readable', code: '' }
    },
    ...over
  };
}

test('RESTAURAÇÃO: evidência observada, completa e fresca volta a liberar o merge', async () => {
  runImpl = roteador();
  const engine = novoEngine(analiseCompleta());
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].quality.status, 'eligible');
  const r = await engine.mergeSelfPR(URL_PR);
  assert.equal(r.ok, true, r.error);
  assert.equal(mergeChamado().length, 1, 'o merge acontece de verdade');
});

test('a mesma análise com cobertura incompleta continua recusando', async () => {
  runImpl = roteador();
  const analise = analiseCompleta();
  analise.observed.scope = { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js'], missing: ['src/b.js'] };
  const r = await novoEngine(analise).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /COVERAGE_INCOMPLETE/);
  assert.equal(mergeChamado().length, 0);
});

test('a mesma análise com verificação refutada continua recusando', async () => {
  runImpl = roteador();
  const analise = analiseCompleta();
  analise.observed.verification = { status: 'failed', confirmed: 1, refuted: 1 };
  const r = await novoEngine(analise).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /VERIFICATION_FAILED/);
  assert.equal(mergeChamado().length, 0);
});

test('a mesma análise com evidência de outro head continua recusando', async () => {
  runImpl = roteador();
  const analise = analiseCompleta();
  analise.observed.headSha = 'd'.repeat(40); // evidência de um snapshot que não é o analisado
  const r = await novoEngine(analise).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /EVIDENCE_STALE/);
  assert.equal(mergeChamado().length, 0);
});

test('a mesma análise com sessão cancelada continua recusando', async () => {
  runImpl = roteador();
  const analise = analiseCompleta();
  analise.observed.sessionOutcome = 'cancelled';
  const r = await novoEngine(analise).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /ANALYSIS_INCOMPLETE/);
  assert.equal(mergeChamado().length, 0);
});

test('--admin continua sem reduzir o gate de qualidade depois da restauração', async () => {
  runImpl = roteador();
  const analise = analiseCompleta();
  analise.observed.scope = { total: ['src/a.js', 'src/b.js'], reviewed: ['src/a.js'], missing: ['src/b.js'] };
  const r = await novoEngine(analise).mergeSelfPR(URL_PR, { mode: 'admin' });
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'admin nunca fura qualidade, só proteção de branch');
});

test('limitação declarada pelo modelo derruba um merge que sem ela passaria', async () => {
  runImpl = roteador();
  const r = await novoEngine(analiseCompleta({ coverageLimitations: ['src/b.js'] })).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false, 'o modelo consegue SUBTRAIR cobertura');
  assert.match(r.error, /COVERAGE_INCOMPLETE/);
});

/* ================= Jira NÃO é obrigatório (decisão de produto, 29/08/2026) =================
   Quem diz se EXISTE requisito de card é o ENGINE (ele é quem chama o Jira e sabe por que
   não leu); quem diz se o requisito foi ATENDIDO continua sendo o modelo. Sem essa divisão,
   `cardMet: null` seria ambíguo entre "não há card aqui" e "não consegui ler", e as duas
   coisas têm desfechos opostos. */

const cardEng = (requirement, code) => ({ card: { requirement, code } });

test('repo sem cultura de card (sem chave no PR) não exige card', () => {
  const r = evaluateQualityEligibility(parecer({ cardMet: null }), evidencia(cardEng('not_required', 'sem_chave')));
  assert.equal(r.status, 'eligible', 'Jira não é obrigatório');
  assert.deepEqual(r.reasons, []);
});

test('Jira desligado no app não exige card', () => {
  const r = evaluateQualityEligibility(parecer({ cardMet: null }), evidencia(cardEng('not_required', 'desligado')));
  assert.equal(r.status, 'eligible');
});

test('org sem site do Jira ligado não exige card', () => {
  const r = evaluateQualityEligibility(parecer({ cardMet: null }), evidencia(cardEng('not_required', 'site_nao_configurado')));
  assert.equal(r.status, 'eligible');
});

test('card que EXISTE e o Farol não conseguiu ler continua inconclusivo', () => {
  for (const code of ['sem_credencial', 'nao_encontrado', 'sem_permissao', 'timeout', 'indisponivel']) {
    const r = evaluateQualityEligibility(parecer({ cardMet: null }), evidencia(cardEng('unreadable', code)));
    assert.equal(r.status, 'inconclusive', code);
    assert.ok(codes(r).includes('CARD_UNKNOWN'));
  }
});

test('card lido: quem decide se foi atendido continua sendo o modelo', () => {
  const lido = evidencia(cardEng('readable', ''));
  assert.equal(evaluateQualityEligibility(parecer({ cardMet: true }), lido).status, 'eligible');
  assert.equal(evaluateQualityEligibility(parecer({ cardMet: false }), lido).status, 'ineligible');
  assert.equal(evaluateQualityEligibility(parecer({ cardMet: null }), lido).status, 'inconclusive');
});

test('card não atendido é ineligible mesmo quando o requisito seria dispensável', () => {
  // o modelo achou um card e disse que não atende: dispensa do requisito não apaga achado
  const r = evaluateQualityEligibility(parecer({ cardMet: false }), evidencia(cardEng('not_required', 'sem_chave')));
  assert.equal(r.status, 'ineligible');
  assert.ok(codes(r).includes('CARD_UNSATISFIED'));
});

test('evidência de card ausente ou inválida falha fechada, nunca dispensa', () => {
  for (const card of [undefined, null, {}, 'not_required', { requirement: 'qualquer' }]) {
    const o = evidencia(); delete o.card; if (card !== undefined) o.card = card;
    const r = evaluateQualityEligibility(parecer({ cardMet: null }), o);
    assert.equal(r.status, 'inconclusive', JSON.stringify(card));
    assert.ok(codes(r).includes('CARD_UNKNOWN'));
  }
});

/* ---------- o CLASSIFICADOR, e não só o avaliador ----------
   A bateria acima passa a exigência já classificada, então ela não cobre o mapa
   código-do-Jira -> exigência. Uma mutação que jogasse `sem_credencial` na lista de
   dispensa passou verde na primeira versão destes testes: dispensa de requisito por
   falha de credencial é exatamente o furo que a decisão de produto NÃO autoriza. */

const { cardEvidence } = await import('../lib/engine/selfpr.js');

test('só os três códigos silenciosos dispensam o card; qualquer outro é ilegível', () => {
  for (const code of ['desligado', 'site_nao_configurado', 'sem_chave']) {
    assert.equal(cardEvidence({ ok: false, code }).requirement, 'not_required', code);
  }
  for (const code of ['sem_credencial', 'nao_encontrado', 'sem_permissao', 'timeout',
    'indisponivel', 'resposta_invalida', 'falha_interna', 'codigo_que_nao_existe', '']) {
    assert.equal(cardEvidence({ ok: false, code }).requirement, 'unreadable', code);
  }
});

test('card lido é readable; ausência de resposta do Jira falha fechada', () => {
  assert.equal(cardEvidence({ ok: true, card: {} }).requirement, 'readable');
  assert.equal(cardEvidence(null).requirement, 'unreadable');
  assert.equal(cardEvidence(undefined).requirement, 'unreadable');
});

/* ================= P1: uma fonte de verdade pro parecer =================
   `verdict` e `approvable` diziam a mesma coisa em dois campos. Deixou de ser
   perigoso no P0a (nenhum dos dois autoriza), mas duas fontes continuam sendo duas
   chances de divergir. `verdict` passa a ser o persistido e `approvable` é derivado
   na leitura, mantendo o contrato da UI. */

test('o registro novo persiste só verdict; approvable vem derivado na projeção', () => {
  const engine = novoEngine(analiseCompleta({ approvable: undefined }));
  delete engine.selfAnalyses[CHAVE].approvable;
  const publicado = engine.snapshot().selfAnalyses[CHAVE];
  assert.equal(publicado.approvable, true, 'derivado de verdict, pra UI não mudar');
  assert.equal(engine.selfAnalyses[CHAVE].approvable, undefined, 'e não volta pro disco');
});

test('needs_work deriva approvable false', () => {
  const engine = novoEngine(analiseCompleta({ verdict: 'needs_work', approvable: undefined }));
  delete engine.selfAnalyses[CHAVE].approvable;
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].approvable, false);
});

test('registro LEGADO com verdict fora do enum preserva o approvable gravado', () => {
  // 'aprovável' é o verdict que o contrato antigo escrevia; derivar dele daria false
  // e o histórico passaria a mentir na tela. Compatibilidade na leitura, sem migração.
  const engine = novoEngine({ key: CHAVE, verdict: 'aprovável', approvable: true, blockers: [] });
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].approvable, true);
});

test('a derivação não toca na elegibilidade', () => {
  const engine = novoEngine(analiseCompleta({ verdict: 'needs_work', approvable: undefined }));
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].quality.status, 'eligible',
    'o parecer segue sem autorizar nem impedir: quem decide é a evidência');
});
