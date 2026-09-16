// Trava de estabilidade da suíte (T0): nenhum arquivo de teste registra um caso ANTES de
// terminar de carregar o que ele importa com `await` no topo.
//
// O caso medido (16/09/2026, durante a C4b): `npm test` roda com `--test-force-exit`, que
// encerra o processo quando os casos JÁ REGISTRADOS terminam. `test/review-commit-id.js`
// registrava três casos e só depois fazia `await import('../server.js')`; enquanto o grafo
// de módulos do engine era menor, a importação chegava primeiro e ninguém via nada. Com um
// módulo a mais no caminho, ela passou a chegar depois, e os seis casos seguintes saíram
// como CANCELADOS numa rodada que ainda dizia "0 falhas".
//
// Silêncio que parece verde é o pior modo de falha de uma suíte, e por isso a regra vira
// trava: todo `await` de topo vem antes do primeiro `test(`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const AWAIT_DE_TOPO = /^(?:const|let|var)\s[^=]+=\s*\(?await\s|^await\s/;
const REGISTRO = /^(?:test|describe)\s*\(/;

function analisar(arquivo) {
  const linhas = fs.readFileSync(path.join(DIR, arquivo), 'utf8').split('\n');
  let primeiroCaso = -1;
  const tardios = [];
  linhas.forEach((linha, i) => {
    if (primeiroCaso < 0 && REGISTRO.test(linha)) primeiroCaso = i;
    if (primeiroCaso >= 0 && AWAIT_DE_TOPO.test(linha)) tardios.push(i + 1);
  });
  return { primeiroCaso, tardios };
}

test('nenhum teste registra caso antes de terminar os await de topo', () => {
  const arquivos = fs.readdirSync(DIR).filter((n) => n.endsWith('.test.js'));
  assert.ok(arquivos.length > 100, 'a varredura precisa achar a suíte inteira');
  const ruins = arquivos.map((a) => ({ a, ...analisar(a) })).filter((r) => r.tardios.length);
  assert.deepEqual(ruins.map((r) => `${r.a}:${r.tardios.join(',')}`), [],
    'com --test-force-exit, um await de topo depois de um caso registrado vira teste cancelado em silêncio');
});
