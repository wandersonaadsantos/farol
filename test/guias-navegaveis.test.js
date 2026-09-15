// Os guias do repositório (README, CLAUDE.md, CONTRIBUTING) são a porta de entrada de
// quem chega de fora. Mapa desatualizado é pior que mapa nenhum, então o que dá pra
// derivar do fonte é derivado, nunca curado à mão.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guiasDistribuidos, alvosDistribuidos } from './helpers/guias-distribuidos.js';

const RAIZ = path.join(import.meta.dirname, '..');
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

/* O índice de cada guia distribuído é gerado, nunca escrito à mão: seção nova sem entrada no
   índice reprova aqui. O slug segue a regra do GitHub (minúsculas, pontuação fora, espaço vira
   hífen, acento fica). Desde a Fase 1.5 os guias são o CLAUDE.md (sumário) e os quatro de docs/
   que viajam por allowlist, e a lista sai do empacotador pelo helper, nunca escrita aqui.

   O README fica fora das quatro travas abaixo, de propósito: ele viaja, mas é a página pública
   do repositório, lida no GitHub, e aponta legitimamente para .github/ e para o que não viaja. */
const slugDeTitulo = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

const LINK_RELATIVO = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNO = /^(https?:|mailto:)/;

// Piso de seções por guia: existe para o teste não passar vazio, não para travar tamanho.
// Números MEDIDOS no fim da Fase 1.5 (15/09/2026); guia que perde seção precisa de motivo.
const PISO_DE_SECOES = {
  'CLAUDE.md': 7,
  'docs/CONFIGURATION.md': 3,
  'docs/REVIEW-GATES.md': 11,
  'docs/MACOS.md': 3,
  'docs/RELEASE.md': 4,
};

function destinoDoLink(guia, alvo) {
  const arquivo = alvo.split('#')[0];
  if (!arquivo) return guia;
  const absoluto = path.join(path.dirname(path.join(RAIZ, guia)), arquivo);
  return path.relative(RAIZ, absoluto).split(path.sep).join('/');
}

function ancorasDe(texto) {
  return new Set(texto.split('\n')
    .filter((l) => /^#{1,6} /.test(l))
    .map((l) => slugDeTitulo(l.replace(/^#{1,6} /, '').trim())));
}

test('cada guia distribuido tem indice igual as proprias secoes', () => {
  for (const guia of guiasDistribuidos()) {
    const texto = ler(guia);
    // por PREFIXO: o marcador de abertura carrega um comentário depois do nome
    const inicio = texto.indexOf('<!-- indice:inicio');
    const fim = texto.indexOf('<!-- indice:fim');
    assert.ok(inicio >= 0 && fim > inicio, `${guia} nao tem o bloco de indice delimitado`);
    // os títulos saem do arquivo SEM o bloco do índice: o "## Índice" mora dentro dele e
    // listar a si mesmo seria ruído (e deixaria o teste impossível de satisfazer)
    const fora = texto.slice(0, inicio) + texto.slice(fim);
    const titulos = fora.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
    const piso = PISO_DE_SECOES[guia] ?? 1;
    assert.ok(titulos.length >= piso, `${guia}: ${titulos.length} secoes, abaixo do piso ${piso}`);
    const esperado = titulos.map((t) => `- [${t}](#${slugDeTitulo(t)})`);
    const linhas = texto.slice(inicio, fim).split('\n').filter((l) => l.startsWith('- ['));
    assert.deepEqual(linhas, esperado, `o indice de ${guia} divergiu das secoes do arquivo`);
  }
});

test('toda ancora citada num guia distribuido existe no documento de destino', () => {
  for (const guia of guiasDistribuidos()) {
    for (const m of ler(guia).matchAll(LINK_RELATIVO)) {
      const alvo = m[1];
      if (EXTERNO.test(alvo) || !alvo.includes('#')) continue;
      const destino = destinoDoLink(guia, alvo);
      if (!destino.endsWith('.md') || !fs.existsSync(path.join(RAIZ, destino))) continue;
      const ancora = alvo.split('#')[1];
      assert.ok(ancorasDe(ler(destino)).has(ancora), `${guia} cita ${alvo}, e ${destino} nao tem esse titulo`);
    }
  }
});

test('guia distribuido so aponta para o que tambem viaja com o app instalado', () => {
  const { arquivos, pastas } = alvosDistribuidos();
  for (const guia of guiasDistribuidos()) {
    for (const m of ler(guia).matchAll(LINK_RELATIVO)) {
      const alvo = m[1];
      if (EXTERNO.test(alvo) || alvo.startsWith('#')) continue;
      const destino = destinoDoLink(guia, alvo);
      const viaja = arquivos.has(destino) || pastas.some((d) => destino === d || destino.startsWith(`${d}/`));
      assert.ok(viaja, `${guia} aponta para ${destino}, que nao viaja com o app instalado (escreva o caminho entre crases, sem link)`);
    }
  }
});

test('nenhum paragrafo longo aparece em dois guias distribuidos', () => {
  const dono = new Map();
  const repetidos = [];
  for (const guia of guiasDistribuidos()) {
    const paragrafos = ler(guia).split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 120);
    for (const p of paragrafos) {
      if (dono.has(p) && dono.get(p) !== guia) repetidos.push(`${guia} repete um paragrafo de ${dono.get(p)}: ${p.slice(0, 60)}`);
      else dono.set(p, guia);
    }
  }
  assert.deepEqual(repetidos, [], 'conteudo duplicado entre guias: a extracao move, nunca copia');
});

test('o README manda o usuario de macOS para o guia distribuido', () => {
  const blocoMac = README.split('### macOS')[1]?.split('\n## ')[0] || '';
  assert.ok(blocoMac.includes('docs/MACOS.md'), 'o bloco de instalacao do macOS no README nao aponta para docs/MACOS.md');
  assert.ok(!/se[cç][aã]o ["“]?macOS["”]? do `CLAUDE\.md`/.test(blocoMac), 'o README ainda manda abrir a secao macOS do CLAUDE.md');
});

test('o CONTRIBUTING manda o recem-chegado pro mapa do codigo', () => {
  const contrib = ler('.github/CONTRIBUTING.md');
  assert.ok(contrib.includes('README.md#mapa-do-código'),
    'o CONTRIBUTING não aponta para a seção "Mapa do código" do README');
});

/* Link relativo quebrado é o modo de falha das fases que MOVEM arquivo: o guia
   continua parecendo certo e o destino sumiu. Vale pros guias da raiz e pro docs/,
   menos as pastas de método e de plano, que citam caminho de worktree que não existe
   mais de propósito. */
const GUIAS = ['README.md', 'CLAUDE.md', '.github/CONTRIBUTING.md', '.github/SECURITY.md', 'docs/QUALITY.md'];

test('todo link relativo dos guias aponta pra arquivo que existe', () => {
  for (const guia of GUIAS) {
    const base = path.dirname(path.join(RAIZ, guia));
    for (const m of ler(guia).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const alvo = m[1];
      if (/^(https?:|mailto:|#)/.test(alvo)) continue;
      const arquivo = path.join(base, alvo.split('#')[0]);
      assert.ok(fs.existsSync(arquivo), `${guia} aponta pra ${alvo}, que não existe`);
    }
  }
});
