'use strict';
// check() resiliente a falha PARCIAL das buscas: quando só as --review-requested
// falham (ex.: rate limit da API de search), a fila, o "é meu" do panorama e os
// marcadores do último ciclo bom são preservados, como já acontece com reviewedKeys
// e myPRs. Sem isso, um ciclo ruim zerava a fila, apagava reReviewedKeys
// (ressuscitando PRs ignorados) e re-notificava tudo na recuperação.
// Runner nativo (node --test), ZERO dependências.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkres-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');
const { BASELINE_FILE, STATE_DIR } = require('../lib/paths');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = {
  key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'PR de teste',
  author: 'alice', repo: 'acme/app', number: 1, updatedAt: '2026-08-01T10:00:00Z', account: 'me'
};

// PR autoral da SEGUNDA conta (outra org): existe pra separar o estado de uma conta
// do estado da outra quando só uma das buscas cai (G5).
const PR_B = {
  key: 'globex/api#7', url: 'https://github.com/globex/api/pull/7', title: 'PR da outra conta',
  author: 'voce', repo: 'globex/api', number: 7, updatedAt: '2026-08-02T10:00:00Z', account: 'voce'
};

// Engine com TODO colaborador de rede/side-effect do check() stubado. O roteiro
// (e.scenario) diz o que cada busca devolve no ciclo corrente; null = busca falhou.
function checkEngine() {
  const e = new Engine();
  e.config.accounts = [{ user: 'me', owners: ['acme'] }];
  e.config.autoReview = false; // nunca dispara revisão headless em teste
  e.seen = new Set();
  e.reReviewedKeys = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.queue = [];
  e.resolveAccount = async () => {};
  e.refreshTokens = async () => { e.tokenOk = true; return true; };
  e.myAuthoredPRs = async () => [];
  e.enrichMyPRBranches = async () => {};
  e.refreshMergeStates = async () => {};
  e.refreshStaleStates = async () => {};
  e.scanPushbacks = async () => {};
  e.checkUpdate = async () => {};
  e.launchReview = () => { throw new Error('launchReview não deveria rodar neste teste'); };
  e.schedule = () => {};
  e.saveSeen = () => {}; // seen em memória basta pro cenário
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  e.searchPRs = async (extraArgs) => {
    const lista = extraArgs[0] === '--owner' ? e.scenario.panorama
      : extraArgs[0] === '--review-requested=@me' ? e.scenario.mine
        : e.scenario.reviewed;
    return lista === null ? null : lista.map(p => ({ ...p })); // check() muta os PRs
  };
  // baseline já existente: a 1ª checagem da vida não pode engolir a fila do teste
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  e.notices = [];
  e.on('new-prs', ev => e.notices.push(ev));
  return e;
}

// Engine com DUAS contas monitoradas e o roteiro do myAuthoredPRs POR CONTA
// (e.autorais[user]; null = a busca daquela conta falhou neste ciclo).
function duasContas() {
  const e = checkEngine();
  e.config.accounts = [{ user: 'me', owners: ['acme'] }, { user: 'voce', owners: ['globex'] }];
  e.selfAnalyses = {};
  e.hiddenPRs = {};
  e.autorais = { me: [PR], voce: [PR_B] };
  e.myAuthoredPRs = async (user) => {
    const lista = e.autorais[user];
    return lista === null ? null : lista.map(p => ({ ...p })); // check() muta os PRs
  };
  return e;
}

// G5: o sinal que decidia tudo isso era GLOBAL (bastava UMA conta responder pra o
// ciclo tratar a lista inteira como completa). Com duas contas, a queda de uma
// apagava a autoanálise e desocultava os PRs dela, porque "sumiu da lista" parecia
// prova de PR fechado. Agora cada conta responde só pelo que é dela.
test('falha da busca de UMA conta preserva myPRs, autoanálise e ocultos DELA (G5)', async () => {
  const e = duasContas();
  await e.check('test');
  assert.deepEqual(e.myPRs.map(p => p.key).sort(), [PR.key, PR_B.key].sort(),
    'ciclo bom traz os PRs autorais das duas contas');

  // estado local pendurado nos dois PRs (é ele que a falha parcial não pode varrer)
  e.selfAnalyses[PR.key] = { key: PR.key, approvable: true };
  e.selfAnalyses[PR_B.key] = { key: PR_B.key, approvable: true };
  e.hidePR(PR.key);
  e.hidePR(PR_B.key);
  assert.ok(e.hiddenPRs[PR.key] && e.hiddenPRs[PR_B.key], 'ocultei os dois');

  // ciclo 2: a conta 'voce' cai; a conta 'me' responde e confirma que o PR dela fechou
  e.autorais = { me: [], voce: null };
  await e.check('test');

  assert.deepEqual(e.myPRs.map(p => p.key), [PR_B.key],
    'o PR da conta caída fica (preservado do ciclo anterior); o da conta que respondeu, e fechou, sai');
  assert.ok(e.selfAnalyses[PR_B.key],
    'autoanálise da conta caída NÃO é podada: com a busca falha, "sumiu" não prova nada');
  assert.equal(e.selfAnalyses[PR.key], undefined,
    'a autoanálise da conta que respondeu é podada como sempre foi (o PR fechou de verdade)');
  assert.ok(e.hiddenPRs[PR_B.key],
    'oculto da conta caída continua oculto: uma queda de rede não pode desocultar os PRs dela');
  assert.equal(e.hiddenPRs[PR.key], undefined,
    'oculto da conta que respondeu, com o PR fora da lista, é limpo (entrada órfã de verdade)');
});

// A preservação resolve a conta dona com accountForPr, que usa o campo `account` do
// PR (o myAuthoredPRs carimba a conta que buscou) e, se ele faltar, cai na org do
// repo. Este caso trava o fallback: PR guardado sem `account` continua sendo
// preservado pela conta certa, e não vira lixo silencioso na primeira falha dela.
test('PR preservado sem o campo account resolve a conta dona pela org do repo', async () => {
  const e = duasContas();
  e.autorais = { me: [], voce: [] };
  await e.check('test');
  e.myPRs = [{ key: PR_B.key, repo: PR_B.repo, number: 7, url: PR_B.url, title: PR_B.title, updatedAt: PR_B.updatedAt }];
  e.autorais = { me: [], voce: null };
  await e.check('test');
  assert.deepEqual(e.myPRs.map(p => p.key), [PR_B.key],
    'sem account no objeto, a org globex já diz que a conta dona é a que caiu');
});

test('falha da busca de TODAS as contas preserva myPRs inteiro (comportamento de sempre)', async () => {
  const e = duasContas();
  await e.check('test');
  e.selfAnalyses[PR.key] = { key: PR.key, approvable: true };
  e.autorais = { me: null, voce: null };
  await e.check('test');
  assert.deepEqual(e.myPRs.map(p => p.key).sort(), [PR.key, PR_B.key].sort(),
    'nenhuma conta respondeu: a lista do último ciclo bom fica de pé');
  assert.ok(e.selfAnalyses[PR.key], 'e nada de autoanálise é podado');
});

test('falha só das --review-requested preserva fila e "é meu", sem re-notificar', async () => {
  const e = checkEngine();
  // ciclo 1: tudo ok, o PR pedido a mim entra na fila e notifica UMA vez
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'notificou o PR novo uma vez');
  // ciclo 2: rate limit derruba só as buscas --review-requested
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1, 'fila preservada do último ciclo bom');
  assert.equal(e.panorama.find(p => p.key === PR.key).mine, true, 'o "é meu" não some do panorama');
  assert.equal(e.notices.length, 1, 'ciclo com falha não notifica');
  assert.equal(e.lastError, null, 'falha parcial não é erro fatal do ciclo');
  // ciclo 3: a busca volta; nada é "novo" de novo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'recuperação não re-notifica o que já estava na fila');
});

test('PR ignorado não ressuscita depois de um ciclo com busca falha', async () => {
  const e = checkEngine();
  // histórico local: já revisei este PR faz tempo (fora de qualquer carência)
  e.decisions.resolved.unshift({ key: PR.key, status: 'auto_approved', action: 'approve', resolvedAt: Date.now() - 60 * 60 * 1000 });
  e.seen.add(PR.key);
  // ciclo 1: re-request real detectado, volta pra fila
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), false, 're-request des-marca o visto');
  assert.ok(e.reReviewedKeys.has(PR.key));
  // usuário ignora (re-marca visto)
  e.seen.add(PR.key);
  // ciclo 2: a falha das buscas --review-requested não pode apagar o marcador
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.ok(e.reReviewedKeys.has(PR.key), 'marcador sobrevive à falha da busca');
  // ciclo 3: busca volta e o PR segue pedido; o ignorar fica valendo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), true, 'o ignorar do usuário fica valendo');
  assert.equal(e.queue.length, 0, 'não volta pra fila sozinho');
});

// gate de orçamento por perfil de chave de API dentro do toReview real do check()
// (não a expressão reimplementada em test/budget-gate.test.js): usa o checkEngine()
// desta suíte, que já monta um Engine real com todo colaborador de rede stubado.
test('check(): perfil apikey com orçamento estourado NÃO dispara auto-revisão', async () => {
  const e = checkEngine();
  const { localDay } = require('../lib/engine/usage');
  e.config.autoReview = true; // aqui, ao contrário do default da suíte, queremos que dispare
  e.tokens = { me: 'tok-me' };
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 1 }];
  e.config.claudeProfileId = 'p1';
  e.usage.byProfileDay = { [`p1|${localDay()}`]: { sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 } };
  const launchCalls = [];
  e.launchReview = (urls, mode) => { launchCalls.push({ urls, mode }); };
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1, 'o PR segue na fila (só o disparo automático é que pausa)');
  assert.equal(launchCalls.length, 0, 'orçamento estourado barra o launchReview automático');
});

test('check(): perfil apikey dentro do orçamento dispara auto-revisão normalmente', async () => {
  const e = checkEngine();
  e.config.autoReview = true;
  e.tokens = { me: 'tok-me' };
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 100 }];
  e.config.claudeProfileId = 'p1';
  const launchCalls = [];
  e.launchReview = (urls, mode) => { launchCalls.push({ urls, mode }); };
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(launchCalls.length, 1, 'sem estouro, o disparo automático roda normalmente');
  assert.deepEqual(launchCalls[0].urls, [PR.url], 'o PR elegível é o que entra no launchReview');
});

// retry pós-falha transitória (server.js chama this.retryTargets(...) e relança via
// this.launchReview): o MESMO caminho do incidente de 04/08/2026 (sessão falha,
// classificada como transitória, fica em retryAfterNet e é relançada sozinha todo
// ciclo). Tinha ZERO noção de orçamento antes desta correção.
test('check(): retry pós-transitório NÃO relança PR de conta com orçamento estourado', async () => {
  const e = checkEngine();
  const { localDay } = require('../lib/engine/usage');
  e.tokens = { me: 'tok-me' };
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 1 }];
  e.config.claudeProfileId = 'p1';
  e.usage.byProfileDay = { [`p1|${localDay()}`]: { sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 } };
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR } });
  const launchCalls = [];
  e.launchReview = (urls, mode) => { launchCalls.push({ urls, mode }); };
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  await e.check('test');
  assert.equal(launchCalls.length, 0, 'orçamento estourado barra o relançamento automático do retry');
});

// Desde a Task 2.3 (G9), o retry pós-rede relança o OBJETO guardado via
// enqueueHeadless (não mais launchReview por URL): preserva requested/knownHead
// do objeto guardado em vez de re-resolver pela URL (que os derrubava).
test('check(): retry pós-transitório relança normalmente quando o perfil está dentro do orçamento', async () => {
  const e = checkEngine();
  e.tokens = { me: 'tok-me' };
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 100 }];
  e.config.claudeProfileId = 'p1';
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR, requested: true, knownHead: 'c'.repeat(40) } });
  const enqueued = [];
  e.enqueueHeadless = (pr) => { enqueued.push(pr); };
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  await e.check('test');
  assert.equal(enqueued.length, 1, 'sem estouro, o retry relança como sempre relançou');
  assert.equal(enqueued[0].url, PR.url);
  assert.equal(enqueued[0].requested, true, 'G9: relança o objeto guardado, requested sobrevive');
  assert.equal(enqueued[0].knownHead, 'c'.repeat(40), 'G9: knownHead sobrevive ao relançamento');
});

// Achado CRITICAL da revisão da Task 2.3: trocar launchReview por enqueueHeadless
// no retry resolveu requested/knownHead, mas enqueueHeadless sozinho NÃO faz o que
// launchReview fazia (markSeen + sair da queue). A falha transitória original
// (runOneHeadless) tinha feito unsee(pr.key) + queue.push(pr) pra deixar o card
// visível "aguardando você" enquanto esperava o retry; sem desfazer isso no
// relançamento, o PR reaparece na "sua fila" com botão Revisar ativo ENQUANTO a
// revisão relançada já está rodando por trás, mentindo "aguardando você".
test('check(): PR relançado pelo retry sai da fila visível e volta a visto (card não mente "aguardando você") (G9)', async () => {
  const e = checkEngine();
  e.tokens = { me: 'tok-me' };
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 100 }];
  e.config.claudeProfileId = 'p1';
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR, requested: true, knownHead: 'c'.repeat(40) } });
  // estado deixado pela falha transitória original (runOneHeadless): unsee + queue.push,
  // e o gh volta a devolver o PR na busca --review-requested=@me (mesmo PR de sempre)
  e.seen = new Set();
  e.queue = [{ ...PR }];
  const enqueued = [];
  e.enqueueHeadless = (pr) => { enqueued.push(pr); };
  e.scenario = { panorama: [], mine: [{ ...PR }], reviewed: [] };
  await e.check('test');
  assert.equal(enqueued.length, 1, 'relançou o PR');
  assert.equal(e.queue.some(p => p.key === PR.key), false, 'sai da fila visível: o card não pode mostrar Revisar ativo com a revisão já rodando');
  assert.equal(e.seen.has(PR.key), true, 'volta a visto: mesmo efeito que o launchReview produzia no lançamento manual');
});

// budgetWarned (o toast "orçamento estourado"): deve disparar UMA vez ao estourar,
// ficar mudo em ciclos seguintes enquanto seguir estourado, e voltar a disparar depois
// de um ciclo em que o perfil não estava mais bloqueado (destravou e travou de novo).
// Cobre a correção do finding 4: sem a reconciliação no topo do check(), um perfil que
// destrava com a fila vazia (ou sem PR elegível) nunca sai do Set e o próximo estouro
// real fica silencioso.
test('budgetWarned: toast do orçamento não repete enquanto seguir estourado, mas volta após destravar e travar de novo', async () => {
  const e = checkEngine();
  const { localDay } = require('../lib/engine/usage');
  e.config.autoReview = true;
  e.tokens = { me: 'tok-me' };
  const profile = { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '', budgetDaily: 1 };
  e.config.claudeProfiles = [profile];
  e.config.claudeProfileId = 'p1';
  e.launchReview = () => {};
  const toasts = [];
  e.on('toast', ev => toasts.push(ev));

  // ciclo 1: estourado, dispara UM toast
  e.usage.byProfileDay = { [`p1|${localDay()}`]: { sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 } };
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(toasts.filter(t => t.kind === 'error').length, 1, 'primeiro estouro avisa uma vez');

  // ciclo 2: segue estourado, NÃO repete o toast
  await e.check('test');
  assert.equal(toasts.filter(t => t.kind === 'error').length, 1, 'estouro contínuo não repete o toast');

  // ciclo 3: perfil destrava (gasto zerado), fila vazia (nenhum PR pra "ver" a
  // reconciliação pelo caminho do toReview): a reconciliação do topo do check() tem
  // que tirar o id do Set mesmo assim
  e.usage.byProfileDay = {};
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  await e.check('test');
  assert.equal(toasts.filter(t => t.kind === 'error').length, 1, 'destravar não gera toast novo');

  // ciclo 4: trava de novo com o mesmo PR: o toast tem que voltar
  e.usage.byProfileDay = { [`p1|${localDay()}`]: { sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1 } };
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(toasts.filter(t => t.kind === 'error').length, 2, 'novo estouro depois de destravar avisa de novo');
});

// G16: o gate de orçamento (budgetBlockedFor) roda no ENFILEIRAMENTO (toReview,
// retryTargets). Num lote grande, o teto pode estourar ENTRE a fila e a vez deste
// PR chegar na boca da sessão. runOneHeadless precisa re-checar imediatamente
// antes de abrir a sessão: se estourou nesse meio tempo, estaciona (não descarta)
// em vez de gastar uma sessão que o gate já teria barrado no enfileiramento.
// G18: o mesmo PR pode chegar por duas contas (time com as duas, review pedido
// nos dois logins). Até aqui o dedup do mineMap mantinha sempre a PRIMEIRA
// versão vista, mesmo quando essa conta é incapaz de agir (silenciada ou sem
// token): o PR ficava mudo, preso numa identidade que nunca dispara aviso nem
// auto-revisão, enquanto a outra conta, capaz, era descartada. Agora a conta
// CAPAZ (não silenciada, com token) vence a incapaz no dedup; empate mantém a
// primeira, o comportamento de sempre.
test('G18: no mesmo PR achado por duas contas, a capaz vence a incapaz no dedup do mineMap', async () => {
  const e = checkEngine();
  e.config.accounts = [
    { user: 'muted-acc', owners: [], muted: true },
    { user: 'voce', owners: [] },
  ];
  e.tokens = { 'muted-acc': 'tok-muted', voce: 'tok-voce' };
  // as duas contas acham o MESMO PR (mesma key); cada uma carimba a própria
  // identidade em `account`, como a busca real faz (gh-queries.js).
  e.searchPRs = async (extraArgs, user) => {
    if (extraArgs[0] === '--review-requested=@me') return [{ ...PR, account: user }];
    return [];
  };
  await e.check('test');

  assert.equal(e.queue.length, 1, 'o PR entra na fila uma única vez (dedup por key)');
  assert.equal(e.accountForPr(e.queue[0]), 'voce',
    'accountForPr resolve pra conta CAPAZ (não silenciada); o PR não fica mudo preso na conta incapaz');
});

// G18 (empate): as duas contas são CAPAZES (nem silenciada, nem sem token). O
// critério só decide quando uma das duas está incapaz; em empate, o dedup
// mantém a PRIMEIRA vista, o comportamento de sempre (não fica reordenando à
// toa quando as duas contas podem agir de verdade).
test('G18: duas contas CAPAZES acham o mesmo PR, a primeira não é destronada (empate mantém a primeira)', async () => {
  const e = checkEngine();
  e.config.accounts = [
    { user: 'primeira', owners: [] },
    { user: 'segunda', owners: [] },
  ];
  e.tokens = { primeira: 'tok-primeira', segunda: 'tok-segunda' };
  e.searchPRs = async (extraArgs, user) => {
    if (extraArgs[0] === '--review-requested=@me') return [{ ...PR, account: user }];
    return [];
  };
  await e.check('test');

  assert.equal(e.queue.length, 1, 'o PR entra na fila uma única vez (dedup por key)');
  assert.equal(e.accountForPr(e.queue[0]), 'primeira',
    'as duas contas podem agir: o dedup mantém a primeira, sem trocar à toa');
});

// G18 (sem token): o outro jeito de ficar incapaz, sem depender de muted. Uma
// conta monitorada sem token pra ela (ver tokenFor) nunca consegue buscar nem
// postar por essa identidade; o mesmo critério de capacidade tem que pegar
// esse caso, não só o silenciado.
test('G18: primeira conta sem token perde pra segunda capaz no dedup do mineMap', async () => {
  const e = checkEngine();
  e.config.accounts = [
    { user: 'sem-token', owners: [] },
    { user: 'voce', owners: [] },
  ];
  e.tokens = { voce: 'tok-voce' }; // 'sem-token' fica de fora: tokenFor devolve null
  e.searchPRs = async (extraArgs, user) => {
    if (extraArgs[0] === '--review-requested=@me') return [{ ...PR, account: user }];
    return [];
  };
  await e.check('test');

  assert.equal(e.queue.length, 1, 'o PR entra na fila uma única vez (dedup por key)');
  assert.equal(e.accountForPr(e.queue[0]), 'voce',
    'accountForPr resolve pra conta CAPAZ (com token); sem token é incapaz mesmo não estando silenciada');
});

test('runOneHeadless re-checa o orçamento antes de abrir a sessão (G16)', async () => {
  const e = checkEngine();
  e.tokens = { me: 'tok-me' };
  e.prState = async () => 'OPEN'; // não é o caso do jaMergeado; segue pro gate de orçamento
  // No enfileiramento (toReview/retryTargets, fora deste teste) o gate ainda estava
  // livre, e foi assim que o PR chegou até aqui; agora, na boca da sessão, o teto já
  // estourou (o gasto aconteceu enquanto o PR esperava a vez na fila).
  e.budgetBlockedFor = () => ({ id: 'p1', label: 'P1' });
  e.runHeadlessReview = async () => { throw new Error('runHeadlessReview não deveria rodar: o orçamento já tinha estourado'); };
  e.headlessBusyAccounts.set('me', 1); // slot ocupado pelo escalonador antes de chamar runOneHeadless
  // estado deixado por uma falha transitória anterior: entrada viva em retryAfterNet
  // e o PR já marcado como visto (o mesmo estado que os 3 sites irmãos herdam do
  // catch quando chegam no ramo de estacionamento)
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR } });
  e.seen.add(PR.key);
  e.queue = [];

  const toasts = [];
  e.on('toast', ev => toasts.push(ev));

  await e.runOneHeadless({ ...PR }, 'me');

  assert.equal(e.autoReviewParked.has(PR.key), true, 'PR entra em autoReviewParked (estaciona, não descarta)');
  assert.equal(e.retryAfterNet.has(PR.key), false, 'C1: retryAfterNet é limpo, senão a entrada órfã desfaz o estacionamento quando o orçamento liberar');
  assert.equal(e.queue.some(p => p.key === PR.key), true, 'I1: o PR volta pra fila visível, como os outros 3 sites de estacionamento');
  assert.equal(e.seen.has(PR.key), false, 'I1: volta a não visto, o card não pode sumir da fila pra sempre');
  assert.equal(e.headlessBusyAccounts.has('me'), false, 'devolve o slot ao escalonador');
  assert.equal(toasts.filter(t => t.kind === 'info').length, 1, 'um único toast informativo');
});
