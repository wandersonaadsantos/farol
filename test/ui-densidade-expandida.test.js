// A Expandida do Radar (07/11/2026): os cards de sempre, agora com a faixa de três pílulas
// (Checks obrigatórios, Reviewers, Merge). A preferência é gravada antes de carregar o app,
// como a tela faz ao reabrir; a Compacta tem a trava própria em test/ui-densidade.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';
import { controlarQuadros } from './helpers/quadros-ui.js';
import { interpretarProntidao } from '../lib/engine/prontidao-pr-estado.js';

const { doc, emitir, listeners } = instalarDom();
globalThis.localStorage.setItem('farol-densidade', 'expandida');
const quadros = controlarQuadros();
await import('../ui/app.js');
for (let i = 0; i < 50 && !listeners.has('state'); i++) await new Promise(resolve => setTimeout(resolve, 1));
const $ = selector => doc.querySelector(selector);
const { switchRadarSub } = await import('../ui/telas/radar.js');

const HEAD = 'h1';
const no = (numero, extra = {}) => ({
  number: numero, isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED',
  baseRefName: 'develop', headRefName: 'feat/x', headRefOid: HEAD, author: { login: 'autora' }, repository: { nameWithOwner: 'acme/app' },
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'alice' } }] },
  latestReviews: { nodes: [{ author: { login: 'gabriel' }, state: 'APPROVED', commit: { oid: HEAD } }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] } } } }] },
  ...extra,
});
const REGRA = { legivel: true, temRegraDeReview: true, aprovacoes: 2, codeOwner: false, checks: ['build'] };
const reg = (n, extra) => interpretarProntidao(no(n, extra), { exigidos: REGRA.checks, regra: REGRA, eu: 'alice', at: 1 });

const pedido = { key: 'acme/app#1', repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', account: 'alice', title: 'Corrige o filtro', author: 'autora', mine: true, updatedAt: new Date().toISOString() };
const meu = { key: 'acme/app#2', repo: 'acme/app', number: 2, url: 'https://github.com/acme/app/pull/2', account: 'alice', title: 'Meu PR', author: 'alice', updatedAt: new Date().toISOString() };
const terceiro = { ...pedido, key: 'acme/app#3', number: 3, url: 'https://github.com/acme/app/pull/3', mine: false, title: 'De outra pessoa' };

function snapshot() {
  return { app: { platform: 'win32', version: 'fixture' }, status: 'idle', account: { user: 'alice', tokenOk: true },
    accounts: [{ user: 'alice', owners: ['acme'], tokenOk: true }],
    config: { accounts: [], intervalSeconds: 300, parallelReviews: 1, people: {}, claudeProfiles: [], defaultReviewers: {}, projectReviewers: {}, theme: 'dark' },
    lastCheckAt: Date.now(), queue: [pedido], panorama: [pedido, terceiro], myPRs: [meu], hiddenPRs: [],
    decisions: { pending: [], resolved: [{ key: 'acme/app#9', resolvedAt: Date.now(), status: 'auto_approved', action: 'approve', verdict: 'approve', pr: { title: 'x' } }] },
    activeSessions: [], activity: {}, selfAnalyses: {}, headlessWaiting: [], usage: {}, toolRuns: {}, chats: {},
    prontidao: { 'acme/app#1': reg(1), 'acme/app#2': reg(2, { mergeStateStatus: 'CLEAN', latestReviews: { nodes: [] }, reviewRequests: { nodes: [] } }), 'acme/app#3': reg(3, { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }) },
    paths: { home: '/fixture', workspace: '/fixture/workspace' } };
}
function receber(snap, sub = 'mim') { switchRadarSub(sub); emitir('state', snap); quadros.pintar(); }

test('a preferência gravada vale ao reabrir: Expandida', () => {
  receber(snapshot());
  assert.equal(doc.body.dataset.densidade, 'expandida');
});

test('Pra mim na Expandida: o card da fila de sempre, com a faixa de pílulas e sem a seta', () => {
  receber(snapshot());
  const html = $('#queue').innerHTML;
  assert.match(html, /class="card pr-card/);
  assert.equal((html.match(/class="pron-pill /g) || []).length, 3);
  assert.doesNotMatch(html, /pron-seta/, 'na Expandida não há linha para recolher');
  assert.match($('#resolved').innerHTML, /acme\/app#9/, 'Revisões recentes aberta');
});

test('Meus PRs na Expandida: o card de hoje com a faixa, e a barra pela pílula Merge sem autoanálise', () => {
  receber(snapshot(), 'meus');
  const html = $('#myPRs').innerHTML;
  assert.match(html, /class="card mypr-card pron-b-ok/);
  assert.match(html, /data-pron-pilula="checks"[\s\S]*data-pron-pilula="reviewers"[\s\S]*data-pron-pilula="merge"/);
  assert.match(html, /act-set-reviewers/, 'os botões do card continuam');
});

test('Panorama na Expandida: ramos, as três pílulas e o fim da linha de sempre', () => {
  receber(snapshot(), 'pano');
  const html = $('#panorama').innerHTML;
  assert.match(html, /<code>feat\/x<\/code>/);
  assert.match(html, /class="pron-faixa"/);
  assert.match(html, /pano-review|class="settled"/);
  assert.equal($('#panoLegenda').hidden, true, 'a legenda dos pontos é só da Compacta');
});
