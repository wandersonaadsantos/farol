// Web hospedada, Task 1: a alocação de porta do provisionamento por pessoa
// (tools/web/portas.js). O arquivo /etc/farol/portas é texto simples, uma linha
// `<login> <porta>` por pessoa, na ordem de inserção, sem comentário. As funções são
// PURAS; a CLI fina que o provisionar-pessoa.sh chama é coberta com um diretório
// temporário. O script de shell em si (useradd, systemd) só roda numa VM Linux.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// portas.js importa lib/paths.js (executadoDireto); com FAROL_HOME definido antes da
// carga, nada cai no diretório provisório de teste nem emite o aviso dele
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-web-provisionar-'));

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { DEFAULT_PORT } = await import('../lib/constants.js');
const { lerPortas, serializarPortas, proximaPortaLivre, alocarPorta, executar } = await import('../tools/web/portas.js');

function coletor() {
  let texto = '';
  return { write: (s) => { texto += s; }, get texto() { return texto; } };
}

test('lerPortas lê uma linha por pessoa, na ordem do arquivo', () => {
  const texto = `ana ${DEFAULT_PORT}\nbeto ${DEFAULT_PORT + 1}\n`;
  assert.deepEqual(lerPortas(texto), [
    { login: 'ana', porta: DEFAULT_PORT },
    { login: 'beto', porta: DEFAULT_PORT + 1 },
  ]);
});

test('lerPortas aceita arquivo vazio, ausente e sem quebra no fim', () => {
  assert.deepEqual(lerPortas(''), []);
  assert.deepEqual(lerPortas(undefined), []);
  assert.deepEqual(lerPortas(`ana ${DEFAULT_PORT}`), [{ login: 'ana', porta: DEFAULT_PORT }]);
});

test('lerPortas recusa linha malformada citando o número da linha', () => {
  const casos = [
    `ana`,
    `ana ${DEFAULT_PORT} extra`,
    `ana porta`,
    `ana 80`,
    `ana 70000`,
    `Ana ${DEFAULT_PORT}`,
    `-ana ${DEFAULT_PORT}`,
    `# comentario ${DEFAULT_PORT}`,
    ` ana ${DEFAULT_PORT}`,
    `ana  ${DEFAULT_PORT}`,
    `ana ${DEFAULT_PORT}.5`,
  ];
  for (const linha of casos) {
    assert.throws(() => lerPortas(`beto ${DEFAULT_PORT + 5}\n${linha}\n`), /linha 2/, linha);
  }
});

test('lerPortas recusa linha vazia no meio (só a quebra final é tolerada)', () => {
  assert.throws(() => lerPortas(`ana ${DEFAULT_PORT}\n\nbeto ${DEFAULT_PORT + 1}\n`), /linha 2/);
});

test('lerPortas recusa arquivo que já repete login ou porta', () => {
  assert.throws(() => lerPortas(`ana ${DEFAULT_PORT}\nana ${DEFAULT_PORT + 1}\n`), /login repetido.*ana/);
  assert.throws(() => lerPortas(`ana ${DEFAULT_PORT}\nbeto ${DEFAULT_PORT}\n`), new RegExp(`porta repetida.*${DEFAULT_PORT}`));
});

test('serializarPortas é o inverso de lerPortas e termina em quebra de linha', () => {
  const texto = `ana ${DEFAULT_PORT}\nbeto ${DEFAULT_PORT + 3}\n`;
  assert.equal(serializarPortas(lerPortas(texto)), texto);
  assert.equal(serializarPortas([]), '');
});

test('proximaPortaLivre começa na porta padrão e pula as ocupadas', () => {
  assert.equal(proximaPortaLivre([]), DEFAULT_PORT);
  const registros = [
    { login: 'ana', porta: DEFAULT_PORT },
    { login: 'beto', porta: DEFAULT_PORT + 1 },
    { login: 'caio', porta: DEFAULT_PORT + 3 },
  ];
  assert.equal(proximaPortaLivre(registros), DEFAULT_PORT + 2);
  assert.equal(proximaPortaLivre(registros, DEFAULT_PORT + 3), DEFAULT_PORT + 4);
});

test('alocarPorta acrescenta no fim com a próxima livre', () => {
  const r = alocarPorta(`ana ${DEFAULT_PORT}\n`, 'beto');
  assert.equal(r.porta, DEFAULT_PORT + 1);
  assert.equal(r.texto, `ana ${DEFAULT_PORT}\nbeto ${DEFAULT_PORT + 1}\n`);
  assert.deepEqual(alocarPorta('', 'ana'), { porta: DEFAULT_PORT, texto: `ana ${DEFAULT_PORT}\n` });
});

test('alocarPorta aceita a porta pedida quando está livre', () => {
  const r = alocarPorta(`ana ${DEFAULT_PORT}\n`, 'beto', DEFAULT_PORT + 10);
  assert.equal(r.porta, DEFAULT_PORT + 10);
  assert.equal(r.texto, `ana ${DEFAULT_PORT}\nbeto ${DEFAULT_PORT + 10}\n`);
  assert.equal(alocarPorta('', 'ana', String(DEFAULT_PORT + 2)).porta, DEFAULT_PORT + 2);
});

test('alocarPorta recusa login repetido e porta repetida', () => {
  const texto = `ana ${DEFAULT_PORT}\n`;
  assert.throws(() => alocarPorta(texto, 'ana'), /login repetido.*ana/);
  assert.throws(() => alocarPorta(texto, 'beto', DEFAULT_PORT), new RegExp(`porta repetida.*${DEFAULT_PORT}`));
});

test('alocarPorta recusa login e porta fora do formato', () => {
  assert.throws(() => alocarPorta('', 'Ana'), /login inválido/);
  assert.throws(() => alocarPorta('', 'ana beto'), /login inválido/);
  assert.throws(() => alocarPorta('', ''), /login inválido/);
  for (const porta of ['80', '70000', 'abc', `${DEFAULT_PORT}x`, 1.5]) {
    assert.throws(() => alocarPorta('', 'ana', porta), /porta inválida/, String(porta));
  }
});

test('CLI alocar reescreve o arquivo e imprime só a porta; listar imprime as linhas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-portas-'));
  try {
    const arquivo = path.join(dir, 'portas');
    let saida = coletor();
    assert.equal(executar(['alocar', arquivo, 'ana'], saida, coletor()), 0);
    assert.equal(saida.texto, `${DEFAULT_PORT}\n`);
    saida = coletor();
    assert.equal(executar(['alocar', arquivo, 'beto', String(DEFAULT_PORT + 7)], saida, coletor()), 0);
    assert.equal(saida.texto, `${DEFAULT_PORT + 7}\n`);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), `ana ${DEFAULT_PORT}\nbeto ${DEFAULT_PORT + 7}\n`);
    saida = coletor();
    assert.equal(executar(['listar', arquivo], saida, coletor()), 0);
    assert.equal(saida.texto, `ana ${DEFAULT_PORT}\nbeto ${DEFAULT_PORT + 7}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI recusa repetição sem tocar o arquivo e devolve código de erro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-portas-'));
  try {
    const arquivo = path.join(dir, 'portas');
    fs.writeFileSync(arquivo, `ana ${DEFAULT_PORT}\n`);
    const erro = coletor();
    assert.equal(executar(['alocar', arquivo, 'ana'], coletor(), erro), 1);
    assert.match(erro.texto, /login repetido/);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), `ana ${DEFAULT_PORT}\n`);
    const uso = coletor();
    assert.equal(executar(['outra-coisa'], coletor(), uso), 2);
    assert.match(uso.texto, /Uso:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
