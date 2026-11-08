// A faixa de prontidão dos PRs (07/11/2026): checks obrigatórios, reviewers e merge.
// A tabela de estados inteira do spec (docs/superpowers/specs/2026-11-07-meus-prs-prontidao-design.md)
// sai do interpretador puro; a leitura em lote e o cache da regra da branch são exercitados
// com o gh falso, sem rede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-prontidao-'));

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const {
  interpretarProntidao, regraDaResposta, mergeDaProntidao, emTransicao, projetarProntidao, FRAGMENTO_PRONTIDAO,
} = await import('../lib/engine/prontidao-pr-estado.js');
const { refreshProntidao, regraDaBranch, precisaLer } = await import('../lib/engine/prontidao-pr.js');
const { reviewStatesGh } = await import('../lib/engine/radar-na-tela.js');

after(() => fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }));

const HEAD = 'h-atual';
const run = (name, status, conclusion, startedAt = '2026-11-07T10:00:00Z') => ({ __typename: 'CheckRun', name, status, conclusion, startedAt });
const verde = name => run(name, 'COMPLETED', 'SUCCESS');
const review = (login, state, oid = HEAD) => ({ author: { login }, state, commit: { oid }, submittedAt: '2026-11-07T10:00:00Z' });

function no(extra = {}) {
  const { contexts = [], reviews = [], pedidos = [], ...resto } = extra;
  return {
    number: 7, updatedAt: '2026-11-07T10:00:00Z', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    reviewDecision: null, baseRefName: 'develop', headRefOid: HEAD, author: { login: 'autora' },
    repository: { nameWithOwner: 'acme/app' },
    reviewRequests: { nodes: pedidos.map(p => ({ requestedReviewer: p.startsWith('time:') ? { __typename: 'Team', slug: p.slice(5) } : { __typename: 'User', login: p } })) },
    latestReviews: { nodes: reviews },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: contexts } } } }] },
    ...resto,
  };
}
const REGRA2 = { legivel: true, temRegraDeReview: true, aprovacoes: 2, codeOwner: false, checks: ['build', 'test'] };
const interp = (n, ctx = {}) => interpretarProntidao(n, { exigidos: ['build', 'test'], regra: REGRA2, eu: 'eu', at: 1, ...ctx });

// --- checks obrigatórios ---------------------------------------------------------------------

test('checks: todos verdes, contando só os exigidos (sonar fora da exigência não pesa)', () => {
  const r = interp(no({ contexts: [verde('build'), verde('test'), run('sonar', 'COMPLETED', 'FAILURE')] }));
  assert.equal(r.checks.tom, 'ok');
  assert.equal(r.checks.total, 2);
  assert.equal(r.checks.verdes, 2);
});

test('checks: rodando x falhou x nunca reportado, e a precedência entre eles', () => {
  const rodando = interp(no({ contexts: [verde('build'), run('test', 'IN_PROGRESS', null)] }));
  assert.equal(rodando.checks.tom, 'run');
  const ausente = interp(no({ contexts: [verde('build')] }));
  assert.equal(ausente.checks.tom, 'wait');
  assert.deepEqual(ausente.checks.lista, [{ nome: 'build', estado: 'verde' }, { nome: 'test', estado: 'ausente' }]);
  const falhou = interp(no({ contexts: [run('build', 'COMPLETED', 'FAILURE'), run('test', 'IN_PROGRESS', null)] }));
  assert.equal(falhou.checks.tom, 'fail', 'falhou vence rodando');
});

test('checks: a rodada mais recente de cada nome vence (job relançado)', () => {
  const r = interp(no({ contexts: [
    run('build', 'COMPLETED', 'FAILURE', '2026-11-06T10:00:00Z'), run('build', 'COMPLETED', 'SUCCESS', '2026-11-07T10:00:00Z'), verde('test'),
  ] }));
  assert.equal(r.checks.tom, 'ok');
});

test('checks: SKIPPED e NEUTRAL contam como verde; status legado pendente é rodando', () => {
  const r = interp(no({ contexts: [run('build', 'COMPLETED', 'SKIPPED'), { __typename: 'StatusContext', context: 'test', state: 'PENDING', createdAt: '2026-11-07T10:00:00Z' }] }));
  assert.equal(r.checks.lista[0].estado, 'verde');
  assert.equal(r.checks.lista[1].estado, 'rodando');
});

test('checks: acrity/review fica fora da conta e é citado à parte', () => {
  const r = interp(no({ contexts: [verde('build')] }), { exigidos: ['build', 'acrity/review'] });
  assert.equal(r.checks.tom, 'ok');
  assert.equal(r.checks.total, 1);
  assert.deepEqual(r.checks.foraDaConta, ['acrity/review']);
});

test('checks: branch sem exigência e regra não legível são cinza, com a diferença no registro', () => {
  const sem = interp(no(), { exigidos: [] });
  assert.equal(sem.checks.tom, 'none');
  assert.equal(sem.checks.regraLegivel, true);
  const ilegivel = interp(no(), { exigidos: null, regra: null });
  assert.equal(ilegivel.checks.tom, 'none');
  assert.equal(ilegivel.checks.regraLegivel, false);
});

// --- reviewers ---------------------------------------------------------------------------------

test('reviewers: aprovações no head somam o exigido', () => {
  const r = interp(no({ reviews: [review('ana', 'APPROVED'), review('bia', 'APPROVED')] }));
  assert.equal(r.reviewers.tom, 'ok');
  assert.equal(r.reviewers.aprovadasNoHead, 2);
  assert.equal(r.reviewers.faltam, 0);
});

test('reviewers: aprovação em commit antigo não conta no head', () => {
  const r = interp(no({ reviews: [review('ana', 'APPROVED'), review('bia', 'APPROVED', 'h-velho')] }));
  assert.equal(r.reviewers.tom, 'wait');
  assert.equal(r.reviewers.aprovadasNoHead, 1);
  assert.equal(r.reviewers.aprovadasAntigas, 1);
  assert.equal(r.reviewers.lista.find(x => x.quem === 'bia').estado, 'aprovou-antigo');
});

test('reviewers: CHANGES_REQUESTED aberto trava, mesmo com o reviewer pedido de novo', () => {
  const r = interp(no({ pedidos: ['ana'], reviews: [review('ana', 'CHANGES_REQUESTED')] }));
  assert.equal(r.reviewers.tom, 'fail');
  assert.equal(r.reviewers.lista[0].estado, 'mudanca');
});

test('reviewers: pedido + time pelo slug + você; bot e a autora ficam fora', () => {
  const r = interp(no({ pedidos: ['eu', 'time:plataforma'], reviews: [review('acrity-ai', 'APPROVED'), review('dependabot[bot]', 'APPROVED'), review('autora', 'COMMENTED')] }));
  assert.deepEqual(r.reviewers.lista.map(x => [x.quem, x.time, x.voce, x.estado]), [
    ['eu', false, true, 'aguardando'], ['plataforma', true, false, 'aguardando'],
  ]);
  assert.equal(r.reviewers.tom, 'wait');
});

test('reviewers: ninguém marcado e branch sem exigência é cinza', () => {
  const r = interp(no(), { regra: { ...REGRA2, temRegraDeReview: false, aprovacoes: 0 } });
  assert.equal(r.reviewers.exigidas, null);
  assert.equal(r.reviewers.tom, 'none');
  assert.equal(r.reviewers.regraLegivel, true, 'sem reviewDecision o GitHub não exige nada');
});

test('reviewers: proteção clássica cai no reviewDecision e diz que a regra não é legível', () => {
  const semRegra = { legivel: true, temRegraDeReview: false, aprovacoes: 0, codeOwner: false, checks: [] };
  const exigida = interp(no({ reviewDecision: 'REVIEW_REQUIRED' }), { regra: semRegra });
  assert.equal(exigida.reviewers.tom, 'wait');
  assert.equal(exigida.reviewers.regraLegivel, false);
  const aprovada = interp(no({ reviewDecision: 'APPROVED', reviews: [review('ana', 'APPROVED')] }), { regra: null });
  assert.equal(aprovada.reviewers.tom, 'ok');
});

test('reviewers: code owner exigido segura até o GitHub dizer que a revisão foi dada', () => {
  const r = interp(no({ reviewDecision: 'REVIEW_REQUIRED', reviews: [review('ana', 'APPROVED'), review('bia', 'APPROVED')] }), { regra: { ...REGRA2, codeOwner: true } });
  assert.equal(r.reviewers.tom, 'wait');
});

// --- merge ---------------------------------------------------------------------------------------

const comTudo = { contexts: [verde('build'), verde('test')], reviews: [review('ana', 'APPROVED'), review('bia', 'APPROVED')] };

test('merge: CLEAN, UNSTABLE e HAS_HOOKS são pronto', () => {
  for (const status of ['CLEAN', 'UNSTABLE', 'HAS_HOOKS']) {
    assert.equal(interp(no({ ...comTudo, mergeStateStatus: status })).merge.motivo, 'pronto', status);
  }
});

test('merge: DRAFT, DIRTY e BEHIND', () => {
  assert.deepEqual([interp(no({ isDraft: true, mergeStateStatus: 'DRAFT' })).merge.tom, interp(no({ isDraft: true })).merge.motivo], ['none', 'rascunho']);
  const dirty = interp(no({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })).merge;
  assert.deepEqual([dirty.tom, dirty.motivo], ['fail', 'conflito']);
  const behind = interp(no({ mergeStateStatus: 'BEHIND' })).merge;
  assert.deepEqual([behind.tom, behind.motivo], ['wait', 'atras']);
});

test('merge: BLOCKED só por check rodando é azul', () => {
  const m = interp(no({ ...comTudo, contexts: [verde('build'), run('test', 'QUEUED', null)], mergeStateStatus: 'BLOCKED' })).merge;
  assert.deepEqual([m.tom, m.motivo, m.motivos], ['run', 'esperando-checks', ['esperando-checks']]);
});

test('merge: BLOCKED por review diz quantas aprovações faltam', () => {
  const m = interp(no({ contexts: comTudo.contexts, reviews: [review('ana', 'APPROVED')], mergeStateStatus: 'BLOCKED' })).merge;
  assert.deepEqual([m.tom, m.motivo, m.faltam], ['wait', 'falta-aprovacao', 1]);
});

test('merge: BLOCKED com check falhando e mudança pedida é vermelho, com os dois motivos', () => {
  const m = interp(no({ contexts: [run('build', 'COMPLETED', 'FAILURE'), verde('test')], reviews: [review('ana', 'CHANGES_REQUESTED')], mergeStateStatus: 'BLOCKED' })).merge;
  assert.equal(m.tom, 'fail');
  // a branch exige 2 aprovações e nenhuma está no head: falta aprovação também é motivo
  assert.deepEqual(m.motivos, ['check-falhando', 'mudanca-pedida', 'falta-aprovacao']);
});

test('merge: UNKNOWN é verificando, e o registro fica em transição', () => {
  const r = interp(no({ ...comTudo, mergeStateStatus: 'UNKNOWN' }));
  assert.deepEqual([r.merge.tom, r.merge.motivo], ['none', 'verificando']);
  assert.equal(emTransicao(r), true);
  assert.equal(emTransicao(interp(no(comTudo))), false);
});

test('nó vazio ou sem os campos da prontidão não quebra (forma antiga da busca)', () => {
  assert.equal(interpretarProntidao(null), null);
  const r = interpretarProntidao({ number: 1, mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' }, { exigidos: null });
  assert.equal(r.merge.motivo, 'conflito');
  assert.deepEqual(r.reviewers.lista, []);
});

test('projeção: mergeStates mais novo que o registro troca só a pílula Merge', () => {
  const reg = interp(no({ ...comTudo, mergeStateStatus: 'BEHIND' }));
  const proj = projetarProntidao({ k: reg }, { k: { status: 'CLEAN', mergeable: 'MERGEABLE', at: 99 } });
  assert.equal(proj.k.merge.motivo, 'pronto');
  assert.equal(proj.k.checks, reg.checks);
  const velho = projetarProntidao({ k: reg }, { k: { status: 'CLEAN', at: 0 } });
  assert.equal(velho.k.merge.motivo, 'atras');
  assert.equal(mergeDaProntidao({ status: 'DRAFT' }, reg.checks, reg.reviewers).motivo, 'rascunho');
});

test('regra da branch: checks, aprovações (o maior entre as regras) e code owner', () => {
  const r = regraDaResposta([
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }, { context: 'acrity/review' }] } },
    { type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: false } },
    { type: 'pull_request', parameters: { required_approving_review_count: 2, require_code_owner_review: true } },
    { type: 'deletion' },
  ]);
  assert.deepEqual(r, { legivel: true, checks: ['build', 'acrity/review'], temRegraDeReview: true, aprovacoes: 2, codeOwner: true });
  assert.equal(regraDaResposta({ message: 'Not Found' }), null);
  assert.deepEqual(regraDaResposta([]).checks, []);
});

// --- leitura no ciclo ------------------------------------------------------------------------

const runReal = io.run;
after(() => { io.run = runReal; });
let chamadas, regraFalha;

function responder(args) {
  const a = args.join(' ');
  if (a.includes('rules/branches')) {
    chamadas.regra++;
    if (regraFalha) return { ok: false, code: 1, stdout: '', stderr: '404' };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify([
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }, { context: 'test' }] } },
      { type: 'pull_request', parameters: { required_approving_review_count: 2 } },
    ]) };
  }
  if (a.includes('...Prontidao')) {
    chamadas.lote.push(args.filter(x => /^k\d+=/.test(x)).length);
    const data = {};
    args.filter(x => /^k\d+=/.test(x)).forEach((x, i) => {
      const numero = Number(x.split('=')[1]);
      data[`p${i}`] = numero === 404 ? null : { pullRequest: no({ number: numero, ...comTudo }) };
    });
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ data }) };
  }
  return { ok: false, code: 1, stdout: '', stderr: `inesperado: ${a}` };
}

function motor(panorama) {
  return {
    panorama, myPRs: [], prontidao: {},
    accountForPr: () => 'eu', accountForOwner: () => 'eu', tokenFor: () => 'tok', ghEnv: () => ({}),
    log: () => { },
  };
}
const prDoPanorama = n => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, updatedAt: '2026-11-07T10:00:00Z' });

beforeEach(() => {
  chamadas = { regra: 0, lote: [] };
  regraFalha = false;
  io.run = async (_cmd, args) => responder(args || []);
});

test('Panorama: um lote de até 15 por chamada (34 numa só voltou 502), e a regra da branch lida uma vez', async () => {
  const e = motor(Array.from({ length: 40 }, (_, i) => prDoPanorama(i + 1)));
  await refreshProntidao(e);
  assert.deepEqual(chamadas.lote, [15, 15, 10]);
  assert.equal(chamadas.regra, 1);
  assert.equal(Object.keys(e.prontidao).length, 40);
  assert.equal(e.prontidao['acme/app#3'].merge.motivo, 'pronto');
  assert.deepEqual(e.checksExigidosCache.get('acme/app@develop').lista, ['build', 'test'], 'a mesma leitura serve ao gate de checks');
});

test('Panorama: PR que não mudou e não espera o GitHub não é relido no ciclo seguinte', async () => {
  const e = motor([prDoPanorama(1), prDoPanorama(2)]);
  await refreshProntidao(e);
  await refreshProntidao(e);
  assert.deepEqual(chamadas.lote, [2]);
  e.panorama[1] = { ...e.panorama[1], updatedAt: '2026-11-07T11:00:00Z' };
  await refreshProntidao(e);
  assert.deepEqual(chamadas.lote, [2, 1], 'só o que mudou volta ao lote');
});

test('Panorama: falha de leitura preserva o último registro, e PR que saiu sai', async () => {
  const e = motor([prDoPanorama(1), prDoPanorama(2)]);
  await refreshProntidao(e);
  const antes = e.prontidao['acme/app#1'];
  io.run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'rede caiu' });
  e.panorama = [{ ...prDoPanorama(1), updatedAt: '2026-11-08T00:00:00Z' }];
  await refreshProntidao(e);
  assert.equal(e.prontidao['acme/app#1'], antes);
  assert.equal(e.prontidao['acme/app#2'], undefined);
});

test('Panorama: alias que veio nulo (repo sem acesso) não derruba os outros do lote', async () => {
  const e = motor([prDoPanorama(404), prDoPanorama(5)]);
  await refreshProntidao(e);
  assert.equal(e.prontidao['acme/app#404'], undefined);
  assert.ok(e.prontidao['acme/app#5']);
});

test('regra da branch que falha entra no cache curto e não vira uma chamada por ciclo', async () => {
  regraFalha = true;
  const e = motor([]);
  assert.equal(await regraDaBranch(e, 'acme/app', 'develop', 'eu'), null);
  assert.equal(await regraDaBranch(e, 'acme/app', 'develop', 'eu'), null);
  assert.equal(chamadas.regra, 1);
});

test('Meus PRs: o nó da busca da base é usado sem chamada nova, e só quando é mais novo', async () => {
  const e = motor([]);
  e.myPRs = [{ key: 'acme/app#9', repo: 'acme/app', number: 9, updatedAt: '2026-11-07T10:00:00Z' }];
  e.nosDosMeusPRs = new Map([['acme/app#9', { no: no({ number: 9, mergeStateStatus: 'BEHIND', ...comTudo }), at: Date.now() }]]);
  await refreshProntidao(e);
  assert.deepEqual(chamadas.lote, []);
  assert.equal(e.prontidao['acme/app#9'].merge.motivo, 'atras');
  const primeiro = e.prontidao['acme/app#9'];
  await refreshProntidao(e);
  assert.equal(e.prontidao['acme/app#9'], primeiro, 'sem nó novo e sem mudança, o registro fica');
  assert.deepEqual(chamadas.lote, []);
});

test('Meus PRs sem nó (a busca voltou sem o fragmento) caem na leitura em lote', async () => {
  const e = motor([]);
  e.myPRs = [{ key: 'acme/app#9', repo: 'acme/app', number: 9, updatedAt: '2026-11-07T10:00:00Z' }];
  await refreshProntidao(e);
  assert.deepEqual(chamadas.lote, [1]);
  assert.equal(e.prontidao['acme/app#9'].merge.motivo, 'pronto');
});

test('precisaLer: nunca lido, em transição, mudou, ou velho', () => {
  const reg = interp(no(comTudo));
  const pr = { updatedAt: reg.updatedAt };
  assert.equal(precisaLer(null, pr, Date.now()), true);
  assert.equal(precisaLer({ ...reg, at: Date.now() }, pr, Date.now()), false);
  assert.equal(precisaLer({ ...reg, at: Date.now() }, { updatedAt: 'outro' }, Date.now()), true);
  assert.equal(precisaLer({ ...reg, at: 0 }, pr, Date.now()), true);
});

test('o fragmento pede só leitura e traz o que o interpretador lê', () => {
  for (const campo of ['reviewDecision', 'reviewRequests', 'latestReviews', 'statusCheckRollup', 'headRefOid', 'commit{oid}', 'slug']) {
    assert.ok(FRAGMENTO_PRONTIDAO.includes(campo), campo);
  }
  assert.doesNotMatch(FRAGMENTO_PRONTIDAO, /mutation/i);
});

test('radar na tela: o selo do GitHub segue só os PRs do panorama', () => {
  const e = { panorama: [{ key: 'a#1' }], staleInfo: { 'a#1': { lastState: 'APPROVED' }, 'b#2': { lastState: 'APPROVED' } } };
  assert.deepEqual(reviewStatesGh(e), { 'a#1': 'APPROVED' });
});

// --- achados da revisão independente (08/11/2026) ------------------------------------------

test('merge: ruleset só com checks e reviewer pedido sem revisar, BLOCKED por check rodando, é azul', () => {
  const soChecks = { legivel: true, temRegraDeReview: false, aprovacoes: 0, codeOwner: false, checks: ['build', 'test'] };
  const r = interp(no({ pedidos: ['ana'], contexts: [verde('build'), run('test', 'IN_PROGRESS', null)], mergeStateStatus: 'BLOCKED' }), { regra: soChecks });
  assert.equal(r.reviewers.tom, 'wait', 'a pílula de reviewers segue âmbar: tem gente marcada');
  assert.deepEqual([r.merge.tom, r.merge.motivo, r.merge.motivos], ['run', 'esperando-checks', ['esperando-checks']]);
  const zero = interp(no({ pedidos: ['ana'], contexts: [verde('build'), run('test', 'IN_PROGRESS', null)], mergeStateStatus: 'BLOCKED' }), { regra: { ...REGRA2, aprovacoes: 0 } });
  assert.equal(zero.merge.motivo, 'esperando-checks', 'regra pull_request com 0 aprovações também não exige');
});

test('merge: falta aprovação quando a proteção clássica pede revisão ou o code owner falta', () => {
  const classica = interp(no({ reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', contexts: [verde('build'), verde('test')] }), { regra: null });
  assert.equal(classica.merge.motivo, 'falta-aprovacao');
  const dono = interp(no({ reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', ...comTudo }), { regra: { ...REGRA2, codeOwner: true } });
  assert.equal(dono.merge.motivo, 'falta-aprovacao');
});

test('regra da branch: leitura que falha depois do cache vencer preserva a regra anterior', async () => {
  const e = motor([]);
  const primeira = await regraDaBranch(e, 'acme/app', 'develop', 'eu');
  assert.deepEqual(primeira.checks, ['build', 'test']);
  e.regraDaBranchCache.get('acme/app@develop').at = 0;
  regraFalha = true;
  assert.deepEqual(await regraDaBranch(e, 'acme/app', 'develop', 'eu'), primeira);
  assert.equal(chamadas.regra, 2);
  assert.deepEqual(await regraDaBranch(e, 'acme/app', 'develop', 'eu'), primeira);
  assert.equal(chamadas.regra, 2, 'a nova tentativa espera o intervalo curto da falha');
  assert.equal(e.regraDaBranchCache.get('acme/app@develop').falhou, true);
});

test('regra da branch: conta em pausa por limite do GitHub não lê', async () => {
  const e = motor([]);
  const limite = (await import('../lib/engine/limite-gh.js')).default;
  await limite.entrarEmEspera(e, 'eu');
  chamadas.regra = 0;
  assert.equal(limite.emEspera(e, 'eu'), true);
  assert.equal(await regraDaBranch(e, 'acme/app', 'develop', 'eu'), null);
  assert.equal(chamadas.regra, 0);
});
