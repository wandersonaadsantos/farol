// Mantém os mesmos testes e limites; a máquina pode reduzir o paralelismo.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testConcurrency, semAsVariaveis } from '../lib/env.js';

const concorrencia = Number(testConcurrency() || 4);
if (!Number.isInteger(concorrencia) || concorrencia < 1 || concorrencia > 4) {
  throw new Error('FAROL_TEST_CONCORRENCIA deve ser um inteiro entre 1 e 4');
}

// Uma chamada explícita da suíte não herda o contexto de um teste hospedeiro.
// O próprio Node define o contexto correto para os arquivos que vai executar.
const env = semAsVariaveis(['NODE_TEST_CONTEXT']);
const resultado = spawnSync(process.execPath, [
  '--test', `--test-concurrency=${concorrencia}`, '--test-force-exit', '--test-timeout=120000',
  ...process.argv.slice(2),
], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'inherit', env });
if (resultado.error) console.error(resultado.error.message);
if (resultado.signal) console.error(`A suíte terminou pelo sinal ${resultado.signal}`);
process.exitCode = resultado.status ?? 1;
