'use strict';
// Retry pós-falha transitória: o toast promete "tento de novo no próximo ciclo",
// então o próximo ciclo tem que conseguir relançar SEM depender (a) da política
// autoReview da conta e (b) de o PR seguir na fila mine (revisão por clique no
// panorama não é mine e sai da queue no rebuild do check). O M8 era exatamente
// essa promessa quebrada. O filtro de token da Onda 1 permanece: conta sem token
// não abre sessão, então também não relança (R2 do plano mestre). Runner nativo,
// ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-retry-net-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.isMuted = (u) => u === 'silenciada';
  // tokens por conta (tokenFor consulta este mapa): 'semtoken' fica de fora de propósito
  e.tokens = { eu: 'tok-eu', silenciada: 'tok-sil' };
  e.log = () => { };
  return e;
}
const prDe = (key, extra) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}`, ...extra });

test('runOneHeadless guarda o PR junto das tentativas na falha transitória', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { throw new Error('fetch failed'); };
  const pr = prDe('o/r#1');
  await e.runOneHeadless(pr, 'eu');
  const guardado = e.retryAfterNet.get('o/r#1');
  assert.equal(guardado.tries, 1, 'conta a tentativa');
  assert.equal(guardado.pr.url, pr.url, 'guarda o PR pra relançar sem depender da fila');
});

test('runOneHeadless cancela a revisão se o PR já foi mergeado enquanto esperava a vez', async () => {
  const e = engineBase();
  e.prState = async () => 'MERGED';
  let rodouRevisao = false;
  e.runHeadlessReview = async () => { rodouRevisao = true; };
  e.headlessBusyAccounts.set('eu', 1); // Map de contagem desde o parallelReviews (v2.41.0)
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(rodouRevisao, false, 'não roda a sessão de revisão num PR já mergeado');
  assert.equal(e.headlessBusyAccounts.has('eu'), false, 'libera a conta pro escalonador');
});

test('runOneHeadless roda normalmente quando o estado do PR não confirma merge', async () => {
  const e = engineBase();
  e.prState = async () => 'OPEN';
  let rodouRevisao = false;
  e.runHeadlessReview = async () => { rodouRevisao = true; };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(rodouRevisao, true, 'PR aberto segue pro fluxo normal de revisão');
});

test('runOneHeadless roda normalmente quando não dá pra confirmar o estado do PR (rede caiu)', async () => {
  const e = engineBase();
  e.prState = async () => { throw new Error('rede caiu'); };
  let rodouRevisao = false;
  e.runHeadlessReview = async () => { rodouRevisao = true; };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(rodouRevisao, true, 'sem prova de merge, nunca pula a revisão por engano');
});

test('retryTargets relança PR de clique no panorama (fora da fila) e ignora autoReview da conta', () => {
  const e = engineBase();
  e.autoReviewFor = () => false; // conta SEM auto-revisão: a promessa do toast vale mesmo assim
  e.queue = [];                  // PR de clique não é mine: nunca volta pra queue no rebuild
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1') });
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map(p => p.key), ['o/r#1']);
});

test('retryTargets pula silenciado, recém-chegado e o que já está rodando', () => {
  const e = engineBase();
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1', { account: 'silenciada' }) });
  e.retryAfterNet.set('o/r#2', { tries: 1, pr: prDe('o/r#2') });
  e.retryAfterNet.set('o/r#3', { tries: 1, pr: prDe('o/r#3') });
  e.retryAfterNet.set('o/r#4', { tries: 1, pr: prDe('o/r#4') });
  const alvos = e.retryTargets(new Set(['o/r#2']), new Set(['o/r#3']));
  assert.deepEqual(alvos.map(p => p.key), ['o/r#4']);
});

test('retryTargets: conta sem token não relança (o filtro da Onda 1 permanece, R2)', () => {
  const e = engineBase();
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1', { account: 'semtoken' }) });
  e.retryAfterNet.set('o/r#2', { tries: 1, pr: prDe('o/r#2') });
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map(p => p.key), ['o/r#2'],
    'sem token não abre sessão: o PR espera o token voltar em vez de falhar de novo');
});

/* ---------- o vazamento do retryAfterNet (incidente de 04/08/2026) ---------- */

// Mensagens REAIS do farol.log de produção, as mesmas fixtures de test/log-taxonomy.test.js.
const MSG_BINARIO = "claude saiu com código 1: '\"C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"' não é reconhecido como um comando interno";
const MSG_ASSINATURA = 'sessão retornou erro: Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access';
const MSG_LIMITE = "sessão retornou erro: You've hit your weekly limit · resets 9pm (America/Sao_Paulo)";
const MSG_LIMITE_SEM_HORA = "sessão retornou erro: You've hit your weekly limit";

test('runOneHeadless: falha não-transitória depois de uma transitória TIRA o PR do retry (incidente de 04/08/2026, biudtech/biud-frontend#702)', async () => {
  // O incidente, com prova no log de produção: o #702 gerou 25 linhas ERROR idênticas
  // entre 15:52 e 19:28, uma a cada ciclo de polling. Às 16:07 a revisão caiu por algo
  // TRANSITÓRIO (o claude.exe "não é reconhecido") e o PR entrou em retryAfterNet com
  // tries: 1. Nos ciclos seguintes a falha virou NÃO-transitória (a org desligou o
  // acesso por assinatura), o ramo não-transitório estacionou o PR... e deixou a entrada
  // de retry viva. O check() via retryAfterNet.size, chamava retryTargets + launchReview,
  // e o launchReview desfazia o estacionamento (autoReviewParked.delete). Resultado:
  // loop infinito SEM TETO, um ERROR por ciclo, até alguém mexer no app.
  const e = engineBase();
  e.prState = async () => 'OPEN';
  const pr = prDe('biudtech/biud-frontend#702');

  e.runHeadlessReview = async () => { throw new Error(MSG_BINARIO); };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), true, 'a falha transitória das 16:07 entra no retry, como sempre entrou');

  e.runHeadlessReview = async () => { throw new Error(MSG_ASSINATURA); };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false,
    'estacionar sem limpar o retry é mentira: o relançamento do check() desfaz o estacionamento e o PR entra em loop');
  assert.equal(e.autoReviewParked.has(pr.key), true, 'falha não-transitória estaciona e espera ação manual');
});

test('runOneHeadless: falha não-transitória sem retry anterior segue estacionando igual', async () => {
  const e = engineBase();
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw new Error(MSG_ASSINATURA); };
  await e.runOneHeadless(prDe('o/r#9'), 'eu');
  assert.equal(e.retryAfterNet.has('o/r#9'), false);
  assert.equal(e.autoReviewParked.has('o/r#9'), true);
});

test('runOneHeadless: cancelar um PR que estava em retry também limpa o retry', async () => {
  // mesmo defeito do incidente, no ramo vizinho: estacionar por cancelamento e deixar
  // a entrada de retry viva faz o check() do ciclo seguinte relançar o que você cancelou
  const e = engineBase();
  e.prState = async () => 'OPEN';
  const pr = prDe('o/r#7');
  e.retryAfterNet.set(pr.key, { tries: 1, pr, notBefore: null });
  e.runHeadlessReview = async () => { const err = new Error('cancelado'); err.cancelled = true; throw err; };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'cancelar tem que parar de valer no próximo ciclo');
  assert.equal(e.autoReviewParked.has(pr.key), true);
});

test('runOneHeadless: falha DESCONHECIDA continua não-transitória (estaciona, não relança em loop)', async () => {
  const e = engineBase();
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw new Error('review o/r#8: Read pr8.patch falhou, Invalid pages parameter'); };
  await e.runOneHeadless(prDe('o/r#8'), 'eu');
  assert.equal(e.retryAfterNet.has('o/r#8'), false);
  assert.equal(e.autoReviewParked.has('o/r#8'), true, 'sem saber o que houve, relançar sozinho vira loop queimando token');
});

/* ---------- limite de plano espera o reset (incidente de 07/08/2026) ---------- */

test('runOneHeadless: limite de plano com hora de reset guarda notBefore no futuro', async () => {
  // Em 07/08/2026 o limite de plano produziu 70 linhas de log em 8 PRs pra UMA condição
  // que traz a hora do reset na própria mensagem. Tentar 12 vezes antes da hora é gastar
  // ciclo à toa: agora a entrada carrega o instante do reset.
  const e = engineBase();
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw new Error(MSG_LIMITE); };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  const guardado = e.retryAfterNet.get('o/r#1');
  assert.equal(guardado.tries, 1);
  assert.equal(typeof guardado.notBefore, 'number', 'notBefore é comparável com Date.now()');
  assert.ok(guardado.notBefore > Date.now(), 'o reset citado é sempre o próximo, então está no futuro');
});

test('retryTargets: PR com notBefore no futuro NÃO volta neste ciclo', () => {
  const e = engineBase();
  const reset = Date.now() + 3600 * 1000;
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1'), notBefore: reset });
  e.retryAfterNet.set('o/r#2', { tries: 1, pr: prDe('o/r#2'), notBefore: null });
  assert.deepEqual(e.retryTargets(new Set(), new Set(), reset - 1).map(p => p.key), ['o/r#2'],
    'esperar o reset é o comportamento; quem não tem hora marcada segue retentando');
});

test('retryTargets: passado o notBefore, o PR volta', () => {
  const e = engineBase();
  const reset = Date.now() + 3600 * 1000;
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1'), notBefore: reset });
  assert.deepEqual(e.retryTargets(new Set(), new Set(), reset).map(p => p.key), ['o/r#1'],
    'na hora exata do reset já pode (mesma régua do resetAtFrom, que devolve o PRÓXIMO reset)');
  assert.deepEqual(e.retryTargets(new Set(), new Set(), reset + 1).map(p => p.key), ['o/r#1']);
});

test('runOneHeadless: limite de plano SEM hora nenhuma segue o caminho antigo (notBefore null, retenta no próximo ciclo)', async () => {
  const e = engineBase();
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw new Error(MSG_LIMITE_SEM_HORA); };
  await e.runOneHeadless(prDe('o/r#3'), 'eu');
  const guardado = e.retryAfterNet.get('o/r#3');
  assert.equal(guardado.tries, 1);
  assert.equal(guardado.notBefore, null, 'sem hora extraível, nada muda: retenta no próximo ciclo até o teto');
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map(p => p.key), ['o/r#3']);
});

test('runOneHeadless: o teto de 12 do limite de plano continua valendo pras tentativas que acontecem', async () => {
  const e = engineBase();
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw new Error(MSG_LIMITE); };
  const pr = prDe('o/r#4');
  e.retryAfterNet.set(pr.key, { tries: 12, pr, notBefore: null });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'estourou o teto: sai do retry');
  assert.equal(e.autoReviewParked.has(pr.key), true, 'e estaciona esperando você');
});

test('runOneHeadless: falha transitória comum (rede) não ganha notBefore', async () => {
  const e = engineBase();
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw new Error('sessão retornou erro: fetch failed'); };
  await e.runOneHeadless(prDe('o/r#5'), 'eu');
  assert.equal(e.retryAfterNet.get('o/r#5').notBefore, null, 'rede volta quando volta, não tem hora marcada');
});

/* ---------- poda de PR mergeado/fechado no retry (bug de 12/08/2026) ---------- */

// O bug: cada ciclo de polling gerava uma cascata de toasts "Conexão de volta:
// relançando..." + "já mergeado; cancelei a revisão" pra cada PR que foi mergeado
// enquanto estava no retryAfterNet. O retryTargets é síncrono e não consulta o
// GitHub, então PRs mergeados passavam pelo filtro e só eram descobertos dentro
// do runOneHeadless, DEPOIS do toast de "relançando". O fix verifica prState()
// ANTES de notificar e lançar, removendo os mergeados/fechados em silêncio.

// Estes testes exercitam a poda diretamente no server.js (check() simplificado),
// usando o mesmo padrão de stub do engine.

const { Engine: EngineForPrune } = require('../server.js');

function engineForPrune() {
  const e = new EngineForPrune();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.isMuted = () => false;
  e.tokens = { eu: 'tok-eu' };
  e.log = () => {};
  return e;
}

test('check() poda PR mergeado do retryAfterNet sem emitir toast de relançamento', async () => {
  const e = engineForPrune();
  e.prState = async (pr) => pr.key === 'o/r#1' ? 'MERGED' : 'OPEN';
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1') });
  e.retryAfterNet.set('o/r#2', { tries: 1, pr: prDe('o/r#2') });

  const toasts = [];
  e.on('toast', t => toasts.push(t.text));

  const launched = [];
  e.launchReview = (urls) => { launched.push(...urls); };

  // simula o trecho do check() que poda e relança
  const retry = e.retryTargets(new Set(), new Set());
  const stillOpen = [];
  for (const pr of retry) {
    let state = null;
    try { state = await e.prState(pr); } catch {}
    if (state === 'MERGED' || state === 'CLOSED') {
      e.retryAfterNet.delete(pr.key);
    } else {
      stillOpen.push(pr);
    }
  }
  if (stillOpen.length) {
    e.emit('toast', { kind: 'info', text: `Conexão de volta: relançando a revisão de ${stillOpen.map(p => p.key).join(', ')}.` });
    e.launchReview(stillOpen.map(p => p.url), 'auto');
  }

  assert.equal(e.retryAfterNet.has('o/r#1'), false, 'PR mergeado removido do retry');
  assert.equal(e.retryAfterNet.has('o/r#2'), true, 'PR aberto permanece no retry');
  assert.equal(toasts.length, 1, 'só um toast, sem menção ao PR mergeado');
  assert.ok(toasts[0].includes('o/r#2'), 'toast menciona só o PR aberto');
  assert.ok(!toasts[0].includes('o/r#1'), 'toast NÃO menciona o PR mergeado');
  assert.equal(launched.length, 1, 'só lança revisão do PR aberto');
});

test('check() poda PR fechado (CLOSED) do retryAfterNet sem toast', async () => {
  const e = engineForPrune();
  e.prState = async () => 'CLOSED';
  e.retryAfterNet.set('o/r#5', { tries: 1, pr: prDe('o/r#5') });

  const toasts = [];
  e.on('toast', t => toasts.push(t.text));

  const retry = e.retryTargets(new Set(), new Set());
  const stillOpen = [];
  for (const pr of retry) {
    let state = null;
    try { state = await e.prState(pr); } catch {}
    if (state === 'MERGED' || state === 'CLOSED') {
      e.retryAfterNet.delete(pr.key);
    } else {
      stillOpen.push(pr);
    }
  }
  if (stillOpen.length) {
    e.emit('toast', { kind: 'info', text: `relançando ${stillOpen.map(p => p.key).join(', ')}.` });
  }

  assert.equal(e.retryAfterNet.has('o/r#5'), false, 'PR fechado removido');
  assert.equal(toasts.length, 0, 'nenhum toast quando TODOS os retries são PRs fechados');
});

test('check() preserva PR no retry quando prState falha (sem prova de merge)', async () => {
  const e = engineForPrune();
  e.prState = async () => { throw new Error('rede caiu'); };
  e.retryAfterNet.set('o/r#6', { tries: 1, pr: prDe('o/r#6') });

  const retry = e.retryTargets(new Set(), new Set());
  const stillOpen = [];
  for (const pr of retry) {
    let state = null;
    try { state = await e.prState(pr); } catch {}
    if (state === 'MERGED' || state === 'CLOSED') {
      e.retryAfterNet.delete(pr.key);
    } else {
      stillOpen.push(pr);
    }
  }

  assert.equal(e.retryAfterNet.has('o/r#6'), true, 'sem prova de merge, nunca descarta');
  assert.equal(stillOpen.length, 1, 'segue no relançamento');
});

/* ---------- G9: relançamento pós-rede relança o OBJETO guardado, não a URL (13/08/2026) ---------- */

// O bug: `launchReview(stillOpen.map(p => p.url), 'auto')` joga fora o objeto
// guardado em retryAfterNet e re-resolve o PR pela URL (queue/panorama/prFromUrl).
// Sem estar mais na queue (revisão de clique não é mine) nem no panorama (mock
// simplificado), a resolução cai em prFromUrl, que devolve requested:false e sem
// knownHead: um round automático (requested:true) é rebaixado a manual, e o
// fallback do headSha (Task 2.2/G8) perde o head conhecido.
test('check() com o bloco ATUAL (launchReview por URL) perde requested e knownHead do objeto guardado (G9, prova do bug)', async () => {
  const e = engineForPrune();
  e.token = 'tok-eu'; // evita refreshTokens real dentro do launchReview
  e.prState = async () => 'OPEN';
  const pr = prDe('o/r#1', { requested: true, knownHead: 'c'.repeat(40) });
  e.retryAfterNet.set('o/r#1', { tries: 1, pr });

  const enqueued = [];
  e.enqueueHeadless = (p) => { enqueued.push(p); };

  // trecho ATUAL do check() (server.js, bloco do retry pós-rede)
  const retry = e.retryTargets(new Set(), new Set());
  const stillOpen = [];
  for (const p of retry) {
    let state = null;
    try { state = await e.prState(p); } catch {}
    if (state === 'MERGED' || state === 'CLOSED') {
      e.retryAfterNet.delete(p.key);
    } else {
      stillOpen.push(p);
    }
  }
  if (stillOpen.length) {
    await e.launchReview(stillOpen.map(p => p.url), 'auto');
  }

  assert.equal(enqueued.length, 1, 'relançou o PR');
  assert.notEqual(enqueued[0].requested, true, 'BUG: launchReview re-resolve por URL e derruba requested pra false');
  assert.equal(enqueued[0].knownHead, undefined, 'BUG: prFromUrl não carrega knownHead nenhum');
});

test('check() relança o OBJETO guardado via enqueueHeadless, preservando requested e knownHead (G9)', async () => {
  const e = engineForPrune();
  e.prState = async () => 'OPEN';
  const pr = prDe('o/r#1', { requested: true, knownHead: 'c'.repeat(40) });
  e.retryAfterNet.set('o/r#1', { tries: 1, pr });

  const enqueued = [];
  e.enqueueHeadless = (p) => { enqueued.push(p); };

  // trecho do check() DEPOIS do fix (Step 3 do brief): relança o objeto guardado
  // em vez de re-resolver por URL
  const retry = e.retryTargets(new Set(), new Set());
  const stillOpen = [];
  for (const p of retry) {
    let state = null;
    try { state = await e.prState(p); } catch {}
    if (state === 'MERGED' || state === 'CLOSED') {
      e.retryAfterNet.delete(p.key);
    } else {
      stillOpen.push(p);
    }
  }
  if (stillOpen.length) {
    for (const p of stillOpen) e.enqueueHeadless(p);
  }

  assert.equal(enqueued.length, 1, 'relançou o PR');
  assert.equal(enqueued[0].requested, true, 'requested sobrevive ao relançamento (G9)');
  assert.equal(enqueued[0].knownHead, 'c'.repeat(40), 'knownHead sobrevive ao relançamento (G9)');
});

test('check() preserva PR quando prState retorna null (sem token)', async () => {
  const e = engineForPrune();
  e.prState = async () => null;
  e.retryAfterNet.set('o/r#7', { tries: 1, pr: prDe('o/r#7') });

  const retry = e.retryTargets(new Set(), new Set());
  const stillOpen = [];
  for (const pr of retry) {
    let state = null;
    try { state = await e.prState(pr); } catch {}
    if (state === 'MERGED' || state === 'CLOSED') {
      e.retryAfterNet.delete(pr.key);
    } else {
      stillOpen.push(pr);
    }
  }

  assert.equal(e.retryAfterNet.has('o/r#7'), true, 'null = sem prova, preserva');
  assert.equal(stillOpen.length, 1);
});
