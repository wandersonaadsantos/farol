// fetch é injetado pra este teste não tocar a rede. O que importa aqui é o
// contrato de erro: todo caminho de falha sai como JiraError com código, nunca
// como TypeError de rede vazando pra quem chamou.
//
// O teste do timeout usa relógio falso e exercita o AbortController de verdade.
// A versão que só injetava um fetchImpl lançando AbortError continuaria verde se
// alguém apagasse o signal e o setTimeout da implementação, ou seja, a feature
// que justifica esta tarefa ficaria sem cobertura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiraClient } from '../lib/jira/client.js';
import { JIRA_CODES } from '../lib/jira/errors.js';
import { JIRA } from '../lib/constants.js';

function clienteCom(resposta) {
  const chamadas = [];
  const fetchImpl = async (url, opts) => { chamadas.push({ url, opts }); return resposta; };
  return { cliente: createJiraClient({ baseUrl: 'https://a.atlassian.net', email: 'a@b.com', token: 'tok', fetchImpl }), chamadas };
}

const OK = { ok: true, status: 200, text: async () => '{"key":"XX-1"}' };

test('getIssue monta a URL da v2 com os campos da whitelist', async () => {
  const { cliente, chamadas } = clienteCom(OK);
  assert.deepEqual(await cliente.getIssue('XX-1'), { key: 'XX-1' });
  assert.equal(chamadas[0].url, 'https://a.atlassian.net/rest/api/2/issue/XX-1?fields=summary,status,description');
});

test('manda Basic com e-mail e token e pede JSON', async () => {
  const { cliente, chamadas } = clienteCom(OK);
  await cliente.getIssue('XX-1');
  assert.equal(chamadas[0].opts.headers.Authorization, `Basic ${Buffer.from('a@b.com:tok').toString('base64')}`);
  assert.equal(chamadas[0].opts.headers.Accept, 'application/json');
});

test('searchJql escapa o jql e respeita maxResults', async () => {
  const { cliente, chamadas } = clienteCom(OK);
  await cliente.searchJql('project = XX', 3);
  assert.ok(chamadas[0].url.startsWith('https://a.atlassian.net/rest/api/2/search?jql=project%20%3D%20XX'));
  assert.ok(chamadas[0].url.includes('maxResults=3'));
});

test('status de erro vira JiraError com o código certo', async () => {
  for (const [status, code] of [[404, JIRA_CODES.NAO_ENCONTRADO], [403, JIRA_CODES.SEM_PERMISSAO], [500, JIRA_CODES.INDISPONIVEL]]) {
    const { cliente } = clienteCom({ ok: false, status, text: async () => '' });
    await assert.rejects(() => cliente.getIssue('XX-1'), (err) => err.name === 'JiraError' && err.code === code);
  }
});

test('corpo que não é JSON vira resposta_invalida', async () => {
  const { cliente } = clienteCom({ ok: true, status: 200, text: async () => '<html>login</html>' });
  await assert.rejects(() => cliente.getIssue('XX-1'), (err) => err.code === JIRA_CODES.RESPOSTA_INVALIDA);
});

test('JSON válido que não é objeto vira resposta_invalida', async () => {
  for (const corpo of ['[]', '123', '"texto"']) {
    const { cliente } = clienteCom({ ok: true, status: 200, text: async () => corpo });
    await assert.rejects(() => cliente.getIssue('XX-1'), (err) => err.code === JIRA_CODES.RESPOSTA_INVALIDA, corpo);
  }
});

test('falha de rede vira indisponivel', async () => {
  const semRede = createJiraClient({
    baseUrl: 'https://a.atlassian.net', email: 'a@b.com', token: 'tok',
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  await assert.rejects(() => semRede.getIssue('XX-1'), (err) => err.code === JIRA_CODES.INDISPONIVEL);
});

test('o timeout do cliente aborta a chamada de verdade', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cliente = createJiraClient({
    baseUrl: 'https://a.atlassian.net', email: 'a@b.com', token: 'tok',
    fetchImpl: (_url, opts) => new Promise((_, rej) => {
      opts.signal.addEventListener('abort', () => { const e = new Error('abortado'); e.name = 'AbortError'; rej(e); });
    }),
  });
  const promessa = assert.rejects(() => cliente.getIssue('XX-1'), (err) => err.code === JIRA_CODES.TIMEOUT);
  t.mock.timers.tick(JIRA.REQUEST_TIMEOUT_MS);
  await promessa;
});
