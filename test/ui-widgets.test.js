'use strict';
// Onda 8: widgets de operacao (showOp/updateOp/closeOp) e estado da UI.
//
// O ciclo de vida de uma operacao virou maquina de estados PURA (ui/pure.js):
// running -> done|error|cancelled, e cada estado terminal tem prazo de auto-dismiss.
// O DOM (ui/app.js) so consome. O que nao da pra testar sem DOM fica travado por
// invariante estatica no texto do app.js, no idioma do ui-semantics.test.js.
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require(path.join(__dirname, '..', 'ui', 'pure.js'));
const APPJS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');

/* ---------- maquina de estados das operacoes (M22) ---------- */

test('opTransition: running anda pra qualquer terminal', () => {
  assert.equal(P.opTransition('running', 'done'), 'done');
  assert.equal(P.opTransition('running', 'error'), 'error');
  assert.equal(P.opTransition('running', 'cancelled'), 'cancelled');
});

test('opTransition: estado terminal nao vira outro terminal nem volta a running', () => {
  assert.equal(P.opTransition('done', 'error'), 'done');
  assert.equal(P.opTransition('error', 'done'), 'error');
  assert.equal(P.opTransition('cancelled', 'running'), 'cancelled');
});

test('opTransition: destino desconhecido nao anda', () => {
  assert.equal(P.opTransition('running', 'sumiu'), 'running');
});

test('opDismissDelay: running nao some sozinho, todo terminal SEMPRE some', () => {
  // pill de erro imortal era o M22: acumulava uma por tentativa
  assert.equal(P.opDismissDelay('running'), null);
  assert.equal(P.opDismissDelay('done'), 3000);
  assert.equal(P.opDismissDelay('error'), 6000);
  assert.equal(P.opDismissDelay('cancelled'), 6000);
});

test('closeOp agenda o dismiss pela maquina, nao so no done (M22)', () => {
  const fn = APPJS.match(/function closeOp\([\s\S]*?\n\}/);
  assert.ok(fn, 'closeOp existe');
  assert.match(fn[0], /opDismissDelay\(/, 'o prazo de sumir vem da funcao pura');
  assert.match(fn[0], /opTransition\(/, 'a transicao de status passa pela maquina');
  assert.doesNotMatch(fn[0], /result === 'done'\) \{\s*setTimeout/,
    'error e cancelled tambem expiram, nao so done');
});

test('showOp remove a pill anterior antes de recriar com o mesmo id (M22)', () => {
  const fn = APPJS.match(/function showOp\([\s\S]*?\n\}/);
  assert.ok(fn, 'showOp existe');
  assert.match(fn[0], /const prev = ACTIVE_OPS\.get\(opId\)/, 'consulta a operacao anterior');
  assert.match(fn[0], /prev\.element\.remove\(\)/, 'a pill velha sai do DOM antes da nova entrar');
});

/* ---------- widget sys-polling (B11) ---------- */

test('sys-polling ancora em elemento que existe, nao em id fantasma (B11)', () => {
  assert.match(HTML, /id="metaCheck"/, 'a ancora real existe no index.html');
  assert.doesNotMatch(APPJS, /\$\('#metaLine'\)/, 'nao existe id metaLine no index.html');
  assert.doesNotMatch(APPJS, /\$\('#topbar'\)/, 'topbar e classe, nao id: $() devolvia null');
  const fn = APPJS.match(/function renderStatus\([\s\S]*?\n\}/);
  assert.ok(fn, 'renderStatus existe');
  assert.match(fn[0], /#metaCheck/, 'a pill de polling vive ao lado do #metaCheck');
});

test('erro de checagem nao trava o widget sys-polling pra sempre (B11)', () => {
  const fn = APPJS.match(/function renderStatus\([\s\S]*?\n\}/);
  assert.match(fn[0], /status !== 'running'/,
    'op terminal e purgada no comeco do ciclo seguinte, senao o has() barra o novo widget');
});

/* ---------- corrida de respostas na aba Entregas (M19) ---------- */

test('loadDeliveries descarta resposta velha por token de requisicao (M19)', () => {
  const fn = APPJS.match(/async function loadDeliveries\([\s\S]*?\n\}/);
  assert.ok(fn, 'loadDeliveries existe');
  assert.match(fn[0], /const rid = \+\+deliveriesReqSeq/, 'cada carga pega um token novo');
  assert.match(fn[0], /if \(rid !== deliveriesReqSeq\) return/,
    'resposta de carga superada nao pinta a tela (padrao da guarda do openChat)');
  const posGuarda = fn[0].indexOf('rid !== deliveriesReqSeq');
  const posClose = fn[0].indexOf('closeOp(');
  assert.ok(posGuarda !== -1 && posGuarda < posClose,
    'a guarda vem ANTES do closeOp: resposta velha nao encerra a op da carga nova');
});

/* ---------- estagio da sessao ativa (B13) ---------- */

test('stageLabel muda com o tempo de vida da sessao', () => {
  assert.equal(P.stageLabel(0), '(iniciando…)');
  assert.equal(P.stageLabel(4), '(iniciando…)');
  assert.equal(P.stageLabel(5), '(processando…)');
  assert.equal(P.stageLabel(14), '(processando…)');
  assert.equal(P.stageLabel(15), '');
  assert.equal(P.stageLabel(600), '');
});

test('o rotulo de estagio tem ticker proprio e nao congela no primeiro paint (B13)', () => {
  assert.match(APPJS, /class="session-stage" data-started=/, 'o estagio mora num span com data-started');
  const fn = APPJS.match(/function tickElapsed\([\s\S]*?\n\}/);
  assert.ok(fn, 'tickElapsed existe');
  assert.match(fn[0], /session-stage/, 'o ticker de 1s envelhece o estagio, como ja faz com o elapsed');
  assert.match(fn[0], /stageLabel\(/, 'o texto vem da funcao pura');
});

/* ---------- escopo persistido orfao (B15) ---------- */

test('validScope: orfao volta pra all, valido permanece', () => {
  assert.equal(P.validScope('all', ['alice']), 'all');
  assert.equal(P.validScope('', ['alice']), 'all');
  assert.equal(P.validScope(null, []), 'all');
  assert.equal(P.validScope('alice', ['alice', 'bob']), 'alice');
  assert.equal(P.validScope('ALICE', ['alice']), 'ALICE', 'compara sem caixa e preserva o valor salvo');
  assert.equal(P.validScope('carol', ['alice', 'bob']), 'all', 'conta removida nao pode esvaziar o Radar');
});

test('rebuildAccounts saneia o SCOPE persistido a cada snapshot (B15)', () => {
  const fn = APPJS.match(/function rebuildAccounts\([\s\S]*?\n\}/);
  assert.ok(fn, 'rebuildAccounts existe');
  assert.match(fn[0], /validScope\(/, 'a validacao roda onde as contas sao reconstruidas');
  assert.match(fn[0], /list\.length/, 'snapshot de boot sem contas nao pode resetar escopo valido');
});
