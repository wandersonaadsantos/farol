'use strict';
// Ocultar um PR de "Meus PRs" (state/hidden-prs.json): guardar e remover a chave,
// sobreviver ao reinício, e o RETORNO AUTOMÁTICO, que é o que torna a feature honesta
// (ocultar não é ignorar a realidade pra sempre: atividade nova traz o PR de volta).
//
// A parte sutil que este arquivo trava é a limpeza de chave órfã: ela só pode acontecer
// quando a busca de PRs meus FUNCIONOU no ciclo. Se limpasse também no ciclo com busca
// falha, uma queda de rede (myPRs vazio ou congelado) desocultaria tudo de uma vez.
// Runner nativo (node --test), ZERO dependências.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-hidden-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');
const { STATE_DIR, BASELINE_FILE, HIDDEN_FILE } = require('../lib/paths');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = {
  key: 'acme/app#12', repo: 'acme/app', number: 12,
  url: 'https://github.com/acme/app/pull/12', title: 'experimento de 2 anos atrás',
  author: 'eu', updatedAt: '2024-08-01T10:00:00Z', account: 'eu'
};

// Engine com o arquivo de ocultos no estado que o teste pedir (undefined = nenhum).
// O FAROL_HOME é o mesmo pra todos, então cada teste parte de um estado explícito.
function novoEngine(estadoInicial) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (estadoInicial === undefined) { try { fs.rmSync(HIDDEN_FILE, { force: true }); } catch { /* ok */ } }
  else fs.writeFileSync(HIDDEN_FILE, JSON.stringify(estadoInicial));
  const e = new Engine();
  e.pushState = () => { };
  e.log = () => { };
  e.on('toast', () => { });
  return e;
}

// Mesmo espírito do checkEngine() do check-resilience.test.js: todo colaborador de
// rede/side-effect do check() stubado. `e.autorais` é o roteiro do myAuthoredPRs
// no ciclo corrente; null = a busca falhou (em todas as contas).
function checkEngine(estadoInicial) {
  const e = novoEngine(estadoInicial);
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.autoReview = false;
  e.seen = new Set();
  e.queue = [];
  e.decisions = { pending: [], resolved: [] };
  e.resolveAccount = async () => { };
  e.refreshTokens = async () => { e.tokenOk = true; return true; };
  e.searchPRs = async () => [];
  e.enrichMyPRBranches = async () => { };
  e.refreshMergeStates = async () => { };
  e.refreshStaleStates = async () => { };
  e.scanPushbacks = async () => { };
  e.checkUpdate = async () => { };
  e.schedule = () => { };
  e.saveSeen = () => { };
  e.launchReview = () => { throw new Error('nenhuma revisão deveria rodar neste teste'); };
  e.autorais = [];
  e.myAuthoredPRs = async () => (e.autorais === null ? null : e.autorais.map(p => ({ ...p })));
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  return e;
}

/* ---------- 1. guardar e remover ---------- */

test('hidePR guarda a chave com o updatedAt do PR que está em myPRs; unhidePR remove', () => {
  const e = novoEngine();
  e.myPRs = [{ ...PR }];
  assert.deepEqual(e.hiddenPRs, {}, 'começa sem nada oculto');

  assert.deepEqual(e.hidePR(PR.key), { ok: true });
  const entrada = e.hiddenPRs[PR.key];
  assert.ok(entrada, 'a chave entrou no mapa de ocultos');
  assert.equal(entrada.updatedAt, PR.updatedAt, 'guarda o updatedAt do instante em que ocultou');
  assert.ok(!Number.isNaN(Date.parse(entrada.at)), 'carimba quando foi ocultado (ISO)');

  assert.deepEqual(e.unhidePR(PR.key), { ok: true });
  assert.equal(e.hiddenPRs[PR.key], undefined, 'mostrar de novo tira a entrada');
});

test('hidePR de PR fora de myPRs guarda updatedAt null; chave vazia é recusada', () => {
  const e = novoEngine();
  e.myPRs = [];
  assert.deepEqual(e.hidePR('acme/app#99'), { ok: true });
  assert.equal(e.hiddenPRs['acme/app#99'].updatedAt, null,
    'sem o PR na lista não há base de comparação: guarda null em vez de inventar');
  const r = e.hidePR('');
  assert.equal(r.ok, false, 'chave vazia não vira entrada');
  assert.ok(r.error, 'e devolve o motivo');
});

/* ---------- 2. persistência entre boots ---------- */

test('o oculto sobrevive ao reinício: outra Engine no mesmo FAROL_HOME continua com a chave', () => {
  const e = novoEngine();
  e.myPRs = [{ ...PR }];
  e.hidePR(PR.key);
  const outra = new Engine();  // some com a Engine, sobe outra no mesmo FAROL_HOME
  assert.ok(outra.hiddenPRs[PR.key], 'a chave oculta continua lá depois do reinício');
  assert.equal(outra.hiddenPRs[PR.key].updatedAt, PR.updatedAt, 'com o updatedAt guardado, senão o retorno automático nasce cego');
});

test('arquivo de ocultos corrompido não derruba o boot (cai no padrão vazio)', () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(HIDDEN_FILE, '{ isso não é json');
  const e = new Engine();
  assert.deepEqual(e.hiddenPRs, {}, 'mesmo tratamento tolerante do resto do estado');
});

/* ---------- 3 e 4. retorno automático no check() ---------- */

test('PR oculto que reaparece com updatedAt DIFERENTE deixa de estar oculto (atividade nova traz de volta)', async () => {
  const e = checkEngine();
  e.autorais = [PR];
  await e.check('test');
  e.hidePR(PR.key);
  assert.ok(e.hiddenPRs[PR.key], 'ocultei');

  e.autorais = [{ ...PR, updatedAt: '2026-08-09T09:00:00Z' }]; // alguém comentou/deu push
  await e.check('test');
  assert.equal(e.hiddenPRs[PR.key], undefined, 'atividade nova desoculta sozinho, sem clique nenhum');
});

test('PR oculto que reaparece com o MESMO updatedAt continua oculto (o caso normal, todo ciclo)', async () => {
  const e = checkEngine();
  e.autorais = [PR];
  await e.check('test');
  e.hidePR(PR.key);
  for (let i = 0; i < 3; i++) await e.check('test');
  assert.ok(e.hiddenPRs[PR.key], 'sem atividade nova, segue oculto ciclo após ciclo');
  assert.equal(e.hiddenPRs[PR.key].updatedAt, PR.updatedAt, 'a base de comparação não é reescrita a cada ciclo');
});

test('entrada guardada com updatedAt null nunca volta sozinha (não havia base de comparação)', async () => {
  const e = checkEngine({ [PR.key]: { at: '2026-08-09T17:30:00.000Z', updatedAt: null } });
  e.autorais = [{ ...PR, updatedAt: '2026-08-09T09:00:00Z' }];
  await e.check('test');
  assert.ok(e.hiddenPRs[PR.key], 'sem updatedAt guardado, qualquer valor atual pareceria "diferente"');
});

/* ---------- 5. limpeza de chave órfã, e a proteção contra a queda de rede ---------- */

test('chave órfã é limpa quando a busca funcionou e o PR sumiu da lista (fechou/mergeou)', async () => {
  const e = checkEngine();
  e.autorais = [PR];
  await e.check('test');
  e.hidePR(PR.key);
  e.autorais = [];             // busca OK, e o PR não está mais entre os meus abertos
  await e.check('test');
  assert.equal(e.hiddenPRs[PR.key], undefined, 'entrada de PR fechado não fica de lixo pra sempre');
});

test('chave órfã NÃO é limpa quando a busca de PRs falhou (queda de rede não desoculta tudo)', async () => {
  // cenário real e adversarial: boot com ocultos vindos do disco (myPRs ainda vazio)
  // e o primeiro ciclo pegando as buscas caídas
  const e = checkEngine({ [PR.key]: { at: '2026-08-09T17:30:00.000Z', updatedAt: PR.updatedAt } });
  assert.ok(e.hiddenPRs[PR.key], 'o oculto veio do disco');
  e.autorais = null;           // todas as buscas de PRs meus falharam neste ciclo
  await e.check('test');
  assert.ok(e.hiddenPRs[PR.key], 'busca falha não é prova de que o PR fechou; desocultar tudo aqui seria o pior momento');

  e.autorais = [];             // a busca volta e confirma: o PR não está mais aberto
  await e.check('test');
  assert.equal(e.hiddenPRs[PR.key], undefined, 'com a lista confirmada, aí sim a entrada órfã sai');
});

/* ---------- 7. snapshot ---------- */

test('snapshot().hiddenPRs traz as chaves, e myPRs continua completo (quem esconde é a UI)', () => {
  const e = novoEngine();
  e.myPRs = [{ ...PR }];
  e.hidePR(PR.key);
  const snap = e.snapshot();
  assert.deepEqual(snap.hiddenPRs, [PR.key], 'array de chaves, não o mapa inteiro');
  assert.equal(snap.myPRs.length, 1,
    'a lista continua completa: a UI também precisa oferecer "mostrar os ocultos"');
});
