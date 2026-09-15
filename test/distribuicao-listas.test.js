// As listas do que viaja na instalação e no pacote são FIXAS e moram em quatro
// arquivos diferentes. Criar ou mover pasta de topo sem atualizar as quatro quebra
// instalação e auto-update sem nenhum erro visível (foi o caso de tools/, PR #36).
// Este teste não mantém lista própria: ele deriva as quatro do fonte e exige que
// concordem, do mesmo jeito que test/facades.test.js deriva as fachadas do server.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// nome de arquivo ou pasta do repositório, pra separar a lista de distribuição de
// outros laços do mesmo script (o install.sh tem um `for d in /opt/homebrew/bin ...`)
const NOME_SIMPLES = /^[A-Za-z][\w.-]*$/;

const RE_PS = {
  f: /foreach \(\$f in @\(([\s\S]*?)\)\)/g,
  d: /foreach \(\$d in @\(([\s\S]*?)\)\)/g,
  t: /foreach \(\$t in @\(([\s\S]*?)\)\)/g,
};
const RE_SH = {
  f: /^for f in (.+); do$/gm,
  d: /^for d in (.+); do$/gm,
};

function listaPowershell(texto, variavel, arquivo) {
  const re = new RegExp(RE_PS[variavel].source, 'g');
  const achadas = [...texto.matchAll(re)].map((m) => (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
  assert.equal(achadas.length, 1, `${arquivo}: esperava UMA lista de $${variavel}, achei ${achadas.length}`);
  return achadas[0];
}

function listaBash(texto, variavel, arquivo) {
  const re = new RegExp(RE_SH[variavel].source, 'gm');
  const achadas = [...texto.matchAll(re)]
    .map((m) => m[1].trim().split(/\s+/))
    .filter((itens) => itens.every((i) => NOME_SIMPLES.test(i)));
  assert.equal(achadas.length, 1, `${arquivo}: esperava UMA lista de ${variavel} com nomes simples, achei ${achadas.length}`);
  return achadas[0];
}

const INSTALADORES = {
  'installer/install.ps1': (t, a) => ({ arquivos: listaPowershell(t, 'f', a), pastas: listaPowershell(t, 'd', a) }),
  'installer/install.sh': (t, a) => ({ arquivos: listaBash(t, 'f', a), pastas: listaBash(t, 'd', a) }),
  'installer/install-linux.sh': (t, a) => ({ arquivos: listaBash(t, 'f', a), pastas: listaBash(t, 'd', a) }),
};

const listas = Object.fromEntries(Object.entries(INSTALADORES).map(([arq, fn]) => [arq, fn(ler(arq), arq)]));
const pacote = ler('tools/make-package.ps1');
const pacoteArquivos = listaPowershell(pacote, 'f', 'tools/make-package.ps1');
const pacotePastas = listaPowershell(pacote, 'd', 'tools/make-package.ps1');
const pacoteTools = listaPowershell(pacote, 't', 'tools/make-package.ps1');
const instalado = listas['installer/install.ps1'];

test('os tres instaladores copiam os mesmos arquivos de raiz e as mesmas pastas', () => {
  for (const [arq, l] of Object.entries(listas)) {
    assert.deepEqual(l.arquivos, instalado.arquivos, `${arq} diverge nos arquivos de raiz`);
    assert.deepEqual(l.pastas, instalado.pastas, `${arq} diverge nas pastas`);
  }
});

test('todo arquivo de raiz instalado viaja no pacote', () => {
  for (const f of instalado.arquivos) {
    assert.ok(pacoteArquivos.includes(f), `${f} e instalado mas nao entra no zip`);
  }
});

test('toda pasta instalada viaja no pacote', () => {
  for (const d of instalado.pastas) {
    // tools/ viaja por lista de ARQUIVOS nomeados no pacote (o resto da pasta é
    // ferramenta de build, não runtime), então a checagem aqui é do que é runtime
    if (d === 'tools') { assert.ok(pacoteTools.includes('jira-mcp.js'), 'tools/ viaja por arquivos nomeados e jira-mcp.js e runtime'); continue; }
    assert.ok(pacotePastas.includes(d), `a pasta ${d} e instalada mas nao entra no zip`);
  }
});

test('tudo que as listas nomeiam existe no repositorio', () => {
  for (const f of new Set([...pacoteArquivos, ...instalado.arquivos])) {
    assert.ok(fs.existsSync(path.join(RAIZ, f)), `${f} esta numa lista de distribuicao e nao existe`);
  }
  for (const d of new Set([...pacotePastas, ...instalado.pastas])) {
    assert.ok(fs.existsSync(path.join(RAIZ, d)) && fs.statSync(path.join(RAIZ, d)).isDirectory(), `${d} nao e pasta do repositorio`);
  }
  for (const t of pacoteTools) assert.ok(fs.existsSync(path.join(RAIZ, 'tools', t)), `tools/${t} nao existe`);
});
