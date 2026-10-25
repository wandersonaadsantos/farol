import test from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';
import { controlarQuadros } from './helpers/quadros-ui.js';

const { doc, emitir, listeners } = instalarDom();
const quadros = controlarQuadros();
const pedidos = [];
globalThis.fetch = async (url, init = {}) => {
  pedidos.push({ url, body: init.body && JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => null, text: async () => '' };
};
await import('../ui/app.js');
const { attentionCount } = await import('../ui/telas/contas.js');
for (let i = 0; i < 50 && !listeners.has('state'); i++) await new Promise(resolve => setTimeout(resolve, 1));
const $ = selector => doc.querySelector(selector);
const pr = { key: 'acme/app#427', repo: 'acme/app', url: 'https://github.com/acme/app/pull/427',
  account: 'alice', title: 'Corrige relatório', author: 'autor', mine: true, updatedAt: new Date().toISOString() };
const outro = { ...pr, key: 'acme/app#428', url: 'https://github.com/acme/app/pull/428' };
function snapshot() {
  return { app: { platform: 'win32', version: 'fixture' }, status: 'idle',
    account: { user: 'alice', tokenOk: true },
    accounts: [{ user: 'alice', owners: ['acme'] }, { user: 'bob', owners: [] }],
    config: { accounts: [], intervalSeconds: 300, parallelReviews: 1, people: {}, claudeProfiles: [],
      defaultReviewers: {}, projectReviewers: {}, theme: 'dark' },
    lastCheckAt: Date.now(), queue: [pr, outro], panorama: [pr, outro], myPRs: [], hiddenPRs: [],
    decisions: { pending: [], resolved: [] }, activeSessions: [], activity: {}, selfAnalyses: {},
    headlessWaiting: [], usage: {}, toolRuns: {}, chats: {}, paths: { home: '/fixture', workspace: '/fixture/workspace' } };
}
function receber(snap) { emitir('state', snap); quadros.pintar(); }
function sessao(item = pr) { return { id: 'review-ativa', mode: 'auto', keys: [item.key], pr: item, startedAt: Date.now() }; }

test('PR em revisão sai do card acionável, dos contadores e do Revisar tudo, sem apagar a fila do motor', () => {
  const snap = snapshot();
  receber(snap);
  assert.equal($('#queueCount').textContent, '2');
  assert.equal($('#btnReviewAll').hidden, false);
  snap.activeSessions = [sessao()];
  snap.headlessWaiting = [pr.key];
  snap.headlessDistributing = [pr.key];
  receber(snap);
  assert.equal($('#activeCount').textContent, '1');
  assert.equal($('#activeWaiting').textContent, '', 'a legenda da espera também não repete a sessão ativa');
  assert.doesNotMatch($('#queue').innerHTML, /acme\/app#427/);
  assert.match($('#queue').innerHTML, /acme\/app#428/);
  assert.equal($('#queueCount').textContent, '1');
  assert.equal($('#rcMim').textContent, '1');
  assert.equal($('#btnReviewAll').hidden, true);
  assert.equal(attentionCount('alice'), 1);
  assert.deepEqual(snap.queue, [pr, outro]);

  snap.activeSessions = [];
  receber(snap);
  assert.match($('#queue').innerHTML, /acme\/app#427/);
  assert.equal($('#queueCount').textContent, '2', 'sem sessão e sem decisão, o pedido volta à fila');
});

test('revisão da mesma chave por outra conta não oculta o pedido legítimo dessa conta', () => {
  const snap = snapshot();
  snap.queue = [pr, { ...pr, account: 'bob' }];
  snap.panorama = snap.queue;
  snap.activeSessions = [sessao({ ...pr, account: 'ALICE' })];
  receber(snap);
  assert.equal($('#queueCount').textContent, '1');
  assert.equal($('#rcMim').textContent, '1');
  assert.equal(attentionCount('alice'), 0);
  assert.equal(attentionCount('bob'), 1);
  assert.match($('#queue').innerHTML, /bob/);
  assert.doesNotMatch($('#queue').innerHTML, /acct-chip">alice/);
});

test('sessão com chave e identidade herdada do repositório também retira apenas sua revisão da fila', () => {
  const snap = snapshot();
  snap.activeSessions = [{ id: 'legada', mode: 'auto', keys: [pr.key], startedAt: Date.now() }];
  receber(snap);
  assert.doesNotMatch($('#queue').innerHTML, /acme\/app#427/);
  assert.equal($('#queueCount').textContent, '1');
});

test('Revisar tudo envia somente os pedidos que continuam na fila, sem reenfileirar a sessão ativa', () => {
  const snap = snapshot();
  const terceiro = { ...pr, key: 'acme/app#429', url: 'https://github.com/acme/app/pull/429' };
  snap.queue.push(terceiro);
  snap.activeSessions = [sessao()];
  receber(snap);
  assert.equal($('#btnReviewAll').hidden, false);
  const antes = pedidos.length;
  $('#btnReviewAll').onclick();
  const enviados = pedidos.slice(antes).filter(p => p.url === '/api/review');
  assert.deepEqual(enviados.map(p => p.body.urls), [[outro.url, terceiro.url]]);
});

test('somente pedidos em espera não abrem a seção Analisando agora', () => {
  const snap = snapshot();
  snap.queue = [];
  snap.headlessWaiting = [pr.key, outro.key];
  snap.headlessWaitingContas = { [pr.key]: 'alice', [outro.key]: 'alice' };
  receber(snap);
  assert.equal($('#queueCount').textContent, '2');
  assert.equal($('#activeWrap').hidden, true);
  assert.match($('#queue').innerHTML, /Na fila de execução/);
  assert.doesNotMatch($('#queue').innerHTML, /act-review/);
});

test('decisões e histórico deixam de oferecer nova revisão do mesmo PR e conta enquanto ativo', () => {
  const snap = snapshot();
  const d = { id: 'd1', key: pr.key, pr, verdict: 'approve', blockedKind: 'stale_head', reasons: [], reportMarkdown: 'Relatório preservado', status: 'posted', action: 'approve' };
  snap.decisions = { pending: [d], resolved: [d] };
  receber(snap);
  assert.match($('#decisions').innerHTML, /Revisar agora/);
  snap.activeSessions = [sessao()];
  receber(snap);
  assert.doesNotMatch($('#decisions').innerHTML, /Revisar agora/);
  assert.match($('#resolved').innerHTML, /disabled title="Revisão em andamento"/);
  assert.match($('#resolved').innerHTML, /Relatório preservado/);
  snap.activeSessions = [sessao({ ...pr, account: 'bob' })];
  receber(snap);
  assert.match($('#decisions').innerHTML, /Revisar agora/);
  assert.doesNotMatch($('#resolved').innerHTML, /disabled title="Revisão em andamento"/);
});

test('recuperação mostra agenda, executor e execução conforme o snapshot real', () => {
  const snap = snapshot();
  snap.decisions.pending = [{ id: 'rec', key: pr.key, pr, verdict: 'approve', reasons: [], esperaProva: { tentativas: 0 } }];
  receber(snap);
  assert.match($('#esperaCi').innerHTML, /Recuperação agendada/);
  assert.doesNotMatch($('#esperaCi').innerHTML, /Concluindo a análise/);
  snap.headlessWaiting = [pr.key];
  receber(snap);
  assert.match($('#esperaCi').innerHTML, /Aguardando executor/);
  snap.activeSessions = [sessao()];
  receber(snap);
  assert.match($('#esperaCi').innerHTML, /Concluindo a análise/);
});
