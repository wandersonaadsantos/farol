// A sessão headless não pode mandar trabalho para o segundo plano (30/09/2026).
//
// Caso medido: biud-frontend#1239, #1249 e #1267 morreram com "a sessão não devolveu JSON".
// Nas três transcrições o modelo rodou um laço `until ... gh pr checks ... pending` com
// `run_in_background`, encerrou o turno com "aguardo o resultado" e o `claude -p` acabou ali,
// sem envelope. A trava é a variável do Claude Code que tira o segundo plano de todas as
// ferramentas; o prompt também pede, mas pedido ao modelo não é trava.
//
// Como no diagnostico-ia-execucao: o spawn é o real e quem responde é um `claude` falso no
// PATH, que grava o ambiente que recebeu.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sem-bg-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');
delete process.env.FAROL_HEADLESS_CMD;
delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS;

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { runProvedor, parseEnvelope } = await import('../lib/engine/session.js');
const { ENV_HEADLESS } = await import('../lib/constants.js');
const { IS_WIN, WORKSPACE } = await import('../lib/paths.js');

const BIN = path.join(BASE, 'bin');
const REGISTRO = path.join(BASE, 'registro.jsonl');

const FALSO = `
const fs = require('node:fs');
process.stdin.on('data', () => { });
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FAROL_TESTE_REGISTRO, JSON.stringify({ bg: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS ?? null }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', is_error: false, session_id: 'falso' }) + '\\n');
});
`;

before(() => {
  fs.mkdirSync(BIN, { recursive: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(BIN, 'claude-falso.cjs'), FALSO);
  if (IS_WIN) {
    fs.writeFileSync(path.join(BIN, 'claude.cmd'), `@"${process.execPath}" "%~dp0claude-falso.cjs" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(BIN, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/claude-falso.cjs" "$@"\n`, { mode: 0o755 });
  }
  process.env.PATH = BIN + path.delimiter + process.env.PATH;
  process.env.FAROL_TESTE_REGISTRO = REGISTRO;
});

after(() => {
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function engineFalso() {
  return {
    config: {},
    // ambiente da conta SEM a variável: quem tem que pôr é o runProvedor
    ghEnv: () => ({ ...process.env }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

// mesmo motivo do diagnostico-ia-execucao: no macOS o shell de login reordena o PATH
async function falsoResolve(t) {
  if (IS_WIN) return true;
  const r = await io.runShell('command -v claude', { env: { ...process.env } });
  if (r.stdout.trim() === path.join(BIN, 'claude')) return true;
  t.skip(`o shell de login resolve outro claude (${r.stdout.trim()}), o falso não seria o executado`);
  return false;
}

test('o processo do claude headless recebe o segundo plano desligado', async (t) => {
  if (!await falsoResolve(t)) return;
  fs.rmSync(REGISTRO, { force: true });
  const res = await runProvedor(engineFalso(), 'prompt de teste', { id: 'f-sem-bg' });
  assert.equal(res.text, 'ok');
  const linhas = fs.readFileSync(REGISTRO, 'utf8').trim().split('\n');
  assert.equal(linhas.length, 1, 'um processo do claude');
  assert.equal(JSON.parse(linhas[0]).bg, '1');
});

test('o ambiente fixo do headless é só a trava, e congelado', () => {
  assert.deepEqual({ ...ENV_HEADLESS }, { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });
  assert.ok(Object.isFrozen(ENV_HEADLESS));
});

for (const prompt of ['pr-review-auto.md', 'self-review.md']) {
  test(`o prompt ${prompt} proíbe esperar o CI em segundo plano`, () => {
    const texto = fs.readFileSync(path.join('workspace-template', 'prompts', prompt), 'utf8');
    assert.match(texto, /O CI do PR você não\s+espera/);
    assert.match(texto, /run_in_background/);
    assert.match(texto, /não existe "depois"/);
  });
}
