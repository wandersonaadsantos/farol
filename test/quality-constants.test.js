'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PORT, TEMPOS } = require('../lib/constants.js');

test('constantes de infra: valores historicos preservados', () => {
  assert.equal(DEFAULT_PORT, 47170);
  assert.equal(TEMPOS.GH_TIMEOUT_MS, 60000);
  assert.equal(TEMPOS.SESSAO_HEADLESS_MS, 1800000);
  assert.equal(TEMPOS.SSE_PING_MS, 25000);
});
