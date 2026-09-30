// O contrato do envio por diferenca: o que o cliente precisa mesclar, o que ele
// precisa apagar, e o empurrao que nao deve virar evento nenhum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camposSerializados, mudancas, corpoDoPatch, semMudanca } from '../lib/estado-delta.js';

test('camposSerializados: um texto JSON por campo de topo', () => {
  const s = camposSerializados({ status: 'idle', queue: [1, 2], nada: undefined });
  assert.equal(s.status, '"idle"');
  assert.equal(s.queue, '[1,2]');
  assert.equal(s.nada, 'null');
});

test('camposSerializados: estado ausente nao explode', () => {
  assert.deepEqual(Object.keys(camposSerializados(null)), []);
  assert.deepEqual(Object.keys(camposSerializados(undefined)), []);
});

test('mudancas: campo igual nao entra, campo alterado entra', () => {
  const antes = camposSerializados({ a: 1, b: { x: 1 } });
  const depois = camposSerializados({ a: 1, b: { x: 2 } });
  assert.deepEqual(mudancas(antes, depois), { alterados: ['b'], removidos: [] });
});

test('mudancas: campo que sumiu e removido, nao alterado', () => {
  const antes = camposSerializados({ a: 1, b: 2 });
  const depois = camposSerializados({ a: 1 });
  assert.deepEqual(mudancas(antes, depois), { alterados: [], removidos: ['b'] });
});

test('mudancas: campo novo conta como alterado', () => {
  const antes = camposSerializados({ a: 1 });
  const depois = camposSerializados({ a: 1, c: 3 });
  assert.deepEqual(mudancas(antes, depois), { alterados: ['c'], removidos: [] });
});

// A ordem das chaves do snapshot nao pode virar mudanca: `snapshot()` monta o objeto
// do zero, e um campo que mudou de lugar continua sendo o mesmo dado.
test('mudancas: ordem diferente dos campos nao e mudanca', () => {
  const antes = camposSerializados({ a: 1, b: 2 });
  const depois = camposSerializados({ b: 2, a: 1 });
  assert.deepEqual(mudancas(antes, depois), { alterados: [], removidos: [] });
});

test('semMudanca: so quando nao ha alterado nem removido', () => {
  assert.equal(semMudanca({ alterados: [], removidos: [] }), true);
  assert.equal(semMudanca({ alterados: ['a'], removidos: [] }), false);
  assert.equal(semMudanca({ alterados: [], removidos: ['a'] }), false);
});

test('corpoDoPatch: JSON valido, so com o que mudou, reusando o texto ja serializado', () => {
  const atual = { status: 'checking', queue: [{ key: 'o/r#1' }], usage: { dias: [1, 2, 3] } };
  const serializado = camposSerializados(atual);
  const anterior = camposSerializados({ status: 'idle', queue: [{ key: 'o/r#1' }], usage: { dias: [1, 2, 3] }, velho: 1 });
  const patch = JSON.parse(corpoDoPatch(serializado, mudancas(anterior, serializado)));
  assert.deepEqual(patch.campos, { status: 'checking' });
  assert.deepEqual(patch.removidos, ['velho']);
});

// Mesclar o patch no estado anterior tem que dar exatamente o snapshot novo: e a
// unica coisa que o cliente faz com ele, e errar aqui seria a tela divergir do engine
// sem ninguem perceber.
test('corpoDoPatch: mesclar no anterior reproduz o snapshot inteiro', () => {
  const antes = { status: 'idle', queue: [], parked: { a: 1 }, some: true };
  const depois = { status: 'checking', queue: [{ key: 'o/r#2' }], parked: { a: 1 } };
  const serializado = camposSerializados(depois);
  const patch = JSON.parse(corpoDoPatch(serializado, mudancas(camposSerializados(antes), serializado)));
  const mesclado = { ...antes, ...patch.campos };
  for (const k of patch.removidos) delete mesclado[k];
  assert.deepEqual(mesclado, depois);
});
