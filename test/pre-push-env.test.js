import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hook = fs.readFileSync(new URL('../tools/hooks/pre-push', import.meta.url), 'utf8');

test('pre-push nao vaza o GIT_DIR do hook para a suite', () => {
  const limpeza = hook.indexOf('unset $(git rev-parse --local-env-vars)');
  const primeiroGate = hook.indexOf('npm run check');
  assert.ok(limpeza >= 0, 'o hook precisa remover as variaveis git locais');
  assert.ok(primeiroGate >= 0 && limpeza < primeiroGate, 'a limpeza precisa acontecer antes da suite');
});
