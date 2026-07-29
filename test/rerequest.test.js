'use strict';
// Cobre markReRequests: re-request de review (PR pedido de novo que eu já revisei)
// volta pra fila UMA vez (des-marca visto), sem re-surgir todo ciclo e permitindo
// ignorar depois. O sinal de "já revisei" vem do HISTÓRICO LOCAL (decisions),
// não de uma busca no gh: essa era a causa raiz do bug relatado (re-request às
// vezes não era identificado por lag de indexação do GitHub). Runner nativo, ZERO deps.
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
  e.reReviewedKeys = new Set();
  e.decisions = { pending: [], resolved: [] };
  return e;
}

// simula uma decisão já resolvida (aprovado/reprovado/comentado, ou pulada)
function resolve(e, key, status, action) {
  e.decisions.resolved.unshift({ key, status, action, resolvedAt: Date.now() });
}

test('re-request (pedido de novo + já revisado + visto) volta pra fila: des-marca visto uma vez', () => {
  const e = freshEngine();
  resolve(e, 'o/r#20', 'auto_approved', 'approve');   // já revisei (postei de verdade)
  e.seen.add('o/r#20');                                // e tinha marcado como visto na 1ª rodada
  const reReq = e.markReRequests(new Set(['o/r#20'])); // pedido de novo agora
  assert.ok(reReq.has('o/r#20'), 'é reconhecido como re-request');
  assert.equal(e.seen.has('o/r#20'), false, 'foi des-marcado como visto (volta pra fila)');
  assert.ok(e.reReviewedKeys.has('o/r#20'), 'marcado pra não re-surgir todo ciclo');
});

test('não re-surge no ciclo seguinte, e um "ignorar" (re-visto) fica valendo', () => {
  const e = freshEngine();
  resolve(e, 'o/r#20', 'posted', 'request_changes');
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
  resolve(e, 'o/r#20', 'already_reviewed', 'approve');
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

test('"pulado" (Pular) não conta como revisado: nada foi postado, não é re-request', () => {
  const e = freshEngine();
  resolve(e, 'o/r#33', 'skipped', 'skip');
  e.seen.add('o/r#33');
  const reReq = e.markReRequests(new Set(['o/r#33']));
  assert.equal(reReq.has('o/r#33'), false, 'pular não posta nada no GitHub, não gera re-request');
  assert.equal(e.seen.has('o/r#33'), true, 'não mexe no visto');
});

test('decisão ainda PENDING (na sua mesa) não conta como re-request', () => {
  const e = freshEngine();
  e.decisions.pending.push({ key: 'o/r#41', status: 'pending', createdAt: Date.now() });
  e.seen.add('o/r#41');
  const reReq = e.markReRequests(new Set(['o/r#41']));
  assert.equal(reReq.has('o/r#41'), false, 'ainda não decidi nada, não é re-request');
});
