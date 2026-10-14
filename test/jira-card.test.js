// O review consome três coisas do card: critério de aceite, escopo técnico e
// fora de escopo. O resto do payload do Jira é peso morto no contexto.
//
// O issueValida é a prova de forma: JSON válido não é card. Um 200 com
// {"errorMessages":[...]} passa por qualquer parser e viraria card de chave
// vazia com ok:true, gravado no cache e injetado no prompt como card lido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIssue, sectionsFrom, issueValida } from '../lib/jira/card.js';

const DESCRICAO = [
  'Contexto qualquer que não é lista.',
  '',
  'h2. Critérios de aceite',
  '- primeiro critério',
  '* segundo critério',
  '1. terceiro critério',
  '',
  'Escopo técnico',
  '- src/a.ts',
  '',
  'Fora de escopo',
  '- não mexer no banco',
].join('\n');

test('sectionsFrom separa as três seções e ignora texto solto', () => {
  const s = sectionsFrom(DESCRICAO);
  assert.deepEqual(s.criteria, ['primeiro critério', 'segundo critério', 'terceiro critério']);
  assert.deepEqual(s.scope, ['src/a.ts']);
  assert.deepEqual(s.outOfScope, ['não mexer no banco']);
});

test('sectionsFrom aguenta descrição vazia ou ausente', () => {
  assert.deepEqual(sectionsFrom(''), { criteria: [], scope: [], outOfScope: [] });
  assert.deepEqual(sectionsFrom(null), { criteria: [], scope: [], outOfScope: [] });
});

test('sectionsFrom reconhece critérios de conclusão em Markdown, wiki e texto sem acento', () => {
  for (const heading of ['## Critérios de conclusão', 'h2. Critérios de conclusão', 'Criterios de conclusao']) {
    assert.deepEqual(sectionsFrom(`${heading}\n- critério demonstrado`).criteria, ['critério demonstrado']);
  }
});

test('seção desconhecida encerra critérios sem absorver lista de entrega', () => {
  for (const heading of ['## Entrega integrada', 'h2. Entrega integrada']) {
    const description = `## Critérios de aceite\n- comportamento esperado\n${heading}\n- arquivo entregue\n## Escopo técnico\n- módulo da mudança`;
    assert.deepEqual(sectionsFrom(description), { criteria: ['comportamento esperado'], scope: ['módulo da mudança'], outOfScope: [] });
  }
});

test('normalizeIssue preserva sete critérios de conclusão e a descrição original', () => {
  const criteria = Array.from({ length: 7 }, (_, i) => `comportamento verificável ${i + 1}`);
  const description = `## Critérios de conclusão\n${criteria.map(item => `- ${item}`).join('\n')}\n## Entrega integrada\n- componente publicado`;
  const card = normalizeIssue({ key: 'TEST-1', fields: { summary: 'Fixture sintética', description } });
  assert.deepEqual(card.criteria, criteria);
  assert.equal(card.description, description);
});

test('prosa longa que menciona critérios de conclusão não abre seção', () => {
  const description = `Uma explicação extensa descreve como os critérios de conclusão serão avaliados durante a revisão de toda a entrega, sem representar um cabeçalho.\n- item de contexto`;
  assert.deepEqual(sectionsFrom(description), { criteria: [], scope: [], outOfScope: [] });
});

test('sectionsFrom aceita checkbox como item de lista', () => {
  const s = sectionsFrom('Critérios de aceite\n- [ ] item aberto\n- [x] item fechado');
  assert.deepEqual(s.criteria, ['item aberto', 'item fechado']);
});

test('issueValida separa card de qualquer outro JSON válido', () => {
  assert.equal(issueValida({ key: 'XX-1', fields: {} }), true);
  assert.equal(issueValida({ errorMessages: ['Issue does not exist'], errors: {} }), false);
  assert.equal(issueValida({ key: '', fields: {} }), false);
  assert.equal(issueValida({ key: 'XX-1' }), false);
  // fields como array passa no typeof e normalizaria pra card sem critério nenhum
  assert.equal(issueValida({ key: 'XX-1', fields: [] }), false);
  assert.equal(issueValida({ key: 'XX-1', fields: ['summary'] }), false);
  assert.equal(issueValida([]), false);
  assert.equal(issueValida(123), false);
  assert.equal(issueValida(null), false);
});

test('normalizeIssue devolve só os campos da whitelist', () => {
  const card = normalizeIssue({
    key: 'xx-1',
    id: '99999',
    self: 'https://a.atlassian.net/rest/api/2/issue/99999',
    fields: {
      summary: '  Título do card  ',
      status: { name: 'Em andamento', id: '3' },
      description: DESCRICAO,
      assignee: { emailAddress: 'nao.pode.vazar@exemplo.com' },
    },
  });
  assert.deepEqual(Object.keys(card).sort(), ['criteria', 'description', 'key', 'outOfScope', 'scope', 'status', 'summary']);
  assert.equal(card.key, 'XX-1');
  assert.equal(card.summary, 'Título do card');
  assert.equal(card.status, 'Em andamento');
  assert.equal(card.criteria.length, 3);
});

test('normalizeIssue aguenta resposta capenga sem lançar', () => {
  const card = normalizeIssue({});
  assert.equal(card.key, '');
  assert.equal(card.summary, '');
  assert.deepEqual(card.criteria, []);
});
