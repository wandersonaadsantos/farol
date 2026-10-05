// A aprovação automática com CI obrigatório vermelho ou em andamento, na revisão de verdade.
//
// De 27 a 30/09/2026 este arquivo provava que o card ia para a mesa e pedia o clique "quando
// a pipe fechar". Pedido do dono em 30/09/2026: "A configuração tem de cumprir o que promete,
// sem exceção: se é pra aprovar automaticamente, ele realmente aprova, sem desculpas pra
// passar por um approve humano." Agora a prova é a da ESPERA AUTOMÁTICA, ponta a ponta:
// o runHeadlessReview guarda o resultado dizendo que espera o CI, e a varredura do ciclo
// (lib/engine/espera-ci.js) relê os checks e posta sozinha quando fecham verdes no MESMO
// head. Nunca aprova por cima de CI vermelho (biud-frontend#896) nem em head que não leu.
// Dependência em aberto saiu da espera: é ressalva, e a política da conta decide.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-gate-espera-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';
const check = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-09-30T12:00:00Z' });

// o gh é a fronteira de rede. `gh` guarda o que o GitHub responderia AGORA; os testes mudam
// isso entre um ciclo e outro, que é como a pipe anda.
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let leiturasDoCi = 0;
let chamadas = 0;
let leiturasDeReviewsAlheios = 0;
let gh;
io.run = async (_cmd, args) => {
  chamadas++;
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    if (gh.postFalha) return { ok: false, code: 1, stdout: '', stderr: gh.postFalha };
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  // reviews dos OUTROS (gate de consciência): o jq filtra por login diferente do meu
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) {
    leiturasDeReviewsAlheios++;
    return { ok: true, code: 0, stdout: JSON.stringify(gh.reviewsAlheios), stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: JSON.stringify(gh.meusReviews), stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    leiturasDoCi++;
    if (gh.leituraFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
    return {
      ok: true, code: 0, stderr: '',
      stdout: JSON.stringify({ state: gh.state, headRefOid: gh.head, baseRefName: 'main', statusCheckRollup: gh.rollup, reviewRequests: gh.pedidos }),
    };
  }
  if (sub.includes('rules/branches/main')) return { ok: true, code: 0, stdout: JSON.stringify(gh.exigidos), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.state }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = []; leiturasDoCi = 0; chamadas = 0; leiturasDeReviewsAlheios = 0;
  gh = {
    state: 'OPEN', head: HEAD, exigidos: ['test', 'audit'], meusReviews: [], reviewsAlheios: [], postFalha: '', leituraFalha: false,
    rollup: [check('test', '', 'IN_PROGRESS'), check('audit', 'SUCCESS')],
    pedidos: [{ __typename: 'User', login: 'eu' }],
  };
});

// `politica` = [limpo, com ressalvas]
function motor(checks, politica = ['approve', 'approve']) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  // a espera do CI é opt-in desde 02/10/2026: estes casos testam a chave LIGADA
  e.config.aguardarCiParaAprovar = true;
  e.politica = politica;
  e.approvePolicyFor = (_conta, limpo) => (limpo ? e.politica[0] : e.politica[1]);
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.toasts = [];
  e.eventos = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  e.on('needs-decision', (p) => e.eventos.push(['needs-decision', p.item.key]));
  e.on('auto-approved', (p) => e.eventos.push(['auto-approved', p.result.key, (p.points || []).length]));
  e.bloqueadoPorChecks = async () => ({ faltando: checks });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = (n) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', requested: true });
const pendente = (e, n) => e.decisions.pending.find((x) => x.key === `acme/app#${n}`);
const resolvida = (e, n) => e.decisions.resolved.find((x) => x.key === `acme/app#${n}`);
const textos = (d) => (d.reasons || []).map((r) => r.text || r);

// a revisão termina com um check obrigatório ainda rodando: é o ponto de partida de quase tudo
async function emEspera(n, { politica, extra, checks = [{ nome: 'test', estado: 'rodando' }] } = {}) {
  const e = motor(checks, politica);
  sessao(e, extra);
  await e.runHeadlessReview(PR(n));
  // o que a revisão em si consultou fica fora da conta de "uma leitura por ciclo"
  e.chamadasAntes = chamadas;
  return e;
}

test('check obrigatório ainda rodando: nada é postado, e o resultado fica ESPERANDO O CI, não pedindo você', async () => {
  const e = await emEspera(1);
  assert.deepEqual(envios, [], 'nenhum APPROVE foi enviado');
  const d = pendente(e, 1);
  assert.ok(d, 'o resultado ficou guardado');
  assert.deepEqual(d.esperaCi.checks, [{ nome: 'test', estado: 'rodando' }]);
  assert.equal(d.headSha, HEAD, 'ancorado no head que a sessão leu');
  assert.match(textos(d)[0], /ainda sem resultado no head \(test\): a aprovação está esperando o CI e sai sozinha quando a pipe fechar verde neste commit/);
  assert.deepEqual(e.eventos, [], 'não avisa "precisa de você"');
  assert.ok(e.toasts.some((t) => /esperando o CI obrigatório; aprovo sozinho/.test(t)), e.toasts.join(' | '));
  assert.equal(e.toasts.some((t) => /precisa da sua atenção/.test(t)), false);
  const tela = e.decisionForUi(d);
  assert.deepEqual(tela.esperaCi.checks, [{ nome: 'test', estado: 'rodando' }], 'a tela recebe os checks que faltam');
  assert.equal(tela.esperaCi.pontos, undefined, 'e só isso: as ressalvas guardadas não vão cruas');
  assert.equal(e.reviewActions()['acme/app#1'].esperaCi, true, 'o Panorama sabe que esta pendência não espera você');
});

test('CI fecha verde no mesmo head: a aprovação sai sozinha, ancorada no head lido, sem clique', async () => {
  const e = await emEspera(2);
  assert.equal(await e.aprovarQuandoOCiFechar(), 0, 'pipe ainda rodando: segue esperando');
  assert.deepEqual(envios, []);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1, 'um APPROVE, e só um');
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(envios[0].commit_id, HEAD);
  assert.equal(envios[0].body, 'Leitura completa, sem bloqueios.');
  assert.equal(pendente(e, 2), undefined, 'saiu da lista de pendências');
  const r = resolvida(e, 2);
  assert.equal(r.status, 'auto_approved');
  assert.equal(r.esperaCi, null);
  assert.deepEqual(r.attention, [], 'limpo: sem ressalva');
  assert.deepEqual(textos(r), [], 'o motivo da espera sai do registro');
  assert.deepEqual(e.eventos, [['auto-approved', 'acme/app#2', 0]]);
  assert.ok(e.toasts.some((t) => /o CI fechou verde e a aprovação saiu sozinha, sem ressalvas/.test(t)));
  assert.equal(await e.aprovarQuandoOCiFechar(), 0, 'ciclo seguinte não tem o que fazer');
  assert.equal(envios.length, 1, 'nunca posta duas vezes');
});

test('CI VERMELHO: espera, nunca aprova por cima e nunca pede clique, por quantos ciclos forem', async () => {
  const e = await emEspera(3, { checks: [{ nome: 'audit', estado: 'vermelho' }] });
  assert.match(textos(pendente(e, 3))[0], /check obrigatório vermelho no head \(audit\)/);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  for (let ciclo = 0; ciclo < 5; ciclo++) assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.deepEqual(envios, [], 'CI vermelho nunca vira APPROVE');
  assert.ok(pendente(e, 3).esperaCi, 'segue esperando');
  assert.deepEqual(e.eventos, [], 'e segue sem pedir você');
  assert.equal(leiturasDoCi, 5, 'uma leitura do PR por ciclo');
  // 5 leituras do PR + 1 da exigência da branch (que fica em cache): nada além disso
  assert.equal(chamadas - e.chamadasAntes, 6);
  // a pipe foi relançada e fechou: a rodada mais recente do check é a que vale
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE'), { ...check('audit', 'SUCCESS'), startedAt: '2026-09-30T13:00:00Z' }];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1);
});

test('o card acompanha a pipe: rodando vira vermelho, e continua sendo espera', async () => {
  const e = await emEspera(4);
  gh.rollup = [check('test', 'FAILURE'), check('audit', 'SUCCESS')];
  await e.aprovarQuandoOCiFechar();
  const d = pendente(e, 4);
  assert.deepEqual(d.esperaCi.checks, [{ nome: 'test', estado: 'vermelho' }]);
  assert.equal(textos(d).filter((t) => /check obrigatório/.test(t)).length, 1, 'um motivo de CI só, trocado e não empilhado');
  assert.match(textos(d)[0], /check obrigatório vermelho no head \(test\)/);
  assert.deepEqual(envios, []);
});

test('head andou durante a espera: NÃO posta, larga a espera e devolve o PR ao round automático', async () => {
  const e = await emEspera(5);
  gh.head = HEAD_NOVO;
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.deepEqual(envios, [], 'CI verde no head NOVO não aprova o texto do head antigo');
  const d = pendente(e, 5);
  assert.equal(d.esperaCi, null);
  assert.equal(d.blockedKind, 'stale_head', 'é o carimbo que o round automático (reReviewTargets) destrava');
  assert.equal(d.blockedHead, HEAD_NOVO);
  assert.match(textos(d)[0], /commit novo enquanto a aprovação esperava o CI \(706cc81 -> b8722a3\)/);
  assert.equal(await e.aprovarQuandoOCiFechar(), 0, 'e a espera não volta');
  assert.equal(leiturasDoCi, 1, 'pendência sem espera não custa leitura');
});

test('leitura que falha NÃO libera: sem prova do CI e do head, espera o próximo ciclo', async () => {
  const e = await emEspera(6);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.leituraFalha = true;
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  gh.leituraFalha = false;
  gh.rollup = null;
  assert.equal(await e.aprovarQuandoOCiFechar(), 0, 'rollup ilegível não é CI verde');
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.exigidos = { message: 'Not Found' };
  e.checksExigidosCache = new Map();
  assert.equal(await e.aprovarQuandoOCiFechar(), 0, 'exigência da branch desconhecida não é CI verde');
  assert.deepEqual(envios, []);
  assert.ok(pendente(e, 6).esperaCi, 'continua esperando, sem ir para a mesa');
  gh.exigidos = ['test', 'audit'];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
});

test('com ressalvas e conta que aprova com ressalvas: espera o CI e aprova, com a ressalva visível', async () => {
  const e = await emEspera(7, { extra: { decision: 'needs_decision', reasons: ['vale olhar a validação do upload'], dependenciasAbertas: ['acme/infra#189 ainda aberto'] } });
  const d = pendente(e, 7);
  assert.equal(d.esperaCi.pontos.length, 2);
  assert.ok(textos(d).some((t) => /acme\/infra#189 ainda aberto/.test(t)), 'a dependência aparece no card como ressalva');
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1);
  const r = resolvida(e, 7);
  assert.deepEqual(r.attention.map((p) => p.text), ['A aprovação depende de algo que estava em aberto na leitura: acme/infra#189 ainda aberto', 'vale olhar a validação do upload']);
  assert.deepEqual(e.eventos, [['auto-approved', 'acme/app#7', 2]]);
});

test('conta que manda esperar você: vai para a mesa pela POLÍTICA, não entra em espera do CI', async () => {
  const e = await emEspera(8, { politica: ['approve', 'wait'], extra: { reasons: ['ressalva da revisão'] } });
  const d = pendente(e, 8);
  assert.equal(d.esperaCi, undefined);
  assert.match(textos(d)[0], /aprovável com ressalvas, e a política da conta .+ é aguardar você/);
  assert.ok(textos(d).includes('check obrigatório ainda sem resultado no head (test)'), 'quem vai clicar fica sabendo da pipe');
  assert.ok(textos(d).includes('ressalva da revisão'));
  assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#8']]);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.deepEqual(envios, [], 'a política mandou esperar você: CI verde não aprova');
  assert.equal(leiturasDoCi, 0);
});

test('a política mudou para "esperar você" durante a espera: larga a espera e avisa, sem postar', async () => {
  const e = await emEspera(9);
  e.politica = ['wait', 'wait'];
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.deepEqual(envios, []);
  const d = pendente(e, 9);
  assert.equal(d.esperaCi, null);
  assert.match(textos(d)[0], /aprovável sem ressalvas, mas a política da conta .* manda aguardar sua aprovação/);
  assert.equal(textos(d).some((t) => /esperando o CI/.test(t)), false, 'o motivo da espera saiu');
  assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#9']]);
  assert.equal(leiturasDoCi, 0, 'a política é conferida antes de gastar a leitura');
});

// O GitHub tira a conta de reviewRequests quando ela posta um review. No round 2 (pedi
// mudanças, o autor corrigiu, o CI está rodando) a lista chega sem mim, e conferir "ainda
// pedido a mim" por ela mandava para a mesa justamente a aprovação que a conta mandou sair.
test('round 2: a conta não está mais em reviewRequests e a aprovação sai do mesmo jeito', async () => {
  const e = await emEspera(10);
  gh.pedidos = [{ __typename: 'User', login: 'outra-pessoa' }];
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1, 'o APPROVE saiu');
  assert.equal(pendente(e, 10), undefined);
});

test('PR fechado ou mergeado na espera: não posta (quem tira a pendência é o reconcilePending)', async () => {
  const e = await emEspera(11);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.state = 'MERGED';
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.deepEqual(envios, []);
  assert.equal(await e.reconcilePending(), 1);
  assert.equal(resolvida(e, 11).status, 'already_merged');
});

test('você aprovou por fora durante a espera: resolve sem postar de novo', async () => {
  const e = await emEspera(12);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.meusReviews = [{ state: 'APPROVED', submitted_at: '2026-09-30T12:30:00Z', commit_id: HEAD }];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.deepEqual(envios, []);
  assert.equal(resolvida(e, 12).status, 'already_reviewed');
});

test('o clique em Aprovar continua valendo durante a espera', async () => {
  const e = await emEspera(13);
  const r = await e.decide(pendente(e, 13).id, 'approve');
  assert.equal(r.ok, true);
  assert.equal(envios.length, 1);
  assert.equal(resolvida(e, 13).status, 'posted');
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.equal(envios.length, 1, 'a espera morreu junto com a pendência');
});

test('a espera sobrevive a reinício: a marca vai gravada na decisão', async () => {
  const e = await emEspera(14);
  const disco = JSON.parse(JSON.stringify(e.decisions));
  const depois = motor([]);
  depois.decisions = disco;
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await depois.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].commit_id, HEAD);
});

test('a postagem falhou depois do CI verde: passageira vai para o reenvio de sempre, permanente diz o que houve', async () => {
  const e = await emEspera(15);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.postFalha = 'gh: No server is currently available to service your request. Sorry about that. (HTTP 503)';
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  const d = pendente(e, 15);
  assert.equal(d.esperaCi, null);
  assert.deepEqual(d.postRetry, { event: 'approve', attempts: 0 }, 'o retryFailedPosts assume');
  assert.equal(d.reasons[0].kind, 'infra');
  assert.deepEqual(e.eventos, [], 'falha passageira não pede você');
  gh.postFalha = '';
  assert.equal(await e.retryFailedPosts(), 1);
  assert.equal(envios.length, 1);
  assert.equal(resolvida(e, 15).status, 'auto_approved');

  const f = await emEspera(16);
  gh.postFalha = 'gh: Resource not accessible by personal access token (HTTP 403)';
  assert.equal(await f.aprovarQuandoOCiFechar(), 0);
  const p = pendente(f, 16);
  assert.equal(p.esperaCi, null);
  assert.equal(p.postRetry, null);
  assert.match(textos(p)[0], /falha ao postar o APPROVE/);
  assert.deepEqual(f.eventos, [['needs-decision', 'acme/app#16']]);
});

/* ---------- gate de consciência na hora do post atrasado (30/09/2026) ----------
   A regra de bloqueadoPorHistorico (skip-review.js) só era consultada ao LANÇAR a revisão
   automática. Com a espera do CI passam minutos ou horas entre a revisão e o post, e uma
   pessoa pode ter pedido mudanças naquele commit: a aprovação sairia por cima. A mesma
   função é consultada de novo, só no instante do post (CI verde, head igual). */
const VERDE = () => [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
const review = (quem, state, extra = {}) => ({ quem, tipo: 'User', state, commit_id: HEAD, ...extra });

test('uma pessoa pediu mudanças no mesmo commit durante a espera: NÃO aprova por cima, vai para a mesa dizendo isso', async () => {
  const e = await emEspera(20);
  gh.reviewsAlheios = [review('ana', 'CHANGES_REQUESTED')];
  for (let ciclo = 0; ciclo < 3; ciclo++) assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.equal(leiturasDeReviewsAlheios, 0, 'com a pipe ainda rodando, nenhuma leitura de reviews: o custo é só na hora do post');
  gh.rollup = VERDE();
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.deepEqual(envios, [], 'nenhum APPROVE por cima do pedido de mudanças');
  assert.equal(leiturasDeReviewsAlheios, 1);
  const d = pendente(e, 20);
  assert.equal(d.esperaCi, null, 'a espera foi largada, de forma durável');
  assert.match(textos(d)[0], /uma pessoa pediu mudanças neste commit enquanto eu esperava o CI \(@ana\)/);
  assert.equal(d.reasons[0].kind, 'gate');
  assert.equal(textos(d).some((t) => /esperando o CI e sai sozinha/.test(t)), false, 'o motivo da espera saiu do card');
  assert.match(e.decisionForUi(d).reasons[0].text, /uma pessoa pediu mudanças neste commit enquanto eu esperava o CI/, 'o texto chega à tela como foi escrito');
  assert.deepEqual(e.eventos, [['needs-decision', 'acme/app#20']]);
  assert.equal(e.toasts.filter((t) => /acme\/app#20 precisa da sua atenção/.test(t)).length, 1, 'um toast só');
  assert.equal(await e.aprovarQuandoOCiFechar(), 0, 'e não volta a tentar');
  assert.deepEqual(envios, []);
  assert.equal(leiturasDeReviewsAlheios, 1);
});

test('review de ferramenta (acrity) durante a espera não é pessoa: a aprovação sai', async () => {
  const e = await emEspera(21);
  gh.rollup = VERDE();
  gh.reviewsAlheios = [review('acrity', 'CHANGES_REQUESTED'), review('acrity-review-bot', 'CHANGES_REQUESTED', { tipo: 'Bot' })];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1);
  assert.equal(resolvida(e, 21).status, 'auto_approved');
});

test('uma aprovação de pessoa não segura (a automática vale como a segunda); duas seguram', async () => {
  const e = await emEspera(22);
  gh.rollup = VERDE();
  gh.reviewsAlheios = [review('ana', 'APPROVED')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1);

  const f = await emEspera(23);
  gh.reviewsAlheios = [review('ana', 'APPROVED'), review('bia', 'APPROVED')];
  assert.equal(await f.aprovarQuandoOCiFechar(), 0);
  assert.equal(envios.length, 1, 'nada novo postado');
  assert.match(textos(pendente(f, 23))[0], /o PR já tem duas aprovações de pessoas neste commit \(@ana, @bia\)/);
});

test('pedido de mudanças em commit ANTERIOR não segura, e quem pediu e depois aprovou conta como aprovação', async () => {
  const e = await emEspera(24);
  gh.rollup = VERDE();
  gh.reviewsAlheios = [review('ana', 'CHANGES_REQUESTED', { commit_id: HEAD_NOVO }), review('bia', 'CHANGES_REQUESTED'), review('bia', 'APPROVED')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 1);
  assert.equal(envios.length, 1);
});

test('a regra é a de skip-review.js, sem cópia: o espera-ci só chama bloqueadoPorHistorico', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'espera-ci.js'), 'utf8');
  assert.match(fonte, /await engine\.bloqueadoPorHistorico\(pr\)/);
  assert.doesNotMatch(fonte, /ehFerramenta|APROVACOES_QUE_SEGURAM|reviewsDeOutros\(/, 'nenhuma segunda versão da regra');
});

test('dependência em aberto declarada pela revisão é ressalva: a conta que espera nas ressalvas não posta, e o card nomeia a dependência', async () => {
  const e = motor([], ['approve', 'wait']);
  sessao(e, { dependenciasAbertas: ['acme/infra#189 ainda aberto'] });
  await e.runHeadlessReview(PR(17));
  assert.deepEqual(envios, []);
  const d = pendente(e, 17);
  assert.equal(d.esperaCi, undefined, 'dependência não é espera automática');
  assert.match(textos(d)[0], /aprovável com ressalvas/);
  assert.ok(textos(d).some((t) => /acme\/infra#189 ainda aberto/.test(t)), JSON.stringify(d.reasons));
});

test('a mesma dependência, em conta que aprova com ressalvas: aprova sozinho e a ressalva fica no app', async () => {
  const e = motor([], ['approve', 'approve']);
  sessao(e, { dependenciasAbertas: ['acme/infra#189 ainda aberto'] });
  await e.runHeadlessReview(PR(18));
  assert.equal(envios.length, 1);
  assert.doesNotMatch(JSON.stringify(envios[0]), /infra#189/, 'a ressalva não entra no texto do PR');
  assert.match(resolvida(e, 18).attention[0].text, /acme\/infra#189 ainda aberto/);
});

test('sem check pendente e sem ressalva, a aprovação automática segue saindo na hora', async () => {
  const e = motor([]);
  sessao(e);
  await e.runHeadlessReview(PR(19));
  assert.equal(envios.length, 1);
  assert.equal(pendente(e, 19), undefined);
});

test('check() roda a espera do CI depois do reconcilePending e antes do retryFailedPosts', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
  const pend = fonte.indexOf('await this.reconcilePending();');
  const espera = fonte.indexOf('await this.aprovarQuandoOCiFechar();');
  const retry = fonte.indexOf('await this.retryFailedPosts();');
  assert.ok(pend > 0 && pend < espera && espera < retry);
});

/* ---------- a espera do CI é opt-in desde 02/10/2026 ---------- */
// Pedido do dono: "deixar essa espera do CI desabilitada por padrão". Desligada, a aprovação
// sai na hora, com o estado da pipe guardado como ressalva no app, e nada dele vai ao PR.

function motorPadrao(checks, politica) {
  const e = motor(checks, politica);
  delete e.config.aguardarCiParaAprovar;
  return e;
}

test('padrão (chave ausente): check obrigatório rodando não segura, a aprovação sai na hora com o CI como ressalva', async () => {
  const e = motorPadrao([{ nome: 'test', estado: 'rodando' }]);
  sessao(e);
  await e.runHeadlessReview(PR(30));
  assert.equal(envios.length, 1, 'um APPROVE, sem esperar a pipe');
  assert.equal(envios[0].commit_id, HEAD);
  assert.doesNotMatch(JSON.stringify(envios[0]), /check obrigatório/, 'o estado do CI não entra no texto do PR');
  assert.equal(pendente(e, 30), undefined, 'nada fica esperando o CI');
  const r = resolvida(e, 30);
  assert.equal(r.status, 'auto_approved');
  assert.match(r.attention.map((p) => p.text).join(' | '), /check obrigatório ainda sem resultado no head \(test\)/);
  assert.equal(e.toasts.some((t) => /esperando o CI/.test(t)), false);
});

test('padrão: CI VERMELHO também não segura, e a ressalva nomeia o check', async () => {
  const e = motorPadrao([{ nome: 'audit', estado: 'vermelho' }]);
  sessao(e);
  await e.runHeadlessReview(PR(31));
  assert.equal(envios.length, 1);
  assert.match(resolvida(e, 31).attention.map((p) => p.text).join(' | '), /check obrigatório vermelho no head \(audit\)/);
});

test('padrão: conta que manda esperar você continua indo para a mesa pela política, com o aviso do CI', async () => {
  const e = motorPadrao([{ nome: 'test', estado: 'rodando' }], ['wait', 'wait']);
  sessao(e);
  await e.runHeadlessReview(PR(32));
  assert.deepEqual(envios, []);
  const d = pendente(e, 32);
  assert.equal(d.esperaCi, undefined, 'pela política, não pela espera');
  assert.ok(textos(d).some((t) => /check obrigatório ainda sem resultado/.test(t)));
});

test('espera armada e depois desligada: o próximo ciclo posta no mesmo head sem olhar o CI', async () => {
  const e = await emEspera(33, { checks: [{ nome: 'audit', estado: 'vermelho' }] });
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  assert.equal(await e.aprovarQuandoOCiFechar(), 0, 'ligada: CI vermelho segura');
  e.config.aguardarCiParaAprovar = false;
  assert.equal(await e.aprovarQuandoOCiFechar(), 1, 'desligada: sai');
  assert.equal(envios.length, 1);
  assert.equal(envios[0].commit_id, HEAD);
  const r = resolvida(e, 33);
  assert.equal(r.status, 'auto_approved');
  assert.match(r.attention.map((p) => p.text).join(' | '), /vermelho no head \(audit\)/);
  assert.ok(e.toasts.some((t) => /a espera do CI está desligada, então a aprovação que esperava saiu sozinha/.test(t)), e.toasts.join(' | '));
});

test('espera desligada não afrouxa o head: commit novo na espera continua largando, sem postar', async () => {
  const e = await emEspera(34);
  e.config.aguardarCiParaAprovar = false;
  gh.head = HEAD_NOVO;
  assert.equal(await e.aprovarQuandoOCiFechar(), 0);
  assert.deepEqual(envios, []);
  assert.equal(pendente(e, 34).blockedKind, 'stale_head');
});

test('o padrão da preferência é desligado e só o booleano verdadeiro liga', async () => {
  const { SETTINGS, EDITAVEIS, sanear } = await import('../lib/settings.js');
  const { aguardaCiParaAprovar } = await import('../lib/engine/gate-espera.js');
  assert.equal(SETTINGS.find((x) => x.key === 'aguardarCiParaAprovar').def, false);
  assert.ok(EDITAVEIS.has('aguardarCiParaAprovar'));
  assert.equal(sanear('aguardarCiParaAprovar', true), true);
  for (const v of [false, 'true', 1, null, undefined]) assert.equal(sanear('aguardarCiParaAprovar', v), false, String(v));
  for (const c of [{}, null, { aguardarCiParaAprovar: 'true' }, { aguardarCiParaAprovar: 1 }]) assert.equal(aguardaCiParaAprovar(c), false, JSON.stringify(c));
  assert.equal(aguardaCiParaAprovar({ aguardarCiParaAprovar: true }), true);
});
