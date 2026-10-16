// Fechar uma sessão de terminal (Windows/mac) desfaz o "visto" dos PRs dela, mesmo sem
// saber se a revisão foi de fato postada — é seguro (GitHub já exclui quem revisou da
// lista de pendentes), e sem isso um PR fica escondido da fila pra sempre se a sessão
// fechar sem o /pr-review ter rodado até o fim (achado de bug real, ver o comentário em
// lib/engine/session.js).
// IMPORTANTE: o teste de spawnConsole (Windows, mais abaixo) grava um script .cmd
// de verdade dentro de HOME/sessions - fixar FAROL_HOME num diretório temporário ANTES
// de qualquer require que carregue lib/paths.js (const de nível de módulo, lida uma
// única vez no load), senão o teste escreve dentro do ~/.farol real da máquina (mesmo
// padrão de test/boot.test.js).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-unsee-'));
process.env.FAROL_HOME = FAROL_HOME;
fs.mkdirSync(path.join(FAROL_HOME, 'workspace'), { recursive: true });

// Só a abertura de processo é substituída: abrir um terminal visível, mesmo com
// `exit 0`, deixa janelas residuais do Windows Terminal em rodadas repetidas.
// Os scripts e o ciclo de vida da sessão continuam sendo exercitados de verdade.
import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  assert.ok(spawnImpl, 'teste de sessão não pode abrir um terminal real');
  return spawnImpl(...args);
};
import { EventEmitter } from 'node:events';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { spawnConsole, spawnConsoleMac, spawnLoginConsoleMac, sessionExit, handleSessionExit } = await import('../lib/engine/session.js');

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

test('spawnConsole (Windows): exit desfaz o visto de TODAS as keys e limpa a sessão sem abrir terminal real', { skip: process.platform !== 'win32' ? 'teste especifico do caminho Windows (spawnConsole)' : false }, () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  let command;
  spawnImpl = (cmd) => { command = cmd; return fakeChild; };
  try {
    spawnConsole(engine, '/pr-review x', 'Revisão de teste', ['org/repo#1', 'org/repo#2'], 'default-user');
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];
  const sessionsDir = path.join(FAROL_HOME, 'sessions');
  const [scriptName] = fs.readdirSync(sessionsDir);
  const script = path.join(sessionsDir, scriptName);
  assert.equal(command, 'powershell.exe');
  assert.equal(fs.readFileSync(script, 'utf8'), '@echo off\r\nexit 0\r\n');
  assert.deepEqual(engine._unseen, [], 'o visto só sai quando o processo termina');

  fakeChild.emit('exit', 0);

  assert.deepEqual(engine._unseen.sort(), ['org/repo#1', 'org/repo#2']);
  assert.equal(engine.activeReviews.has(id), false);
  assert.equal(engine.checkedNow, true);
  assert.equal(fs.existsSync(script), false, 'o script temporário precisa ser apagado');
});

test('spawnConsole (Windows): falha de abertura remove sessão e script sem desfazer visto', { skip: process.platform !== 'win32' ? 'teste especifico do caminho Windows (spawnConsole)' : false }, () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  spawnImpl = () => fakeChild;
  try {
    spawnConsole(engine, '/pr-review x', 'Revisão de teste', ['org/repo#1'], 'default-user');
  } finally {
    spawnImpl = null;
  }
  const sessionsDir = path.join(FAROL_HOME, 'sessions');
  assert.equal(fs.readdirSync(sessionsDir).length, 1);

  fakeChild.emit('error', new Error('abertura recusada'));

  assert.equal(engine.activeReviews.size, 0);
  assert.deepEqual(fs.readdirSync(sessionsDir), []);
  assert.deepEqual(engine._unseen, []);
  assert.equal(engine.checkedNow, undefined);
  assert.ok(engine._toasts.some(t => t.kind === 'toast' && t.payload.kind === 'error' && /abertura recusada/.test(t.payload.text)));
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
