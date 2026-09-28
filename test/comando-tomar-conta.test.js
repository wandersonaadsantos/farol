// `tomar` exige a conta (Task 3, 28/09/2026): a tomada de lease sem acctTag deixava o
// executor confiar na conta que ELE resolvia para o PR, e o admin não tinha como pedir a
// tomada para uma conta específica. Puro: sem estado, sem IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import comando from '../lib/sync/comando.js';

const T = 'a'.repeat(32);
test('tomar sem acctTag não é comando', () => {
  assert.equal(comando.sanearComando({ tipo: 'tomar', args: { prTag: T, matTag: T, confirmado: true } }), null);
});
test('tomar com acctTag viaja com ela', () => {
  const c = comando.sanearComando({ tipo: 'tomar', args: { prTag: T, matTag: T, acctTag: T, confirmado: true } });
  assert.equal(c.args.acctTag, T);
});
