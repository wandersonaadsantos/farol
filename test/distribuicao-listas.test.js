// As listas do que viaja na instalação e no pacote são FIXAS e moram em quatro
// arquivos diferentes. Criar ou mover pasta de topo sem atualizar as quatro quebra
// instalação e auto-update sem nenhum erro visível (foi o caso de tools/, PR #36).
// Este teste não mantém lista própria: ele deriva as quatro do fonte e exige que
// concordem, do mesmo jeito que test/facades.test.js deriva as fachadas do server.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// nome de arquivo ou pasta do repositório, pra separar a lista de distribuição de
// outros laços do mesmo script (o install.sh tem um `for d in /opt/homebrew/bin ...`)
const NOME_SIMPLES = /^[A-Za-z][\w.-]*$/;

const RE_PS = {
  f: /foreach \(\$f in @\(([\s\S]*?)\)\)/g,
  d: /foreach \(\$d in @\(([\s\S]*?)\)\)/g,
  t: /foreach \(\$t in @\(([\s\S]*?)\)\)/g,
  doc: /foreach \(\$doc in @\(([\s\S]*?)\)\)/g,
};
const RE_SH = {
  f: /^for f in (.+); do$/gm,
  d: /^for d in (.+); do$/gm,
  t: /^for t in (.+); do$/gm,
  doc: /^for doc in (.+); do$/gm,
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

/* As rotas de instalador COMPLETO (Setup.exe e offline do macOS) montam o app com listas
   próprias e são o que a pessoa baixa na primeira instalação (decisão D1 da Fase 1.5,
   15/09/2026). Duas regras de comparação, as duas medidas: elas carregam node_modules a mais,
   que é o que as torna offline, e só esse item sai da comparação de pastas; e tools/ viaja por
   ARQUIVOS nomeados em toda rota que monta pacote, então a pasta sai da comparação e a lista
   de arquivos de tools de cada rota tem de ser igual à do pacote. */
const EMBUTEM_RUNTIME = new Set(['node_modules']);
const PASTA_POR_ARQUIVOS = 'tools';

const ROTAS_COMPLETAS = {
  'tools/make-installer.ps1': (t, a) => ({
    arquivos: listaPowershell(t, 'f', a), pastas: listaPowershell(t, 'd', a), tools: listaPowershell(t, 't', a),
  }),
  'tools/make-offline-mac.sh': (t, a) => ({
    arquivos: listaBash(t, 'f', a), pastas: listaBash(t, 'd', a), tools: listaBash(t, 't', a),
  }),
};
const completas = Object.fromEntries(Object.entries(ROTAS_COMPLETAS).map(([arq, fn]) => [arq, fn(ler(arq), arq)]));

test('os instaladores completos (Setup.exe e offline do mac) levam o mesmo que o instalador', () => {
  const pastasDoInstalador = instalado.pastas.filter((d) => d !== PASTA_POR_ARQUIVOS);
  for (const [arq, l] of Object.entries(completas)) {
    assert.deepEqual(l.arquivos, instalado.arquivos, `${arq} diverge nos arquivos de raiz`);
    const pastas = l.pastas.filter((d) => !EMBUTEM_RUNTIME.has(d));
    assert.deepEqual(pastas, pastasDoInstalador, `${arq} diverge nas pastas (fora node_modules e tools)`);
    assert.deepEqual(l.tools, pacoteTools, `${arq} nao leva os mesmos arquivos de tools que o pacote`);
  }
});

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
    // ferramenta de build). QUAIS arquivos são de runtime não se decide aqui: quem
    // deriva isso de lib/ é test/pacote-runtime-tools.test.js, e repetir um nome à
    // mão criaria uma segunda fonte de verdade para a mesma pergunta
    if (d === 'tools') { assert.ok(pacoteTools.length > 0, 'tools/ e instalada e o pacote nao nomeia nenhum arquivo dela'); continue; }
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

const LEITOR_DA_ROTA = {
  'installer/install.ps1': listaPowershell,
  'installer/install.sh': listaBash,
  'installer/install-linux.sh': listaBash,
  'tools/make-package.ps1': listaPowershell,
  'tools/make-installer.ps1': listaPowershell,
  'tools/make-offline-mac.sh': listaBash,
};
const textoDaRota = Object.fromEntries(Object.keys(LEITOR_DA_ROTA).map((arq) => [arq, ler(arq)]));
const docsPorRota = Object.fromEntries(Object.entries(LEITOR_DA_ROTA)
  .map(([arq, leitor]) => [arq, leitor(textoDaRota[arq], 'doc', arq)]));
const pastasPorRota = Object.fromEntries(Object.entries(LEITOR_DA_ROTA)
  .map(([arq, leitor]) => [arq, leitor(textoDaRota[arq], 'd', arq)]));

/* A allowlist dos guias distribuídos é CONGELADA de propósito e é a única lista curada deste
   arquivo: a decisão do dono (15/09/2026, revista no mesmo dia) nomeou exatamente estes quatro,
   e o que não pode acontecer é um quinto entrar por descuido. Mudar esta lista é decisão, não
   ajuste. */
const GUIAS_APROVADOS = ['CONFIGURATION.md', 'REVIEW-GATES.md', 'MACOS.md', 'RELEASE.md'];

test('as seis rotas levam exatamente os quatro guias aprovados', () => {
  for (const [arq, docs] of Object.entries(docsPorRota)) {
    assert.deepEqual([...docs].sort(), [...GUIAS_APROVADOS].sort(), `${arq} diverge da allowlist de guias`);
  }
});

test('docs/ nunca viaja como pasta inteira', () => {
  for (const [arq, pastas] of Object.entries(pastasPorRota)) {
    assert.ok(!pastas.includes('docs'), `${arq} copia a pasta docs inteira, e docs/superpowers iria junto`);
  }
});

test('cada guia aprovado existe e o protocolo do workspace continua distribuido', () => {
  for (const d of GUIAS_APROVADOS) assert.ok(fs.existsSync(path.join(RAIZ, 'docs', d)), `docs/${d} nao existe`);
  assert.ok(fs.existsSync(path.join(RAIZ, 'workspace-template', 'CLAUDE.md')), 'o protocolo das sessoes sumiu');
  for (const [arq, pastas] of Object.entries(pastasPorRota)) {
    assert.ok(pastas.includes('workspace-template'), `${arq} deixou de levar workspace-template (e o CLAUDE.md das sessoes)`);
  }
});

/* A guarda de árvore suja do empacotador (incidente de 15/08/2026) tinha lista PRÓPRIA de
   caminhos e envelheceu: medido em 16/09/2026, README.md, os quatro atalhos de instalação e
   quatro arquivos de tools/ viajavam no zip sem que mudança não commitada neles recusasse o
   build. A guarda agora consulta o que os laços de cópia registraram em $doPacote, e este
   teste trava as três peças: cada laço registra o que copia, a guarda não nomeia caminho à
   mão, e ela roda depois de todas as cópias e antes do zip. */
const REGISTRO_POR_LACO = { f: '$f', d: '$d', t: '"tools/$t"', doc: '"docs/$doc"' };

function corpoDoLaco(texto, variavel) {
  const inicio = texto.search(new RegExp(RE_PS[variavel].source));
  assert.ok(inicio >= 0, `tools/make-package.ps1 sem o laco de $${variavel}`);
  const abre = texto.indexOf('{', texto.indexOf('))', inicio));
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    if (texto[i] === '}' && --nivel === 0) return { corpo: texto.slice(abre, i + 1), fim: i };
  }
  throw new Error(`laco de $${variavel} sem fechamento`);
}

const GUARDA = 'git -C $Src status --porcelain -- @doPacote';

test('cada laco de copia do pacote registra o que copia para a guarda de arvore suja', () => {
  for (const [variavel, registro] of Object.entries(REGISTRO_POR_LACO)) {
    const { corpo } = corpoDoLaco(pacote, variavel);
    assert.ok(corpo.includes(`$doPacote += ${registro}`),
      `o laco de $${variavel} copia sem registrar ${registro} em $doPacote: mudanca nao commitada ali nao recusaria o build`);
  }
});

test('a guarda de arvore suja consulta so o que foi copiado, nunca uma lista escrita a mao', () => {
  // o redirecionamento de stderr (2>$null) fica fora: o que se compara sao os caminhos
  const consultas = (pacote.match(/status --porcelain[^\r\n]*/g) || []).map((c) => c.replace(/\s+\d?>.*$/, ''));
  assert.deepEqual(consultas, [GUARDA.slice(GUARDA.indexOf('status'))],
    'a guarda deve ser uma unica consulta git sobre @doPacote');
});

test('a guarda de arvore suja roda depois de todas as copias e antes do zip', () => {
  const guarda = pacote.indexOf(GUARDA);
  const ultimaCopia = Math.max(...Object.keys(REGISTRO_POR_LACO).map((v) => corpoDoLaco(pacote, v).fim));
  const zip = pacote.indexOf('[IO.Compression.ZipFile]::Open(');
  assert.ok(guarda > ultimaCopia, 'a guarda roda antes de alguma copia e deixaria de ver o que ela registra');
  assert.ok(zip > guarda, 'a guarda roda depois do zip ser gravado');
});
