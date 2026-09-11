// lib/sync/sse.js: o parser de Server-Sent Events do stream do RTDB. Puro. A rede
// entrega o corpo em pedaços arbitrários, então nenhum teste aqui pode supor que um
// pedaço termina numa linha inteira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sse, { createSseParser } from '../lib/sync/sse.js';

function coletar() {
  const eventos = [];
  const p = createSseParser((e) => eventos.push(e));
  return { p, eventos };
}

test('evento simples com nome e dado', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: {"path":"/","data":1}\n\n');
  assert.deepEqual(eventos, [{ event: 'put', data: '{"path":"/","data":1}' }]);
});

test('pedaços cortados no meio da linha e no meio do nome do campo', () => {
  const { p, eventos } = coletar();
  const texto = 'event: patch\ndata: {"path":"/a","data":{"x":2}}\n\nevent: put\ndata: null\n\n';
  for (const pedaco of texto.match(/.{1,3}/gs)) p.feed(pedaco);
  assert.deepEqual(eventos, [
    { event: 'patch', data: '{"path":"/a","data":{"x":2}}' },
    { event: 'put', data: 'null' },
  ]);
});

test('aceita \r\n, inclusive com o \r e o \n em pedaços diferentes', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\r');
  p.feed('\ndata: 1\r\n\r');
  p.feed('\n');
  assert.deepEqual(eventos, [{ event: 'put', data: '1' }]);
});

test('várias linhas data: viram um texto só, separado por \n', () => {
  const { p, eventos } = coletar();
  p.feed('data: linha1\ndata: linha2\ndata:linha3\n\n');
  assert.deepEqual(eventos, [{ event: 'message', data: 'linha1\nlinha2\nlinha3' }]);
});

test('linha que começa com ":" é comentário e não despacha nada', () => {
  const { p, eventos } = coletar();
  p.feed(': ping\n\n:outro\nevent: put\n: no meio\ndata: x\n\n');
  assert.deepEqual(eventos, [{ event: 'put', data: 'x' }]);
});

test('linha vazia sem nada pendente não inventa evento', () => {
  const { p, eventos } = coletar();
  p.feed('\n\n\n');
  assert.deepEqual(eventos, []);
});

test('dois-pontos dentro do valor fazem parte do dado', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: {"a":"b: c"}\n\n');
  assert.equal(eventos[0].data, '{"a":"b: c"}');
});

test('campos desconhecidos (id, retry) são ignorados', () => {
  const { p, eventos } = coletar();
  p.feed('id: 7\nretry: 1000\nevent: put\ndata: 1\n\n');
  assert.deepEqual(eventos, [{ event: 'put', data: '1' }]);
});

test('o nome do evento zera depois de despachar', () => {
  const { p, eventos } = coletar();
  p.feed('event: keep-alive\ndata: null\n\ndata: 2\n\n');
  assert.deepEqual(eventos, [{ event: 'keep-alive', data: 'null' }, { event: 'message', data: '2' }]);
});

test('end() despacha o pendente, inclusive a última linha sem \n', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: {"x":');
  assert.deepEqual(eventos, []);
  p.feed('1}');
  p.end();
  assert.deepEqual(eventos, [{ event: 'put', data: '{"x":1}' }]);
  p.end();
  assert.equal(eventos.length, 1, 'end() repetido não duplica');
});

test('end() sem pendência não despacha', () => {
  const { p, eventos } = coletar();
  p.feed('event: put\ndata: 1\n\n');
  p.end();
  assert.equal(eventos.length, 1);
});

test('export default carrega o mesmo contrato do nomeado', () => {
  assert.equal(sse.createSseParser, createSseParser);
});
