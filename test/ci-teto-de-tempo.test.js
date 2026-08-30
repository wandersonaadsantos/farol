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
