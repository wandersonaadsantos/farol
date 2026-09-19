// O bloco de divergência entre o gh desta máquina e as contas do Farol (v2.62.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contasGhHtml, contasGhVazio } from '../ui/pure.js';

const REAL = {
  lidas: true,
  naoMonitoradas: ['agente70reviewer'],
  semLogin: ['alexpraxedes'],
  orgsDuplicadas: [{ owner: 'biudtech', contas: ['wandersonbiuder', 'alexpraxedes'] }],
  sugestoes: [{ conta: 'wandersonaadsantos', owner: 'Edicoes-CNBB', origens: ['pedido'] }],
};

test('sem divergência o bloco não existe', () => {
  assert.equal(contasGhHtml(null), '');
  assert.equal(contasGhHtml({ lidas: true, naoMonitoradas: [], semLogin: [], orgsDuplicadas: [], sugestoes: [] }), '');
  assert.equal(contasGhVazio({}), true);
});

test('cada divergência vem com o ato que a resolve', () => {
  const html = contasGhHtml(REAL);
  assert.match(html, /data-gh-monitorar="agente70reviewer"/);
  assert.match(html, /class="btn sm ghost acct-remove" data-user="alexpraxedes"/, 'reusa a remoção com confirmação que já existe');
  assert.match(html, /data-gh-tirar-org="biudtech" data-user="alexpraxedes"/);
  assert.doesNotMatch(html, /data-gh-tirar-org="biudtech" data-user="wandersonbiuder"/, 'a primeira da lista é a que vale, e fica');
  assert.match(html, /data-gh-add-org="Edicoes-CNBB" data-user="wandersonaadsantos"/);
  assert.match(html, /foi pedida como revisora/);
});

test('login e org entram escapados', () => {
  const html = contasGhHtml({ naoMonitoradas: ['<x>'], sugestoes: [{ conta: 'a', owner: '"><img>', origens: ['membro'] }] });
  assert.doesNotMatch(html, /<x>|"><img>/);
  assert.match(html, /&lt;x&gt;/);
});
