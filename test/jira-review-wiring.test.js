// Duas invariantes que quebram em silêncio se ninguém travar:
// (1) o caminho de re-review incremental montava { ...streamOpts, extraArgs: [...] },
//     o que SUBSTITUI os argumentos do MCP e faria a sessão retomada subir sem
//     ferramenta de Jira nenhuma, sem erro em lugar nenhum;
// (2) card ilegível tem que derrubar o cardMet, senão o gate de auto-approve
//     fecha em cima de uma afirmação que ninguém conferiu.
//
// Os três últimos testes leem o FONTE de propósito. Esta classe de falha já
// aconteceu aqui: o fan-out de PR grande ficou DUAS versões sem nunca ter rodado
// porque todos os testes exercitavam funções puras e ninguém travava o caminho
// até o prompt. Mesmo idioma de test/checkpoint-review-wiring.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-jira-wiring-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const review = await import('../lib/engine/review.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('rodarSessao preserva os argumentos do mcp ao retomar a sessão', async () => {
  const vistos = [];
  const engine = {
    pushActivity: () => {},
    runClaudeStream: async (_p, opts) => { vistos.push(opts.extraArgs || []); return { sessionId: 's' }; },
  };
  const streamOpts = { id: 1, extraArgs: ['--mcp-config', 'x.json', '--strict-mcp-config'] };
  await review.rodarSessao(engine, 'prompt', streamOpts, 'sid-antigo');
  assert.deepEqual(vistos[0], ['--mcp-config', 'x.json', '--strict-mcp-config', '--resume', 'sid-antigo'],
    'o --resume SOMA, nunca substitui');
});

test('rodarSessao sem sid passa os argumentos intactos', async () => {
  const vistos = [];
  const engine = { pushActivity: () => {}, runClaudeStream: async (_p, opts) => { vistos.push(opts.extraArgs || []); return {}; } };
  await review.rodarSessao(engine, 'prompt', { id: 1, extraArgs: ['--strict-mcp-config'] }, null);
  assert.deepEqual(vistos[0], ['--strict-mcp-config']);
});

const FONTE = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');

test('o bloco do card CHEGA no promptFinal do headless', () => {
  assert.match(FONTE, /promptFinal \+= jiraMod\.cardBlock\(cardRes\)/);
});

test('os argumentos do mcp CHEGAM no streamOpts do headless', () => {
  const trecho = FONTE.slice(FONTE.indexOf('const streamOpts = {'), FONTE.indexOf('const sid ='));
  assert.match(trecho, /extraArgs: jiraMod\.mcpArgsFor\(engine, cardRes\.site\)/);
});

test('card não lido com o Jira ligado derruba o cardMet', () => {
  assert.match(FONTE, /if \(!cardRes\.ok && jiraLigado\) result\.cardMet = false/);
});

// A assimetria entre os dois códigos silenciosos é deliberada e frágil: os dois
// são rotina demais pra virar linha de log e de feed (PR sem card e org fora do
// Jira não são falha de ninguém), mas só o sem_chave sai também do motivo
// etiquetado. Org sem site DERRUBA o cardMet, então sem o motivo a revisão cairia
// na mesa do humano sem nada na tela explicando por quê.
test('sem_chave e site_nao_configurado calam log e feed, só sem_chave cala o motivo', () => {
  const silencio = FONTE.slice(FONTE.indexOf('} else if (jiraLigado'), FONTE.indexOf('if (heranca.ativa)'));
  assert.match(silencio, /JIRA_CODES\.SEM_CHAVE/, 'PR sem chave não vira WARN');
  assert.match(silencio, /JIRA_CODES\.SITE_NAO_CONFIGURADO/, 'org sem site não vira WARN');

  const i = FONTE.indexOf('if (!cardRes.ok && jiraLigado && cardRes.code !== JIRA_CODES.SEM_CHAVE)');
  assert.ok(i > 0, 'o motivo etiquetado do card continua condicionado ao sem_chave');
  const condicao = FONTE.slice(i, FONTE.indexOf('\n', i));
  assert.ok(!condicao.includes('SITE_NAO_CONFIGURADO'),
    'org sem site derruba o cardMet: tirar o motivo deixaria a decisão sem explicação na tela');
});
