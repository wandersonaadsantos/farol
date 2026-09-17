// A festa da análise impecável ligada à tela de verdade: o snapshot do SSE chega pelo
// ui/app.js, a aba Meus PRs pinta, e a festa acontece UMA vez por análise.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

const { emitir } = instalarDom();
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

await import('../ui/app.js');

const PR = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', repo: 'acme/app', number: 7, title: 'Ajusta o rodapé', author: 'alice', updatedAt: new Date().toISOString() };

function analise(extra = {}) {
  return { at: 1000, verdict: 'approvable', approvable: true, blockers: [], externalBlockers: [], tips: [], summary: 'tudo certo', ...extra };
}

function estado(selfAnalyses) {
  return {
    app: { name: 'Farol', version: '2.60.0', platform: 'win32' },
    status: 'ocioso', account: { user: 'alice', tokenOk: true },
    accounts: [{ user: 'alice', owners: ['acme'] }],
    config: { ghUser: 'alice', owners: ['acme'], accounts: [{ user: 'alice', owners: ['acme'] }], intervalSeconds: 300, sync: {}, people: {}, defaultReviewers: {}, projectReviewers: {}, claudeProfiles: [] },
    lastCheckAt: Date.now(), nextCheckAt: Date.now() + 60000,
    queue: [], panorama: [], myPRs: [PR], hiddenPRs: [], selfAnalyses, decisions: { pending: [], resolved: [] },
    activeSessions: [], headlessWaiting: [], chats: {}, reviewActions: {}, staleStates: {},
    usage: {}, usageSessions: [], toolRuns: {}, pushbacks: {}, team: [], highlights: [], update: { state: 'idle' },
    paths: { home: '/tmp/.farol', workspace: '/tmp/.farol/workspace' },
    sync: { enabled: false, devices: [] },
  };
}

const festas = () => document.body.children.filter((c) => c.className === 'confete').length;

test('análise impecável festeja uma vez, e repintar a tela não repete', () => {
  const antes = festas();
  emitir('state', estado({ [PR.key]: analise() }));
  assert.equal(festas(), antes + 1, 'a festa aconteceu');
  emitir('state', estado({ [PR.key]: analise() }));
  assert.equal(festas(), antes + 1, 'o mesmo snapshot não festeja de novo');
});

test('análise com dica não festeja', () => {
  const antes = festas();
  emitir('state', estado({ 'acme/app#8': analise({ at: 2000, tips: ['dá pra simplificar'] }) }));
  assert.equal(festas(), antes);
});

test('análise nova do mesmo PR festeja de novo', () => {
  const antes = festas();
  emitir('state', estado({ [PR.key]: analise({ at: 5000 }) }));
  assert.equal(festas(), antes + 1);
});
