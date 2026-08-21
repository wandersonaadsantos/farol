// O protocolo do workspace é produto, não código: ele é re-sincronizado da fonte
// a cada boot. Se continuar mandando o modelo buscar o card num site fixo, a
// revisão de uma org de outra empresa vai atrás do Jira errado.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const PROTOCOLO = fs.readFileSync(path.join(RAIZ, 'workspace-template', 'CLAUDE.md'), 'utf8');
const SELF = fs.readFileSync(path.join(RAIZ, 'workspace-template', 'prompts', 'self-review.md'), 'utf8');

test('nenhum dos dois fixa mais um site do Jira', () => {
  for (const [nome, texto] of [['CLAUDE.md', PROTOCOLO], ['self-review.md', SELF]]) {
    assert.ok(!/[a-z0-9-]+\.atlassian\.net/i.test(texto), `${nome} ainda cita um site fixo do Jira`);
  }
});

test('a revisão sabe que o card já vem lido pelo Farol', () => {
  assert.ok(/lido pelo Farol/i.test(PROTOCOLO));
});

test('a autoanálise NÃO afirma que o card vem lido, porque ela não recebe o bloco', () => {
  assert.ok(!/lido pelo Farol/i.test(SELF), 'a autoanálise recebe só a ferramenta escopada, não o card pré-lido');
  assert.ok(/getJiraIssue/.test(SELF));
});

test('a regra de card não verificável continua nos dois', () => {
  assert.ok(/n[ãa]o[- ]verific[áa]vel/i.test(PROTOCOLO));
  assert.ok(/n[ãa]o[- ]verific[áa]vel/i.test(SELF));
});

test('o protocolo da revisão instrui o caso da seção de card ausente', () => {
  assert.match(PROTOCOLO, /n[ãa]o\s+aparecer/i);
  assert.ok(/getJiraIssue/.test(PROTOCOLO), 'sem a seção, o modelo precisa saber que lê o card ele mesmo');
});
