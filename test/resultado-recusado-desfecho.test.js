// Resultado recusado ficava "ok" no Consumo: envelope fora do contrato, prosa sem JSON,
// pushback ilegível e ferramenta sem texto (spec 4.1, buraco 2). Só a autoanálise
// descartada por commit novo carimbava o desfecho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-recusado-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { lerResultadoDaRevisao } = await import('../lib/engine/review.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');
const USO = { usage: { output_tokens: 10 }, total_cost_usd: 0.1 };

function esperar(cond, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

test('revisão: envelope ausente ou fora do contrato marca erro na sessão', () => {
  for (const erro of [Object.assign(new Error('sem JSON'), { code: 'FAROL_RESULT_MISSING' }), new Error('JSON fora do contrato')]) {
    const chamadas = [];
    const engine = { parseHeadlessResult() { throw erro; }, marcarDesfecho: (id, st) => { chamadas.push([id, st]); return true; } };
    assert.throws(() => lerResultadoDaRevisao(engine, { text: 'prosa', sessionId: null }, 'a-rev'));
    assert.deepEqual(chamadas, [['a-rev', 'erro']]);
  }
});

test('revisão: resultado válido não mexe no desfecho', () => {
  const chamadas = [];
  const engine = { parseHeadlessResult: () => ({ verdict: 'approve' }), marcarDesfecho: (...a) => chamadas.push(a) };
  assert.deepEqual(lerResultadoDaRevisao(engine, { text: '{}' }, 'a-ok'), { verdict: 'approve' });
  assert.equal(chamadas.length, 0);
});

test('pushback ilegível marca erro na linha da sessão', async () => {
  const e = new Engine();
  e.pushState = () => { };
  e.accountForPr = () => 'eu';
  e.runClaudeStream = async (prompt, opts) => {
    e.recordUsage(opts.id, 'eu', USO, 'claude-opus-5', '', opts.ref);
    return { text: 'sem json nenhum', sessionId: null };
  };
  assert.equal(await e.classifyPushback({ key: 'o/r#5', url: 'u', author: 'a' }, 'm'), null);
  const s = e.usageSessions.sessions.at(-1);
  assert.match(s.id, /^pb-/);
  assert.equal(s.status, 'erro');
});

test('ferramenta sem texto marca erro na linha da sessão', async () => {
  const e = new Engine();
  e.token = 'tok';
  e.pushState = () => { };
  e.toolPrompt = () => 'prompt';
  e.runClaudeStream = async (prompt, opts) => {
    e.recordUsage(opts.id, 'eu', USO, 'claude-opus-5', '', opts.ref);
    return { text: '   ', sessionId: null };
  };
  assert.equal((await e.launchTool('health')).ok, true);
  await esperar(() => (e.toolRunGet('health') || {}).status === 'error');
  const s = e.usageSessions.sessions.at(-1);
  assert.match(s.id, /^f-/);
  assert.equal(s.status, 'erro');
});

test('autoanálise: a leitura do resultado recusado marca erro antes de propagar', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'selfpr.js'), 'utf8');
  assert.match(fonte, /try \{ result = engine\.parseSelfResult\(res\.text\); \}\s*catch \(err\) \{ marcarErroNoConsumo\(engine, id\); throw err; \}/);
});
