import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparar } from '../tools/quality/gate.js';

test('comparar: contagem igual ou menor passa', () => {
  const base = { 'a.js': { emptyCatch: 2 } };
  assert.deepEqual(comparar({ 'a.js': { emptyCatch: 1 } }, base).regressoes, []);
  assert.deepEqual(comparar({ 'a.js': { emptyCatch: 2 } }, base).regressoes, []);
});

test('comparar: contagem maior e arquivo novo com violacao reprovam', () => {
  const base = { 'a.js': { emptyCatch: 1 } };
  assert.equal(comparar({ 'a.js': { emptyCatch: 2 } }, base).regressoes.length, 1);
  assert.equal(comparar({ 'a.js': { emptyCatch: 1 }, 'novo.js': { varUse: 1 } }, base).regressoes.length, 1);
});

test('comparar: arquivo deletado nao reprova', () => {
  assert.deepEqual(comparar({}, { 'a.js': { emptyCatch: 5 } }).regressoes, []);
});
