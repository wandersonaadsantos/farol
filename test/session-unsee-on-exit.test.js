'use strict';
// Fechar uma sessão de terminal (Windows/mac) desfaz o "visto" dos PRs dela, mesmo sem
// saber se a revisão foi de fato postada — é seguro (GitHub já exclui quem revisou da
// lista de pendentes), e sem isso um PR fica escondido da fila pra sempre se a sessão
// fechar sem o /pr-review ter rodado até o fim (achado de bug real, ver o comentário em
// lib/engine/session.js).
// IMPORTANTE: o teste de spawnConsole real (Windows, mais abaixo) grava um script .cmd
// de verdade dentro de HOME/sessions - fixar FAROL_HOME num diretório temporário ANTES
// de qualquer require que carregue lib/paths.js (const de nível de módulo, lida uma
// única vez no load), senão o teste escreve dentro do ~/.farol real da máquina (mesmo
// padrão de test/boot.test.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-unsee-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;
// spawnConsole usa WORKSPACE (HOME/workspace) como cwd do processo filho - sem essa
// pasta existir, o spawn do powershell.exe falha na hora com ENOENT (cwd inválido),
// o que cairia no handler 'error' em vez do 'exit' que o teste real quer exercitar.
// Fora daqui isso normalmente é semeado pelo boot da Engine; como este teste chama
// spawnConsole direto (sem subir a Engine inteira), semeamos manualmente.
fs.mkdirSync(path.join(FAROL_HOME, 'workspace'), { recursive: true });

// mock de child_process.spawn pros testes de spawnConsoleMac (M5): lib/engine/session.js
// captura `spawn` no load, então a troca precisa vir ANTES do require abaixo (mesmo
// padrão de test/session-claude-profile.test.js). Sem spawnImpl setado, delega pro
// spawn real (o teste de spawnConsole real do Windows, mais abaixo, depende disso).
const childProcess = require('child_process');
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};
const { EventEmitter } = require('node:events');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnConsole, spawnConsoleMac, spawnLoginConsoleMac, sessionExit, handleSessionExit } = require('../lib/engine/session');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

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
    buildSessionScriptMac(slash, id, user) { return '#!/bin/bash\nexit 0\n'; }, // script minimo valido
    buildLoginScriptMac(dir, id) { return '#!/bin/bash\nexit 0\n'; }, // script minimo valido
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

  // spawnConsole guarda a sessão em activeReviews antes de qualquer coisa; usamos isso
  // pra pegar o child real (via o id gerado) e tratar o evento 'error' também - se o
  // spawn do powershell.exe falhar por qualquer motivo neste ambiente (sandbox, política
  // de execução, etc.), o teste falha rápido com mensagem clara em vez de estourar o
  // timeout de 15s esperando por um 'exit' que nunca vem.
  const id = Array.from(engine.activeReviews.keys())[0];

  await new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (engine._unseen.length > 0) { clearInterval(iv); resolve(); return; }
      if (!engine.activeReviews.has(id) && engine._unseen.length === 0 && engine._toasts.some(t => t.kind === 'error')) {
        clearInterval(iv);
        const toast = engine._toasts.find(t => t.kind === 'error');
        reject(new Error(`spawn do powershell.exe falhou neste ambiente: ${toast.payload.text}`));
        return;
      }
      if (Date.now() - start > 15000) { clearInterval(iv); reject(new Error('timeout esperando exit do processo real')); }
    }, 100);
  });

  assert.deepEqual(engine._unseen.sort(), ['org/repo#1', 'org/repo#2']);
});

// M5: `open -a Terminal` retorna na hora; exit 0 = Terminal lançado (o fim REAL da
// sessão chega depois, pelo trap EXIT do .command). Exit != 0 = o Terminal nunca abriu
// (permissão de automação negada, MDM): sem tratar, o pill fica preso e as keys ficam
// vistas pra sempre, PR sumido da fila (o inflight só cobre sessões auto).
test('spawnConsoleMac: open saindo != 0 desfaz o visto, remove a sessão e avisa (M5)', () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  let scriptGravado = null;
  spawnImpl = (cmd, args) => { scriptGravado = args[2]; return fakeChild; }; // spawn('open', ['-a','Terminal',script])
  try {
    spawnConsoleMac(engine, '/pr-review x', 'Revisão de 1 PR', ['org/repo#7'], 'alice');
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];
  assert.ok(id, 'sessão registrada antes do exit');
  assert.equal(fs.existsSync(scriptGravado), true, 'o .command foi gravado');

  fakeChild.emit('exit', 1);

  assert.equal(engine.activeReviews.size, 0, 'pill não pode ficar preso');
  assert.deepEqual(engine._unseen, ['org/repo#7'], 'sem unsee o PR some da fila pra sempre');
  assert.equal(engine.checkedNow, true, 'a fila precisa ser rechecada');
  assert.ok(engine._toasts.some(t => t.kind === 'toast' && t.payload.kind === 'error'), 'o usuário precisa saber que não abriu');
  assert.equal(fs.existsSync(scriptGravado), false, 'o trap EXIT nunca vai rodar; o script órfão tem que ser apagado');
});

test('spawnConsoleMac: open saindo 0 não mexe em nada; o fim real chega pelo trap EXIT (M5)', () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  spawnImpl = () => fakeChild;
  try {
    spawnConsoleMac(engine, '/pr-review x', 'Revisão de 1 PR', ['org/repo#7'], 'alice');
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];

  fakeChild.emit('exit', 0); // open lançou o Terminal e retornou; a sessão segue viva

  assert.equal(engine.activeReviews.has(id), true, 'sessão continua ativa');
  assert.deepEqual(engine._unseen, [], 'não desfaz visto de sessão viva');

  const r = sessionExit(engine, id); // o trap EXIT do .command chama /api/session-exit
  assert.equal(r.ok, true);
  assert.deepEqual(engine._unseen, ['org/repo#7'], 'o ciclo fecha pelo caminho de sempre');
});

// R13 do plano mestre: spawnLoginConsoleMac tem o MESMO buraco do M5 (ignora exit != 0
// do open). Sem keys o dano é menor (não há visto pra desfazer), mas o pill de login
// ficava preso pra sempre e o script órfão nunca era apagado.
test('spawnLoginConsoleMac: open saindo != 0 remove a sessão, apaga o script e avisa (M5, R13)', () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  let scriptGravado = null;
  spawnImpl = (cmd, args) => { scriptGravado = args[2]; return fakeChild; };
  try {
    spawnLoginConsoleMac(engine, '/tmp/claude-dir-teste');
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];
  assert.ok(id, 'sessão registrada antes do exit');
  assert.equal(fs.existsSync(scriptGravado), true, 'o .command foi gravado');

  fakeChild.emit('exit', 1);

  assert.equal(engine.activeReviews.size, 0, 'pill de login não pode ficar preso');
  assert.deepEqual(engine._unseen, [], 'login não tem keys, nada a desfazer');
  assert.equal(engine.checkedNow, undefined, 'sem keys não recheca a fila');
  assert.ok(engine._toasts.some(t => t.kind === 'toast' && t.payload.kind === 'error'), 'o usuário precisa saber que não abriu');
  assert.equal(fs.existsSync(scriptGravado), false, 'o trap EXIT nunca vai rodar; o script órfão tem que ser apagado');
});
