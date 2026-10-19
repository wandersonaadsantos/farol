import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const executor = path.resolve(import.meta.dirname, '../tools/rodar-testes.js');

function rodar(t, fonte, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-runner-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const arquivo = path.join(dir, 'fixture.mjs');
  fs.writeFileSync(arquivo, fonte);
  return spawnSync(process.execPath, [executor, ...args, arquivo], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, FAROL_TEST_CONCORRENCIA: '1' },
  });
}

test('o executor propaga uma falha real de teste', (t) => {
  const r = rodar(t, "import test from 'node:test'; test('falha de prova', () => { throw new Error('falha esperada'); });");
  assert.ifError(r.error);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /falha esperada/);
});

test('o executor encaminha os argumentos usados pela matriz e pela seleção de casos', (t) => {
  const r = rodar(t, `import test from 'node:test';
    test('selecionado', () => {});
    test('fora da seleção', () => { throw new Error('não deveria executar'); });`,
  ['--no-test-force-exit', '--test-name-pattern=selecionado']);
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selecionado/);
});
