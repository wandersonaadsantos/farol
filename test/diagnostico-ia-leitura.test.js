// Diagnóstico com IA SOMENTE LEITURA (spec 7.A3): a sessão é alimentada pelo mesmo Markdown
// do diagnóstico e não tem ferramenta de escrita. Critério de aceite da spec: "sessão de
// diagnóstico sem ferramentas de escrita". Aqui a prova é pela linha de comando de cada
// provedor, pelo prompt e pelo prompt do workspace ressincronizado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-diag-ia-'));
process.env.FAROL_HOME = BASE;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { argsDeSomenteLeitura } = await import('../lib/engine/session.js');
const { codexArgs } = await import('../lib/codex/stream.js');

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('somente leitura restringe as ferramentas do Claude e não carrega MCP nenhum', () => {
  // --safe-mode e --disable-slash-commands: hooks, plugins e skills não obedecem ao --tools
  assert.deepEqual(argsDeSomenteLeitura({ somenteLeitura: true }), ['--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands']);
  assert.deepEqual(argsDeSomenteLeitura({}), [], 'sessão normal não muda');
});

test('somente leitura põe o Codex em sandbox de leitura', () => {
  assert.equal(codexArgs({}, { somenteLeitura: true }).join(' ').includes('--sandbox read-only'), true);
  assert.equal(codexArgs({}, {}).join(' ').includes('--sandbox'), false);
});

test('a ferramenta de diagnóstico abre a sessão como somente leitura; kudos não muda', async () => {
  const e = new Engine();
  e.token = 'tok';
  e.pushState = () => { };
  e.log = () => { };
  const vistos = [];
  e.runClaudeStream = async (prompt, opts) => { vistos.push({ prompt, opts }); return { text: 'relatório' }; };
  await e.launchTool('health');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].opts.somenteLeitura, true);
  assert.equal(vistos[0].opts.operationKind, 'tool');
  // o outro lado do título: kudos segue como estava, sem a restrição
  const { STATE_DIR } = await import('../lib/paths.js');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'highlights.md'), '- 2026-09-16 · @pessoa · destaque sintético\n');
  e.config.teamHighlights = true;
  await e.launchTool('kudos');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(vistos.length, 2, 'o kudos também abriu a sessão');
  assert.equal(vistos[1].opts.somenteLeitura, false);
});

test('o prompt do diagnóstico carrega o Markdown do diagnóstico, delimitado', () => {
  const e = new Engine();
  e.log = () => { };
  e.doctorInfo = { node: 'v24.0.0' };
  e.registrarFalha({ sessionId: 's-prompt', kind: 'tool', motivo: 'quebrou de um jeito reconhecível' });
  const prompt = e.toolPrompt('health');
  assert.match(prompt, /### Diagnóstico do Farol \(dados desta máquina\)/);
  assert.match(prompt, /quebrou de um jeito reconhecível/);
  assert.match(prompt, /somente leitura/i);
  assert.doesNotMatch(prompt, /aplique só as correções de baixo risco/i);
});

test('o prompt do workspace não manda mais editar o app, e viaja na lista ressincronizada', () => {
  const p = ler('workspace-template/.claude/commands/pr-health.md');
  assert.doesNotMatch(p, /Aplique as correções|corrige o próprio app|peça confirmação antes/i);
  assert.match(p, /somente leitura/i);
  // prompt novo tem que chegar nas cópias já semeadas: a lista do prepareHome é quem faz isso
  assert.match(ler('server.js'), /path\.join\('\.claude', 'commands', 'pr-health\.md'\)/);
});

test('os dois botões Limpar dizem o efeito, e cada um diz um efeito diferente', () => {
  const html = ler('ui/index.html');
  const rotulo = (id) => (html.match(new RegExp(`id="${id}"[^>]*>([^<]+)<`)) || [])[1] || '';
  const relatorio = rotulo('btnHealthClear');
  const log = rotulo('btnLogClear');
  assert.notEqual(relatorio, log);
  assert.doesNotMatch(relatorio, /^Limpar$/);
  assert.match(relatorio, /relatório/i);
  assert.match(log, /log/i);
  assert.match(log, /apagar/i);
});
