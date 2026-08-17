import { test } from 'node:test';
import assert from 'node:assert/strict';
import env from '../lib/env.js';

test('env e preguicoso: stub setado DEPOIS do require e enxergado', () => {
  delete process.env.FAROL_REVIEW_CMD;
  assert.equal(env.reviewCmdStub(), undefined);
  process.env.FAROL_REVIEW_CMD = 'node fake.js';
  assert.equal(env.reviewCmdStub(), 'node fake.js');
  delete process.env.FAROL_REVIEW_CMD;
});

test('debugSpawns liga e desliga pelo setter', () => {
  env.setDebugSpawns(true);
  assert.equal(env.debugSpawns(), true);
  env.setDebugSpawns(false);
  assert.equal(env.debugSpawns(), false);
});
