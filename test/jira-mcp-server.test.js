// O servidor MCP é o contrato com o CLI do Claude. Erra o handshake e a sessão
// sobe sem ferramenta nenhuma, em silêncio. Por isso o teste exercita as quatro
// mensagens do protocolo em vez de subir o processo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-jira-mcp-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { handle } = await import('../tools/jira-mcp.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const deps = {
  cliente: {
    getIssue: async (key) => ({ key, fields: { summary: 't', status: { name: 'Em andamento' }, description: 'Critérios de aceite\n- um' } }),
    searchJql: async () => ({ issues: [] }),
  },
};

test('initialize devolve protocolo, capacidade de ferramenta e nome', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, deps);
  assert.equal(r.id, 1);
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.ok(r.result.capabilities.tools);
  assert.equal(r.result.serverInfo.name, 'farol-jira');
});

test('notificação não gera resposta', async () => {
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null);
});

test('tools/list anuncia as duas ferramentas com o nome que o protocolo já usa', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps);
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['getJiraIssue', 'searchJiraIssuesUsingJql']);
  assert.equal(r.result.tools.find((t) => t.name === 'getJiraIssue').inputSchema.required[0], 'issueIdOrKey');
});

test('tools/call devolve o card normalizado como texto', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'getJiraIssue', arguments: { issueIdOrKey: 'XX-1' } } }, deps);
  assert.equal(r.result.content[0].type, 'text');
  assert.ok(r.result.content[0].text.includes('XX-1'));
  assert.ok(r.result.content[0].text.includes('Em andamento'));
  assert.ok(!r.result.isError);
});

test('200 fora de forma não vira card também no MCP', async () => {
  const ruim = { cliente: { getIssue: async () => ({ errorMessages: ['Issue does not exist'] }) } };
  const r = await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'getJiraIssue', arguments: { issueIdOrKey: 'XX-1' } } }, ruim);
  assert.equal(r.result.isError, true);
  assert.ok(r.result.content[0].text.includes('resposta_invalida'));
});

test('ferramenta desconhecida vira erro de conteúdo, não crash', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'inventada', arguments: {} } }, deps);
  assert.equal(r.result.isError, true);
});

test('falha do Jira vira isError e nunca vaza credencial', async () => {
  const ruim = { cliente: { getIssue: async () => { const e = new Error('o Jira respondeu 403'); e.code = 'sem_permissao'; throw e; } } };
  const r = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'getJiaIssue'.replace('Jia', 'Jira'), arguments: { issueIdOrKey: 'XX-1' } } }, ruim);
  assert.equal(r.result.isError, true);
  assert.ok(r.result.content[0].text.includes('sem_permissao'));
});

test('método desconhecido devolve erro JSON-RPC', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 6, method: 'nao/existe' }, deps);
  assert.equal(r.error.code, -32601);
});
