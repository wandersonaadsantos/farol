import test from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';
const { doc, emitir, listeners, irPara } = instalarDom();
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => null, text: async () => '' });
const frames = [], eventos = new Map(), janela = new Map();
globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
doc.addEventListener = (nome, fn) => { eventos.set(nome, [...(eventos.get(nome) || []), fn]); };
globalThis.addEventListener = (nome, fn) => { janela.set(nome, [...(janela.get(nome) || []), fn]); };
const disparar = (mapa, nome) => { for (const fn of mapa.get(nome) || []) fn({ target: { closest: () => null } }); };
const flush = () => { while (frames.length) frames.shift()(); };
const escritas = {};
for (const seletor of ['#resolved', '#reviewersEditor', '#queue', '#myPRs']) {
  const el = doc.querySelector(seletor);
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: novo => { html = String(novo); escritas[seletor] = (escritas[seletor] || 0) + 1; } });
}
await import('../ui/app.js');
const { estado } = await import('../ui/telas/estado.js');
for (let i = 0; i < 50 && !listeners.has('state'); i++) await new Promise(resolve => setTimeout(resolve, 1));
const config = { intervalSeconds: 300, parallelReviews: 1, theme: 'dark', accounts: [], people: {},
  mergeBlockedRepos: [], defaultReviewers: {}, projectReviewers: {}, claudeProfiles: [], claudeProfileId: '', teamHighlights: false, deliveriesEnabled: false };
const fixture = { app: { name: 'Farol', version: 'fixture', platform: 'win32' }, status: 'idle',
  account: { user: 'alice', tokenOk: true }, accounts: [{ user: 'alice', owners: ['acme'] }], config,
  queue: [], panorama: [], myPRs: [], hiddenPRs: [], activeSessions: [], activity: {}, headlessWaiting: [],
  decisions: { pending: [], resolved: [] }, selfAnalyses: {}, reviewActions: {}, usage: {}, chats: {},
  paths: { home: '/fixture', workspace: '/fixture/workspace' }, update: {}, toolRuns: {} };
emitir('state', fixture); flush();

test('SSE aplica cada patch imediatamente mas uma rajada só pinta dependências uma vez', () => {
  const antes = { ...escritas };
  for (let n = 1; n <= 40; n++) {
    emitir('state-patch', { campos: { usage: { marcador: n } }, removidos: [] });
    assert.equal(estado().usage.marcador, n);
  }
  assert.equal(frames.length, 1);
  assert.equal(escritas['#queue'], antes['#queue']);
  flush();
  assert.equal(escritas['#queue'], antes['#queue'] + 1);
  assert.equal(escritas['#resolved'], antes['#resolved']);
  assert.equal(escritas['#reviewersEditor'], antes['#reviewersEditor']);
});

test('configuração de aba oculta só é projetada quando a navegação a mostra', () => {
  const antes = escritas['#reviewersEditor'] || 0;
  emitir('state-patch', { campos: { config: { ...config, intervalSeconds: 600 } }, removidos: [] });
  flush();
  assert.equal(escritas['#reviewersEditor'] || 0, antes);
  irPara('/sistema/automacao'); disparar(janela, 'popstate'); flush();
  assert.equal(doc.querySelector('#setInterval').value, '600');
  assert.ok(escritas['#reviewersEditor'] > antes);
  const depois = escritas['#reviewersEditor'];
  doc.querySelector('#setInterval').value = 'rascunho';
  emitir('state-patch', { campos: { usage: { marcador: 99 } }, removidos: [] }); flush();
  assert.equal(escritas['#reviewersEditor'], depois);
  assert.equal(doc.querySelector('#setInterval').value, 'rascunho');
});

test('ocultar suspende pintura e voltar recompõe a contagem pelo horário atual', () => {
  const pill = doc.querySelector('#statusPill');
  const antes = pill.textContent;
  doc.hidden = true;
  emitir('state-patch', { campos: { status: 'checking', nextCheckAt: Date.now() - 1000 }, removidos: [] }); flush();
  assert.equal(estado().status, 'checking');
  assert.equal(pill.textContent, antes);
  emitir('state-patch', { campos: { status: 'idle' }, removidos: [] });
  doc.hidden = false; disparar(eventos, 'visibilitychange'); flush();
  assert.equal(pill.textContent, 'monitorando');
  assert.match(doc.querySelector('#metaCheck').textContent, /próxima em 0:00/);
});

test('atividade recebida no SSE não cresce sem limite entre snapshots e é coalescida', () => {
  irPara('/radar/pra-mim'); disparar(janela, 'popstate'); flush();
  emitir('state-patch', { campos: { activeSessions: [{ id: 'ativa', mode: 'auto', startedAt: 1000 }], activity: {} }, removidos: [] }); flush();
  for (let i = 0; i < 2000; i++) emitir('activity', { id: 'ativa', item: { t: 1000 + i, s: 'leitura', k: 'info', text: `linha ${i}` } });
  assert.equal(estado().activity.ativa.length, 300);
  assert.equal(estado().activeSessions[0].ultimoSinalEm, 2999);
  assert.equal(frames.length, 1);
  flush();
  assert.equal(estado().activity.ativa.at(-1).text, 'linha 1999');
});

test('alerta de PR abre e prepara a subaba ainda não pintada antes de localizar o card', () => {
  const url = 'https://github.com/acme/repo/pull/7';
  emitir('state-patch', { campos: { myPRs: [{ key: 'acme/repo#7', url, title: 'Meu PR recém-chegado', repo: 'acme/repo', author: 'alice' }] }, removidos: [] });
  assert.equal(document.body.dataset.radarSub || 'mim', 'mim');
  emitir('focus-pr', { url });
  assert.equal(document.body.dataset.radarSub, 'meus');
  assert.match(doc.querySelector('#myPRs').innerHTML, /Meu PR recém-chegado/);
});
