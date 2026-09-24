// Todo job do CI declara teto de tempo.
//
// Por que existe: em 30/08/2026 o job de macOS ficou preso no passo de testes
// (a suíte roda em segundos) e seguiria até o default do GitHub, que é de SEIS
// HORAS. Aconteceu duas vezes no mesmo dia, na `main` e num PR, e as duas foram
// resolvidas na mão: enquanto durou, o PR ficou `BLOCKED` esperando um job que
// nunca ia terminar, e o runner queimou tempo à toa. Job eterno é pior que job
// vermelho, porque ele não informa nada e ainda segura a fila.
//
// É a mesma doutrina que o repositório já aplicou dentro da suíte ("teto de
// tempo no git, para trave virar falha legível em vez de job eterno"), levada
// pro lugar que faltava, que é o próprio workflow.
//
// A leitura é por texto e não por parser de YAML de propósito: o invariante 1
// proíbe dependência npm, e a pergunta aqui é simples o bastante pra não pedir
// uma. O teste falha se alguém acrescentar job novo sem teto.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const CI = path.join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');
const PKG = path.join(import.meta.dirname, '..', 'package.json');

/** Nome de cada job e o corpo dele, lendo a indentação do bloco `jobs:`. */
function jobsDo(texto) {
  const linhas = texto.split(/\r?\n/);
  const inicio = linhas.findIndex(l => /^jobs:\s*$/.test(l));
  assert.ok(inicio >= 0, 'ci.yml precisa ter um bloco jobs:');
  const jobs = [];
  for (let i = inicio + 1; i < linhas.length; i++) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(linhas[i]);
    if (!m) continue;
    const fim = linhas.findIndex((l, j) => j > i && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
    jobs.push({ nome: m[1], corpo: linhas.slice(i, fim === -1 ? linhas.length : fim).join('\n') });
  }
  return jobs;
}

test('todo job do CI declara timeout-minutes', () => {
  const texto = fs.readFileSync(CI, 'utf8');
  const jobs = jobsDo(texto);
  assert.ok(jobs.length >= 2, `esperava achar os jobs do ci.yml, achei ${jobs.length}`);
  for (const job of jobs) {
    const m = /^ {4}timeout-minutes:\s*(\d+)\s*$/m.exec(job.corpo);
    assert.ok(m, `job "${job.nome}" sem timeout-minutes: sem teto ele roda ate o default de 360 min do GitHub`);
    const min = Number(m[1]);
    assert.ok(min > 0 && min <= 30, `job "${job.nome}" com teto de ${min} min: a suite roda em segundos, teto alto nao protege de nada`);
  }
});

/* O teto do JOB salva a fila, mas nao diz o nome de nada: o passo e cancelado e o log
   termina no meio, sem culpado. Aconteceu de novo em 23 e 24/09/2026, tres vezes no mesmo
   dia no macOS (dois PRs e a main), sempre com a suite terminando em ~2,5 min de teste e o
   processo ficando de pe por mais doze.

   O teto do RUNNER resolve a outra metade: `--test-timeout` transforma a trava numa falha
   com nome ("test timed out after Nms"), com saida 1, na hora. Medido: o caso mais lento da
   suite leva 25 s, entao o teto e folgado o bastante para nao inventar falha em runner
   lento, e apertado o bastante para caber MUITAS vezes dentro do teto do job.

   A relacao entre os dois e o que importa, e e ela que este caso trava: runner com teto
   MAIOR que o job devolveria o silencio de hoje, com uma configuracao a mais para manter. */
const TETO_DO_RUNNER = /--test-timeout=(\d+)/;

test('a suite declara teto de tempo POR TESTE, para trava virar falha com nome', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const script = String((pkg.scripts || {}).test || '');
  const m = TETO_DO_RUNNER.exec(script);
  assert.ok(m, 'npm test sem --test-timeout: trava vira job cancelado sem culpado, que foi o que aconteceu tres vezes em 23/09/2026');
  const ms = Number(m[1]);
  assert.ok(ms >= 60000, `teto de ${ms}ms: o caso mais lento medido leva 25 s, e teto apertado inventa falha em runner lento`);
  assert.match(script, /--test-force-exit/, 'o force-exit continua: ele cuida do que sobra DEPOIS dos testes');
});

test('o teto por teste cabe dentro do teto do job, senao o job mata antes de a trava se nomear', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const ms = Number(TETO_DO_RUNNER.exec(String((pkg.scripts || {}).test || ''))[1]);
  const jobs = jobsDo(fs.readFileSync(CI, 'utf8'));
  const tetos = jobs.map(j => Number(/^ {4}timeout-minutes:\s*(\d+)\s*$/m.exec(j.corpo)[1]) * 60000);
  const menor = Math.min(...tetos);
  assert.ok(ms < menor, `teto por teste (${ms}ms) precisa ser menor que o do job mais curto (${menor}ms)`);
});
