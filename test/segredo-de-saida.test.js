// O segredo por sessão de terminal que autentica o aviso de saída (trap EXIT ->
// /api/session-exit) quando a A4 é exigida (lib/engine/segredo-de-saida.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novoSegredoDeSaida, confereSegredoDeSaida, linhasDeAvisoDeSaida } from '../lib/engine/segredo-de-saida.js';

test('novoSegredoDeSaida: 43 caracteres base64url, diferente a cada chamada', () => {
  const a = novoSegredoDeSaida();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, novoSegredoDeSaida());
});

test('confereSegredoDeSaida: só o segredo da própria sessão confere', () => {
  const s = novoSegredoDeSaida();
  const engine = { activeReviews: new Map([['t1', { id: 't1', segredoDeSaida: s }], ['t2', { id: 't2' }]]) };
  assert.equal(confereSegredoDeSaida(engine, 't1', s), true);
  assert.equal(confereSegredoDeSaida(engine, 't1', s.slice(1)), false, 'tamanho diferente não lança');
  assert.equal(confereSegredoDeSaida(engine, 't1', ''), false);
  assert.equal(confereSegredoDeSaida(engine, 't2', ''), false, 'sessão sem segredo nunca confere');
  assert.equal(confereSegredoDeSaida(engine, 't9', s), false, 'sessão inexistente');
  assert.equal(confereSegredoDeSaida({}, 't1', s), false);
});

test('linhasDeAvisoDeSaida: o trap manda o segredo por cabeçalho, nunca por argumento', () => {
  const linhas = linhasDeAvisoDeSaida('t7', 47170, 'abc').join('\n');
  assert.match(linhas, /^FAROL_SESSION_SECRET='abc'$/m);
  assert.equal(linhas.includes('export FAROL_SESSION_SECRET'), false, 'variável de shell: o claude não herda o segredo');
  assert.match(linhas, /-H "x-farol-session: \$FAROL_SESSION_SECRET"/);
  assert.match(linhas, /\{"id":"t7"\}/);
  assert.match(linhas, /http:\/\/127\.0\.0\.1:47170\/api\/session-exit/);
  assert.match(linhas, /trap notify EXIT/);
  assert.ok(linhas.indexOf('FAROL_SESSION_SECRET=') < linhas.indexOf('trap notify EXIT'), 'o segredo existe antes de o trap poder disparar');
});
