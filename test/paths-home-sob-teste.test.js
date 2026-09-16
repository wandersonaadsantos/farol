// Trava de EXECUÇÃO contra teste que escreve na pasta de dados real (incidente de
// 15/09/2026, 22:29): um teste com import estático de lib/paths.js, rodado sozinho com
// `node --test <arquivo>`, resolveu HOME para o ~/.farol verdadeiro antes de a env
// isolada existir, e gravou config, credencial e chaves de teste por cima das reais.
//
// A trava estática (test-isolation.test.js) só roda na suíte inteira, e por isso não
// pegou a execução avulsa. Esta roda em QUALQUER processo do executor de testes: sob
// `NODE_TEST_CONTEXT`, sem FAROL_HOME, o HOME é um diretório temporário, nunca o real.
//
// Os processos filhos abaixo só IMPRIMEM o caminho resolvido; nenhum grava nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PATHS = new URL('../lib/paths.js', import.meta.url).href;
const SCRIPT = `import(${JSON.stringify(PATHS)}).then((m) => process.stdout.write(m.HOME));`;
const REAL = path.join(os.homedir(), '.farol');

function resolver(env) {
  const limpo = { ...process.env };
  delete limpo.FAROL_HOME;
  delete limpo.NODE_TEST_CONTEXT;
  return execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT], { env: { ...limpo, ...env }, encoding: 'utf8' });
}

test('sob o executor de testes e sem FAROL_HOME, o HOME nunca é a pasta real', () => {
  const home = resolver({ NODE_TEST_CONTEXT: 'child-v8' });
  assert.notEqual(path.resolve(home), path.resolve(REAL));
  assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir())), home);
});

test('com FAROL_HOME, vale ele, com ou sem executor de testes', () => {
  const alvo = path.join(os.tmpdir(), 'farol-home-explicito');
  assert.equal(resolver({ FAROL_HOME: alvo, NODE_TEST_CONTEXT: 'child-v8' }), alvo);
  assert.equal(resolver({ FAROL_HOME: alvo }), alvo);
});

test('fora do executor de testes, o app continua usando ~/.farol', () => {
  assert.equal(path.resolve(resolver({})), path.resolve(REAL));
});
