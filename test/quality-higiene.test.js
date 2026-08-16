'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { refsForaDeTodo } = require('../tools/quality/higiene.js');

test('TODO(BT-123) e legitimo; BT-123 solto conta', () => {
  assert.equal(refsForaDeTodo('// TODO(BT-123): migrar'), 0);
  assert.equal(refsForaDeTodo('// veio do card BT-123'), 1);
  assert.equal(refsForaDeTodo('// BT-1 e BUGS-22 juntos'), 2);
});
