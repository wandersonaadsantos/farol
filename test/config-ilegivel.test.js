// config.json presente e ilegível impede o boot em vez de virar os padrões; o BOM é aceito (porte
// do fork, 24/11/2026). Antes, o arquivo quebrado virava os padrões com uma cópia .bad ao lado, e a
// primeira gravação da config regravava o arquivo: contas, políticas, perfis e a autenticação
// exigida sumiam sem ninguém perceber.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-config-ilegivel-'));
process.env.FAROL_HOME = HOME;
after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const { lerConfigOuRecusar, subirOuRecusar, CODIGO_CONFIG_ILEGIVEL } = await import('../lib/config-ilegivel.js');
const { lerJsonTeimoso } = await import('../lib/io.js');

let n = 0;
function arquivo(conteudo) {
  const f = path.join(HOME, `config-${++n}.json`);
  if (conteudo !== undefined) fs.writeFileSync(f, conteudo);
  return f;
}
function recusa(f) {
  const linhas = [];
  let erro = null;
  try { lerConfigOuRecusar((m) => linhas.push(m), f); } catch (e) { erro = e; }
  return { erro, linhas };
}

test('arquivo ausente é instalação nova: devolve {} e não lança', () => {
  assert.deepEqual(lerConfigOuRecusar(null, arquivo()), {});
});

test('objeto válido volta como está, e o BOM do editor do Windows é aceito', () => {
  assert.deepEqual(lerConfigOuRecusar(null, arquivo('{"port": 47180}')), { port: 47180 });
  assert.deepEqual(lerConfigOuRecusar(null, arquivo('﻿{"port": 47181}')), { port: 47181 });
  assert.deepEqual(lerJsonTeimoso(arquivo('﻿[1]')).data, [1], 'o BOM sai na leitura comum também');
});

test('JSON quebrado, vazio e JSON que não é objeto recusam com o motivo, sem tocar o arquivo', () => {
  const casos = [
    ['{"port": 47180,,}', /não é JSON válido/],
    ['', /o arquivo está vazio/],
    ['   \n', /o arquivo está vazio/],
    ['[1, 2]', /não é um objeto \(é uma lista\)/],
    ['"texto"', /não é um objeto \(é um texto\)/],
    ['null', /não é um objeto \(é null\)/],
  ];
  for (const [conteudo, motivo] of casos) {
    const f = arquivo(conteudo);
    const { erro, linhas } = recusa(f);
    assert.equal(erro?.code, CODIGO_CONFIG_ILEGIVEL, JSON.stringify(conteudo));
    assert.match(erro.message, motivo);
    assert.match(erro.message, /não foi alterado nem renomeado/);
    assert.deepEqual(linhas, [erro.message], 'a mesma linha vai ao log');
    assert.equal(fs.readFileSync(f, 'utf8'), conteudo, 'o arquivo não é regravado');
    assert.equal(fs.existsSync(`${f}.bad`), false, 'sem cópia .bad');
  }
});

test('a mensagem não cita o trecho do arquivo, onde moram segredos', () => {
  const segredo = 'sk-ant-api03-SEGREDO-QUE-NAO-PODE-VAZAR';
  const { erro } = recusa(arquivo(`{"apiKey": "${segredo}" "x": 1}`));
  assert.ok(!erro.message.includes(segredo));
  assert.ok(!erro.message.includes('SEGREDO'));
});

test('subirOuRecusar: a recusa sai limpa com código 1, outro erro segue lançando', () => {
  const escrito = [];
  let codigo = null;
  subirOuRecusar(() => { throw Object.assign(new Error('config.json ilegível, o Farol não sobe'), { code: CODIGO_CONFIG_ILEGIVEL }); },
    { erro: (m) => escrito.push(m), sair: (c) => { codigo = c; } });
  assert.deepEqual(escrito, ['[farol] config.json ilegível, o Farol não sobe']);
  assert.equal(codigo, 1);
  assert.throws(() => subirOuRecusar(() => { throw new Error('outro'); }, { erro: () => { }, sair: () => { } }), /outro/);
  assert.equal(subirOuRecusar(() => 'subiu'), 'subiu');
});

test('a Engine não sobe com o config.json ilegível', async () => {
  const { CONFIG_FILE } = await import('../lib/paths.js');
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, '{"accounts": [');
  const { Engine } = await import('../server.js');
  assert.throws(() => new Engine(), (e) => e.code === CODIGO_CONFIG_ILEGIVEL);
  assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8'), '{"accounts": [', 'o arquivo ficou como estava');
  fs.rmSync(CONFIG_FILE);
});
