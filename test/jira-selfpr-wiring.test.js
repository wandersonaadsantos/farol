// A autoanálise usa as MESMAS ferramentas de Jira da revisão, então ela precisa
// do mesmo escopo. Sem isto, ela segue no conector do claude.ai (um tenant só)
// enquanto o protocolo do self-review.md afirma que a ferramenta já está apontada
// para a org do PR. Teste de fonte, mesmo motivo do wiring da revisão.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FONTE = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'selfpr.js'), 'utf8');

test('a autoanálise sobe com os argumentos do mcp escopado', () => {
  assert.match(FONTE, /extraArgs: isolated \? \[\] : \[\.\.\.jiraMod\.mcpArgsFor\(engine, jiraMod\.siteForPr\(engine, pr\)\), \.\.\.guardasDaSessao\(\)\]/,
    'o mcp do Jira e as guardas de permissão (06/11/2026) viajam juntos; a execução isolada não leva nenhum');
});

test('a autoanálise importa o compositor do Jira', () => {
  assert.match(FONTE, /import \* as jiraMod from '\.\/jira\.js'/);
});
