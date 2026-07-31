'use strict';
// Fechar uma sessão de terminal (Windows/mac) desfaz o "visto" dos PRs dela, mesmo sem
// saber se a revisão foi de fato postada — é seguro (GitHub já exclui quem revisou da
// lista de pendentes), e sem isso um PR fica escondido da fila pra sempre se a sessão
// fechar sem o /pr-review ter rodado até o fim (achado de bug real, ver o comentário em
// lib/engine/session.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnConsole, sessionExit, handleSessionExit } = require('../lib/engine/session');

function fakeEngine(overrides) {
  const unseen = [];
  const toasts = [];
  const engine = Object.assign({
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeConfigDir() { return ''; },
    ghEnv() { return { ...process.env }; },
    activeReviews: new Map(),
    sessionSeq: 0,
    unsee(key) { unseen.push(key); },
    checkNow() { this.checkedNow = true; },
    pushState() {},
    emit(kind, payload) { toasts.push({ kind, payload }); },
    log() {},
    buildSessionScript(slash, account) { return '@echo off\r\nexit 0\r\n'; }, // script minimo valido
    handleSessionExit(opts) { return handleSessionExit(this, opts); }, // facade, igual server.js
    _unseen: unseen,
    _toasts: toasts,
  }, overrides || {});
  return engine;
}

test('sessionExit (mac): desfaz o visto de todas as keys da sessão registrada', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t1', { id: 't1', keys: ['org/repo#1', 'org/repo#2'], label: 'Revisão de 2 PRs', mode: 'terminal', startedAt: Date.now() });
  const result = sessionExit(engine, 't1');
  assert.equal(result.ok, true);
  assert.deepEqual(engine._unseen.sort(), ['org/repo#1', 'org/repo#2']);
  assert.equal(engine.checkedNow, true); // keys.length > 0 dispara checkNow, como antes
});

test('sessionExit (mac): sessão sem keys (ex.: login dedicado) não chama checkNow nem quebra', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t2', { id: 't2', keys: [], label: 'Login do Claude', mode: 'terminal', startedAt: Date.now() });
  const result = sessionExit(engine, 't2');
  assert.equal(result.ok, true);
  assert.deepEqual(engine._unseen, []);
  assert.equal(engine.checkedNow, undefined); // sem keys, não deve rechecar
});

test('sessionExit: id desconhecido (sessão já não existe) não lança e devolve ok', () => {
  const engine = fakeEngine();
  const result = sessionExit(engine, 'id-que-nao-existe');
  assert.equal(result.ok, true);
  assert.deepEqual(engine._unseen, []);
});

// caminho Windows (spawnConsole): a lógica do handler de exit foi extraída pra
// handleSessionExit(engine, { keys, label, id, code }), compartilhada entre spawnConsole
// e sessionExit (mac) — testamos ela diretamente, sem precisar de processo real nenhum
// (ver nota do brief: abordagem 2, recomendada).
test('handleSessionExit: desfaz o visto de todas as keys e dispara checkNow (equivalente ao exit do spawnConsole)', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t3', { id: 't3', keys: ['org/repo#9'], label: 'Revisão de 1 PR', mode: 'terminal', startedAt: Date.now() });
  handleSessionExit(engine, { keys: ['org/repo#9'], label: 'Revisão de 1 PR', id: 't3', code: 0 });
  assert.deepEqual(engine._unseen, ['org/repo#9']);
  assert.equal(engine.checkedNow, true);
  assert.equal(engine.activeReviews.has('t3'), false);
});

test('handleSessionExit: sem keys (login dedicado) não chama checkNow', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t4', { id: 't4', keys: [], label: 'Login do Claude', mode: 'terminal', startedAt: Date.now() });
  handleSessionExit(engine, { keys: [], label: 'Login do Claude', id: 't4', code: 0 });
  assert.deepEqual(engine._unseen, []);
  assert.equal(engine.checkedNow, undefined);
});

test('handleSessionExit: código de saída != 0 loga WARN', () => {
  const engine = fakeEngine();
  let warned = null;
  engine.log = (level, msg) => { if (level === 'WARN') warned = msg; };
  engine.activeReviews.set('t5', { id: 't5', keys: [], label: 'Sessão X', mode: 'terminal', startedAt: Date.now() });
  handleSessionExit(engine, { keys: [], label: 'Sessão X', id: 't5', code: 1 });
  assert.ok(warned && /saiu com codigo 1/.test(warned));
});

// spawnConsole real (Windows): roda um script trivial (`exit 0` direto, sem claude/pause)
// e espera o evento `exit` de verdade disparar, confirmando que o handler real (não só a
// função extraída) chama unsee. Curto e não deixa nada pendurado.
test('spawnConsole (Windows): ao sair de verdade, desfaz o visto de TODAS as keys da sessão', async (t) => {
  if (process.platform !== 'win32') { t.skip('teste especifico do caminho Windows (spawnConsole)'); return; }
  const engine = fakeEngine({
    buildSessionScript() { return '@echo off\r\nexit 0\r\n'; },
  });
  spawnConsole(engine, '/pr-review x', 'Revisão de teste', ['org/repo#1', 'org/repo#2'], 'default-user');

  await new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (engine._unseen.length > 0) { clearInterval(iv); resolve(); return; }
      if (Date.now() - start > 15000) { clearInterval(iv); reject(new Error('timeout esperando exit do processo real')); }
    }, 100);
  });

  assert.deepEqual(engine._unseen.sort(), ['org/repo#1', 'org/repo#2']);
});
