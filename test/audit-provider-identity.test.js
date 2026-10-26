import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('processos sintéticos com PID reutilizado produzem identidades de sessão distintas', () => {
  const provider = pathToFileURL(path.resolve('tools/smoke-fixtures/audit-provider.js')).href;
  const script = `Object.defineProperty(process, 'pid', { value: 424242 }); await import(${JSON.stringify(provider)});`;
  const execute = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script],
    { input: '{}', encoding: 'utf8', timeout: 10000, windowsHide: true }).trim());
  const first = execute(), second = execute();
  assert.notEqual(first.session_id, second.session_id);
  assert.equal(first.total_cost_usd, 0.12);
  assert.equal(second.total_cost_usd, 0.12);
});
