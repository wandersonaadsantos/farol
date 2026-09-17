// A sessão de diagnóstico (A3) vista pelo PROCESSO que ela abre de verdade (verificação B,
// 16/09/2026). O cmdline.test troca o spawn; aqui o spawn é o real, o FAROL_HEADLESS_CMD está
// ausente e quem responde é um `claude` falso no PATH, que grava o argv e o cwd que recebeu.
//
// Por que as flags além de `--tools`: pelo `claude --help` da 2.1.268 e pela documentação de
// hooks, `--tools` tira ferramenta do contexto do modelo, mas hooks de settings (usuário,
// projeto do workspace, plugins) rodam mesmo assim, e nem `--dangerously-skip-permissions`
// nem `--tools` os afetam. `--safe-mode` desliga hooks, plugins, skills, MCP, agentes
// customizados, CLAUDE.md e memória, mantendo autenticação e ferramentas embutidas;
// `--disable-slash-commands` desliga skills e comandos.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-diag-exec-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');
delete process.env.FAROL_HEADLESS_CMD;

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { runProvedor, parseEnvelope } = await import('../lib/engine/session.js');
const { IS_WIN, WORKSPACE } = await import('../lib/paths.js');

const BIN = path.join(BASE, 'bin');
const REGISTRO = path.join(BASE, 'registro.jsonl');

const FALSO = `
const fs = require('node:fs');
let entrada = '';
process.stdin.on('data', (d) => { entrada += d; });
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FAROL_TESTE_REGISTRO, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), prompt: entrada.length }) + '\\n');
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
    ghEnv: () => ({ ...process.env }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

// mesmo motivo do perfil-claude-sem-escrita: no macOS o shell de login reordena o PATH
async function falsoResolve(t) {
  if (IS_WIN) return true;
  const r = await io.runShell('command -v claude', { env: { ...process.env } });
  if (r.stdout.trim() === path.join(BIN, 'claude')) return true;
  t.skip(`o shell de login resolve outro claude (${r.stdout.trim()}), o falso não seria o executado`);
  return false;
}

async function execucao(opts) {
  fs.rmSync(REGISTRO, { force: true });
  const res = await runProvedor(engineFalso(), 'prompt de teste', { id: 'f-exec', ...opts });
  const linhas = fs.readFileSync(REGISTRO, 'utf8').trim().split('\n');
  assert.equal(linhas.length, 1, 'um processo do claude');
  return { res, reg: JSON.parse(linhas[0]) };
}

const RESTRICAO = ['--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands'];

test('a sessão de leitura executa o claude com a linha exata, no workspace, sem MCP nem customização', async (t) => {
  if (!await falsoResolve(t)) return;
  const { res, reg } = await execucao({ somenteLeitura: true });
  assert.equal(res.text, 'ok', 'o resultado do processo real voltou');
  assert.deepEqual(reg.argv, ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', ...RESTRICAO]);
  // o cwd que o processo enxerga vem canônico: no macOS a pasta temporária mora em
  // /var, que é link para /private/var (medido no CI em 17/09/2026)
  assert.equal(fs.realpathSync(reg.cwd), fs.realpathSync(WORKSPACE));
  assert.ok(reg.prompt > 0, 'o prompt chegou pelo stdin, não pela linha');
  assert.equal(reg.argv.includes('--mcp-config'), false);
});

test('a sessão comum executa sem nenhuma das restrições', async (t) => {
  if (!await falsoResolve(t)) return;
  const { reg } = await execucao({});
  assert.deepEqual(reg.argv, ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']);
});

test('argumento extra de quem chama não substitui a restrição, vem depois dela', async (t) => {
  if (!await falsoResolve(t)) return;
  const { reg } = await execucao({ somenteLeitura: true, extraArgs: ['--resume', '00000000-0000-4000-8000-000000000000'] });
  assert.deepEqual(reg.argv.slice(5, 5 + RESTRICAO.length), RESTRICAO);
  assert.deepEqual(reg.argv.slice(-2), ['--resume', '00000000-0000-4000-8000-000000000000']);
});
