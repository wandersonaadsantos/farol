// Encerramento abrupto (spec 7.A1, item 9 e critérios de aceite): o processo do Farol
// morre com a sessão aberta e o boot seguinte, no MESMO FAROL_HOME, registra a linha
// interrompida. Só processo de verdade prova isso: em memória o acumulador nunca some.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const SERVER_URL = pathToFileURL(path.join(RAIZ, 'server.js')).href;
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-interrompida-'));
const STUB = path.join(BASE, 'provedor-falso.mjs');
const MARCA = '@@RESULTADO@@';
const orfaos = [];

after(() => {
  for (const pid of orfaos) { try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ } }
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

fs.writeFileSync(STUB, [
  "import fs from 'node:fs';",
  'fs.writeFileSync(process.env.STUB_PID_FILE, String(process.pid));',
  "const linha = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
  "const sid = '11111111-2222-3333-4444-555555555555';",
  "if (process.env.STUB_EMITIR === '1') {",
  "  linha({ type: 'system', subtype: 'init', model: 'claude-opus-5', session_id: sid });",
  "  linha({ type: 'assistant', message: { id: 'msg_1', stop_reason: 'tool_use', content: [{ type: 'text', text: 'lendo' }], usage: { input_tokens: 12, output_tokens: 345 } } });",
  '}',
  "if (process.env.STUB_CONCLUIR === '1') {",
  "  linha({ type: 'result', is_error: false, result: 'ok', session_id: sid, usage: { input_tokens: 12, output_tokens: 345 }, total_cost_usd: 0.5 });",
  '  process.exit(0);',
  '}',
  "if (process.env.STUB_ERRO === '1') {",
  "  linha({ type: 'result', is_error: true, result: 'erro simulado', session_id: sid, usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.05 });",
  '  process.exit(0);',
  '}',
  'setTimeout(() => process.exit(0), 60000);',
].join('\n'));

function ambiente(home, extra = {}) {
  const casaFalsa = path.join(home, 'casa-falsa');
  fs.mkdirSync(casaFalsa, { recursive: true });
  return {
    ...process.env, FAROL_HOME: home, HOME: casaFalsa, USERPROFILE: casaFalsa,
    FAROL_HEADLESS_CMD: `"${process.execPath}" "${STUB}"`,
    STUB_PID_FILE: path.join(home, 'stub.pid'), STUB_EMITIR: '0', STUB_CONCLUIR: '0', STUB_ERRO: '0',
    ...extra,
  };
}

const SESSAO = [
  `const { Engine } = await import(${JSON.stringify(SERVER_URL)});`,
  'const e = new Engine();',
  "e.runClaudeStream('prompt', { id: 'a-filho', account: '', ref: 'o/r#1' }).then(() => process.exit(0), () => process.exit(3));",
].join('\n');

const BOOT = [
  `const { Engine } = await import(${JSON.stringify(SERVER_URL)});`,
  'const e = new Engine();',
  `process.stdout.write('\\n${MARCA}' + JSON.stringify(e.usageSessions.sessions));`,
  'process.exit(0);',
].join('\n');

function iniciarSessao(home, extra) {
  return spawn(process.execPath, ['--input-type=module', '-e', SESSAO], { env: ambiente(home, extra), stdio: 'ignore' });
}

function boot(home) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', BOOT], { env: ambiente(home), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.slice(r.stdout.lastIndexOf(MARCA) + MARCA.length)).filter((s) => s.id === 'a-filho');
}

function tentativas(home) {
  const arquivo = path.join(home, 'workspace', 'state', 'usage-tentativas.json');
  if (!fs.existsSync(arquivo)) return [];
  try { return Object.values(JSON.parse(fs.readFileSync(arquivo, 'utf8')).tentativas); } catch { return []; }
}

function esperar(cond, ms = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 50);
  });
}

function guardarOrfao(home) {
  const arquivo = path.join(home, 'stub.pid');
  if (fs.existsSync(arquivo)) orfaos.push(Number(fs.readFileSync(arquivo, 'utf8')));
}

function saida(filho) {
  return new Promise((resolve) => {
    if (filho.exitCode !== null || filho.signalCode !== null) return resolve(filho.exitCode);
    filho.once('exit', (code) => resolve(code));
  });
}

async function matar(filho) {
  const fim = saida(filho);
  process.kill(filho.pid, 'SIGKILL');
  await fim;
}

test('morto à força depois de consumo parcial: o boot seguinte registra interrompida com os tokens', async () => {
  const home = path.join(BASE, 'parcial');
  const filho = iniciarSessao(home, { STUB_EMITIR: '1' });
  await esperar(() => tentativas(home).some((t) => t.parcial.output_tokens === 345));
  guardarOrfao(home);
  await matar(filho);
  const linhas = boot(home);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].status, 'interrompida');
  assert.equal(linhas[0].outputTokens, 345);
  assert.equal(linhas[0].inputTokens, 12);
  assert.ok(linhas[0].attemptId);
  assert.deepEqual(tentativas(home), []);
});

test('morto à força antes de qualquer consumo: linha interrompida com custo desconhecido, não zero e não ausência', async () => {
  const home = path.join(BASE, 'sem-consumo');
  const filho = iniciarSessao(home);
  await esperar(() => tentativas(home).length === 1 && fs.existsSync(path.join(home, 'stub.pid')));
  guardarOrfao(home);
  await matar(filho);
  const linhas = boot(home);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].status, 'interrompida');
  assert.equal(linhas[0].costSource, 'desconhecido');
  assert.equal(linhas[0].outputTokens, 0);
});

test('fechamento normal seguido de boot não duplica a linha', async () => {
  const home = path.join(BASE, 'normal');
  const filho = iniciarSessao(home, { STUB_EMITIR: '1', STUB_CONCLUIR: '1' });
  assert.equal(await saida(filho), 0);
  assert.deepEqual(tentativas(home), []);
  assert.equal(boot(home).length, 1);
  const depois = boot(home);
  assert.equal(depois.length, 1);
  assert.equal(depois[0].status, 'ok');
});

test('erro devolvido normalmente pelo CLI continua registrado como hoje', async () => {
  const home = path.join(BASE, 'erro-cli');
  const filho = iniciarSessao(home, { STUB_ERRO: '1' });
  assert.equal(await saida(filho), 3);
  const linhas = boot(home);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].status, 'erro');
  assert.equal(linhas[0].costSource, 'medido');
  assert.equal(linhas[0].costUsd, 0.05);
  assert.deepEqual(tentativas(home), []);
});
