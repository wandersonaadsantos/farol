// O que só a tela sabe da autoanálise em andamento: quando a sessão que sumiu é falha, e quando
// não é. Foi aqui que apareceram o falso "não terminou" e o "Cancelando…" preso (08/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const { andamentoDoPr, observarCancelamentos, dispensarFalha } = await import('../ui/telas/autoanalise-andamento.js');
const { definirEstado } = await import('../ui/telas/estado.js');

const sessao = (key, extra = {}) => ({ id: 's1', mode: 'self', keys: [key], startedAt: 1000, ultimoSinalEm: Date.now(), ...extra });
const ver = (key, sess, itens = []) => {
  definirEstado({ activeSessions: sess ? [sess] : [], activity: sess ? { [sess.id]: itens } : {} });
  observarCancelamentos();
  return andamentoDoPr(key, { running: !!sess, qpos: 0, analise: null });
};

test('a sessão que some sem análise nova vira falha, e dá para dispensar', () => {
  ver('a#1', sessao('a#1'));
  assert.equal(ver('a#1', null).tipo, 'falha');
  dispensarFalha('a#1');
  assert.equal(ver('a#1', null), null);
});

test('com análise nova a sessão que some não é falha', () => {
  ver('a#2', sessao('a#2'));
  definirEstado({ activeSessions: [], activity: {} });
  assert.equal(andamentoDoPr('a#2', { running: false, qpos: 0, analise: { at: 1000 } }), null);
});

test('cancelada por outra via, visto só no estado recebido, não vira falha', () => {
  ver('a#3', sessao('a#3'));
  definirEstado({ activeSessions: [sessao('a#3', { cancelled: true })], activity: {} });
  observarCancelamentos();
  assert.equal(ver('a#3', null), null);
});

test('a marca de cancelamento não passa para a sessão seguinte', () => {
  definirEstado({ activeSessions: [sessao('a#4', { cancelled: true })], activity: {} });
  observarCancelamentos();
  assert.equal(ver('a#4', sessao('a#4', { id: 's2' })).cancelando, false);
});

test('a etapa não recua quando as linhas antigas saem do feed', () => {
  const s = sessao('a#5', { id: 's5' });
  assert.equal(ver('a#5', s, [{ s: 'verificacao' }]).etapa, 2);
  assert.equal(ver('a#5', s, [{ s: 'leitura' }]).etapa, 2);
});
