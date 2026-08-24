// "Testar leitura" (v2.53.0). Antes disso, o único jeito de descobrir que a
// credencial de um site estava errada era esperar o próximo PR daquela org chegar,
// abrir a revisão e ler o motivo no card da decisão: tarde demais e no lugar errado.
//
// O que estes testes travam: o teste usa /myself de propósito (qualquer credencial
// válida responde, então falha aqui é sempre credencial ou URL, nunca permissão em
// projeto), a recusa carrega a FRASE junto do código (a tabela de motivos vive em
// lib/ e o navegador não a alcança), e nada do segredo volta na resposta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-jira-teste-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const jira = await import('../lib/engine/jira.js');
const { JIRA_CODES } = await import('../lib/jira/errors.js');
const cred = await import('../lib/jira/credentials.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const SITE = { id: 's1', label: 'A', baseUrl: 'https://a.atlassian.net', owners: ['orga'], projectKeys: ['XX'] };
const engine = { config: { jiraSites: [SITE] }, log: () => {} };

test('site que não existe na config recusa com código e frase', async () => {
  const r = await jira.testarSite({ config: { jiraSites: [] } }, 's1');
  assert.equal(r.ok, false);
  assert.equal(r.code, JIRA_CODES.SITE_NAO_CONFIGURADO);
  assert.ok(r.motivo && r.motivo.length > 10, 'a tela precisa da frase, não só do código');
});

test('site sem credencial nem chega a tocar a rede', async () => {
  let bateu = false;
  const r = await jira.testarSite(engine, 's1', async () => { bateu = true; });
  assert.equal(r.ok, false);
  assert.equal(r.code, JIRA_CODES.SEM_CREDENCIAL);
  assert.match(r.motivo, /credencial/i);
  assert.equal(bateu, false, 'sem credencial não há o que testar');
});

test('credencial válida devolve quem ela representa, e nada do segredo', async () => {
  cred.setCredential('s1', { email: 'eu@empresa.com', token: 'segredo-que-nao-pode-vazar' });
  let urlPedida = '';
  const fetchFalso = async (url) => {
    urlPedida = url;
    return { ok: true, status: 200, text: async () => '{"displayName":"Wanderson","emailAddress":"eu@empresa.com"}' };
  };
  const r = await jira.testarSite(engine, 's1', fetchFalso);
  assert.equal(r.ok, true);
  assert.equal(r.quem, 'Wanderson');
  assert.match(urlPedida, /\/rest\/api\/2\/myself$/, 'myself não depende de existir card nem de permissão em projeto');
  assert.equal(JSON.stringify(r).includes('segredo-que-nao-pode-vazar'), false, 'a resposta nunca leva o token');
});

test('sem displayName cai no e-mail, e sem os dois ainda é sucesso', async () => {
  const soEmail = await jira.testarSite(engine, 's1',
    async () => ({ ok: true, status: 200, text: async () => '{"emailAddress":"eu@empresa.com"}' }));
  assert.equal(soEmail.quem, 'eu@empresa.com');

  const anonimo = await jira.testarSite(engine, 's1',
    async () => ({ ok: true, status: 200, text: async () => '{"accountId":"abc"}' }));
  assert.equal(anonimo.ok, true, 'o Jira respondeu: a credencial vale, mesmo sem nome pra mostrar');
  assert.equal(anonimo.quem, '');
});

test('401 vira falta de permissão, com a frase da taxonomia', async () => {
  const r = await jira.testarSite(engine, 's1', async () => ({ ok: false, status: 401, text: async () => '{}' }));
  assert.equal(r.ok, false);
  assert.equal(r.code, JIRA_CODES.SEM_PERMISSAO);
  assert.ok(r.motivo);
});

test('erro cru do fetch chega como indisponibilidade, que é o que ele é', async () => {
  // o cliente normaliza tudo que não é JiraError em INDISPONIVEL (ver comoJiraError):
  // fetch estourando é falha de rede, e é assim que o usuário precisa ler.
  const r = await jira.testarSite(engine, 's1', () => { throw new TypeError('conexão morreu'); });
  assert.equal(r.ok, false);
  assert.equal(r.code, JIRA_CODES.INDISPONIVEL);
  assert.match(r.motivo, /indispon/i);
});

test('resposta que não é objeto não passa por credencial válida', async () => {
  const r = await jira.testarSite(engine, 's1',
    async () => ({ ok: true, status: 200, text: async () => '"sou uma string"' }));
  assert.equal(r.ok, false);
  assert.equal(r.code, JIRA_CODES.RESPOSTA_INVALIDA, 'portal de login e proxy respondem 200 com corpo que não é da API');
});
