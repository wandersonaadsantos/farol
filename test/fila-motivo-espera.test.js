import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { processHeadless } from '../lib/engine/headless-fila.js';
import { esperaParaTela } from '../lib/engine/conta-na-tela.js';
import admissao from '../lib/engine/admissao.js';
import { queueWaitingCardHtml } from '../ui/pure/radar.js';

afterEach(() => mock.restoreAll());

const pr = (n, account = 'alice') => ({ key: `acme/app#${n}`, account, title: 'Corrige formulário', author: 'bob' });
function motor(shared = false) {
  const e = {
    config: { parallelReviews: 1, globalParallelReviews: 2,
      sync: { enabled: shared, shared: { enabled: shared }, aceitarAdmin: false } },
    doctorInfo: { claude: 'pronto' }, sync: { lastPresenceAt: Date.now() },
    headlessQueue: [pr(1), pr(2)], headlessBusyAccounts: new Map(),
    orgLastStart: new Map(), headlessSeq: 0, iniciadas: [],
    accountForPr: p => p.account, headlessAcct: p => p.account,
    runOneHeadless(p) { e.iniciadas.push(p.key); },
  };
  return e;
}
function detalhes(e) { return esperaParaTela(e).headlessWaitingDetails; }
function memoria(mb) {
  mock.method(os, 'freemem', () => mb * 1024 * 1024);
  mock.method(process, 'availableMemory', () => mb * 1024 * 1024);
}

test('o limite da conta explica a espera sem lançar outra sessão', () => {
  const e = motor();
  e.headlessBusyAccounts.set('alice', 1);
  processHeadless(e);
  assert.deepEqual(detalhes(e)['acme/app#2'], {
    posicao: 2, total: 2, motivo: 'limite-conta', ocupadas: 1, limite: 1,
  });
  assert.deepEqual(e.iniciadas, []);
  assert.equal(e.headlessBusyAccounts.get('alice'), 1);
});

test('teto global mostra a ocupação efetiva de todas as contas', () => {
  const e = motor();
  e.headlessBusyAccounts = new Map([['alice', 1], ['outra', 1]]);
  processHeadless(e);
  assert.equal(detalhes(e)['acme/app#1'].motivo, 'limite-global');
  assert.equal(detalhes(e)['acme/app#1'].ocupadas, 2);
  assert.deepEqual(e.iniciadas, []);
});

test('recusa de memória vem da admissão real e não ocupa vaga', () => {
  memoria(1);
  const e = motor(true);
  processHeadless(e);
  const antes = admissao.resumo(e);
  assert.equal(detalhes(e)['acme/app#1'].motivo, 'memoria-insuficiente');
  assert.deepEqual(admissao.resumo(e), antes, 'projetar a fila não reserva vagas');
  assert.equal(antes.total, 0);
  assert.deepEqual(e.iniciadas, []);
});

test('presença vencida e provedor indisponível não viram espera genérica', () => {
  const e = motor(true);
  e.sync.lastPresenceAt = 1;
  processHeadless(e);
  assert.equal(detalhes(e)['acme/app#1'].motivo, 'presenca-vencida');
  e.sync.lastPresenceAt = Date.now();
  e.doctorInfo = {};
  processHeadless(e);
  assert.equal(detalhes(e)['acme/app#1'].motivo, 'provedor-nao-pronto');
});

test('limite compartilhado explica a recusa sem expor conteúdo interno', () => {
  const e = motor(true);
  e.grupoSegura = () => 'diagnóstico interno que não deve sair';
  processHeadless(e);
  assert.equal(detalhes(e)['acme/app#1'].motivo, 'grupo-nao-verificavel');
  assert.doesNotMatch(JSON.stringify(detalhes(e)), /diagnóstico interno/);
});

test('vaga do aparelho ocupada por outra operação aparece com seu teto', () => {
  memoria(8192);
  const e = motor(true);
  e.config.globalParallelReviews = 1;
  assert.equal(admissao.reservar(e, { tipo: 'chat' }).ok, true);
  processHeadless(e);
  assert.equal(detalhes(e)['acme/app#1'].motivo, 'sem-vaga');
  assert.equal(detalhes(e)['acme/app#1'].ocupadas, 1);
  assert.equal(detalhes(e)['acme/app#1'].limite, 1);
  assert.equal(admissao.resumo(e).total, 1);
});

test('ao liberar a conta, o motivo anterior desaparece e as posições são atualizadas', () => {
  const e = motor();
  e.headlessBusyAccounts.set('alice', 1);
  processHeadless(e);
  e.headlessBusyAccounts.clear();
  processHeadless(e);
  assert.deepEqual(e.iniciadas, ['acme/app#1']);
  assert.equal(detalhes(e)['acme/app#1'], undefined);
  assert.deepEqual(detalhes(e)['acme/app#2'], {
    posicao: 1, total: 1, motivo: 'limite-conta', ocupadas: 1, limite: 1,
  });
});

const mark = { dot: '', chip: '', style: '' };
test('card mostra posição e motivo recebido do agendador', () => {
  const e = motor();
  e.headlessBusyAccounts.set('alice', 1);
  processHeadless(e);
  const html = queueWaitingCardHtml(pr(2), { mark, espera: detalhes(e)['acme/app#2'] });
  assert.match(html, /Posição 2 de 2 na fila local \(ordem de entrada\)/);
  assert.match(html, /Limite de revisões simultâneas desta conta atingido \(1\/1\)/);
  assert.match(html, /alterna organizações/);
  assert.doesNotMatch(html, /act-review|act-ignore/);
});

test('falta de diagnóstico não inventa uma causa nem uma posição', () => {
  const html = queueWaitingCardHtml(pr(1), { mark });
  assert.match(html, /Motivo da espera ainda não confirmado/);
  assert.doesNotMatch(html, /Posição|Limite de revisões simultâneas/);
});

test('espera de distribuição não recebe posição ou recusa da fila local', () => {
  const html = queueWaitingCardHtml(pr(1), { mark, distribuindo: true,
    espera: { posicao: 1, total: 3, motivo: 'memoria-insuficiente' } });
  assert.match(html, /Esperando distribuição/);
  assert.doesNotMatch(html, /Posição|Memória disponível insuficiente/);
});
