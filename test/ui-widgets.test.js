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

/* ---------- visibilidade da barra de contas (B14) ---------- */

test('accountBarVisible: so nas abas onde o filtro por conta age', () => {
  assert.equal(P.accountBarVisible(2, 'radar'), true);
  assert.equal(P.accountBarVisible(2, 'destaques'), true);
  assert.equal(P.accountBarVisible(2, 'time'), true);
  assert.equal(P.accountBarVisible(2, 'entregas'), false, 'Entregas filtra por org propria, nada ali respeita SCOPE');
  assert.equal(P.accountBarVisible(2, 'sistema'), false);
  assert.equal(P.accountBarVisible(2, 'consumo'), false);
  assert.equal(P.accountBarVisible(1, 'radar'), false, 'conta unica nao tem o que filtrar');
  assert.equal(P.accountBarVisible(2, 'abaquenaoexiste'), false, 'allowlist: aba nova nasce sem a barra');
});

test('renderAccountBar consome a allowlist pura (B14)', () => {
  const fn = APPJS.match(/function renderAccountBar\([\s\S]*?\n\}/);
  assert.ok(fn, 'renderAccountBar existe');
  assert.match(fn[0], /accountBarVisible\(/);
  assert.doesNotMatch(fn[0], /CURRENT_TAB === 'sistema'/, 'a denylist antiga saiu');
});

/* ---------- atividade do chat e encerramento (B16) ---------- */

test('chat-activity atualiza a pill via updateOp, nao atropela o container (B16)', () => {
  const handler = APPJS.match(/addEventListener\('chat-activity'[\s\S]*?\n  \}\);/);
  assert.ok(handler, 'o handler chat-activity existe');
  assert.match(handler[0], /updateOp\(/, 'o texto vivo entra como step da operacao');
  assert.doesNotMatch(handler[0], /\.textContent = text/,
    'textContent no container destroi a pill que o renderChat criou dentro dele');
});

test('closeChat encerra a operacao do chat antes de soltar a chave (B16)', () => {
  // recorte ancorado no inicio da PROXIMA funcao: o closeChat de uma linha so
  // faria a regex de bloco (ate \n}) engolir o renderChat e casar falso-verde
  const fn = APPJS.match(/function closeChat\(\)[\s\S]*?(?=\nfunction renderChat\()/);
  assert.ok(fn, 'closeChat existe imediatamente antes do renderChat');
  assert.match(fn[0], /closeOp\(`chat-\$\{chatKey\}`/,
    'fechar o painel no meio da resposta nao pode vazar a op no ACTIVE_OPS');
});

test('a fase generica do chat roda so no primeiro paint, nao a cada snapshot (B16)', () => {
  const fn = APPJS.match(/function renderChat\([\s\S]*?\n\}/);
  assert.ok(fn, 'renderChat existe');
  assert.doesNotMatch(fn[0], /Math\.random\(\)/,
    'fase sorteada a cada snapshot atropelava o texto real vindo do chat-activity');
});

/* ---------- marcadores de sessao do merge (B17) ---------- */

test('expiredSessionMarks: marca so expira quando chega refresh mais NOVO', () => {
  const marks = [['acme/app#1', 100], ['acme/app#2', 200]];
  assert.deepEqual(P.expiredSessionMarks(marks, 150), ['acme/app#1'], 'expira so quem foi marcado antes do refresh');
  assert.deepEqual(P.expiredSessionMarks(marks, 200), ['acme/app#1'], 'refresh da mesma geracao nao confirma nada');
  assert.deepEqual(P.expiredSessionMarks(marks, 300), ['acme/app#1', 'acme/app#2']);
  assert.deepEqual(P.expiredSessionMarks([], 300), []);
  assert.deepEqual(P.expiredSessionMarks(marks, null), [], 'sem lastCheckAt (boot) nada expira');
  assert.deepEqual(P.expiredSessionMarks(marks, 0), [], 'zero tambem e ausencia de refresh');
});

test('os marcadores de merge sao Map com geracao e sao podados no render (B17)', () => {
  assert.match(APPJS, /autoUnavailableKeys = new Map\(\)/);
  assert.match(APPJS, /adminUnavailableKeys = new Map\(\)/);
  assert.doesNotMatch(APPJS, /autoUnavailableKeys\.add\(/, 'Map nao tem add: seria TypeError em runtime');
  assert.doesNotMatch(APPJS, /adminUnavailableKeys\.add\(/, 'Map nao tem add: seria TypeError em runtime');
  const inicio = APPJS.match(/function renderMyPRs\(\) \{[\s\S]{0,700}/);
  assert.ok(inicio, 'renderMyPRs existe');
  assert.match(inicio[0], /expiredSessionMarks\(/,
    'a poda roda no comeco de cada render, cumprindo o que o comentario da declaracao dos marcadores sempre prometeu');
});

/* ---------- estado de carregamento das listas (Meus PRs vinha assumindo vazio) ---------- */

test('listViewState: nunca assume vazio antes do primeiro ciclo terminar', () => {
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'starting', length: 0 }), 'loading');
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'checking', length: 0 }), 'loading');
});

test('listViewState: primeiro ciclo falhou sem nunca ter confirmado nada vira erro, nao vazio', () => {
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'error', length: 0 }), 'error');
});

test('listViewState: so' + ' chama de vazio depois de um ciclo confirmado', () => {
  assert.equal(P.listViewState({ lastCheckAt: 12345, status: 'idle', length: 0 }), 'empty');
});

test('listViewState: lista com item sempre mostra a lista, mesmo se o ciclo mais recente falhou', () => {
  // preserva o ultimo dado bom (o motor ja faz isso); a UI so decide entre
  // loading/error/empty quando a lista em si esta vazia
  assert.equal(P.listViewState({ lastCheckAt: 12345, status: 'error', length: 3 }), 'list');
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'checking', length: 1 }), 'list');
});

test('renderMyPRs, renderQueue e renderPanorama decidem o empty state pelo listViewState, nao so pelo tamanho', () => {
  for (const nome of ['renderMyPRs', 'renderQueue', 'renderPanorama']) {
    const fn = APPJS.match(new RegExp(`function ${nome}\\([\\s\\S]*?\\n\\}`));
    assert.ok(fn, `${nome} existe`);
    assert.match(fn[0], /listViewState\(/,
      `${nome} precisa consultar listViewState antes de decidir o empty state, senao assume vazio sem resposta definitiva`);
  }
});
