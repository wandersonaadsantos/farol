// Inventário das rotas /api (A4, spec 7.A4): toda rota que o servidor roteia tem classe.
// Rota nova sem classe reprova aqui. A lista do servidor é DERIVADA do fonte, com o mesmo
// extrator do test/ui-contract.test.js, para não virar tabela curada que envelhece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas } from '../lib/local-auth/inventario.js';

const SERVERJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
function rotasServidas() {
  return new Set([...SERVERJS.matchAll(/p === '(\/api\/[^']+)'/g)].map(m => m[1]));
}

test('o extrator de rotas não está cego', () => {
  const servidas = rotasServidas();
  assert.ok(servidas.has('/api/decide'));
  assert.ok(servidas.size >= 46, `esperava pelo menos 46 rotas, achei ${servidas.size}`);
});

test('toda rota servida tem classe no inventário', () => {
  const semClasse = [...rotasServidas()].filter(r => !classeDaRota(r));
  assert.deepEqual(semClasse, [], `rota sem classe (classifique em lib/local-auth/inventario.js conforme a spec 7.A4): ${semClasse.join(', ')}`);
});

test('nenhuma rota aparece em duas classes', () => {
  const todas = todasAsRotas();
  assert.equal(new Set(todas).size, todas.length);
});

test('as classes da spec cobrem os 46 caminhos, e as públicas são só as duas de autenticação', () => {
  const naoPublicas = Object.entries(CLASSES).filter(([c]) => c !== 'autenticacao-publica').flatMap(([, rotas]) => rotas);
  assert.equal(naoPublicas.length, 46);
  assert.deepEqual(CLASSES['autenticacao-publica'].slice().sort(), ['/api/auth/pair', '/api/auth/status']);
  assert.deepEqual(Object.keys(CLASSES).sort(), ['autenticacao-publica', 'demais', 'destrutiva', 'escreve-github', 'evento', 'leitura-baixo-risco', 'leitura-sensivel', 'recebe-segredo', 'sessao-paga']);
});

test('a exceção pública depende do método', () => {
  assert.deepEqual({ ...PUBLICAS }, { '/api/auth/pair': 'POST', '/api/auth/status': 'GET' });
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/pair'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/status'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/pair'), false);
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/status'), false);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/state'), false);
});
