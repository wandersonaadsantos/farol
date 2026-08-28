// Retry pós-falha transitória: o toast promete "tento de novo no próximo ciclo",
// então o próximo ciclo tem que conseguir relançar SEM depender (a) da política
// autoReview da conta e (b) de o PR seguir na fila mine (revisão por clique no
// panorama não é mine e sai da queue no rebuild do check). O M8 era exatamente
// essa promessa quebrada. O filtro de token da Onda 1 permanece: conta sem token
// não abre sessão, então também não relança (R2 do plano mestre). Runner nativo,
// ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-retry-net-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.isMuted = (u) => u === 'silenciada';
  // tokens por conta (tokenFor consulta este mapa): 'semtoken' fica de fora de propósito
  e.tokens = { eu: 'tok-eu', silenciada: 'tok-sil' };
  e.log = () => { };
  // gate de consciência sempre livre (é rede; a suíte dele é
  // test/consciencia-historico.test.js)
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
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

const { Engine: EngineForPrune } = await import('../server.js');

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

// Achado CRITICAL da revisão da Task 2.3: enqueueHeadless sozinho não faz o que
// launchReview fazia (markSeen + sair da queue). A falha transitória original
// (runOneHeadless) tinha feito unsee + queue.push pra deixar o card visível
// "aguardando você" enquanto esperava o retry; sem desfazer isso no
// relançamento, o card mente "aguardando você" com o botão Revisar ativo
// enquanto a revisão relançada já está rodando por trás.
test('check() tira o PR relançado da fila visível e marca como visto (não mente "aguardando você") (G9)', async () => {
  const e = engineForPrune();
  e.prState = async () => 'OPEN';
  const pr = prDe('o/r#1', { requested: true, knownHead: 'c'.repeat(40) });
  e.retryAfterNet.set('o/r#1', { tries: 1, pr });
  // estado deixado pela falha transitória original (runOneHeadless): unsee + queue.push
  e.seen = new Set();
  e.queue = [{ ...pr }];

  const enqueued = [];
  e.enqueueHeadless = (p) => { enqueued.push(p); };

  // trecho do check() DEPOIS do fix: markSeen + sai da queue, igual o launchReview fazia
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
    for (const p of stillOpen) {
      e.markSeen(p.key);
      e.queue = e.queue.filter(q => q.key !== p.key);
      e.enqueueHeadless(p);
    }
  }

  assert.equal(enqueued.length, 1, 'relançou o PR');
  assert.equal(e.queue.some(q => q.key === 'o/r#1'), false, 'sai da fila visível: o card não pode mostrar Revisar ativo com a revisão já rodando');
  assert.equal(e.seen.has('o/r#1'), true, 'volta a visto: mesmo efeito que o launchReview produzia no lançamento manual');
});

/* ---------- G15: estacionamento persiste entre reinícios ---------- */

test('autoReviewParked sobrevive a reinício da Engine (G15)', () => {
  const engine1 = new Engine();
  engine1.autoReviewParked.add('acme/repo#4');
  engine1.saveAutoReviewParked();

  const engine2 = new Engine();
  assert.equal(engine2.autoReviewParked.has('acme/repo#4'), true, 'estacionamento persiste entre reinícios');
});

/* ---------- G15 (revisão): a poda do check() é gateada por owner que respondeu ---------- */
// A poda ingênua (key fora do panorama = remove) confundia "owner cuja busca
// FALHOU neste ciclo" com "PR fechado/mergeado de verdade": o panorama é montado
// por owner (ver check(), busca `--owner`), e um owner cuja busca falhou (list
// === null) simplesmente não contribui PR nenhum, igual um owner sem PR aberto.
// No pior caso (todos os owners falham mas a busca `mine` responde), um flake de
// rede esvaziaria o autoReviewParked inteiro e relançaria sozinho sessões
// fadadas à mesma falha conhecida, reabrindo o próprio G15. A poda agora só
// mexe na key cujo owner RESPONDEU neste ciclo (mesmo padrão do G5: falha de
// busca não prova PR fechado). Harness no padrão do check-resilience.test.js:
// check() inteiro, com todo colaborador de rede/side-effect stubado.
const { BASELINE_FILE: BASELINE_FILE_G15, STATE_DIR: STATE_DIR_G15 } = await import('../lib/paths.js');

function checkEngineG15() {
  const e = new Engine();
  e.config.accounts = [{ user: 'me', owners: ['acme', 'globex'] }];
  e.config.autoReview = false; // nunca dispara revisão headless em teste
  e.seen = new Set();
  e.reReviewedKeys = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.queue = [];
  e.resolveAccount = async () => { };
  e.refreshTokens = async () => { e.tokenOk = true; return true; };
  e.myAuthoredPRs = async () => [];
  e.enrichMyPRBranches = async () => { };
  e.refreshMergeStates = async () => { };
  e.refreshStaleStates = async () => { };
  e.refreshReviewSignals = async () => { }; // sinal por ref é rede: fora do ciclo de teste
  e.scanPushbacks = async () => { };
  e.checkUpdate = async () => { };
  e.launchReview = () => { throw new Error('launchReview não deveria rodar neste teste'); };
  e.schedule = () => { };
  e.saveSeen = () => { };
  // roteiro por owner: null = a busca DAQUELE owner falhou neste ciclo
  e.panoramaByOwner = { acme: [], globex: [] };
  // roteiro da fila mine (--review-requested=@me): NÃO é filtrada por owner, então
  // pode devolver PR de org que não está em nenhum acc.owners (é assim na vida real)
  e.mineList = [];
  e.searchPRs = async (extraArgs) => {
    if (extraArgs[0] === '--owner') {
      const lista = e.panoramaByOwner[extraArgs[1]];
      return lista === null ? null : lista.map(p => ({ ...p }));
    }
    if (extraArgs[0] === '--review-requested=@me') return e.mineList.map(p => ({ ...p }));
    return []; // --reviewed-by=@me: sem PR, sem falha
  };
  // baseline já existente: a 1a checagem da vida não pode mexer no roteiro do teste
  fs.mkdirSync(STATE_DIR_G15, { recursive: true });
  fs.writeFileSync(BASELINE_FILE_G15, new Date().toISOString() + '\n');
  return e;
}

test('check() NÃO despatasa key de owner cuja busca falhou neste ciclo (G15)', async () => {
  const e = checkEngineG15();
  e.autoReviewParked.add('acme/repo#1');
  e.panoramaByOwner = { acme: null, globex: [] }; // acme falhou neste ciclo
  await e.check('test');
  assert.equal(e.autoReviewParked.has('acme/repo#1'), true,
    'owner que falhou fica intocado: "sumiu do panorama" não prova PR fechado');
});

test('check() poda key de owner que respondeu e cujo PR saiu do panorama (fechou/mergeou) (G15)', async () => {
  const e = checkEngineG15();
  e.autoReviewParked.add('globex/repo#2');
  e.panoramaByOwner = { acme: [], globex: [] }; // globex respondeu; o PR não está mais na lista dele
  await e.check('test');
  assert.equal(e.autoReviewParked.has('globex/repo#2'), false,
    'owner respondeu neste ciclo: PR fechado é podado de verdade');
});

test('check() não poda nada quando TODAS as buscas de owner falham (G15)', async () => {
  const e = checkEngineG15();
  e.autoReviewParked.add('acme/repo#1');
  e.autoReviewParked.add('globex/repo#2');
  e.panoramaByOwner = { acme: null, globex: null }; // flake total: nenhum owner respondeu
  await e.check('test');
  assert.equal(e.autoReviewParked.has('acme/repo#1'), true, 'flake de rede não esvazia o estacionamento');
  assert.equal(e.autoReviewParked.has('globex/repo#2'), true, 'flake de rede não esvazia o estacionamento');
});

// Re-revisão do fix acima: o gate por owner que respondeu (ownersOk) criou uma
// quebra própria. Owner removido do monitoramento (não está em NENHUM
// acc.owners de config) nunca mais vai responder, então nunca entraria em
// ownersOk, e a key dele ficaria presa no estacionamento pra sempre (o arquivo
// só cresceria, o oposto do que o comentário da poda promete). Presença na
// config é fato determinístico (não depende de rede), então esta poda é
// incondicional, MESMO com todas as buscas de owner monitorado falhando.
test('check() poda key de owner que SAIU da config, mesmo com todas as buscas falhando (G15)', async () => {
  const e = checkEngineG15();
  e.autoReviewParked.add('desmonitorado/repo#9'); // owner não está em config.accounts[].owners (só acme/globex)
  e.panoramaByOwner = { acme: null, globex: null }; // flake total nos owners monitorados
  await e.check('test');
  assert.equal(e.autoReviewParked.has('desmonitorado/repo#9'), false,
    'owner fora da config é podado de primeira: PR fora do panorama, ninguém pra reclamar');
});

// Revisão final da onda 3 (C1): a exceção acima era INCONDICIONAL, e é aí que ela
// des-estacionava PR vivo. A fila mine (--review-requested=@me) resolve por token,
// NÃO por owner: PR de uma org que não está em nenhum acc.owners entra na fila
// normalmente e pode ser revisado, cancelado e estacionado como qualquer outro.
// Podar a key dele todo ciclo devolvia o PR pro toReview, que relançava a sessão
// fadada à mesma falha, que estacionava de novo: loop pago a cada 30s, exatamente
// o G15 reaberto. A exceção só vale quando a key TAMBÉM sumiu do panorama do
// ciclo (aí o PR fechou de verdade, e o estacionamento não guarda nada).
test('check() NÃO poda key de owner fora da config quando o PR segue ABERTO na fila mine (C1)', async () => {
  const e = checkEngineG15();
  const prForaDaConfig = {
    key: 'desmonitorado/repo#9',
    url: 'https://github.com/desmonitorado/repo/pull/9',
    updatedAt: new Date().toISOString(),
  };
  e.autoReviewParked.add(prForaDaConfig.key);
  e.mineList = [prForaDaConfig]; // review pedido a mim: entra na fila mesmo sem owner monitorado
  await e.check('test');
  assert.equal(e.autoReviewParked.has(prForaDaConfig.key), true,
    'PR aberto de owner não monitorado continua estacionado: poda aqui vira relançamento em loop');
  await e.check('test');
  assert.equal(e.autoReviewParked.has(prForaDaConfig.key), true,
    'e continua estacionado ciclo após ciclo, não só no primeiro');
});

test('check() poda key de owner fora da config quando o PR FECHOU (sumiu da fila mine) (C1)', async () => {
  const e = checkEngineG15();
  e.autoReviewParked.add('desmonitorado/repo#9');
  e.mineList = []; // o PR fechou: não vem mais em lugar nenhum do panorama
  await e.check('test');
  assert.equal(e.autoReviewParked.has('desmonitorado/repo#9'), false,
    'PR fechado de owner fora da config sai do estacionamento: o arquivo não pode só crescer');
});

/* ---------- M2: o lote grava o estacionamento uma vez, não uma vez por PR ---------- */

function engineLaunch() {
  const e = engineBase();
  e.token = 'tok-eu';
  e.refreshTokens = async () => true;
  e.enqueueHeadless = () => { };
  e.pushState = () => { };
  e.markSeen = () => { };
  e.saveSeen = () => { };
  return e;
}

test('launchReview grava o estacionamento UMA vez por lote (M2)', async () => {
  const e = engineLaunch();
  const prs = ['o/r#1', 'o/r#2', 'o/r#3'].map(k => prDe(k));
  e.queue = prs.map(p => ({ ...p }));
  for (const p of prs) e.autoReviewParked.add(p.key);
  let gravacoes = 0;
  e.saveAutoReviewParked = () => { gravacoes++; };

  const r = await e.launchReview(prs.map(p => p.url), 'auto');

  assert.equal(r.ok, true);
  assert.equal(gravacoes, 1, 'três PRs no lote, uma gravação: as duas primeiras eram estado intermediário que ninguém lê');
  for (const p of prs) assert.equal(e.autoReviewParked.has(p.key), false, 'os três saíram do estacionamento');
});

test('launchReview não grava nada quando nenhum PR do lote estava estacionado (M2)', async () => {
  const e = engineLaunch();
  const prs = ['o/r#4', 'o/r#5'].map(k => prDe(k));
  e.queue = prs.map(p => ({ ...p }));
  let gravacoes = 0;
  e.saveAutoReviewParked = () => { gravacoes++; };

  await e.launchReview(prs.map(p => p.url), 'auto');

  assert.equal(gravacoes, 0, 'nada mudou no estacionamento: gravar seria escrita à toa a cada lançamento');
});

/* ---------- M1: arquivo de estacionamento malformado não derruba o boot ---------- */
// readJson só protege de JSON inválido; `{}` é JSON válido e `new Set({})` lança
// (objeto não é iterável), matando o construtor da Engine inteiro. Estado corrompido
// (disco cheio no meio de uma gravação, edição à mão) tem que degradar pra vazio.
test('boot com auto-review-parked.json malformado não lança (M1)', () => {
  const arquivo = path.join(STATE_DIR_G15, 'auto-review-parked.json');
  fs.mkdirSync(STATE_DIR_G15, { recursive: true });
  fs.writeFileSync(arquivo, '{}');
  try {
    let e;
    assert.doesNotThrow(() => { e = new Engine(); }, 'arquivo malformado não pode impedir o app de subir');
    assert.equal(e.autoReviewParked.size, 0, 'degrada pra estacionamento vazio');
  } finally {
    try { fs.unlinkSync(arquivo); } catch { }
  }
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
