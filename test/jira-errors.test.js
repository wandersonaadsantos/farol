// O erro do Jira viaja até a `reason` da revisão e até a tela. Se o código não
// for estável, quem chama volta a decidir por regex em cima da mensagem, que foi
// exatamente o problema que a taxonomia de log já resolveu no resto do app.
//
// Três donos de falha, não um: o Jira (indisponivel, sem_permissao), o Farol
// (falha_interna) e o recurso desligado. Chamar falha do Farol de "o Jira está
// indisponível" é mentira com outro endereço.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JiraError, JIRA_CODES, codeFromStatus, motivoDe } from '../lib/jira/errors.js';

test('JiraError carrega o código e continua sendo Error', () => {
  const err = new JiraError(JIRA_CODES.TIMEOUT, 'estourou');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'JiraError');
  assert.equal(err.code, 'timeout');
  assert.equal(err.message, 'estourou');
});

test('codeFromStatus separa ausência de permissão de indisponibilidade', () => {
  assert.equal(codeFromStatus(404), JIRA_CODES.NAO_ENCONTRADO);
  assert.equal(codeFromStatus(401), JIRA_CODES.SEM_PERMISSAO);
  assert.equal(codeFromStatus(403), JIRA_CODES.SEM_PERMISSAO);
  assert.equal(codeFromStatus(500), JIRA_CODES.INDISPONIVEL);
  assert.equal(codeFromStatus(502), JIRA_CODES.INDISPONIVEL);
});

test('a taxonomia distingue os três donos de falha', () => {
  assert.equal(JIRA_CODES.DESLIGADO, 'desligado');
  assert.equal(JIRA_CODES.FALHA_INTERNA, 'falha_interna');
  assert.ok(!/jira/i.test(motivoDe(JIRA_CODES.FALHA_INTERNA)) || /não foi o Jira/i.test(motivoDe(JIRA_CODES.FALHA_INTERNA)),
    'falha do Farol não pode ser apresentada como falha do Jira');
});

test('motivoDe devolve frase para todo código conhecido e nunca vazio', () => {
  for (const code of Object.values(JIRA_CODES)) {
    assert.ok(motivoDe(code).length > 0, `código sem frase: ${code}`);
  }
  assert.ok(motivoDe('inventado').length > 0, 'código desconhecido precisa de frase genérica');
});
