import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORT, TEMPOS } from '../lib/constants.js';

test('constantes de infra: valores historicos preservados', () => {
  assert.equal(DEFAULT_PORT, 47170);
  assert.equal(TEMPOS.GH_TIMEOUT_MS, 60000);
  assert.equal(TEMPOS.SESSAO_HEADLESS_MS, 7200000);
  assert.equal(TEMPOS.SESSAO_SEM_PROGRESSO_MS, 1800000);
  assert.ok(TEMPOS.SINAL_REVISAO_TTL_MS > TEMPOS.SESSAO_HEADLESS_MS);
  assert.equal(TEMPOS.SSE_PING_MS, 25000);
});
