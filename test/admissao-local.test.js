// Admissão local (CT-ADM): reserva antes do provedor, requisitos duros e piso de memória.
//
// O caso que dá nome à regra é o da medição indisponível: **não saber medir é DESCONHECIDO,
// não memória suficiente**. Começar sem saber é o que produz encerramento pelo sistema
// operacional no meio da revisão, e é por isso que ele recusa.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-admissao-' + process.pid);

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

function motor(extra = {}) {
  return {
    config: { parallelReviews: 1, sync: { enabled: true, shared: { enabled: true }, aceitarAdmin: false }, ...extra.config },
    doctorInfo: { claude: '1.0.0' },
    sync: { lastPresenceAt: AGORA, autoridade: null },
    ...extra,
  };
}

function comMemoria(mb) {
  os.freemem = () => mb * 1024 * 1024;
  process.availableMemory = () => mb * 1024 * 1024;
}

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
  const e = motor({ config: { parallelReviews: 3, sync: { enabled: true, shared: { enabled: true }, aceitarAdmin: false } } });
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
  const e = motor({ config: { parallelReviews: 4, sync: { enabled: true, shared: { enabled: true } } } });
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
const reviewMod = (await import('../lib/engine/review.js')).default;

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
  const e = engineFila(tres, { config: { parallelReviews: 3, sync: { enabled: true, shared: { enabled: true } } } });
  reviewMod.processHeadless(e);
  assert.equal(e.ran.length, 3);
});
