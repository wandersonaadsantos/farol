// Trava estatica: quem dispara `git` neste repositorio nao herda o ambiente cru.
//
// POR QUE ELA EXISTE, e por que ela e ESTATICA como a do test-isolation.test.js:
// o conserto de 30/08/2026 (ver test/helpers/git-limpo.js) some sozinho na
// primeira chamada nova que alguem escrever sem lembrar dele, e some EM SILENCIO.
// Foi assim que o defeito nasceu: a montagem de repositorio de prova rodava
// `git init` herdando GIT_DIR do hook de pre-push, reinicializava o repositorio do
// Farol como BARE e gravava a identidade do teste no config compartilhado, com a
// suite inteira verde. Nada falha quando o isolamento falta; o estrago aparece
// noutro lugar, depois, com cara de outro problema.
//
// A doutrina do repositorio e "travas automaticas, nao confiar em disciplina"
// (CLAUDE.md, "Versionamento"), e o proprio CLAUDE.md ja registrou que aviso em
// prosa nao substitui invariante no codigo (secao "A garantia mora no
// estrangulamento"). Aqui nao ha estrangulamento possivel, porque cada chamada
// monta as opcoes dela, entao a garantia e conferida no fonte.
//
// COMO ELA LE: as chamadas sao localizadas no fonte CRU, porque o nome do
// programa mora dentro de uma string, e sao conferidas no fonte PASSADO PELO
// `strip`, que apaga conteudo de string e de comentario preservando a estrutura e
// o COMPRIMENTO (medido), entao os indices dos dois coincidem. E o que faz um
// `env` citado num comentario dentro da chamada nao valer como isolamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { strip } from '../tools/quality/strip.js';

const RAIZ = path.join(import.meta.dirname, '..');
const VARRIDOS = ['lib', 'test', 'tools'];
const SOLTOS = ['server.js', 'main.js'];

/**
 * Chamadas que podem disparar o programa git.
 *
 * As quatro do child_process que aceitam o programa como primeiro argumento. A
 * forma de shell (exec, runShell) fica de fora: nela o comando e uma linha inteira
 * e nao um argumento, e o repositorio nao dispara git assim em lugar nenhum
 * (conferido). Se passar a disparar, esta trava nao veria, e vale dizer isso aqui
 * em vez de fingir cobertura.
 */
const CHAMADA = /\b(?:execFileSync|spawnSync|execFile|spawn)\s*\(\s*['"]git['"]/g;

/**
 * Chamada que NAO precisa de ambiente limpo, com o motivo junto.
 *
 * A ficha e obrigatoria e o teste confere que ela continua valendo: excecao que
 * deixou de se aplicar reprova, para a lista nao virar deposito de dispensa velha.
 */
const EXCECOES = new Map([
  ['tools/git-env.js', 'e ele que DESCOBRE a lista de variaveis a remover, entao limpar antes seria circular; e a pergunta que ele faz (rev-parse --local-env-vars) devolve os nomes que o binario conhece, que nao dependem de para qual repositorio o ambiente aponta'],
]);

// Este arquivo cita o padrao para procura-lo, e nao dispara git nenhum. A dispensa
// nao fica no boca a boca: o ultimo caso prova que ele nao alcanca child_process.
const ESTE = 'test/git-isolado.test.js';

function arquivosJs(dir, achados = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const alvo = path.join(dir, e.name);
    if (e.isDirectory()) arquivosJs(alvo, achados);
    else if (e.name.endsWith('.js')) achados.push(alvo);
  }
  return achados;
}

function relativo(abs) {
  return path.relative(RAIZ, abs).split(path.sep).join('/');
}

/** Fim da chamada que abre em `abre`, balanceando parenteses no fonte sem strings. */
function fimDaChamada(limpo, abre) {
  let nivel = 0;
  for (let i = abre; i < limpo.length; i++) {
    if (limpo[i] === '(') nivel++;
    else if (limpo[i] === ')' && --nivel === 0) return i + 1;
  }
  return limpo.length;
}

/**
 * O trecho isola o ambiente, direta ou indiretamente.
 *
 * Direta e `env` escrito na propria chamada. Indireta e a chamada receber as
 * opcoes de um construtor do mesmo arquivo, que e a forma que o
 * protocolo-versionado usa: ali o `env` existe, so nao esta a vista. Resolver UM
 * nivel cobre o que o repositorio faz hoje e mantem a trava capaz de acusar a
 * chamada ingenua, que e o alvo. Construtor a mais de um nivel, ou importado de
 * outro arquivo, passaria sem ser visto: e limitacao conhecida, e e o preco de nao
 * transformar a trava num interpretador de JavaScript.
 */
function isola(trecho, limpo) {
  if (/\benv\b/.test(trecho)) return true;
  for (const m of trecho.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const def = new RegExp('\\b(?:const|let|var|function)\\s+' + m[1] + '\\b');
    const achou = limpo.search(def);
    if (achou >= 0 && /\benv\b/.test(limpo.slice(achou, achou + 400))) return true;
  }
  return false;
}

function chamadasDeGit(rel, cru) {
  const limpo = strip(cru);
  const achados = [];
  for (const m of cru.matchAll(CHAMADA)) {
    const abre = cru.indexOf('(', m.index);
    const trecho = limpo.slice(abre, fimDaChamada(limpo, abre));
    const linha = cru.slice(0, m.index).split('\n').length;
    achados.push({ rel, linha, trecho, isolada: isola(trecho, limpo) });
  }
  return achados;
}

let varredura;
/**
 * As chamadas de git do repositorio, varridas uma vez por processo.
 *
 * Duas economias, e as duas importam porque isto roda em toda suite: a memoria,
 * porque os quatro casos abaixo fazem a mesma pergunta, e o pre-filtro por regex
 * antes do `strip`, que e caractere a caractere. Sem o pre-filtro a varredura
 * passava por uma centena de arquivos para achar chamada em quatro, e sozinha
 * custava mais que a suite inteira.
 */
function todasAsChamadas() {
  if (varredura) return varredura;
  const arquivos = [
    ...VARRIDOS.flatMap(d => arquivosJs(path.join(RAIZ, d))),
    ...SOLTOS.map(f => path.join(RAIZ, f)),
  ];
  varredura = arquivos
    .map(abs => ({ rel: relativo(abs), cru: fs.readFileSync(abs, 'utf8') }))
    .filter(a => a.rel !== ESTE)
    // `match` e nao `test`: CHAMADA e global, e `test` guarda lastIndex entre
    // chamadas, entao ela responderia diferente para o mesmo arquivo.
    .filter(a => a.cru.match(CHAMADA))
    .flatMap(a => chamadasDeGit(a.rel, a.cru));
  return varredura;
}

test('a varredura enxerga as chamadas que existem hoje', () => {
  // Sem esta ancora os outros casos passariam por vacuidade: regex que deixa de
  // casar, ou pasta que deixa de ser varrida, devolveria lista vazia e verde.
  const todas = todasAsChamadas();
  assert.ok(todas.length >= 5, 'esperava achar as chamadas de git do repo, achei ' + todas.length);
  const arquivos = new Set(todas.map(c => c.rel));
  for (const esperado of ['tools/eng-behaviour/gate.js', 'test/eng-behaviour-gate.test.js', 'test/protocolo-versionado.test.js']) {
    assert.ok(arquivos.has(esperado), esperado + ' dispara git e a varredura nao viu');
  }
});

test('toda chamada a git passa um ambiente proprio, em vez de herdar o do processo', () => {
  const sem = todasAsChamadas()
    .filter(c => !EXCECOES.has(c.rel))
    .filter(c => !c.isolada)
    .map(c => c.rel + ':' + c.linha);
  assert.deepEqual(sem, [], 'git disparado com o ambiente herdado; use envGitLimpo (teste) ou envSemRepositorioHerdado (producao)');
});

test('o ambiente passado nao e o process.env cru, que nao isola nada', () => {
  // Passar o process.env inteiro satisfaz a letra do caso acima e nao muda nada:
  // o filho continua recebendo o GIT_DIR de quem chamou.
  const cruas = todasAsChamadas()
    .filter(c => /\benv\s*:\s*process\s*\.\s*env\b/.test(c.trecho))
    .map(c => c.rel + ':' + c.linha);
  assert.deepEqual(cruas, [], 'passar o ambiente do processo inteiro e o mesmo que herdar');
});

test('a lista de dispensa nao envelhece: excecao registrada ainda e uma chamada sem ambiente', () => {
  const porArquivo = new Map();
  for (const c of todasAsChamadas()) {
    if (!porArquivo.has(c.rel)) porArquivo.set(c.rel, []);
    porArquivo.get(c.rel).push(c);
  }
  for (const [rel, motivo] of EXCECOES) {
    const chamadas = porArquivo.get(rel) || [];
    assert.ok(chamadas.length > 0, rel + ' nao dispara mais git: tire a dispensa');
    assert.ok(chamadas.some(c => !c.isolada), rel + ' ja passa ambiente proprio: tire a dispensa');
    assert.ok(motivo.trim().length > 0, rel + ' precisa de motivo escrito');
  }
});

test('este arquivo nao dispara git, que e o que sustenta a autodispensa dele', () => {
  const cru = fs.readFileSync(path.join(RAIZ, ESTE), 'utf8');
  assert.doesNotMatch(strip(cru), /child_process/, 'a trava nao pode virar consumidora do que ela vigia');
});
