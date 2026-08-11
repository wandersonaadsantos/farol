'use strict';
// Histórico de decisões: quanto o Farol guarda e como uma revisão antiga é
// alcançada. Motivo (pedido do Wanderson, 11/08/2026): a tabela de Consumo
// passou a oferecer a caixa de revisão por clique, e o clique não podia esbarrar
// num teto. O teto era 200 em disco e 30 no payload; o payload continua enxuto
// (medido: 5,2 KB por decisão COM relatório, ou seja 3000 seriam 15 MB por push
// de SSE, a cada ciclo de polling), então o alcance vem de uma busca por chave
// no histórico completo, não de inflar o que trafega a cada ciclo.
const path = require('node:path');
const os = require('node:os');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-dechist-' + process.pid);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const dec = require('../lib/engine/decision');

function engineFake() {
  return { decisions: { pending: [], resolved: [] }, saveDecisions() { } };
}

test('o histórico guarda 3000 decisões (o teto de 200 perdia revisão que ainda interessa)', () => {
  const e = engineFake();
  for (let i = 0; i < 3200; i++) dec.resolveIntoHistory(e, { id: 'd' + i, key: `acme/app#${i}` });
  assert.equal(e.decisions.resolved.length, 3000);
  // unshift: a mais nova entra na frente, e quem cai é a mais VELHA
  assert.equal(e.decisions.resolved[0].key, 'acme/app#3199');
  assert.equal(e.decisions.resolved[2999].key, 'acme/app#200');
});

test('decisionByKey acha a revisão pela chave do PR, mesmo fora do recorte da tela', () => {
  const e = engineFake();
  for (let i = 0; i < 500; i++) {
    dec.resolveIntoHistory(e, { id: 'd' + i, key: `acme/app#${i}`, verdict: 'approve', reportMarkdown: 'relatório ' + i });
  }
  // #10 está na posição 489: muito além das 30 que o snapshot manda pra UI
  const achada = dec.decisionByKey(e, 'acme/app#10');
  assert.ok(achada, 'a revisão antiga precisa ser alcançável');
  assert.equal(achada.reportMarkdown, 'relatório 10', 'vem com o relatório, que é o conteúdo da caixa');
  assert.equal(dec.decisionByKey(e, 'acme/app#99999'), null, 'chave que não existe devolve null, não undefined solto');
  assert.equal(dec.decisionByKey(e, ''), null);
  assert.equal(dec.decisionByKey(e, null), null);
});

test('decisionByKey prefere a PENDENTE quando o mesmo PR foi revisado de novo', () => {
  // o mesmo PR pode ter uma decisão antiga resolvida e uma nova esperando você;
  // a caixa tem que mostrar a que está valendo agora
  const e = engineFake();
  dec.resolveIntoHistory(e, { id: 'velha', key: 'acme/app#7', reportMarkdown: 'antiga' });
  e.decisions.pending.push({ id: 'nova', key: 'acme/app#7', reportMarkdown: 'atual' });
  assert.equal(dec.decisionByKey(e, 'acme/app#7').reportMarkdown, 'atual');
});
