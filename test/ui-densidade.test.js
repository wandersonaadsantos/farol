// A Compacta é a densidade padrão do Radar (07/11/2026): Pra mim, Meus PRs e Panorama viram
// uma linha por PR com a forma curta da prontidão, e o card cheio só abre pela seta. Este
// teste carrega o app de verdade no DOM de mentira com um estado plausível e confere o que
// cada lista desenhou. A Expandida (os cards de sempre) é o que as travas antigas da fila e
// das decisões leem, com a preferência gravada antes de carregar o app.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';
import { controlarQuadros } from './helpers/quadros-ui.js';
import { interpretarProntidao } from '../lib/engine/prontidao-pr-estado.js';

const { doc, emitir, listeners } = instalarDom();
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

test('a Compacta é a padrão e marca o corpo da página', () => {
  receber(snapshot());
  assert.equal(doc.body.dataset.densidade, 'compacta');
});

test('Pra mim na Compacta: a fila vira linha com a frase, o trio da prontidão e o Revisar', () => {
  receber(snapshot());
  const html = $('#queue').innerHTML;
  assert.match(html, /class="pr-linha fila-linha/);
  assert.match(html, /1º na fila/);
  assert.match(html, /class="pron-trio"/);
  assert.match(html, /gabriel aprovou, falta você/, 'reviewers incluem você');
  assert.match(html, /class="btn primary sm act-review"/);
  assert.match(html, /data-linha="acme\/app#1"/, 'a seta abre o card cheio só deste PR');
  assert.doesNotMatch(html, /class="card pr-card/);
});

test('Pra mim: o resumo do topo leva às seções, e Revisões recentes vira uma linha', () => {
  receber(snapshot());
  assert.match($('#praMimResumo').innerHTML, /1 na fila/);
  assert.match($('#praMimResumo').innerHTML, /1 resolvida hoje/);
  assert.equal($('#praMimResumo').hidden, false);
  assert.match($('#resolved').innerHTML, /data-recentes-alternar/);
  assert.match($('#resolved').innerHTML, /1 resolvida hoje · mostrar/);
});

test('Meus PRs na Compacta: linha com o trio, o resumo do topo e o Merge só pela regra atual', () => {
  receber(snapshot(), 'meus');
  const html = $('#myPRs').innerHTML;
  assert.match(html, /class="pr-linha mypr-linha/);
  assert.match(html, /Pronto/);
  assert.match(html, /pron-b-ok/, 'sem autoanálise, a barra segue a pílula Merge');
  assert.doesNotMatch(html, /act-self-merge/, 'sem autoanálise elegível o Merge não aparece, mesmo com o merge pronto no GitHub');
  assert.match($('#myPRsResumo').innerHTML, /1 pronto pra merge/);
});

test('Panorama na Compacta: três pontos com o texto completo, legenda acima e a busca intacta', () => {
  receber(snapshot(), 'pano');
  const html = $('#panorama').innerHTML;
  assert.match(html, /class="pron-pontos" role="img" aria-label="Checks obrigatórios: 1 de 1 verdes/);
  assert.match(html, /Merge: Conflito com a base/);
  assert.match(html, /class="prow /, 'continua lista de linhas do Panorama');
  assert.match($('#panoLegenda').innerHTML, /checks obrigatórios/);
});

test('sem prontidão carregada: estado neutro discreto, nunca erro', () => {
  const snap = snapshot();
  delete snap.prontidao;
  receber(snap);
  assert.match($('#queue').innerHTML, /pron-trio vazia/);
  receber(snap, 'pano');
  assert.match($('#panorama').innerHTML, /ainda não lidos/);
});

test('o seletor de densidade fica ao lado das sub-abas, e a preferência é local e protegida', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
  assert.match(index, /<div class="radar-topo">\s*<div class="radar-subs" id="radarSubs"/);
  assert.match(index, /id="densidade" role="group" aria-label="Densidade da lista"/);
  assert.match(index, /data-densidade="compacta" aria-pressed="true"/);
  assert.match(index, /data-densidade="expandida" aria-pressed="false"/);
  const tela = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'telas', 'densidade.js'), 'utf8');
  assert.match(tela, /try \{ DENSIDADE = densidadeValida\(localStorage\.getItem\(CHAVE\)\); \} catch/);
  assert.match(tela, /try \{ localStorage\.setItem\(CHAVE, DENSIDADE\); \} catch/);
});
