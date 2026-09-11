// A revisão headless com a coordenação entre aparelhos ligada (D9, D11, D13, D14 e D19
// do contrato da sincronização). O gate mora em runClaudeStream; aqui a prova é o que o
// CHAMADOR faz com a resposta dele:
//   - bloqueio devolve o PR pra fila visível com uma espera anotada, e nunca estaciona
//     nem entra no retry (segurar não é falhar);
//   - recibo de outro aparelho não re-enfileira (o coordenador já marcou o PR como visto);
//   - lease perdido no meio da sessão não estaciona e não posta;
//   - cada desfecho grava o recibo DEPOIS de persistir o resultado local, e o que não
//     chegou a desfecho devolve o lease;
//   - as automações pulam PR segurado, e ele não conta como "esperando" na cota (D19).
// Com a coordenação DESLIGADA nada disto muda: a suíte inteira é a prova.
//
// Engine real com FAROL_HOME temporário (server.js alcança lib/paths.js, então await
// import) e sessão stubada no padrão de test/dedup-round.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-review-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const reviewMod = (await import('../lib/engine/review.js')).default;
const fanout = (await import('../lib/engine/fanout.js')).default;
const io = (await import('../lib/io.js')).default;

// fan-out neutro (sem gh) e o gh da label de "revisando" gravado em vez de rodar
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
const runOriginal = io.run;
let ghCalls = [];
io.run = async (cmd, args) => { ghCalls.push([cmd, ...args].join(' ')); return { ok: true, code: 0, stdout: '', stderr: '' }; };

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

beforeEach(() => { ghCalls = []; });

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const prDe = (key, extra = {}) => ({ key, repo: key.split('#')[0], number: Number(key.split('#')[1]), url: `https://github.com/${key.replace('#', '/pull/')}`, author: 'dev', requested: true, ...extra });

function envelopeApprove() {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.' } },
  };
}

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, completos: [], abortos: 0 };
  h.onLost = () => { };
  h.complete = async (op) => { h.completos.push(op); h.done = true; return { ok: true }; };
  h.abort = async () => { h.abortos++; h.done = true; };
  return h;
}

// sessão stubada: devolve `resposta` (objeto ou função) e guarda os opts que o
// runHeadlessReview mandou pro runClaudeStream. Imita o invólucro de session.js no
// ponto que importa aqui: com a coordenação ligada, opts.onAdmitted roda entre a
// admissão e o provedor, e nunca quando a admissão foi recusada. Resposta em função
// recebe `admitir` e decide quando (ou se) a admissão aconteceu.
function motor({ resposta, policy = 'approve', coordenacao = true } = {}) {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokenFor = () => 'tok-eu';
  e.isMuted = () => false;
  e.log = () => { };
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.prState = async () => 'OPEN';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => null;
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = () => { };
  e.myReviewsWithTime = async () => [];
  e.postados = [];
  e.postReview = async (pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.opts = [];
  e.runClaudeStream = async (prompt, opts) => {
    e.opts.push(opts);
    const admitir = async () => { if (coordenacao && typeof opts.onAdmitted === 'function') await opts.onAdmitted(null); };
    if (typeof resposta === 'function') return resposta(opts, admitir);
    if (!(resposta && resposta.blocked)) await admitir();
    return resposta;
  };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  if (coordenacao) e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  return e;
}

const bloqueio = (reason, detail = {}) => ({ blocked: true, coordination: { admitted: false, reason, detail }, text: '', sessionId: null });
const resultado = (envelope, handle) => ({ text: JSON.stringify({ result: JSON.stringify(envelope) }), sessionId: 's1', coordination: handle });

test('MAX_RODADAS_AUTO_DIA lê a fonte única do teto compartilhado', () => {
  assert.equal(reviewMod.MAX_RODADAS_AUTO_DIA, SYNC.DAILY_ROUNDS_MAX);
});

test('runHeadlessReview manda operationKind review e o contexto da coordenação', async () => {
  const e = motor({ resposta: bloqueio('indisponivel') });
  const pr = prDe('o/r#1', { rodadaAutomatica: true, manual: true, semCoordenacao: true, ignorarRecibo: false, account: 'eu' });
  await e.runHeadlessReview(pr);
  const op = e.opts[0];
  assert.equal(op.operationKind, 'review');
  assert.deepEqual(op.coordination, {
    prKey: 'o/r#1', account: 'eu', materialVersion: HEAD, headSha: HEAD, contaRodada: true, manual: true,
    semCoordenacao: true, ignorarRecibo: false,
    pr: { key: 'o/r#1', url: pr.url, repo: 'o/r', number: 1, author: 'dev', account: 'eu' },
  });
});

test('bloqueio alheio: volta pra fila, anota a espera, não estaciona e não entra no retry', async () => {
  const e = motor({ resposta: bloqueio('alheio', { deviceName: 'notebook', deviceId: 'd2', since: 1 }) });
  const pr = prDe('o/r#2');
  e.markSeen(pr.key);
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.seen.has(pr.key), false, 'unsee: o PR volta a ser elegível');
  assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1, 'volta VISÍVEL pra fila');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'nunca estaciona');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'nunca entra no retry');
  const espera = e.sync.espera[pr.key];
  assert.equal(espera.reason, 'alheio');
  assert.equal(espera.deviceName, 'notebook');
  assert.ok(espera.until > Date.now(), 'a espera vale por um tempo');
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.pending.length, 0, 'bloqueio não vira pendência');
  assert.ok(e.toasts.every((t) => t.kind === 'info'), 'segurar não é falhar');
  assert.ok(e.toasts.some((t) => /notebook/.test(t.text)), 'o aviso diz qual aparelho está com o PR');
});

// A label pública só entra depois da admissão: recusada, nada é escrito no GitHub. Antes
// ela entrava no início da revisão, e cada recusa virava um add e um remove sem sessão
// nenhuma (a espera de 'indisponivel' é de segundos), ou uma label presa quando o lease
// alheio era de pushback, que não põe label.
for (const reason of ['alheio', 'recibo', 'esgotado', 'indisponivel']) {
  test(`admissão recusada (${reason}) não escreve a label de revisando no GitHub`, async () => {
    const e = motor({ resposta: bloqueio(reason, { deviceName: 'notebook', operationKind: 'pushback' }) });
    await e.runHeadlessReview(prDe('o/r#3'));
    assert.equal(ghCalls.some((c) => c.includes('--add-label')), false);
    assert.equal(ghCalls.some((c) => c.includes('--remove-label')), false);
  });
}

test('coordenação desligada: a label entra no início, como sempre', async () => {
  const e = motor({ resposta: resultado(envelopeApprove(), null), coordenacao: false });
  await e.runHeadlessReview(prDe('o/r#21'));
  assert.ok(ghCalls.some((c) => c.includes('--add-label')));
  assert.ok(ghCalls.some((c) => c.includes('--remove-label')));
});

test('bloqueio por recibo: não estaciona, não re-enfileira e não anota espera', async () => {
  const e = motor({ resposta: bloqueio('recibo', { deviceName: 'desktop' }) });
  const pr = prDe('o/r#4');
  e.markSeen(pr.key);
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.seen.has(pr.key), true, 'o coordenador marcou visto e ele fica visto');
  assert.equal(e.queue.some((p) => p.key === pr.key), false, 'não volta pra fila');
  assert.equal(e.autoReviewParked.has(pr.key), false);
  assert.equal(e.retryAfterNet.has(pr.key), false);
  assert.equal(e.sync.espera[pr.key], undefined, 'recibo não é espera');
  assert.equal(ghCalls.some((c) => c.includes('--add-label') || c.includes('--remove-label')), false, 'a label nem entrou: a recusa veio antes');
});

test('bloqueio por teto de rodadas: espera até a virada do dia em Brasília', async () => {
  const e = motor({ resposta: bloqueio('esgotado', { day: '2026-09-11', started: 3 }) });
  const pr = prDe('o/r#5');
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.sync.espera[pr.key].reason, 'esgotado');
  assert.ok(e.sync.espera[pr.key].until > Date.now());
  assert.equal(e.autoReviewParked.has(pr.key), false);
});

test('lease perdido no meio da sessão: não estaciona, não entra no retry e não posta', async () => {
  const perdido = async (op, admitir) => { await admitir(); throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const e = motor({ resposta: perdido });
  const pr = prDe('o/r#6');
  e.markSeen(pr.key);
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'cancelamento pela coordenação não é cancelamento seu');
  assert.equal(e.retryAfterNet.has(pr.key), false);
  assert.equal(e.seen.has(pr.key), false);
  assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1);
  assert.equal(e.postados.length, 0);
  assert.ok(e.logs.some((l) => /WARN .*lease de coordenação perdido/.test(l)));
  assert.ok(ghCalls.some((c) => c.includes('--add-label')), 'a sessão foi admitida antes de perder o lease');
  assert.equal(ghCalls.some((c) => c.includes('--remove-label')), false, 'a label agora é do aparelho que assumiu');
});

// Entrada de retry PREEXISTENTE: o PR já vinha de uma falha transitória quando a
// coordenação o tirou deste aparelho. Deixá-la viva fazia o próprio check() relançar no
// ciclo seguinte um PR que outro aparelho acabou de assumir.
test('lease perdido limpa a entrada de retry que já existia', async () => {
  const perdido = async (op, admitir) => { await admitir(); throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const e = motor({ resposta: perdido });
  const pr = prDe('o/r#66');
  e.retryAfterNet.set(pr.key, { tries: 2, pr, at: Date.now() });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'o retry de antes não pode sobreviver à perda do lease');
});

// A autoanálise chega aqui com cancelled também. Sem ramo próprio, a pessoa lia
// "Autoanálise cancelada", como se tivesse cancelado, e sem saber que a análise não
// ficou registrada em lugar nenhum.
test('autoanálise com lease perdido tem texto próprio, não o de cancelamento', async () => {
  const perdido = async (op, admitir) => { await admitir(); throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const e = motor({ resposta: perdido });
  e.runSelfAnalysis = async () => { throw Object.assign(new Error('cancelada por você'), { cancelled: true, coordenacao: 'perdido' }); };
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  await e.runOneHeadless({ ...prDe('o/r#7'), kind: 'self' }, 'eu');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /outro aparelho assumiu a coordenação; a autoanálise foi encerrada sem registrar/);
  assert.doesNotMatch(toasts[0], /cancelada/);
  assert.ok(e.logs.some((l) => /WARN .*autoanalise .*lease de coordenação perdido/.test(l)));
});

test('desfecho postado grava recibo published depois de registrar a decisão', async () => {
  const h = handleFalso();
  const e = motor({ resposta: resultado(envelopeApprove(), h) });
  const ordem = [];
  const record = e.recordDecision.bind(e);
  e.recordDecision = (...a) => { ordem.push('decisao'); return record(...a); };
  const complete = h.complete;
  h.complete = async (op) => { ordem.push('recibo'); return complete(op); };
  await e.runHeadlessReview(prDe('o/r#7'));
  assert.equal(e.postados.length, 1);
  assert.deepEqual(h.completos, [{ publicationState: 'published' }]);
  assert.deepEqual(ordem, ['decisao', 'recibo'], 'estado local primeiro, recibo depois (D14)');
  assert.equal(h.abortos, 0);
});

test('pendência grava recibo pending; postagem que falhou grava failed', async () => {
  const h1 = handleFalso();
  const e1 = motor({ resposta: resultado(envelopeApprove(), h1), policy: 'wait' });
  await e1.runHeadlessReview(prDe('o/r#8'));
  assert.deepEqual(h1.completos, [{ publicationState: 'pending' }]);

  const h2 = handleFalso();
  const e2 = motor({ resposta: resultado(envelopeApprove(), h2) });
  e2.postReview = async () => ({ ok: false, error: 'HTTP 422: Unprocessable Entity' });
  await e2.runHeadlessReview(prDe('o/r#9'));
  assert.deepEqual(h2.completos, [{ publicationState: 'failed' }]);
});

test('review meu já no head: recibo external_review publicado', async () => {
  const h = handleFalso();
  const e = motor({ resposta: resultado(envelopeApprove(), h) });
  e.myReviewsWithTime = async () => [{ state: 'APPROVED', at: Date.now(), commit: HEAD }];
  await e.runHeadlessReview(prDe('o/r#10'));
  assert.equal(e.postados.length, 0);
  assert.deepEqual(h.completos, [{ outcome: 'external_review', publicationState: 'published' }]);
});

test('sessão sem desfecho (resultado ilegível) devolve o lease no finally, sem recibo', async () => {
  const h = handleFalso();
  const e = motor({ resposta: { text: 'só progresso, nenhum envelope', sessionId: 's1', coordination: h } });
  await assert.rejects(e.runHeadlessReview(prDe('o/r#11')));
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

test('toReview pula o PR com espera vigente e volta a lançar quando ela vence', async () => {
  const e = motor();
  e.sync.status = 'conectado';
  const pr = prDe('o/r#12');
  e.queue = [pr];
  const lancados = [];
  e.launchReview = async (urls) => { lancados.push(...urls); return { ok: true }; };
  e.sync.espera[pr.key] = { reason: 'alheio', deviceName: 'notebook', until: Date.now() + 60 * 1000 };
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, []);
  delete e.sync.espera[pr.key];
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, [pr.url]);
});

test('toReview não lança nada com a coordenação ligada e a conexão fora (aviso único)', async () => {
  const e = motor();
  e.sync.status = 'erro';
  e.sync.lastError = { code: 'indisponivel', motivo: 'o Firebase está indisponível ou sem rede', at: 1 };
  e.queue = [prDe('o/r#13'), prDe('o/r#14')];
  const lancados = [];
  e.launchReview = async (urls) => { lancados.push(...urls); return { ok: true }; };
  await e._dispararAutomacoes([]);
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, []);
  assert.equal(e.toasts.filter((t) => /Coordenação entre aparelhos indisponível/.test(t.text)).length, 1);
});

test('coordenação desligada: a espera anotada não segura nada', async () => {
  const e = motor({ coordenacao: false });
  const pr = prDe('o/r#15');
  e.queue = [pr];
  e.sync.espera[pr.key] = { reason: 'alheio', until: Date.now() + 60 * 1000 };
  const lancados = [];
  e.launchReview = async (urls) => { lancados.push(...urls); return { ok: true }; };
  await e._dispararAutomacoes([]);
  assert.deepEqual(lancados, [pr.url]);
});

test('retryTargets e reReviewTargets pulam PR segurado pela coordenação', () => {
  const pr = prDe('org/app#7');
  const base = {
    retryAfterNet: new Map([[pr.key, { tries: 1, pr, notBefore: null }]]),
    accountForPr: () => 'eu', isMuted: () => false, tokenFor: () => 'tok', budgetBlockedFor: () => null,
    skipComentado: {},
  };
  const livre = { ...base, syncSeguraAutomacao: () => false };
  const segura = { ...base, syncSeguraAutomacao: (k) => k === pr.key };
  assert.equal(reviewMod.retryTargets(livre, new Set(), new Set()).length, 1);
  assert.equal(reviewMod.retryTargets(segura, new Set(), new Set()).length, 0);

  const re = (seguraFn) => ({
    panorama: [{ ...pr }],
    staleInfo: { [pr.key]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    headQuietoDesde: { [pr.key]: { head: 'sha-novo', at: 0 } },
    reReviewLaunched: {}, decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(), retryAfterNet: new Map(),
    accountForPr: () => 'eu', isMuted: () => false, autoReviewFor: () => true, tokenFor: () => 'tok',
    budgetBlockedFor: () => null, outrosRevisando: () => [], skipComentado: {},
    syncSeguraAutomacao: seguraFn,
  });
  assert.equal(reviewMod.reReviewTargets(re(() => false), new Set()).length, 1);
  assert.equal(reviewMod.reReviewTargets(re(() => true), new Set()).length, 0);
});

test('launchReReviews carimba rodadaAutomatica no PR enfileirado', async () => {
  const pr = prDe('org/app#8');
  const enq = [];
  const e = {
    panorama: [pr],
    staleInfo: { [pr.key]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    headQuietoDesde: { [pr.key]: { head: 'sha-novo', at: 0 } },
    reReviewLaunched: {}, decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(), retryAfterNet: new Map(), headlessQueue: [], activeReviews: new Map(),
    accountForPr: () => 'eu', isMuted: () => false, autoReviewFor: () => true, tokenFor: () => 'tok',
    budgetBlockedFor: () => null, outrosRevisando: () => [], skipComentado: {},
    saveReReviewLaunched() { }, emit() { }, enqueueHeadless(p) { enq.push(p); },
    bloqueiaAutomatico: async () => false, fetchPrFiles: async () => null,
  };
  await reviewMod.launchReReviews(e);
  assert.equal(enq.length, 1);
  assert.equal(enq[0].rodadaAutomatica, true);
});

// D19: a cota da conta dentro do perfil só morde quando OUTRA conta está esperando.
// PR segurado pela coordenação não vai rodar, então não é disputa de verdade.
function engineContas({ queue, segura }) {
  const contas = [{ user: 'biuder' }, { user: 'pessoal' }];
  return {
    queue,
    accountList: () => contas,
    accountForPr: (p) => p.acct,
    isMuted: () => false,
    autoReviewFor: () => true,
    tokenFor: () => 'tok',
    autoReviewParked: new Set(),
    skipComentado: {},
    profileOfAccount: () => ({ id: 'p1' }),
    syncSeguraAutomacao: segura,
  };
}

test('contasDoPerfil não marca como esperando a conta cujo único PR está segurado (D19)', () => {
  const queue = [{ key: 'org/app#1', acct: 'pessoal' }];
  const segurado = Engine.prototype.contasDoPerfil.call(engineContas({ queue, segura: () => true }), 'p1');
  assert.equal(segurado.find((c) => c.user === 'pessoal').waiting, false);
  const livre = Engine.prototype.contasDoPerfil.call(engineContas({ queue, segura: () => false }), 'p1');
  assert.equal(livre.find((c) => c.user === 'pessoal').waiting, true);
});

// D14 vale até o POST: o heartbeat segue batendo depois de o provedor resolver
// (myReviewStates, checks, headSha), e perder o lease nessa fase quer dizer que outro
// aparelho pode ser o dono agora. Nada sai no GitHub; o PR volta pra fila como no ramo
// de perda durante a sessão.
for (const [nome, marcar] of [['antes de o resultado chegar ao gate', (h) => { h.lost = true; }], ['durante a consulta que antecede o POST', () => { }]]) {
  test(`handle perdido depois de o provedor resolver não posta (${nome})`, async () => {
    const h = handleFalso();
    marcar(h);
    const e = motor({ resposta: resultado(envelopeApprove(), h) });
    e.myReviewsWithTime = async () => { h.lost = true; return []; };
    const pr = prDe('o/r#16');
    e.markSeen(pr.key);
    await e.runOneHeadless(pr, 'eu');
    assert.equal(e.postados.length, 0, 'lease perdido não posta');
    assert.equal(h.completos.length, 0, 'sem desfecho, sem recibo');
    assert.equal(e.autoReviewParked.has(pr.key), false, 'não estaciona');
    assert.equal(e.retryAfterNet.has(pr.key), false, 'não entra no retry');
    assert.equal(e.seen.has(pr.key), false);
    assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1, 'volta pra fila');
    assert.equal(e.decisions.pending.some((d) => d.key === pr.key), false, 'nada foi decidido neste aparelho');
    assert.ok(e.logs.some((l) => /WARN .*lease de coordenação perdido/.test(l)));
    assert.ok(e.toasts.every((t) => t.kind === 'info'));
  });
}

test('handle perdido depois de o provedor resolver também segura o REQUEST_CHANGES', async () => {
  const h = handleFalso();
  const env = {
    analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', cardMet: true,
    reasons: ['bloqueio real'], reportMarkdown: 'relatório',
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } },
  };
  const e = motor({ resposta: resultado(env, h) });
  e.rejectPolicyFor = () => 'request_changes';
  e.myReviewsWithTime = async () => { h.lost = true; return []; };
  await e.runOneHeadless(prDe('o/r#17'), 'eu');
  assert.equal(e.postados.length, 0);
});

// D13: o teto compartilhado conta o round automático pós-push UMA vez. A marca é
// consumida na admissão, então nada que herde o objeto do PR depois disso (retry
// transitório, fila de volta, clique sobre o card) gasta outra rodada do dia.
test('retentativa transitória de um round automático não reserva outra rodada', async () => {
  let chamadas = 0;
  const e = motor({ resposta: () => { chamadas++; throw new Error('dial tcp: connectex: rede fora'); } });
  const pr = prDe('o/r#18', { rodadaAutomatica: true });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.opts[0].coordination.contaRodada, true, 'a primeira tentativa conta o round');
  const guardado = e.retryAfterNet.get(pr.key);
  assert.ok(guardado, 'queda transitória vai pro retry');
  await e.runOneHeadless(guardado.pr, 'eu');
  assert.equal(chamadas, 2);
  assert.equal(e.opts[1].coordination.contaRodada, false, 'o retry é o MESMO round');
});

test('clique sobre o PR que voltou da coordenação não gasta rodada do dia', async () => {
  const e = motor({ resposta: bloqueio('alheio', { deviceName: 'notebook' }) });
  const pr = prDe('o/r#19', { rodadaAutomatica: true });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.opts[0].coordination.contaRodada, true);
  const naFila = e.queue.find((p) => p.key === pr.key);
  assert.ok(naFila, 'voltou pra fila');
  assert.notEqual(naFila.rodadaAutomatica, true, 'a fila não herda a marca do round');
  // o clique copia o objeto da fila; mesmo que a marca tivesse vazado, clique não conta
  naFila.rodadaAutomatica = true;
  e.token = 'tok-eu';
  e.bloqueiaAutomatico = async () => false;
  e.syncPreflightManual = async () => ({ ok: true });
  const enfileirados = [];
  e.enqueueHeadless = (p) => { enfileirados.push(p); };
  await e.launchReview([pr.url], 'auto', 'clique');
  assert.equal(enfileirados.length, 1);
  assert.notEqual(enfileirados[0].rodadaAutomatica, true, 'clique nunca é round automático');
});

test('retomada recusada que recomeça do zero não reserva outra rodada', async () => {
  const h = handleFalso();
  const e = motor({
    resposta: async (op, admitir) => {
      await admitir();
      if ((op.extraArgs || []).includes('--resume')) throw new Error('No conversation found with session id');
      return resultado(envelopeApprove(), h);
    },
  });
  const pr = prDe('o/r#20', { rodadaAutomatica: true, retomarSid: 'sessao-anterior-1', knownHead: HEAD });
  await e.runHeadlessReview(pr);
  assert.equal(e.opts.length, 2);
  assert.equal(e.opts[0].coordination.contaRodada, true, 'a tentativa com --resume conta o round');
  assert.equal(e.opts[1].coordination.contaRodada, false, 'a sessão nova que a substitui é a mesma rodada');
});

// Desfechos com lease: complete() solta o lease, então a label deste aparelho sai ANTES
// do recibo. Na ordem inversa, um aparelho que assumisse o head novo no intervalo teria a
// label dele (mesma conta, mesmo nome) apagada pela remoção atrasada do finally.
const ENV_REJEITA = {
  analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', cardMet: true,
  reasons: ['bloqueio real'], reportMarkdown: 'relatório',
  payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } },
};
const DESFECHOS = [
  ['published', () => ({ env: envelopeApprove() })],
  ['pending', () => ({ env: envelopeApprove(), policy: 'wait' })],
  ['failed', () => ({ env: envelopeApprove(), ajustar: (e) => { e.postReview = async () => ({ ok: false, error: 'HTTP 422: Unprocessable Entity' }); } })],
  ['external_review', () => ({ env: envelopeApprove(), ajustar: (e) => { e.myReviewsWithTime = async () => [{ state: 'APPROVED', at: Date.now(), commit: HEAD }]; } })],
  ['auto_rejected', () => ({ env: ENV_REJEITA, ajustar: (e) => { e.rejectPolicyFor = () => 'request_changes'; } })],
];
for (const [nome, cenario] of DESFECHOS) {
  test(`desfecho ${nome}: a label sai antes do recibo soltar o lease`, async () => {
    const { env, policy, ajustar } = cenario();
    const h = handleFalso();
    const e = motor({ resposta: resultado(env, h), policy });
    if (ajustar) ajustar(e);
    let labelAoGravarRecibo = null;
    const complete = h.complete;
    h.complete = async (op) => { labelAoGravarRecibo = ghCalls.some((c) => c.includes('--remove-label')); return complete(op); };
    await e.runHeadlessReview(prDe('o/r#22'));
    assert.equal(h.completos.length, 1, 'o desfecho gravou o recibo');
    assert.equal(labelAoGravarRecibo, true, 'a label já tinha saído quando o lease foi solto');
    assert.equal(ghCalls.filter((c) => c.includes('--remove-label')).length, 1, 'e sai uma vez só');
  });
}

// A retomada recusada abre uma segunda admissão, depois de a primeira ter posto a label.
// Se a segunda ouve "alheio", a label no PR só é do outro aparelho quando ele está numa
// REVISÃO (mesma conta, mesmo nome); lease de pushback ou autoanálise não põe label, e
// preservar a nossa a deixaria presa.
for (const [kind, preserva] of [['review', true], ['pushback', false], ['self', false]]) {
  test(`retomada recusada e segunda admissão alheia (${kind}): label ${preserva ? 'preservada' : 'removida'}`, async () => {
    const e = motor({
      resposta: async (op, admitir) => {
        if (!(op.extraArgs || []).includes('--resume')) return bloqueio('alheio', { deviceName: 'notebook', operationKind: kind });
        await admitir();
        throw new Error('No conversation found with session id');
      },
    });
    await e.runHeadlessReview(prDe('o/r#23', { retomarSid: 'sessao-anterior-2', knownHead: HEAD }));
    assert.ok(ghCalls.some((c) => c.includes('--add-label')), 'a primeira tentativa pôs a label');
    assert.equal(ghCalls.some((c) => c.includes('--remove-label')), !preserva);
  });
}

// D14 em TODOS os desfechos, não só no postado: o estado local (recordDecision) é
// persistido antes de o recibo ir pro banco. Com a ordem inversa, uma queda entre os
// dois deixaria outro aparelho vendo "este commit já foi analisado" sem decisão nenhuma
// gravada aqui.
for (const [nome, cenario] of DESFECHOS) {
  test(`desfecho ${nome}: recibo gravado depois de registrar a decisão`, async () => {
    const { env, policy, ajustar } = cenario();
    const h = handleFalso();
    const e = motor({ resposta: resultado(env, h), policy });
    if (ajustar) ajustar(e);
    const ordem = [];
    const record = e.recordDecision.bind(e);
    e.recordDecision = (...a) => { ordem.push('decisao'); return record(...a); };
    const complete = h.complete;
    h.complete = async (op) => { ordem.push('recibo'); return complete(op); };
    await e.runHeadlessReview(prDe('o/r#24'));
    assert.deepEqual(ordem, ['decisao', 'recibo']);
  });
}
