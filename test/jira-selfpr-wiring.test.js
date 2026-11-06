// A autoanálise usa as MESMAS ferramentas de Jira da revisão, então ela precisa
// do mesmo escopo. Sem isto, ela segue no conector do claude.ai (um tenant só)
// enquanto o protocolo do self-review.md afirma que a ferramenta já está apontada
// para a org do PR.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FONTE = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'selfpr.js'), 'utf8');

// O que o lançador RECEBE (MCP escopado e guardas; nada na execução isolada) é observado na
// autoanálise de verdade em test/caminho-protegido-fiacao.test.js, não pela grafia do fonte.

test('a autoanálise importa o compositor do Jira', () => {
  assert.match(FONTE, /import \* as jiraMod from '\.\/jira\.js'/);
});
