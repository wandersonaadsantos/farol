// As duas peças de infra que o resto do Jira consome: os literais com endereço
// único (core.duplication.business-rule) e o serializador que não derruba o
// processo em referência circular, já que o servidor MCP escreve resposta a
// cada chamada e um throw ali mataria a sessão de revisão inteira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JIRA } from '../lib/constants.js';
import io from '../lib/io.js';

test('JIRA expõe os literais de infra com nome', () => {
  assert.ok(JIRA.CACHE_TTL_MS > 0, 'TTL do cache precisa ser positivo');
  assert.ok(JIRA.REQUEST_TIMEOUT_MS > 0, 'timeout da chamada precisa ser positivo');
  assert.equal(JIRA.API_PATH, '/rest/api/2/issue/');
  assert.equal(JIRA.SEARCH_PATH, '/rest/api/2/search');
  assert.equal(JIRA.FIELDS, 'summary,status,description');
  assert.equal(JIRA.CACHE_DIR, 'cards');
  assert.equal(JIRA.MCP_DIR, 'mcp');
  assert.equal(JIRA.MCP_SERVER_NAME, 'farol-jira');
});

test('safeStringify serializa o normal e degrada no circular', () => {
  assert.equal(io.safeStringify({ a: 1 }), '{"a":1}');
  const circular = { nome: 'x' };
  circular.eu = circular;
  assert.equal(io.safeStringify(circular), 'null');
  assert.equal(io.safeStringify(circular, '{}'), '{}');
});
