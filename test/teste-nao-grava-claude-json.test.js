// Teste nenhum grava no ~/.claude.json da máquina (06/10/2026).
//
// O boot da Engine pré-confia o workspace gravando no ~/.claude.json, e cada arquivo de
// teste que sobe a Engine fazia isso no arquivo REAL, o mesmo que o Claude Code das sessões
// abertas grava. Medido no aparelho do dono: 980 dos 1146 projetos do arquivo eram
// workspaces temporários de teste, e uma dessas gravações coincidiu com o arquivo ficando
// inválido (um "}" sobrando no fim). Sob o executor de testes o arquivo fica no HOME isolado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-claude-json-'));
process.env.FAROL_HOME = DIR;
const { Engine } = await import('../server.js');
const { CLAUDE_JSON_DA_CONFIANCA, WORKSPACE } = await import('../lib/paths.js');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const REAL = path.join(os.homedir(), '.claude.json');
const projetosDoReal = () => {
  try { return Object.keys(JSON.parse(fs.readFileSync(REAL, 'utf8')).projects || {}); } catch { return null; }
};

test('sob teste, o arquivo da confiança mora no HOME isolado, não no da máquina', () => {
  assert.equal(CLAUDE_JSON_DA_CONFIANCA, path.join(DIR, '.claude.json'));
  assert.notEqual(path.resolve(CLAUDE_JSON_DA_CONFIANCA), path.resolve(REAL));
});

test('o boot grava a confiança no arquivo isolado e não toca o ~/.claude.json real', () => {
  new Engine();
  const isolado = JSON.parse(fs.readFileSync(path.join(DIR, '.claude.json'), 'utf8'));
  assert.equal(isolado.projects[WORKSPACE].hasTrustDialogAccepted, true, 'a confiança continua sendo semeada');
  const doReal = projetosDoReal();
  if (doReal) assert.equal(doReal.includes(WORKSPACE), false, 'o workspace do teste não entrou no arquivo real');
});
