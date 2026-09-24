// Abandonar cedo o que ja virou trabalho perdido (23/09/2026).
//
// Medido nos 25 reviews de biudtech/infra-k8s deste aparelho: a passada de #145 rodou
// 16m55 e custou US$ 3,37 pra terminar como `already_reviewed`, e a de #150 rodou 8m31
// e custou US$ 2,74 pra terminar como `superseded`. Nos dois casos o Farol so descobriu
// no FIM, depois de pagar a sessao inteira. O vigia pergunta durante a sessao.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-vigia-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const vigia = (await import('../lib/engine/vigia-sessao.js')).default;
const fanout = (await import('../lib/engine/fanout.js')).default;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
after(() => {
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const HEAD = 'a'.repeat(40);
const HEAD_NOVO = 'b'.repeat(40);
const PR = { key: 'o/r#150', repo: 'o/r', number: 150, url: 'https://github.com/o/r/pull/150',
  requested: true, title: 'sync waves', author: 'alex' };

/* ---------- a decisão, pura ---------- */

test('head diferente do inicial manda abandonar', () => {
  assert.deepEqual(vigia.decidir({ headInicial: HEAD, headAgora: HEAD_NOVO, meusEstados: [] }),
    { abandonar: true, motivo: 'head-novo' });
});

test('revisão minha no head em curso manda abandonar', () => {
  assert.equal(vigia.decidir({ headInicial: HEAD, headAgora: HEAD, meusEstados: ['APPROVED'] }).motivo, 'ja-revisado');
});

test('COMENTAR não é revisar: um COMMENTED meu no head não abandona a sessão', () => {
  // `myReviewStates` devolve COMMENTED junto, e a primeira versão deste vigia (23/09/2026)
  // tratava qualquer estado como revisão feita: um recado de "vou olhar" no PR mataria a
  // sessão que estava lendo o código. A tabela do que DECIDE mora no decision.js.
  assert.equal(vigia.decidir({ headInicial: HEAD, headAgora: HEAD, meusEstados: ['COMMENTED'] }).abandonar, false);
  assert.equal(vigia.decidir({ headInicial: HEAD, headAgora: HEAD, meusEstados: ['DISMISSED'] }).abandonar, false,
    'review derrubado deixou de valer');
  assert.equal(vigia.decidir({ headInicial: HEAD, headAgora: HEAD, meusEstados: ['COMMENTED', 'APPROVED'] }).motivo, 'ja-revisado',
    'mas o que decide continua decidindo, mesmo acompanhado');
});

test('nada mudou: a sessão segue', () => {
  assert.equal(vigia.decidir({ headInicial: HEAD, headAgora: HEAD, meusEstados: [] }).abandonar, false);
});

test('falta de dado NUNCA abandona trabalho pago', () => {
  assert.equal(vigia.decidir({ headInicial: HEAD, headAgora: '', meusEstados: null }).abandonar, false,
    'gh que falhou não é prova de head novo');
  assert.equal(vigia.decidir({ headInicial: '', headAgora: HEAD_NOVO, meusEstados: null }).abandonar, false,
    'sem head de partida não há comparação possível');
});

/* ---------- a rodada, contra um engine ---------- */

function engineVigiado({ head, estados }) {
  const e = new Engine();
  e.log = () => { };
  e.headSha = async () => head;
  e.myReviewStates = async () => estados;
  e.cancelados = [];
  e.cancelSession = (id) => { e.cancelados.push(id); return { ok: true }; };
  return e;
}

test('a rodada cancela a sessão e carimba o motivo', async () => {
  const e = engineVigiado({ head: HEAD_NOVO, estados: [] });
  const d = await vigia.conferir(e, PR, 'sess-1', HEAD);
  assert.equal(d.abandonar, true);
  assert.deepEqual(e.cancelados, ['sess-1']);
  assert.equal(vigia.abandonoDe(e, PR.key), 'head-novo');
});

test('gh que falha na conferida não cancela nada', async () => {
  const e = engineVigiado({ head: HEAD, estados: [] });
  e.headSha = async () => { throw new Error('fetch failed'); };
  e.myReviewStates = async () => { throw new Error('fetch failed'); };
  await vigia.conferir(e, PR, 'sess-2', HEAD);
  assert.deepEqual(e.cancelados, [], 'queda de rede não pode matar sessão de 10 minutos');
  assert.equal(vigia.abandonoDe(e, PR.key), '');
});

test('parado, o vigia não consulta mais nada', async () => {
  const e = engineVigiado({ head: HEAD_NOVO, estados: [] });
  let consultas = 0;
  e.headSha = async () => { consultas++; return HEAD; };
  const h = vigia.iniciar(e, PR, 'sess-3', HEAD, { intervaloMs: 5 });
  await new Promise(r => setTimeout(r, 30));
  h.parar();
  const depois = consultas;
  await new Promise(r => setTimeout(r, 30));
  assert.ok(consultas > 0, 'o relógio roda enquanto a sessão vive');
  assert.equal(consultas, depois, 'e para junto com ela');
});

test('sem head de partida o vigia nem liga o relógio', async () => {
  const e = engineVigiado({ head: HEAD_NOVO, estados: [] });
  let consultas = 0;
  e.headSha = async () => { consultas++; return HEAD_NOVO; };
  vigia.iniciar(e, PR, 'sess-4', '', { intervaloMs: 5 }).parar();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(consultas, 0);
});

/* ---------- o desfecho no worker ---------- */

function engineDeWorker(motivo) {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'conta';
  e.isMuted = () => false;
  e.tokens = { conta: 'tok' };
  e.prState = async () => 'OPEN';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.runHeadlessReview = async () => {
    e.abandonosDeSessao = new Map([[PR.key, motivo]]);
    throw Object.assign(new Error('cancelada'), { cancelled: true });
  };
  return e;
}

test('head novo: não estaciona e o PR volta pra fila pro head certo', async () => {
  const e = engineDeWorker('head-novo');
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.autoReviewParked.has(PR.key), false, 'commit novo não é falha e não pede clique');
  assert.ok(e.queue.some(p => p.key === PR.key), 'o PR volta pra fila e o head novo é revisado');
  assert.equal(e.retryAfterNet.has(PR.key), false);
  assert.equal(vigia.abandonoDe(e, PR.key), '', 'o carimbo é consumido, não fica preso pro próximo round');
});

test('já revisado: sai da fila em silêncio, sem estacionar nem pedir clique', async () => {
  const e = engineDeWorker('ja-revisado');
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.autoReviewParked.has(PR.key), false);
  assert.ok(!e.queue.some(p => p.key === PR.key), 'refazer o que está feito não volta pra fila');
  assert.equal(vigia.abandonoDe(e, PR.key), '');
});

test('cancelamento SEU continua estacionando (o vigia não sequestra o ramo de cancelar)', async () => {
  const e = engineDeWorker('');
  e.runHeadlessReview = async () => { throw Object.assign(new Error('cancelada'), { cancelled: true }); };
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.equal(e.parkedMotivos[PR.key].tipo, 'cancelado');
});

/* ---------- a fiação: a sessão de verdade roda vigiada ---------- */

test('a sessão de revisão liga o vigia com o head lido, e o desliga no fim', async () => {
  // o `fanout.prMetrics` já é trocado por aqui no topo: mesmo padrão, agora no vigia,
  // porque o ponto deste caso é provar que o runHeadlessReview CHAMA o vigia (sem isso
  // os casos acima provariam um módulo que ninguém usa).
  const original = vigia.iniciar;
  const ligados = [];
  vigia.iniciar = (engine, pr, id, head) => {
    const reg = { pr: pr.key, head, id, parado: false };
    ligados.push(reg);
    return { parar() { reg.parado = true; } };
  };
  try {
    const e = new Engine();
    e.log = () => { };
    e.accountForPr = () => 'conta';
    e.tokenFor = () => '';
    e.headSha = async () => HEAD;
    e.fetchPrFiles = async () => [];
    e.myReviewStates = async () => [];
    e.approvePolicyFor = () => 'wait';
    e.rejectPolicyFor = () => 'wait';
    e.scopeLabel = () => 'Conta';
    e.writeMemory = () => { };
    e.postReview = async () => ({ ok: true });
    e.runClaudeStream = async () => ({
      text: JSON.stringify({ result: JSON.stringify({
        analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', cardMet: true,
        reasons: [], reportMarkdown: 'ok', payloads: {} }) }), sessionId: 's1'
    });
    await e.runHeadlessReview({ ...PR });
    assert.equal(ligados.length, 1, 'toda sessão de revisão nasce vigiada');
    assert.equal(ligados[0].head, HEAD, 'o vigia compara contra o head que ESTA sessão leu');
    assert.equal(ligados[0].parado, true, 'e nenhum vigia sobrevive à sessão');
  } finally {
    vigia.iniciar = original;
  }
});
