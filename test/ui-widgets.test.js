// Onda 8: widgets de operacao (showOp/updateOp/closeOp) e estado da UI.
//
// O ciclo de vida de uma operacao virou maquina de estados PURA (ui/pure.js):
// running -> done|error|cancelled, e cada estado terminal tem prazo de auto-dismiss.
// O DOM (ui/app.js) so consome. O que nao da pra testar sem DOM fica travado por
// invariante estatica no texto do app.js, no idioma do ui-semantics.test.js.
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../ui/pure.js';
const APPJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.css'), 'utf8');

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

test('Entregas guarda disclosure de Pessoas separado e confirma o reset pela resposta do novo contexto', () => {
  assert.match(APPJS, /let deliveriesOpen = new Set\(\)/,
    'details aberto/fechado não pode reutilizar deliveriesExpanded (mostrar mais/menos)');
  const fn = APPJS.match(/async function loadDeliveries\([\s\S]*?\n\}/);
  assert.ok(fn, 'loadDeliveries existe');
  assert.match(APPJS, /let deliveriesDataContext = null/,
    'o estado registra a org/período da última resposta aceita');
  assert.match(fn[0], /const requestContext = JSON\.stringify\(\[requestOrg, requestDays\]\)/,
    'a carga captura o contexto resolvido antes da chamada assíncrona');
  const posGuarda = fn[0].indexOf('rid !== deliveriesReqSeq');
  const posContexto = fn[0].indexOf('deliveriesDataContext !== requestContext');
  assert.ok(posGuarda !== -1 && posGuarda < posContexto,
    'resposta velha não pode confirmar nem resetar o contexto de disclosure');
  assert.match(fn[0], /if \(deliveriesDataContext !== requestContext\) resetDeliveriesDisclosure\(\);\s*\n\s*deliveriesDataContext = requestContext/,
    'contexto novo fecha reabertura da UI velha durante a carga; refresh igual preserva o atalho');
  const render = APPJS.match(/function renderDeliveries\([\s\S]*?\n\}/);
  assert.match(render[0], /openKeys: deliveriesOpen/,
    'o renderer puro recebe as chaves abertas explicitamente');
  assert.match(APPJS, /function resetDeliveriesDisclosure\(\) \{ deliveriesOpen = new Set\(\); \}/,
    'o reset de disclosure tem uma operação nomeada');
  assert.match(APPJS, /\$\('#delivOrg'\)[\s\S]{0,300}resetDeliveriesDisclosure\(\);\s*\n\s*loadDeliveries\(\)/,
    'trocar organização fecha os grupos da organização anterior');
  assert.match(APPJS, /\$\('#delivDays'\)[\s\S]{0,500}resetDeliveriesDisclosure\(\);\s*\n\s*loadDeliveries\(\)/,
    'trocar período fecha os grupos do período anterior');
  assert.match(APPJS, /if \(nextDays === deliveriesDays\) return/,
    'clicar no período já ativo não fecha disclosures nem refaz a consulta');
});

test('toggle nativo de details atualiza Pessoas e mostrar mais preserva o card aberto', () => {
  assert.match(APPJS,
    /addEventListener\('toggle',[\s\S]*?details\[data-deliv-group\^="author:"\][\s\S]*?deliveriesOpen\.add\(key\)[\s\S]*?deliveriesOpen\.delete\(key\)[\s\S]*?true\)/,
    'toggle não borbulha: a delegação usa capture e sincroniza o Set de Pessoas');
  const handler = APPJS.match(/\$\('#deliveries'\)\.addEventListener\('click',[\s\S]*?\n\}\);/);
  assert.ok(handler, 'handler delegado de Entregas existe');
  assert.match(handler[0], /mais\.closest\('details\[open\]'\)[\s\S]*?deliveriesOpen\.add\(key\)/,
    'antes do re-render de mostrar mais, o details aberto é preservado até se o toggle ainda estiver enfileirado');
});

test('atalho @pessoa abre explicitamente o grupo, sem mudar o default recolhido', () => {
  const fn = APPJS.match(/function gotoDeliv\(kind, valor\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'gotoDeliv existe');
  assert.match(fn[0], /if \(by === 'author'\) deliveriesOpen\.add\('author:' \+ valor\);\s*\n\s*renderDeliveries\(\)/,
    'clicar em @fulano na frente é intenção explícita de abrir aquele grupo');
  assert.match(fn[0], /if \(CURRENT_TAB !== 'entregas'\) switchTab\('entregas'\)/,
    'atalho dentro da própria tela não inicia uma carga que substituiria o alvo recém-aberto');
});

test('seta do accordion acompanha o atributo open no próprio summary', () => {
  assert.match(CSS, /\.deliv-card details\[open\] > summary\.deliv-sum::after \{[^}]*transform: rotate\(90deg\)/,
    'summary já é .deliv-sum; não existe um .deliv-sum filho dentro dele');
  assert.doesNotMatch(CSS, /details\[open\] > summary \.deliv-sum::after/,
    'o seletor antigo nunca casava e deixava a seta apontando para a direita com o corpo aberto');
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

/* ---------- Diagnostico: resumo agrupado antes do despejo cru ----------
   O que da pra testar sem DOM ja mora no ui/pure.js (ui-pure.test.js). Aqui ficam as
   invariantes do CONSUMO: o app tem que ler a rota agrupada, montar resumo antes do
   detalhe e nao voltar a despejar o log inteiro. */

test('buildDiagnostics consome a rota agrupada e poe o Resumo ANTES do Detalhe', () => {
  const fn = APPJS.match(/async function buildDiagnostics\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'buildDiagnostics existe');
  assert.match(fn[0], /get\('\/api\/log\/triage'\)/, 'o agrupamento vem do servidor (a UI nao pode require lib/)');
  assert.match(fn[0], /logSummaryLines\(grupos\)/, 'o resumo entra no relatorio');
  assert.match(fn[0], /logTailLines\(log, DIAG_LOG_TAIL\)/, 'o detalhe cru entra limitado');
  assert.ok(fn[0].indexOf("'  Resumo:'") < fn[0].indexOf('Detalhe'), 'resumo antes do detalhe');
  assert.doesNotMatch(fn[0], /log\.join\('\n'\)/, 'o despejo das 159 linhas cruas saiu do relatorio');
});

test('o teto do detalhe do diagnostico e 40 linhas, declarado uma vez so', () => {
  assert.match(APPJS, /const DIAG_LOG_TAIL = 40;/);
});

test('a aba Sistema mostra o resumo agrupado do log, sem mexer no botao de zerar', () => {
  const fn = APPJS.match(/async function loadLog\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'loadLog existe');
  assert.match(fn[0], /get\('\/api\/log\/triage'\)/);
  assert.match(fn[0], /logSummaryShort\(grupos \|\| \[\], 3\)/, 'os 3 maiores grupos');
  assert.match(HTML, /<p class="sys-note" id="logResumo" hidden><\/p>/,
    'o resumo mora em paragrafo proprio: a .section-head e flex e quebra cedo (CLAUDE.md)');
  assert.match(HTML, /id="btnLogClear"/, 'o botao de zerar segue onde estava');
  assert.match(HTML, /id="logBox"/, 'o despejo cru continua disponivel embaixo');
});

/* ---------- "Meus PRs": PR oculto ----------
   A separacao visivel/oculto e o texto do rodape sao puros e moram no ui/pure.js
   (ui-pure.test.js). Aqui ficam as invariantes do CONSUMO, que sem DOM so da pra travar
   no texto do app.js: quem o contador conta, de onde vem a decisao e o desempate dos
   dois botoes escritos "Ocultar" no mesmo card. */

test('o contador de Meus PRs conta o VISIVEL, nao o total', () => {
  // com 3 PRs e os 3 ocultos, a bolinha dizia 3 e a lista mostrava 0
  const fn = APPJS.match(/function renderMyPRs\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'renderMyPRs existe');
  assert.match(fn[0], /\$\('#myPRsCount'\)\.textContent = visiveis\.length;/);
  assert.match(fn[0], /\$\('#myPRsCount'\)\.hidden = visiveis\.length === 0;/);
  assert.doesNotMatch(fn[0], /\$\('#myPRsCount'\)\.textContent = list\.length;/,
    'o contador pelo total saiu');
});

test('renderMyPRs decide o oculto pelas funcoes puras, nao por logica solta', () => {
  const fn = APPJS.match(/function renderMyPRs\(\) \{[\s\S]*?\n\}/);
  assert.match(fn[0], /splitHiddenPRs\(todos, effectiveHidden\(STATE\.hiddenPRs, hideOptimistic, unhideOptimistic\)\)/,
    'o motor manda myPRs COMPLETO; quem separa e a UI, com a marca otimista por cima');
  assert.match(fn[0], /myPRsEmptyMsg\(vs, \{ escopoTodas: SCOPE === 'all', ocultos: ocultos\.length \}\)/,
    'o vazio com tudo oculto tem que explicar, nao ficar em branco');
});

test('o estado de carregamento olha a lista COMPLETA, senao ocultar tudo viraria "verificando"', () => {
  const fn = APPJS.match(/function renderMyPRs\(\) \{[\s\S]*?\n\}/);
  assert.match(fn[0], /listViewState\(\{ lastCheckAt: STATE\.lastCheckAt, status: STATE\.status, length: todos\.length \}\)/);
});

test('a marca otimista morre quando o motor confirma (nao sobrevive a estado novo)', () => {
  const fn = APPJS.match(/function renderMyPRs\(\) \{[\s\S]*?\n\}/);
  assert.match(fn[0], /if \(doMotor\.has\(String\(k\)\.toLowerCase\(\)\)\) hideOptimistic\.delete\(k\)/);
  assert.match(fn[0], /if \(!doMotor\.has\(String\(k\)\.toLowerCase\(\)\)\) unhideOptimistic\.delete\(k\)/);
});

test('o card nao tem mais DOIS botoes escritos "Ocultar" (a confusao que originou a feature)', () => {
  // o act-self-clear some so com a AUTOANALISE, e o usuario lia como "ocultar o PR"
  assert.match(APPJS, /class="btn sm ghost act-self-clear"[\s\S]{0,220}>Ocultar análise<\/button>/,
    'o botao da autoanalise diz o que ele oculta');
  assert.doesNotMatch(APPJS, /act-self-clear"[\s\S]{0,220}>Ocultar<\/button>/,
    'o rotulo ambiguo saiu');
});

test('o botao Ocultar do PR promete o comportamento REAL (volta sozinho com commit novo)', () => {
  const btn = APPJS.match(/class="btn sm ghost act-pr-hide"[^>]*>/);
  assert.ok(btn, 'o botao Ocultar do PR existe');
  assert.match(btn[0], /title="Some com este PR de Meus PRs\. Ele volta sozinho se receber commit novo"/,
    'ocultar nao e pra sempre: o motor reexibe quando ha atividade nova');
  assert.match(APPJS, /class="btn sm ghost act-pr-unhide"[\s\S]{0,200}>Reexibir<\/button>/,
    'com os ocultos a mostra, o Ocultar vira Reexibir');
});

test('ocultar e reexibir sao otimistas e desfazem a marca quando a rota falha', () => {
  const handler = APPJS.match(/const hide = e\.target\.closest\('\.act-pr-hide'\);[\s\S]*?\n  \}\n\}\);/);
  assert.ok(handler, 'o handler de ocultar/reexibir existe');
  assert.match(handler[0], /api\('\/api\/pr\/hide', \{ key \}\)/, 'usa o helper api(), como o resto da UI');
  assert.match(handler[0], /api\('\/api\/pr\/unhide', \{ key \}\)/);
  assert.match(handler[0], /hideOptimistic\.delete\(key\); renderMyPRs\(\); renderRadarNav\(\);/,
    'falhou, o card volta: a tela nao pode mentir que ocultou');
  assert.match(handler[0], /unhideOptimistic\.delete\(key\); renderMyPRs\(\); renderRadarNav\(\);/);
});

test('o rodape dos ocultos usa o texto puro e alterna estado so da tela', () => {
  const fn = APPJS.match(/function renderMyPRsHiddenFoot\([\s\S]*?\n\}/);
  assert.ok(fn, 'renderMyPRsHiddenFoot existe');
  assert.match(fn[0], /hiddenFootLabel\(n, hiddenOpen\)/, 'o texto vem da funcao pura');
  assert.match(fn[0], /foot\.hidden = !label/, 'sem oculto o rodape some inteiro');
  assert.match(fn[0], /aria-expanded="\$\{hiddenOpen \? 'true' : 'false'\}"/,
    'o toggle declara o estado, nao so a classe');
  assert.match(APPJS, /hiddenOpen = !hiddenOpen;\n  renderMyPRs\(\); renderRadarNav\(\);/,
    'alternar re-renderiza a secao E a contagem da sub-aba');
  assert.match(HTML, /<div id="myPRsHiddenFoot" class="mypr-hidden-foot" hidden><\/div>/,
    'a ancora do rodape existe no index.html (nao e id fantasma, B11)');
});

/* ---------- menções navegáveis: estrutura que a foto/link exigem ----------
   As funções puras estão travadas em ui-pure.test.js; aqui ficam as invariantes
   que só existem no app.js/index.html: o título que trunca sem comer o autor e
   o handler ÚNICO de navegação interna. */

test('Panorama: o CSS que impede o título de empurrar o autor pra fora', () => {
  // regressão do defeito de "Revisões recentes" (v2.39.0) reencontrado aqui em
  // 11/08: com o @autor dentro do .pw-title (overflow hidden + ellipsis), título
  // comprido empurrava foto e login pra fora da tela, sem aviso.
  //
  // A metade de MARKUP deste teste saiu daqui na onda 5: o card do panorama virou
  // panoramaRowHtml, em ui/pure.js, e lá dá pra renderizar de verdade em vez de
  // casar regex no fonte. Ver "Panorama: o autor fica FORA da caixa que trunca o
  // título" em ui-pure.test.js. O que sobra aqui é o par de CSS, que segue sendo
  // texto porque app.css não é executável.
  assert.match(CSS, /\.pw-title-txt \{[^}]*text-overflow: ellipsis/,
    'quem corta é o texto, não a linha inteira');
  assert.match(CSS, /\.pw-title \.person-mention \{[^}]*flex: none/,
    'a menção do autor não encolhe junto com o título');
});

test('navegação interna tem UM handler só, delegado, e entende os 3 tipos', () => {
  const fn = APPJS.match(/function goTo\(spec\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'goTo existe');
  assert.match(fn[0], /const \{ tipo, alvo, seletor \} = parseGoto\(spec\);/,
    'o parse do spec mora no ui/pure.js, onde tem teste');
  assert.match(fn[0], /if \(tipo === 'aba'\) return gotoAba\(alvo, seletor \|\| null\);/,
    'aba: repassa o seletor (destino de ferramenta precisa dele)');
  assert.match(fn[0], /switchTab\('sistema'\);\s*\n\s*return sysGoTo\(alvo, seletor \|\| null\);/,
    'sys: troca a aba ANTES do sysGoTo (elemento em aba escondida não rola)');
  assert.match(fn[0], /if \(tipo === 'deliv'\) return gotoDeliv\(alvo, seletor\);/);
  // mesma ordem do sysGoTo, pelo mesmo motivo, e sem piscar painel escondido
  assert.match(APPJS, /function gotoAba\(nome, at\) \{\s*\n\s*switchTab\(nome\);/,
    'gotoAba troca a aba ANTES de procurar o alvo');
  assert.match(APPJS, /if \(!el \|\| el\.hidden\) return;/,
    'painel de ferramenta sem resultado ainda é hidden: não pisca o que ninguém vê');
  assert.match(APPJS, /document\.addEventListener\('click', \(e\) => \{\s*\n\s*const el = e\.target\.closest\('\[data-goto\]'\);/,
    'um listener delegado no document, não um por tela');
  assert.match(APPJS, /document\.addEventListener\('keydown'/, 'mesma navegação pelo teclado');
});

test('toda menção com data-goto é anunciada como botão (role + tabindex)', () => {
  // O pure.js entra na varredura desde a onda 5: os emissores de data-goto foram
  // saindo do app.js junto com as funções puras (hoje são mais lá do que aqui), e
  // um contrato de acessibilidade que só olha o arquivo de origem vira cego assim
  // que o código muda de casa. Foi o que aconteceu ao mover o bloco de Consumo: o
  // piso caiu de 6 pra 5 e o teste reprovou sem que nenhuma menção tivesse perdido
  // role ou tabindex.
  const PUREJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'pure.js'), 'utf8');
  const fontes = [APPJS, HTML, PUREJS];
  const alvos = fontes.reduce((n, src) => n + [...src.matchAll(/data-goto="[^"]*"/g)].length, 0);
  assert.ok(alvos >= 6, `esperava várias menções navegáveis, achei ${alvos}`);
  // cada emissão de data-goto em elemento não interativo tem role/tabindex junto
  for (const src of fontes) {
    const semRole = [...src.matchAll(/<span[^>]*data-goto="[^"]*"[^>]*>/g)]
      .filter(m => !/role="button"/.test(m[0]) || !/tabindex="0"/.test(m[0]));
    assert.deepEqual(semRole.map(m => m[0].slice(0, 90)), [],
      'span com data-goto precisa de role="button" e tabindex="0"');
  }
});

/* ---------- progresso: regua unica, sem percentual chutado ---------- */

test('progresso literal no app.js so existe no paint inicial (<= 10); o resto sai da regua sessionProgress', () => {
  // o bug de origem (16/08/2026): barra da autoanalise fixa em "progress: 25"
  // ate concluir do nada. A regra agora e central: percentual de meio de fluxo
  // vem SEMPRE de sessionProgress (ui/pure.js); literal so pro primeiro paint,
  // e primeiro paint honesto e baixo (ninguem mediu nada ainda).
  const chutes = [...APPJS.matchAll(/progress:\s*(\d+)/g)].filter(m => Number(m[1]) > 10);
  assert.deepEqual(chutes.map(m => m[0]), [],
    'percentual literal acima de 10 no app.js: use sessionProgress (ui/pure.js), a regua unica de progresso');
  assert.ok(APPJS.includes('sessionProgress('), 'a regua central sumiu do app.js');
});
