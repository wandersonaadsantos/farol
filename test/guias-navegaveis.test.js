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

/* O índice do CLAUDE.md é gerado, nunca escrito à mão: seção nova sem entrada no
   índice reprova aqui. O slug segue a regra do GitHub (minúsculas, pontuação fora,
   espaço vira hífen, acento fica). */
const slugDeTitulo = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

test('o indice do CLAUDE.md lista TODAS as secoes, na ordem, com ancora valida', () => {
  const guia = ler('CLAUDE.md');
  // por PREFIXO: o marcador de abertura carrega um comentário depois do nome
  const inicio = guia.indexOf('<!-- indice:inicio');
  const fim = guia.indexOf('<!-- indice:fim');
  assert.ok(inicio >= 0 && fim > inicio, 'o CLAUDE.md não tem o bloco de índice delimitado');
  const indice = guia.slice(inicio, fim);
  // os títulos saem do arquivo SEM o bloco do índice: o "## Índice" mora dentro dele e
  // listar a si mesmo seria ruído (e deixaria o teste impossível de satisfazer)
  const fora = guia.slice(0, inicio) + guia.slice(fim);
  const titulos = fora.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
  assert.ok(titulos.length >= 15, `esperava o CLAUDE.md com muitas seções, achei ${titulos.length}`);
  const esperado = titulos.map((t) => `- [${t}](#${slugDeTitulo(t)})`);
  const linhas = indice.split('\n').filter((l) => l.startsWith('- ['));
  assert.deepEqual(linhas, esperado, 'o índice do CLAUDE.md divergiu das seções do arquivo');
});
