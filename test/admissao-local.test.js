// Admissão local (CT-ADM): reserva antes do provedor, requisitos duros e piso de memória.
//
// O caso que dá nome à regra é o da medição indisponível: **não saber medir é DESCONHECIDO,
// não memória suficiente**. Começar sem saber é o que produz encerramento pelo sistema
// operacional no meio da revisão, e é por isso que ele recusa.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = process.env.FAROL_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-admissao-'));

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const admissao = (await import('../lib/engine/admissao.js')).default;
const { SYNC } = await import('../lib/constants.js');

const AGORA = 1_800_000_000_000;
const freememReal = os.freemem;
const disponivelReal = process.availableMemory;

afterEach(() => {
  os.freemem = freememReal;
  if (disponivelReal) process.availableMemory = disponivelReal;
  else delete process.availableMemory;
});

// O teto da admissão é o TOTAL do aparelho (`globalParallelReviews`), não o limite por conta
// (`parallelReviews`): até 30/09/2026 o segundo virava o primeiro com o compartilhamento
// ligado. O motor padrão desta suíte tem teto total 1.
function motor(extra = {}) {
  return {
    config: { parallelReviews: 1, globalParallelReviews: 1, sync: { enabled: true, shared: { enabled: true }, aceitarAdmin: false }, ...extra.config },
    doctorInfo: { claude: '1.0.0' },
    sync: { lastPresenceAt: AGORA, autoridade: null },
    ...extra,
  };
}

function comMemoria(mb) {
  os.freemem = () => mb * 1024 * 1024;
  process.availableMemory = () => mb * 1024 * 1024;
}

// Os `await` de topo vêm ANTES do primeiro caso: com `--test-force-exit`, o processo
// encerra quando os casos já registrados terminam, e um `await` que só volta depois
// disso deixa os casos seguintes CANCELADOS, numa rodada que ainda diz "0 falhas".
const reviewMod = (await import('../lib/engine/review.js')).default;

test('ativa só com o compartilhamento ligado', () => {
  assert.equal(admissao.ativa(motor()), true);
  assert.equal(admissao.ativa({ config: { sync: { enabled: true, shared: { enabled: false } } } }), false);
  assert.equal(admissao.ativa({ config: {} }), false);
});

test('reserva, inicia e libera, e a vaga volta', () => {
  comMemoria(4096);
  const e = motor();
  const r = admissao.reservar(e, { tipo: 'review', agora: AGORA, ref: 'dono/repo#1' });
  assert.equal(r.ok, true);
  assert.equal(admissao.resumo(e).porEstado.reserva, 1);
  assert.equal(admissao.iniciar(e, r.id), true);
  assert.equal(admissao.resumo(e).porEstado.execucao, 1);
  assert.deepEqual(admissao.resumo(e).refs, ['dono/repo#1']);
  assert.equal(admissao.liberar(e, r.id), true);
  assert.equal(admissao.resumo(e).total, 0);
});

// O ponto da reserva antes do provedor: duas chamadas no mesmo tick não contam a mesma vaga.
test('clique e automático concorrentes não usam a mesma vaga', () => {
  comMemoria(4096);
  const e = motor();
  const automatico = admissao.reservar(e, { agora: AGORA });
  const clique = admissao.reservar(e, { agora: AGORA, clique: true });
  assert.equal(automatico.ok, true);
  assert.equal(clique.ok, false);
  assert.equal(clique.motivo, 'sem-vaga');
});

test('o teto é do APARELHO: três operações de contas diferentes cabem uma', () => {
  comMemoria(4096);
  const e = motor();
  const rs = [1, 2, 3].map(() => admissao.reservar(e, { agora: AGORA }));
  assert.deepEqual(rs.map((r) => r.ok), [true, false, false]);
});

test('teto maior cabe mais, e a política remota pode restringir', () => {
  comMemoria(4096);
  const e = motor({ config: { parallelReviews: 1, globalParallelReviews: 3, sync: { enabled: true, shared: { enabled: true }, aceitarAdmin: false } } });
  assert.deepEqual([1, 2, 3, 4].map(() => admissao.reservar(e, { agora: AGORA }).ok), [true, true, true, false]);
});

// A exceção de clique atravessa só o teto.
test('exceção de clique fura o teto, entra na contagem, e não atravessa o resto', () => {
  comMemoria(4096);
  const e = motor();
  admissao.reservar(e, { agora: AGORA });
  const excecao = admissao.reservar(e, { agora: AGORA, clique: true, excecao: true });
  assert.equal(excecao.ok, true);
  assert.equal(excecao.excecao, true);
  assert.equal(admissao.resumo(e).total, 2, 'quem excede também conta');
  comMemoria(1);
  const semMemoria = admissao.reservar(e, { agora: AGORA, clique: true, excecao: true });
  assert.equal(semMemoria.ok, false);
  assert.equal(semMemoria.motivo, 'memoria-insuficiente', 'a exceção não atravessa o piso');
});

test('medição indisponível é desconhecido, não memória suficiente', () => {
  const e = motor();
  os.freemem = () => 0;
  delete process.availableMemory;
  const r = admissao.reservar(e, { agora: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'memoria-desconhecida');
});

test('vale o MENOR entre o limite do processo e o da máquina', () => {
  const e = motor();
  os.freemem = () => 8192 * 1024 * 1024;
  process.availableMemory = () => (SYNC.PISO_MEMORIA_MB - 10) * 1024 * 1024;
  assert.equal(admissao.reservar(e, { agora: AGORA }).motivo, 'memoria-insuficiente');
});

test('requisitos duros: presença vencida, provedor não pronto e tipo desconhecido', () => {
  comMemoria(4096);
  const vencida = motor({ sync: { lastPresenceAt: AGORA - SYNC.PRESENCE_TICK_MS * 4 } });
  assert.equal(admissao.reservar(vencida, { agora: AGORA }).motivo, 'presenca-vencida');
  const semProvedor = motor({ doctorInfo: { claude: null } });
  assert.equal(admissao.reservar(semProvedor, { agora: AGORA }).motivo, 'provedor-nao-pronto');
  assert.equal(admissao.reservar(motor(), { agora: AGORA, tipo: 'minerar' }).motivo, 'tipo-desconhecido');
});

test('o resumo conta por estado e por tipo, e nunca leva conteúdo', () => {
  comMemoria(4096);
  const e = motor({ config: { globalParallelReviews: 4, sync: { enabled: true, shared: { enabled: true } } } });
  const a = admissao.reservar(e, { tipo: 'review', agora: AGORA, ref: 'dono/repo#1' });
  admissao.reservar(e, { tipo: 'chat', agora: AGORA });
  admissao.iniciar(e, a.id);
  const r = admissao.resumo(e);
  assert.equal(r.total, 2);
  assert.deepEqual([r.porEstado.reserva, r.porEstado.execucao], [1, 1]);
  assert.deepEqual([r.porTipo.review, r.porTipo.chat], [1, 1]);
  assert.deepEqual(Object.keys(r).sort(), ['porEstado', 'porTipo', 'refs', 'total']);
});

test('cada reserva guarda a métrica e o piso que usou: é o ponto de coleta da medição', () => {
  comMemoria(2048);
  const e = motor();
  const r = admissao.reservar(e, { agora: AGORA });
  const reg = e.admissao.reservas.get(r.id);
  assert.equal(reg.pisoMb, SYNC.PISO_MEMORIA_MB);
  assert.ok(reg.memoriaMb >= 2000 && reg.memoriaMb <= 2100, String(reg.memoriaMb));
});

// Fiação no escalonador: os critérios de aceite da C4 sobre a fila.

function engineFila(prs, extra = {}) {
  const e = motor(extra);
  return Object.assign(e, {
    // cópia dos PRs: o escalonador carimba `admissaoId` no objeto, e reaproveitar a
    // mesma referência entre casos faria um teste enxergar a reserva do outro
    headlessQueue: prs.map((p) => ({ ...p })),
    headlessBusyAccounts: new Map(),
    ran: [],
    accountForPr: (pr) => pr.acct,
    headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); },
    runOneHeadless(pr, acct) { this.ran.push(`${pr.key}@${acct}`); },
  });
}

const tres = [{ key: 'a/x#1', acct: 'c1' }, { key: 'b/x#2', acct: 'c2' }, { key: 'c/x#3', acct: 'c3' }];

test('com a admissão ativa, três contas e teto 1 abrem UMA sessão', () => {
  comMemoria(4096);
  const e = engineFila(tres);
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 1);
  assert.equal(e.headlessQueue.length, 2, 'os outros esperam na fila, sem estacionar');
  assert.equal(admissao.resumo(e).total, 1);
});

test('a espera não perde a demanda: liberada a vaga, o próximo sai', () => {
  comMemoria(4096);
  const e = engineFila(tres);
  reviewMod.processHeadless(e);
  const pr = { key: e.ran[0].split('@')[0], admissaoId: [...e.admissao.reservas.keys()][0] };
  reviewMod.freeHeadlessSlot(e, 'c1', pr);
  assert.equal(admissao.resumo(e).total, 0, 'qualquer desfecho libera a reserva');
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 2);
});

test('sem memória medida, a fila não anda e nada é estacionado', () => {
  os.freemem = () => 0;
  delete process.availableMemory;
  const e = engineFila(tres);
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, []);
  assert.equal(e.headlessQueue.length, 3);
});

test('teto do aparelho maior deixa várias contas rodarem juntas', () => {
  comMemoria(4096);
  const e = engineFila(tres, { config: { parallelReviews: 1, globalParallelReviews: 3, sync: { enabled: true, shared: { enabled: true } } } });
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 3);
});

/* ---------- cada número diz uma coisa só (30/09/2026) ---------- */

const COMPARTILHADO = { enabled: true, shared: { enabled: true }, aceitarAdmin: false };
const daMesmaConta = [{ key: 'a/x#1', acct: 'c1' }, { key: 'a/x#2', acct: 'c1' }, { key: 'a/x#3', acct: 'c1' }];

// Era o defeito: com a admissão ativa o limite por conta virava 4 fixo, e `parallelReviews`
// passava a ser o total do aparelho. Uma conta com limite 1 abria três sessões juntas.
test('o limite por conta vale igual com a admissão ativa: três PRs da mesma conta e limite 1 abrem UMA', () => {
  comMemoria(4096);
  const e = engineFila(daMesmaConta, { config: { parallelReviews: 1, globalParallelReviews: 0, sync: COMPARTILHADO } });
  reviewMod.processHeadless(e);
  assert.deepEqual(e.ran, ['a/x#1@c1']);
  assert.equal(e.headlessQueue.length, 2);
});

test('o limite por conta é o mesmo número com e sem a admissão', () => {
  comMemoria(4096);
  for (const limite of [1, 2, 3, 4]) {
    const com = engineFila([...daMesmaConta, { key: 'a/x#4', acct: 'c1' }, { key: 'a/x#5', acct: 'c1' }], { config: { parallelReviews: limite, sync: COMPARTILHADO } });
    const sem = engineFila([...daMesmaConta, { key: 'a/x#4', acct: 'c1' }, { key: 'a/x#5', acct: 'c1' }], { config: { parallelReviews: limite, sync: { enabled: false } } });
    reviewMod.processHeadless(com);
    reviewMod.processHeadless(sem);
    assert.equal(com.ran.length, limite, `com a admissão, limite ${limite}`);
    assert.equal(sem.ran.length, limite, `sem a admissão, limite ${limite}`);
  }
});

test('sem teto total, a admissão não nega vaga: quem limita é o limite por conta', () => {
  comMemoria(4096);
  const e = motor({ config: { parallelReviews: 1, globalParallelReviews: 0, sync: COMPARTILHADO } });
  assert.equal(admissao.politicaDoAparelho(e).tetoParalelismo, null, 'nenhum dos dois lados opinou');
  // `Math.max(1, Number(teto) || 1)` transformava "sem teto" em teto 1
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(() => admissao.reservar(e, { agora: AGORA }).ok), [true, true, true, true, true, true]);
  // e no escalonador: três contas, limite 1 por conta, sem teto total = três sessões
  const fila = engineFila(tres, { config: { parallelReviews: 1, globalParallelReviews: 0, sync: COMPARTILHADO } });
  reviewMod.processHeadless(fila);
  assert.equal(fila.ran.length, 3);
});

test('o teto total local é o globalParallelReviews, e o parallelReviews não entra nele', () => {
  const com = (config) => admissao.politicaDoAparelho(motor({ config: { sync: COMPARTILHADO, ...config } })).tetoParalelismo;
  assert.equal(com({ parallelReviews: 4, globalParallelReviews: 2 }), 2);
  assert.equal(com({ parallelReviews: 1, globalParallelReviews: 6 }), 6);
  assert.equal(com({ parallelReviews: 4, globalParallelReviews: 0 }), null, '0 = sem teto total');
  assert.equal(com({ parallelReviews: 4 }), null, 'ausente = sem teto total');
  assert.equal(com({ parallelReviews: 4, globalParallelReviews: 'x' }), null, 'torto não liga teto que ninguém pediu');
  assert.equal(com({ parallelReviews: 4, globalParallelReviews: 99 }), 8, 'o mesmo clamp do escalonador');
});

// O que o aparelho publica e a tela mostra é sempre um número: o agendador do admin e a
// frota em versão antiga leem `paralelismo` como total, e "sem teto" não é um número.
test('o total do aparelho como número: o teto total, ou a soma dos limites por conta', () => {
  const contas = [{ user: 'a' }, { user: 'b' }, { user: 'c' }];
  const com = (config) => admissao.totalDoAparelho({ ...motor({ config: { sync: COMPARTILHADO, ...config } }), accountList: () => contas });
  assert.equal(com({ parallelReviews: 2, globalParallelReviews: 5 }), 5);
  assert.equal(com({ parallelReviews: 2, globalParallelReviews: 0 }), 6, 'três contas, duas por conta');
  assert.equal(com({ parallelReviews: 1, globalParallelReviews: 0 }), 3);
  assert.equal(admissao.totalDoAparelho(motor({ config: { parallelReviews: 3, globalParallelReviews: 0, sync: COMPARTILHADO } })), 3, 'sem lista de contas, conta uma');
});

// O total que vale é o MENOR entre o teto total deste aparelho e o que o admin definiu à
// distância; sem um deles, vale o outro; o remoto nunca amplia.
test('teto total local e remoto: vale o menor, e cada um vale sozinho quando o outro não opina', async () => {
  const cachePolitica = (await import('../lib/sync/cache-politica.js')).default;
  const aceitando = { enabled: true, shared: { enabled: true }, aceitarAdmin: true };
  const tetoCom = (local, remoto) => {
    if (remoto === null) cachePolitica.apagarPolitica();
    else cachePolitica.gravarPolitica({ uid: 'u1', dev: 'd1', generation: 1, versao: 1, politica: { pausado: false, tetoParalelismo: remoto } });
    return admissao.politicaDoAparelho(motor({ config: { parallelReviews: 4, globalParallelReviews: local, sync: aceitando } }));
  };
  try {
    assert.equal(tetoCom(6, 3).tetoParalelismo, 3, 'o remoto restringe');
    assert.equal(tetoCom(6, 3).origem.tetoParalelismo, 'restricao-mantida', 'sem autoridade fresca, o remoto continua restringindo');
    assert.equal(tetoCom(2, 4).tetoParalelismo, 2, 'o remoto maior não amplia');
    assert.equal(tetoCom(2, 4).origem.tetoParalelismo, 'local');
    assert.equal(tetoCom(0, 3).tetoParalelismo, 3, 'sem teto local, o remoto vale sozinho');
    assert.equal(tetoCom(5, null).tetoParalelismo, 5, 'sem política remota, o local vale sozinho');
    assert.equal(tetoCom(0, null).tetoParalelismo, null, 'sem nenhum dos dois, não há teto total');
    // sem teto local e com o remoto em 2: a terceira reserva é negada pelo teto do admin
    comMemoria(4096);
    cachePolitica.gravarPolitica({ uid: 'u1', dev: 'd1', generation: 1, versao: 1, politica: { pausado: false, tetoParalelismo: 2 } });
    const e = motor({ config: { parallelReviews: 4, globalParallelReviews: 0, sync: aceitando } });
    assert.deepEqual([1, 2, 3].map(() => admissao.reservar(e, { agora: AGORA }).ok), [true, true, false]);
  } finally {
    cachePolitica.apagarPolitica();
  }
});

/* ---------- atualizar nunca faz uma instalação existente trabalhar MAIS ---------- */

// Quantas sessões abrem com a fila cheia (cinco PRs por conta), e o máximo numa conta só.
function vazao(config, nContas) {
  const prs = [];
  for (let c = 1; c <= nContas; c++) for (let i = 1; i <= 5; i++) prs.push({ key: `o${c}/r#${i}`, acct: `c${c}` });
  const e = engineFila(prs, { config });
  reviewMod.processHeadless(e);
  const porConta = {};
  for (const r of e.ran) { const conta = r.split('@')[1]; porConta[conta] = (porConta[conta] || 0) + 1; }
  return { total: e.ran.length, maiorConta: Math.max(0, ...Object.values(porConta)) };
}

// O que o engine fazia até 30/09/2026, escrito como estava em admissao.js e review.js: com
// a admissão ativa o total era o menor entre `parallelReviews` e o teto global, e o limite
// por conta era 4 fixo; sem ela, limite por conta `parallelReviews` e só o teto global.
function vazaoAntiga({ porConta, global, ligado }, nContas) {
  const tetoGlobal = global > 0 ? global : Infinity;
  const total = ligado ? Math.min(porConta, tetoGlobal) : tetoGlobal;
  const limiteDaConta = ligado ? 4 : porConta;
  return { total: Math.min(total, limiteDaConta * nContas), maiorConta: Math.min(limiteDaConta, total) };
}

test('tabela: o total do aparelho e o limite por conta são os mesmos antes e depois da migração', async () => {
  const M = (await import('../lib/engine/contas-migracao.js')).default;
  comMemoria(8192);
  let linhas = 0;
  for (const porConta of [1, 2, 3, 4]) for (const nContas of [1, 2, 3]) for (const ligado of [true, false]) for (const global of [0, 1, 2, 6]) {
    const sync = ligado ? { enabled: true, shared: { enabled: true }, aceitarAdmin: false } : { enabled: false };
    const antiga = { parallelReviews: porConta, globalParallelReviews: global, sync };
    const r = M.migrarParalelismo(antiga);
    const migrada = { ...antiga, esquemaConfig: r.esquemaConfig };
    if ('globalParallelReviews' in r) migrada.globalParallelReviews = r.globalParallelReviews;
    const rotulo = `por conta ${porConta}, ${nContas} conta(s), compartilhamento ${ligado}, teto global ${global}`;
    const antes = vazaoAntiga({ porConta, global, ligado }, nContas);
    const depois = vazao(migrada, nContas);
    assert.equal(depois.total, antes.total, `${rotulo}: total do aparelho`);
    // o limite por conta: o que UMA conta sozinha, com a fila cheia, consegue abrir
    assert.equal(vazao(migrada, 1).total, vazaoAntiga({ porConta, global, ligado }, 1).total, `${rotulo}: limite por conta`);
    assert.ok(depois.maiorConta <= antes.maiorConta, `${rotulo}: nenhuma conta abre mais do que abria`);
    if (!ligado) assert.equal('globalParallelReviews' in r, false, `${rotulo}: sem compartilhamento, intocada`);
    // idempotente: a config migrada não muda de novo
    assert.deepEqual(M.migrarParalelismo(migrada), { mudou: false, mudancas: [] }, rotulo);
    linhas++;
  }
  assert.equal(linhas, 96);
});

test('sem a migração, a mesma instalação abriria mais: é isto que ela impede', () => {
  comMemoria(8192);
  const sync = { enabled: true, shared: { enabled: true }, aceitarAdmin: false };
  assert.equal(vazaoAntiga({ porConta: 2, global: 0, ligado: true }, 3).total, 2);
  assert.equal(vazao({ parallelReviews: 2, globalParallelReviews: 0, sync }, 3).total, 6, 'quem tira o teto de propósito tem contas vezes o limite por conta');
});

// 01/10/2026: a pausa só segurava a revisão (pela reserva de vaga). O pushback abria sessão e
// a co-assinatura postava APPROVE num aparelho que o painel dizia estar pausado.
test('pausado: só com o compartilhamento ligado, o admin aceito e a política pausando', async () => {
  const cachePolitica = (await import('../lib/sync/cache-politica.js')).default;
  const sync = (aceitarAdmin, ligado = true) => ({ enabled: ligado, shared: { enabled: ligado }, aceitarAdmin });
  try {
    cachePolitica.gravarPolitica({ uid: 'u1', dev: 'd1', generation: 1, versao: 1, politica: { pausado: true } });
    assert.equal(admissao.pausado(motor({ config: { sync: sync(true) } })), true);
    assert.equal(admissao.pausado(motor({ config: { sync: sync(false) } })), false, 'sem aceitar o admin, a política dele não pausa');
    assert.equal(admissao.pausado(motor({ config: { sync: sync(true, false) } })), false, 'sem compartilhamento não há política de aparelho');
    cachePolitica.gravarPolitica({ uid: 'u1', dev: 'd1', generation: 1, versao: 2, politica: { pausado: false } });
    assert.equal(admissao.pausado(motor({ config: { sync: sync(true) } })), false);
  } finally {
    cachePolitica.apagarPolitica();
  }
});

test('aparelho pausado não varre pushback nem co-assina; sem a pausa, os dois seguem', async () => {
  const cachePolitica = (await import('../lib/sync/cache-politica.js')).default;
  const pushbackMod = (await import('../lib/engine/pushback.js')).default;
  const skipMod = (await import('../lib/engine/skip-review.js')).default;
  const aceitando = { enabled: true, shared: { enabled: true }, aceitarAdmin: true };
  const chamadas = [];
  const engine = () => motor({
    config: { autoPushback: true, coAssinarReview: true, sync: aceitando },
    reviewActions: () => { chamadas.push('pushback'); return []; },
    approvePolicyFor: () => 'approve',
    accountForPr: () => { chamadas.push('coassinar'); return 'eu'; },
    panorama: [], log: () => {}, emit: () => {},
  });
  const pr = { key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1' };
  try {
    cachePolitica.gravarPolitica({ uid: 'u1', dev: 'd1', generation: 1, versao: 1, politica: { pausado: true } });
    await pushbackMod.scanPushbacks(engine());
    assert.deepEqual(chamadas, [], 'pausado, a varredura de pushback nem lista os alvos');
    assert.equal(await skipMod.coAssinar(engine(), pr, 'ana', 'abc1234'), false);
    assert.deepEqual(chamadas, ['coassinar'], 'pausado, a co-assinatura para antes de qualquer gh');
    cachePolitica.gravarPolitica({ uid: 'u1', dev: 'd1', generation: 1, versao: 2, politica: { pausado: false } });
    await pushbackMod.scanPushbacks(engine());
    assert.ok(chamadas.includes('pushback'), 'sem a pausa, a varredura roda');
  } finally {
    cachePolitica.apagarPolitica();
  }
});
