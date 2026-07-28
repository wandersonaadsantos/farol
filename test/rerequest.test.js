'use strict';
// Cobre markReRequests: re-request de review (PR pedido de novo que eu já revisei)
// volta pra fila UMA vez (des-marca visto), sem re-surgir todo ciclo e permitindo
// ignorar depois. Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-rereq-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function freshEngine() {
  const e = new Engine();
  e.seen = new Set();
  e.reviewedKeys = new Set();
  e.reReviewedKeys = new Set();
  return e;
}

test('re-request (pedido de novo + já revisado + visto) volta pra fila: des-marca visto uma vez', () => {
  const e = freshEngine();
  e.reviewedKeys.add('o/r#20');   // já revisei
  e.seen.add('o/r#20');           // e tinha marcado como visto na 1ª rodada
  const reReq = e.markReRequests(new Set(['o/r#20'])); // pedido de novo agora
  assert.ok(reReq.has('o/r#20'), 'é reconhecido como re-request');
  assert.equal(e.seen.has('o/r#20'), false, 'foi des-marcado como visto (volta pra fila)');
  assert.ok(e.reReviewedKeys.has('o/r#20'), 'marcado pra não re-surgir todo ciclo');
});

test('não re-surge no ciclo seguinte, e um "ignorar" (re-visto) fica valendo', () => {
  const e = freshEngine();
  e.reviewedKeys.add('o/r#20');
  e.seen.add('o/r#20');
  e.markReRequests(new Set(['o/r#20']));        // ciclo 1: des-marca
  // ciclo 2: continua re-request, mas não deve des-marcar de novo
  e.markReRequests(new Set(['o/r#20']));
  assert.equal(e.seen.has('o/r#20'), false, 'segue fora de visto (fila)');
  // usuário ignora (re-marca visto); próximo ciclo NÃO deve ressurgir
  e.seen.add('o/r#20');
  e.markReRequests(new Set(['o/r#20']));
  assert.equal(e.seen.has('o/r#20'), true, 'o ignorar do usuário fica valendo (não força de volta)');
});

test('quando o PR sai dos pedidos (re-revisado/fechado), limpa o marcador', () => {
  const e = freshEngine();
  e.reviewedKeys.add('o/r#20');
  e.seen.add('o/r#20');
  e.markReRequests(new Set(['o/r#20']));
  assert.ok(e.reReviewedKeys.has('o/r#20'));
  e.markReRequests(new Set()); // não está mais pedido a mim
  assert.equal(e.reReviewedKeys.has('o/r#20'), false, 'marcador limpo ao sair dos pedidos');
});

test('pedido NOVO (nunca revisei) não é re-request e não mexe no visto', () => {
  const e = freshEngine();
  e.seen.add('o/r#7'); // por algum motivo estava visto, mas eu nunca revisei
  const reReq = e.markReRequests(new Set(['o/r#7']));
  assert.equal(reReq.has('o/r#7'), false, 'sem review prévia não é re-request');
  assert.equal(e.seen.has('o/r#7'), true, 'não mexe no visto de quem não é re-request');
});
