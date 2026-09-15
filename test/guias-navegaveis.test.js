// Os guias do repositório (README, CLAUDE.md, CONTRIBUTING) são a porta de entrada de
// quem chega de fora. Mapa desatualizado é pior que mapa nenhum, então o que dá pra
// derivar do fonte é derivado, nunca curado à mão.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const README = ler('README.md');

test('o README tem o mapa do codigo', () => {
  assert.match(README, /^## Mapa do código$/m, 'faltou a seção "Mapa do código" no README');
});

test('o mapa do README documenta as DUAS entradas, com o comando de cada uma', () => {
  const pkg = JSON.parse(ler('package.json'));
  const mapa = README.split('## Mapa do código')[1] || '';
  assert.ok(mapa.includes('`main.js`'), 'o mapa não cita main.js');
  assert.ok(mapa.includes('`server.js`'), 'o mapa não cita server.js');
  for (const script of ['start', 'server']) {
    assert.ok(mapa.includes(`npm run ${script}`) || mapa.includes(`npm ${script}`),
      `o mapa não diz como rodar o script "${script}" (${pkg.scripts[script]})`);
  }
  assert.equal(pkg.main, 'main.js', 'o package.json deixou de apontar main.js e o mapa mente');
});

test('todo caminho do repositorio citado no mapa existe', () => {
  const mapa = README.split('## Mapa do código')[1].split('\n## ')[0];
  const citados = [...mapa.matchAll(/`([\w./-]+\/[\w./-]*|\w+\.js)`/g)].map((m) => m[1]);
  assert.ok(citados.length >= 4, 'o mapa cita menos caminhos do que o esperado, confira o teste');
  for (const c of new Set(citados)) {
    assert.ok(fs.existsSync(path.join(RAIZ, c)), `o mapa do README cita ${c}, que não existe`);
  }
});
