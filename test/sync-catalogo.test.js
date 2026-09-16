// Forma da linha do catálogo e o resumo do texto claro (7.C3).
//
// O resumo decide se vale escrever, e precisa de duas propriedades que não são óbvias:
// ser ESTÁVEL entre execuções (senão toda reabertura do Farol republicaria o catálogo
// inteiro) e INDEPENDENTE DA ORDEM das chaves (senão o mesmo PR montado por outro caminho
// pareceria mudado). Cada uma tem caso próprio aqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import catalogo from '../lib/sync/catalogo.js';

const PR = {
  key: 'dono/repo#12', url: 'https://github.com/dono/repo/pull/12', title: 'Corrige o gate',
  author: 'alguem', repo: 'dono/repo', number: 12, isDraft: false,
};

test('a linha leva só os sete campos, e o resto do PR é descartado', () => {
  const linha = catalogo.linhaDoCatalogo({ ...PR, headSha: 'abc', reviewers: ['x'], corpoInteiro: 'texto enorme' });
  assert.deepEqual(Object.keys(linha).sort(), catalogo.CAMPOS.slice().sort());
  assert.equal('headSha' in linha, false);
  assert.equal('corpoInteiro' in linha, false);
});

test('título gigante é truncado, e o truncamento é estável', () => {
  const longo = 'x'.repeat(500);
  const a = catalogo.linhaDoCatalogo({ ...PR, title: longo });
  const b = catalogo.linhaDoCatalogo({ ...PR, title: longo });
  assert.equal(a.title.length, catalogo.MAX_TITULO);
  assert.equal(a.title, b.title);
});

test('campo de forma errada vira o vazio do tipo, nunca lixo', () => {
  const linha = catalogo.linhaDoCatalogo({ key: 42, title: null, number: 'doze', isDraft: 'sim' });
  assert.equal(linha.key, '');
  assert.equal(linha.title, '');
  assert.equal(linha.number, 0);
  assert.equal(linha.isDraft, false, 'só true explícito é rascunho');
});

test('o resumo NÃO muda quando só a ordem das chaves muda', () => {
  const invertido = {};
  for (const k of Object.keys(PR).reverse()) invertido[k] = PR[k];
  assert.equal(catalogo.resumoDaLinha(invertido), catalogo.resumoDaLinha(PR));
});

test('o resumo muda quando o título muda', () => {
  assert.notEqual(catalogo.resumoDaLinha({ ...PR, title: 'Outro' }), catalogo.resumoDaLinha(PR));
});

// Estabilidade entre execuções: o valor é fixo, e mudá-lo sem querer reprova aqui.
test('o resumo é o mesmo em qualquer execução', () => {
  assert.equal(catalogo.resumoDaLinha(PR), catalogo.resumoDaLinha(PR));
  assert.match(catalogo.resumoDaLinha(PR), /^[0-9a-f]{32}$/);
  assert.equal(catalogo.resumoDoClaro({ a: 1, b: [2, { c: 3 }] }), catalogo.resumoDoClaro({ b: [2, { c: 3 }], a: 1 }));
});

test('ordem dentro de lista CONTA: lista é ordem, objeto não é', () => {
  assert.notEqual(catalogo.resumoDoClaro({ a: [1, 2] }), catalogo.resumoDoClaro({ a: [2, 1] }));
});
