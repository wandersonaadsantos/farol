import test from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

const { doc, emitir, listeners, irPara } = instalarDom();
navigator.userAgent = 'Farol Electron/44.1.0';
const consultas = new Set();
const respostas = new Map([
  ['/api/auth/status', { exigida: false }],
  ['/api/log', []],
  ['/api/log/triage', []],
  ['/api/diagnostics', { ok: true, markdown: 'Diagnóstico sintético', falhas: [] }],
  ['/api/reviewer-candidates', {}],
]);
globalThis.fetch = async url => {
  assert.ok(respostas.has(url), `Rota HTTP não prevista na fixture: ${url}`);
  consultas.add(url);
  return { ok: true, status: 200, json: async () => respostas.get(url) };
};
const frames = [], janela = new Map();
globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
globalThis.addEventListener = (nome, fn) => janela.set(nome, [...(janela.get(nome) || []), fn]);
const flush = () => { while (frames.length) frames.shift()(); };
let configuracoes = 0;
const editor = doc.querySelector('#reviewersEditor');
Object.defineProperty(editor, 'innerHTML', { get: () => '', set: () => { configuracoes++; } });
await import('../ui/app.js');
for (let i = 0; i < 50 && !listeners.has('state'); i++) await new Promise(resolve => setTimeout(resolve, 1));
const config = { intervalSeconds: 300, parallelReviews: 1, theme: 'dark', people: {}, accounts: [],
  mergeBlockedRepos: [], defaultReviewers: {}, projectReviewers: {}, claudeProfiles: [], claudeProfileId: '' };
const fixture = { app: { name: 'Farol', version: 'fixture', platform: 'linux' }, status: 'idle', config,
  account: { user: 'fixture', tokenOk: true }, accounts: [], queue: [], panorama: [], myPRs: [], hiddenPRs: [],
  activeSessions: [], activity: {}, headlessWaiting: [], decisions: { pending: [], resolved: [] },
  selfAnalyses: {}, reviewActions: {}, usage: {}, chats: {}, paths: { home: '/fixture', workspace: '/fixture/workspace' },
  update: {}, toolRuns: {} };

test('primeiro SSE Linux oculta autostart sem pintar Sistema nem alterar campo focado', () => {
  doc.activeElement = { tagName: 'INPUT', value: 'rascunho' };
  emitir('state', fixture); flush();
  assert.equal(doc.body.dataset.tab, 'radar');
  assert.equal(configuracoes, 0);
  assert.equal(doc.querySelector('#rowAutostart').style.display, 'none');
  assert.equal(doc.activeElement.value, 'rascunho');
});

test('reconciliação SSE só atualiza controles de plataforma, inclusive fora de Electron', () => {
  for (const [platform, label] of [['darwin', 'Iniciar com o macOS'], ['win32', 'Iniciar com o Windows']]) {
    emitir('state-patch', { campos: { app: { ...fixture.app, platform } }, removidos: [] }); flush();
    assert.equal(doc.querySelector('#rowAutostart').style.display, '');
    assert.equal(doc.querySelector('#rowAutostart .set-title').textContent, label);
    assert.equal(configuracoes, 0);
    assert.equal(doc.activeElement.value, 'rascunho');
  }
  navigator.userAgent = 'Browser';
  emitir('state-patch', { campos: { app: { ...fixture.app, platform: 'win32' } }, removidos: [] }); flush();
  assert.equal(doc.querySelector('#rowAutostart').style.display, 'none');
  navigator.userAgent = 'Farol Electron/44.1.0';
});

test('primeiro acesso ao Sistema mantém autostart Linux oculto e consome configuração adiada', async () => {
  emitir('state-patch', { campos: { app: fixture.app }, removidos: [] }); flush();
  assert.equal(doc.querySelector('#rowAutostart').style.display, 'none');
  doc.activeElement = null;
  irPara('/sistema/preferencias');
  for (const fn of janela.get('popstate') || []) fn();
  flush();
  // As respostas locais resolvem por promises; a próxima volta observa também seus consumidores.
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(consultas.has('/api/log/triage'));
  assert.ok(consultas.has('/api/diagnostics'));
  assert.equal(doc.querySelector('#logBox').textContent, 'Nenhuma falha registrada. Bom sinal.');
  assert.equal(doc.querySelector('#logResumo').hidden, true);
  assert.equal(doc.body.dataset.tab, 'sistema');
  assert.ok(configuracoes > 0);
  assert.equal(doc.querySelector('#rowAutostart').style.display, 'none');
});
