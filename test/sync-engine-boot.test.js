// Boot da Engine com a sincronização LIGADA e um login já feito em disco: o estado em
// que o Farol abre todo dia depois do primeiro uso. test/sync-engine.test.js cobre o
// recurso sendo configurado; este arquivo existe à parte porque o cenário exige o
// config.json e a credencial gravados ANTES do construtor, num FAROL_HOME que nunca
// viu a identidade do aparelho.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-boot-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');

const DEVICE_FILE = path.join(FAROL_HOME, 'workspace', 'state', SYNC.DEVICE_FILE);

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function gravarJson(arquivo, dados) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
}

// sync ligado, completo e com a coordenação ativa; a URL é de produção de propósito:
// qualquer tentativa de conexão no boot sairia da máquina, e o espião de fetch reprova
gravarJson(path.join(FAROL_HOME, 'config.json'), {
  autoReview: false,
  sync: {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: 'chave-web-de-teste', databaseUrl: 'https://farol-teste-default-rtdb.firebaseio.com', projectId: 'farol-teste',
  },
});
gravarJson(path.join(FAROL_HOME, SYNC.CREDENTIALS_FILE), { uid: 'u1', email: 'a@b.com', refreshToken: 'rt-do-disco', savedAt: 1 });

function proximaVolta() { return new Promise((resolve) => setImmediate(resolve)); }

// O contrato promete que o construtor NUNCA toca rede: quem conecta é o primeiro tick.
// O espião entra ANTES do new Engine() de propósito, porque é no boot (e em qualquer
// trabalho agendado por ele) que uma conexão escondida apareceria.
test('boot com sync ligado e login em disco não toca a rede nem cria a identidade do aparelho', async () => {
  const fetchReal = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url) => { chamadas.push(String(url)); throw new TypeError('fetch failed'); };
  try {
    const engine = new Engine();
    await proximaVolta();
    await proximaVolta();
    assert.equal(chamadas.length, 0, 'nenhuma chamada de rede no boot');
    assert.equal(engine.sync.status, 'conectando');
    assert.equal(fs.existsSync(DEVICE_FILE), false, 'sync-device.json nasce na primeira conexão, não no boot');
  } finally {
    globalThis.fetch = fetchReal;
  }
});

test('boot conectando: segura a automação sem toast de login que não falta', () => {
  const engine = new Engine();
  const toasts = [];
  engine.on('toast', (t) => toasts.push(t));
  assert.equal(engine.sync.status, 'conectando');
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), true, 'fail-closed enquanto a primeira conexão não acontece');
  assert.equal(toasts.some((t) => /nenhum login/.test(t.text)), false, 'o aparelho TEM login: o aviso não pode dizer que falta');
  assert.equal(toasts.length, 0, 'conectando é passagem de um ciclo, não indisponibilidade');
});

// A presença e a reconexão só acontecem porque o check() chama o syncTick a cada ciclo.
// Os outros testes chamam a fachada direto; este prova a FIAÇÃO, com todo colaborador de
// rede do ciclo stubado (mesmo molde de test/check-resilience.test.js) e o syncTick
// trocado por um espião que só registra a ordem.
test('check() chama o syncTick uma vez por ciclo, depois do refreshMergeStates', async () => {
  const { BASELINE_FILE, STATE_DIR } = await import('../lib/paths.js');
  const e = new Engine();
  const ordem = [];
  Object.assign(e, {
    seen: new Set(), reReviewedKeys: new Set(), decisions: { pending: [], resolved: [] }, queue: [],
    resolveAccount: async () => {}, refreshTokens: async () => { e.tokenOk = true; return true; },
    searchPRs: async () => [], myAuthoredPRs: async () => [], enrichMyPRBranches: async () => {},
    refreshStaleStates: async () => {}, refreshReviewSignals: async () => {}, scanPushbacks: async () => {},
    checkUpdate: async () => {}, refreshContributors: async () => {}, schedule: () => {}, saveSeen: () => {},
  });
  e.config.accounts = [{ user: 'me', owners: ['acme'] }];
  e.refreshMergeStates = async () => { ordem.push('merge'); };
  e.syncTick = async () => { ordem.push('sync'); return { ok: true }; };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  await e.check('test');
  assert.deepEqual(ordem, ['merge', 'sync']);
});
