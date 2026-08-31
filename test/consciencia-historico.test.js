// Gate de CONSCIÊNCIA do review automático (28/08/2026 à tarde). A regra do
// Wanderson: "se alguém já aprovou, se alguém tá revisando e se alguém já
// reprovou que não seja o acrity, não fazemos review a menos que haja ação
// manual. Se ninguém está revisando e não temos histórico de review no head
// ativo então devemos seguir na revisão automatizada." O que se prova aqui:
// - bloqueadoPorHistorico bloqueia com reprovação de OUTRA pessoa no head
//   ATIVO (a primeira já basta) ou com DUAS aprovações humanas (o "(máximo 2)"
//   da regra: com uma só, a revisão automática ainda vale como a segunda);
//   cada pessoa conta pelo ÚLTIMO estado decisivo dela; ferramenta (acrity),
//   DISMISSED, COMMENTED e head antigo nunca bloqueiam; falta de dado (sem
//   head, sem rede) NUNCA bloqueia, porque o pior caso é revisão redundante,
//   nunca post errado.
// - a fiação: os três caminhos automáticos (launchReview, launchReReviews e o
//   retry do check(), hoje _repescarRetry) aguardam o gate antes do
//   enqueueHeadless, e o clique manual atravessa sem consultar nada. Estilo de
//   test/saida-de-cena-estrangulamento.test.js: o stub delega no módulo de
//   verdade nos pontos que o teste existe pra provar.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-consciencia-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skip = await import('../lib/engine/skip-review.js');
const reviewMod = (await import('../lib/engine/review.js')).default;
const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1 };

/* ---------- bloqueadoPorHistorico (a pergunta em si) ---------- */

// espião no io.run que responde a lista de reviews pelo caminho do gh api
function espiaReviews(engine, lista, ok = true) {
  const original = io.run;
  io.run = (cmd, args) => {
    engine.rodou.push(args);
    return Promise.resolve({ ok, stdout: JSON.stringify(lista), stderr: ok ? '' : 'boom' });
  };
  return () => { io.run = original; };
}

function engineFalso(extra = {}) {
  return {
    rodou: [],
    toasts: [],
    accountForPr: () => 'eu',
    tokenFor: () => 'tok',
    ghEnv: () => ({}),
    headSha: async () => 'sha1',
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    log: () => {},
    ...extra,
  };
}

test('UMA aprovação de outra pessoa NÃO bloqueia (a automática ainda vale como a segunda)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false);
  assert.deepEqual(r.quem, []);
});

test('DUAS aprovações humanas no head ativo bloqueiam (o teto do fluxo do time)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [
    { quem: 'ana', state: 'APPROVED', commit_id: 'sha1' },
    { quem: 'zoe', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, true);
  assert.equal(r.head, 'sha1');
  assert.deepEqual(r.quem, ['ana', 'zoe']);
});

test('duas aprovações sendo uma do acrity NÃO bloqueiam (ferramenta não conta no teto)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [
    { quem: 'ana', state: 'APPROVED', commit_id: 'sha1' },
    { quem: 'acrity', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false);
});

test('reprovação seguida de aprovação da MESMA pessoa conta como aprovação (último estado vence)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [
    { quem: 'ana', state: 'CHANGES_REQUESTED', commit_id: 'sha1' },
    { quem: 'ana', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false, 'a ressalva dela foi atendida e virou a primeira aprovação');
});

test('bloqueia com CHANGES_REQUESTED de outra pessoa no head ativo', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [{ quem: 'ana', state: 'CHANGES_REQUESTED', commit_id: 'sha1' }]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, true);
});

// regra explícita: review de ferramenta não dispensa olho humano nem o substitui
test('NÃO bloqueia quando o decisivo é do acrity (ferramenta)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [{ quem: 'acrity', state: 'CHANGES_REQUESTED', commit_id: 'sha1' }, { quem: 'Acrity', state: 'APPROVED', commit_id: 'sha1' }]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false);
  assert.deepEqual(r.quem, []);
});

/* FALHA REAL DE CAMPO (biudtech/engine-ai#108, 29/08/2026). O login do Acrity na
   API de reviews é `acrity-advesarial-code-review[bot]`, com `user.type: "Bot"`;
   `acrity` é o prefixo da LABEL, e era a única grafia que a lista de ferramentas
   casava. As fixtures acima usavam o prefixo, então a suíte ficava verde
   enquanto o gate contava o bot como PESSOA: a reprovação dele segurou a revisão
   automática do time num PR inteiro. Estes testes existem pra que a próxima
   ferramenta com login de bot não repita o episódio. */

test('login REAL do acrity na API não bloqueia (o bug do engine-ai#108)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [{ quem: 'acrity-advesarial-code-review[bot]', tipo: 'Bot', state: 'CHANGES_REQUESTED', commit_id: 'sha1' }]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false);
  assert.deepEqual(r.quem, []);
});

test('login real do acrity SEM o type (jq antigo, cópia velha) também não bloqueia', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [{ quem: 'acrity-advesarial-code-review[bot]', state: 'APPROVED', commit_id: 'sha1' }, { quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false, 'uma aprovação humana só não fecha o teto de duas');
});

// a regra vale pra QUALQUER ferramenta, não só a que doeu: review de bot não
// dispensa olho humano, então nunca entra na conta que segura o automático
test('review de qualquer bot não conta como pessoa', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [
    { quem: 'coderabbitai[bot]', tipo: 'Bot', state: 'CHANGES_REQUESTED', commit_id: 'sha1' },
    { quem: 'vercel[bot]', tipo: 'Bot', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false);
});

// contrato da consulta: sem o type na projeção do jq, a regra geral de bot fica
// cega e a defesa volta a depender só da lista de nomes
test('reviewsDeOutros pede o type do autor ao gh', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, []));
  await skip.bloqueadoPorHistorico(e, { ...PR });
  const jq = e.rodou.map(a => (a || []).join(' ')).find(t => t.includes('/reviews'));
  assert.ok(jq && /\.user\.type/.test(jq), `o jq tem que projetar .user.type: ${jq}`);
});

test('NÃO bloqueia com DISMISSED nem COMMENTED (não são decisivos)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [
    { quem: 'ana', state: 'DISMISSED', commit_id: 'sha1' },
    { quem: 'zoe', state: 'COMMENTED', commit_id: 'sha1' },
  ]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false);
});

test('decisivo de head ANTIGO não bloqueia (head novo zera o histórico)', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha-velho' }]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false, 'o autor empurrou código novo desde a aprovação');
});

test('sem head (fetch falhou ou vazio) NÃO bloqueia e nem consulta os reviews', async (t) => {
  const quebrado = engineFalso({ headSha: async () => { throw new Error('rede'); } });
  t.after(espiaReviews(quebrado, []));
  const r1 = await skip.bloqueadoPorHistorico(quebrado, { ...PR });
  assert.equal(r1.bloqueado, false);
  assert.equal(quebrado.rodou.length, 0, 'sem head a 2ª chamada gh nem acontece');
  const vazio = engineFalso({ headSha: async () => '' });
  t.after(espiaReviews(vazio, []));
  const r2 = await skip.bloqueadoPorHistorico(vazio, { ...PR });
  assert.equal(r2.bloqueado, false);
  assert.equal(vazio.rodou.length, 0);
});

test('lista de reviews indisponível (rede) NÃO bloqueia', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [], false));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, false);
  assert.equal(r.head, 'sha1', 'o head foi lido, o que faltou foi a lista');
});

test('reprovação lidera o bloqueio e quem sai sem caixa duplicada', async (t) => {
  const e = engineFalso();
  t.after(espiaReviews(e, [
    { quem: 'Zoe', state: 'APPROVED', commit_id: 'sha1' },
    { quem: 'ana', state: 'CHANGES_REQUESTED', commit_id: 'sha1' },
    { quem: 'zoe', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const r = await skip.bloqueadoPorHistorico(e, { ...PR });
  assert.equal(r.bloqueado, true, 'a reprovação da ana segura sozinha');
  assert.deepEqual(r.quem, ['ana'], 'o toast nomeia quem segura (a reprovação), não os aprovadores');
  assert.deepEqual(r.decisivos, [{ quem: 'ana', state: 'CHANGES_REQUESTED' }]);
});

/* ---------- o texto do toast (PURO) ---------- */

test('textoDoBloqueio: aprovação no singular, sem travessão e sem nomear a ferramenta', () => {
  const t = skip.textoDoBloqueio('o/r#1', { quem: ['ana'], decisivos: [{ quem: 'ana', state: 'APPROVED' }] });
  assert.match(t, /^o\/r#1: @ana já aprovou este head/);
  assert.match(t, /o botão Revisar continua valendo/);
  assert.doesNotMatch(t, /—/, 'sem travessão, regra da casa');
  // o toast é interno e pode falar de "revisão automática", mas nunca nomeia a
  // ferramenta (o texto não pode virar copy público por acidente)
  assert.doesNotMatch(t, /Farol|Claude|\bIA\b/);
});

test('textoDoBloqueio: reprovação vira "já pediu mudanças"', () => {
  const t = skip.textoDoBloqueio('o/r#1', { quem: ['ana'], decisivos: [{ quem: 'ana', state: 'CHANGES_REQUESTED' }] });
  assert.match(t, /@ana já pediu mudanças neste head/);
});

test('textoDoBloqueio: plural e misto acertam a concordância', () => {
  const aprovadores = { quem: ['ana', 'zoe'], decisivos: [{ quem: 'ana', state: 'APPROVED' }, { quem: 'zoe', state: 'APPROVED' }] };
  assert.match(skip.textoDoBloqueio('o/r#1', aprovadores), /@ana e @zoe já aprovaram este head/);
  const misto = { quem: ['ana', 'zoe'], decisivos: [{ quem: 'ana', state: 'APPROVED' }, { quem: 'zoe', state: 'CHANGES_REQUESTED' }] };
  assert.match(skip.textoDoBloqueio('o/r#1', misto), /@ana e @zoe já revisaram este head/);
  assert.equal(skip.textoDoBloqueio('o/r#1', { quem: [] }), '');
});

/* ---------- aviso único por PR+head e a poda ---------- */

test('avisaBloqueioHistorico: um toast por PR+head; head novo avisa de novo e derruba a chave velha', () => {
  const e = engineFalso();
  const hist = { bloqueado: true, head: 'sha1', quem: ['ana'], decisivos: [{ quem: 'ana', state: 'APPROVED' }] };
  skip.avisaBloqueioHistorico(e, { ...PR }, hist);
  skip.avisaBloqueioHistorico(e, { ...PR }, hist);
  assert.equal(e.toasts.length, 1, 'mesmo PR+head não repete o aviso');
  skip.avisaBloqueioHistorico(e, { ...PR }, { ...hist, head: 'sha2' });
  assert.equal(e.toasts.length, 2, 'head novo é decisão nova, avisa de novo');
  assert.equal(e.historicoAvisado.size, 1, 'a chave do head velho sai quando a do novo entra');
  assert.ok(e.historicoAvisado.has('o/r#1@sha2'));
});

test('podarHistoricoAvisado: memória some junto com o PR que saiu do panorama', () => {
  const e = engineFalso();
  e.historicoAvisado = new Set(['o/r#1@sha1', 'o/r#2@sha9']);
  skip.podarHistoricoAvisado(e, new Set(['o/r#1']));
  assert.deepEqual([...e.historicoAvisado], ['o/r#1@sha1']);
});

/* ---------- bloqueiaAutomatico: manual atravessa sem consultar nada ---------- */

test('bloqueiaAutomatico: pr.manual atravessa sem nenhuma chamada', async () => {
  const e = engineFalso({
    bloqueadoPorHistorico: async () => { throw new Error('clique manual não podia consultar o histórico'); },
  });
  assert.equal(await skip.bloqueiaAutomatico(e, { ...PR, manual: true }), false);
});

test('bloqueiaAutomatico: caminho automático bloqueado avisa e devolve true', async () => {
  const e = engineFalso({
    bloqueadoPorHistorico: async () => ({ bloqueado: true, head: 'sha1', quem: ['ana'], decisivos: [{ quem: 'ana', state: 'APPROVED' }] }),
  });
  assert.equal(await skip.bloqueiaAutomatico(e, { ...PR }), true);
  assert.equal(e.toasts.length, 1);
  assert.match(e.toasts[0].payload.text, /@ana já aprovou este head/);
});

/* ---------- fiação: os três caminhos automáticos ---------- */

const BLOQUEADO = { bloqueado: true, head: 'sha1', quem: ['ana'], decisivos: [{ quem: 'ana', state: 'APPROVED' }] };
const LIVRE = { bloqueado: false, head: 'sha1', quem: [], decisivos: [] };

function engineFiacao(extra = {}) {
  return {
    skipComentado: {},
    headlessQueue: [],
    activeReviews: new Map(),
    autoReviewParked: new Set(),
    retryAfterNet: new Map(),
    panorama: [],
    decisions: { pending: [] },
    staleInfo: {},
    reReviewLaunched: {},
    config: {},
    token: 'tok',
    queue: [],
    toasts: [],
    seenKeys: [],
    refreshTokens: async () => { },
    // os stubs delegam no módulo de verdade: é a fiação que estes testes provam
    enqueueHeadless(pr) { return reviewMod.enqueueHeadless(this, pr); },
    bloqueiaAutomatico(pr) { return skip.bloqueiaAutomatico(this, pr); },
    bloqueadoPorHistorico: async () => LIVRE,
    // gate de checks obrigatorios livre por padrao: a suite dele e
    // test/checks-obrigatorios.test.js, e aqui o que se prova e a fiacao do historico
    bloqueadoPorChecks: async () => ({ bloqueado: false, faltando: [] }),
    prFromUrl: (u) => ({ key: 'o/r#1', url: u, repo: 'o/r', number: 1 }),
    accountForPr: () => 'eu',
    isMuted: () => false,
    autoReviewFor: () => true,
    tokenFor: () => 'tok',
    budgetBlockedFor: () => null,
    outrosRevisando: () => [],
    markSeen(k) { this.seenKeys.push(k); },
    unsee() { },
    saveAutoReviewParked() { },
    saveSkipComentado() { },
    saveReReviewLaunched() { },
    writeInflight() { },
    processHeadless() { },
    pushState() { },
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    log() { },
    ...extra,
  };
}

// caminho 1: o disparo do toReview (launchReview automático)
test('launchReview automático bloqueado: nada enfileira e o PR fica na fila visível', async () => {
  const e = engineFiacao({ bloqueadoPorHistorico: async () => BLOQUEADO });
  e.queue = [{ ...PR }];
  const r = await reviewMod.launchReview(e, [PR.url], 'auto');
  assert.equal(r.ok, false);
  assert.equal(e.headlessQueue.length, 0, 'nenhuma sessão enfileirada');
  assert.equal(e.queue.length, 1, 'o card continua na fila, com o botão Revisar valendo');
  assert.deepEqual(e.seenKeys, [], 'nem o markSeen roda: o PR fica exatamente onde estava');
  assert.equal(e.toasts.filter(t => t.ev === 'toast').length, 1, 'o aviso sai uma vez');
});

test('launchReview por clique atravessa o bloqueio (ação manual sempre vale)', async () => {
  const e = engineFiacao({
    bloqueadoPorHistorico: async () => { throw new Error('clique não podia consultar o histórico'); },
  });
  e.queue = [{ ...PR }];
  const r = await reviewMod.launchReview(e, [PR.url], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.equal(e.headlessQueue.length, 1, 'o clique revisa');
});

// caminho 2: o round automático pós-push (launchReReviews)
/* CONTRATO INVERTIDO EM 29/08/2026, e de propósito. A versão anterior deste
   teste exigia que o bloqueio GRAVASSE a âncora do head, para o caminho
   automático não reconsultar o mesmo head a cada ciclo. O efeito colateral, que
   o teste não via, é que a âncora é justamente o que o classificaReRound usa
   pra dizer "esse head já teve o round dele": com ela gravada por um round que
   NUNCA rodou, o relançamento automático morria pra sempre naquele head e o PR
   passava a depender de clique. Foi o bug de campo do Wanderson ("entra um
   commit novo, a review não fica automática e depende de ação manual").
   O controle de custo continua, agora em `bloqueioConsultado`: memória, não
   decisão, com janela de HEAD_QUIETO_MS (ver test/rereview-launch.test.js). */
test('launchReReviews bloqueado: não enfileira, não mede diff, e a âncora NÃO é gravada', async () => {
  const e = engineFiacao({
    bloqueadoPorHistorico: async () => BLOQUEADO,
    fetchPrFiles: async () => { throw new Error('bloqueado não podia nem medir o diff'); },
  });
  e.panorama = [{ ...PR, isDraft: false }];
  e.staleInfo['o/r#1'] = { stale: true, head: 'sha2', lastState: 'APPROVED' };
  e.headQuietoDesde = { 'o/r#1': { head: 'sha2', at: 0 } };
  await reviewMod.launchReReviews(e);
  assert.equal(e.headlessQueue.length, 0, 'round automático não abre sessão');
  assert.equal(e.reReviewLaunched['o/r#1'], undefined,
    'round que não rodou não pode gastar a âncora do head');
  assert.equal((e.bloqueioConsultado['o/r#1'] || {}).head, 'sha2',
    'o custo de gh fica controlado pela memória do bloqueio, que não mata o round');
});

test('launchReReviews livre: segue enfileirando como sempre', async () => {
  const e = engineFiacao();
  e.panorama = [{ ...PR, isDraft: false }];
  e.staleInfo['o/r#1'] = { stale: true, head: 'sha2', lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde = { 'o/r#1': { head: 'sha2', at: 0 } };
  await reviewMod.launchReReviews(e);
  assert.equal(e.headlessQueue.length, 1, 'sem histórico decisivo, o round roda');
});

// caminho 3: o retry pós-transitório (_repescarRetry no server.js)
function engineRetry() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.saveSeen = () => { };
  e.prState = async () => 'OPEN';
  return e;
}

test('retry pós-transitório bloqueado: não enfileira e a entrada do retry morre', async () => {
  const e = engineRetry();
  e.bloqueadoPorHistorico = async () => BLOQUEADO;
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR } });
  e.retryTargets = () => [{ ...PR }];
  const enfileirados = [];
  e.enqueueHeadless = (pr) => enfileirados.push(pr);
  await e._repescarRetry([], new Set());
  assert.equal(enfileirados.length, 0, 'o retry não fura o gate');
  assert.equal(e.retryAfterNet.has(PR.key), false, 'a promessa "retomo sozinho" caducou junto');
});

test('retry pós-transitório livre: relança como sempre relançou', async () => {
  const e = engineRetry();
  e.bloqueadoPorHistorico = async () => LIVRE;
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR } });
  e.retryTargets = () => [{ ...PR }];
  const enfileirados = [];
  e.enqueueHeadless = (pr) => enfileirados.push(pr);
  await e._repescarRetry([], new Set());
  assert.equal(enfileirados.length, 1);
});
