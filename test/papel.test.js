import test from 'node:test';
import assert from 'node:assert/strict';
import { ehObservador } from '../lib/sync/papel.js';

test('com sinal: observador se e só se o admin é este aparelho', () => {
  assert.equal(ehObservador({ adminDev: 'd1', deviceId: 'd1', temChaveDeAdmin: false }), true);
  assert.equal(ehObservador({ adminDev: 'd2', deviceId: 'd1', temChaveDeAdmin: true }), false);
});
test('sem sinal: a chave local decide, falhando fechado', () => {
  assert.equal(ehObservador({ adminDev: '', deviceId: 'd1', temChaveDeAdmin: true }), true);
  assert.equal(ehObservador({ adminDev: '', deviceId: 'd1', temChaveDeAdmin: false }), false);
});
test('sem deviceId não há papel de admin', () => {
  assert.equal(ehObservador({ adminDev: 'd1', deviceId: '', temChaveDeAdmin: false }), false);
});
