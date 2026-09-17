// Panorama e Meus PRs de outros aparelhos na tela de verdade: o ui/app.js carregado contra
// o DOM de mentira (test/helpers/dom-stub.js), no padrão de test/ui-radar-compartilhado.
//
// Prova que o bootstrap entrega `sync-lists` à tela, que a tela busca a projeção ao abrir,
// que as linhas remotas entram nas abas com origem e contagem sem dobra, que o escopo de
// conta da barra filtra as linhas remotas, e que a falha da leitura do andamento é dita.
// Não prova visual, CSS nem clique real: isso é a jornada no app.
process.env.TZ = 'America/Sao_Paulo';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

const { emitir } = instalarDom();

const PEDIDOS = [];
let RESPOSTAS = {};
globalThis.fetch = async (url, init = {}) => {
  const corpo = init.body ? JSON.parse(init.body) : null;
  PEDIDOS.push({ url: String(url), corpo });
  const r = RESPOSTAS[String(url)];
  const valor = typeof r === 'function' ? r(corpo) : r;
  return { ok: true, status: 200, json: async () => (valor === undefined ? {} : valor), text: async () => '' };
};

await import('../ui/app.js');
const Est = await import('../ui/telas/estado.js');
const $ = (s) => document.querySelector(s);
const esperar = () => new Promise((r) => setTimeout(r, 0));

const CONTAS = [{ user: 'alice', owners: ['acme'] }, { user: 'bob', owners: ['beta'] }];

function estado({ sync = {}, panorama = [], myPRs = [] } = {}) {
  return {
    app: { name: 'Farol', version: '2.59.7', platform: 'win32' },
    status: 'ocioso', account: { user: 'alice', tokenOk: true },
    accounts: CONTAS,
    config: { ghUser: 'alice', owners: ['acme'], accounts: CONTAS, intervalSeconds: 300, sync: {}, people: {}, defaultReviewers: {}, projectReviewers: {}, claudeProfiles: [] },
    lastCheckAt: Date.now(), nextCheckAt: Date.now() + 60000,
    queue: [], panorama, myPRs, hiddenPRs: [], selfAnalyses: {}, decisions: { pending: [], resolved: [] },
    activeSessions: [], headlessWaiting: [], chats: {}, reviewActions: {}, staleStates: {},
    usage: {}, usageSessions: [], toolRuns: {}, pushbacks: {}, team: [], highlights: [], update: { state: 'idle' },
    paths: { home: '/tmp/.farol', workspace: '/tmp/.farol/workspace' },
    sync: { enabled: true, shared: true, bloqueioCompartilhamento: '', deviceId: 'dB', devices: [], distribuicao: { modo: '', esperando: [] }, comandosEmitidos: [], tomadasSofridas: [], ...sync },
  };
}

function linha(key, account, extra = {}) {
  return { key, url: '', title: `Título ${key}`, author: 'ana', repo: key.split('#')[0], number: Number(key.split('#')[1]), isDraft: false, u: Date.now() - 1000, account, somenteLeitura: false, ...extra };
}

function escopo(tipo, account, linhas, extra = {}) {
  return { tipo, account, dev: 'dA', aparelho: 'Notebook', estado: 'ok', lidoEm: Date.now(), falhaEm: 0, confirmadoAte: Date.now() + 600000, naoAbriram: 0, linhas, ...extra };
}

function projecao(escopos, extra = {}) {
  return { ok: true, estado: 'ligada', limiteMs: 180000, escopos, ...extra };
}

const LOCAL = { key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'Local', author: 'ana', repo: 'acme/app', number: 1, account: 'alice' };
const PROJ = projecao([
  escopo('panorama', 'alice', [linha('acme/app#1', 'alice'), linha('acme/app#2', 'alice')]),
  escopo('panorama', 'bob', [linha('beta/api#5', 'bob')]),
  escopo('myPrs', 'alice', [linha('acme/app#36', 'alice', { somenteLeitura: true })]),
]);

beforeEach(() => {
  PEDIDOS.length = 0;
  RESPOSTAS = {};
  Est.definirEscopo('all');
});

test('ao abrir com a visão valendo, a tela busca a projeção das listas uma vez', async () => {
  RESPOSTAS['/api/sync/lists'] = PROJ;
  emitir('state', estado({ panorama: [LOCAL] }));
  emitir('state', estado({ panorama: [LOCAL] }));
  await esperar();
  const pedidos = PEDIDOS.filter((p) => p.url === '/api/sync/lists');
  assert.equal(pedidos.length, 1, 'uma busca só, não uma por snapshot');
  assert.deepEqual(pedidos[0].corpo, {});
  assert.match($('#panoramaRemoto').innerHTML, /acme\/app#2/);
});

test('sync-lists chega pelo bootstrap: origem, sem dobra, e a contagem da aba soma sem repetir', () => {
  assert.equal(emitir('sync-lists', PROJ), 1, 'o bootstrap escuta sync-lists');
  emitir('state', estado({ panorama: [LOCAL], myPRs: [] }));
  const html = $('#panoramaRemoto').innerHTML;
  assert.match(html, /acme\/app#2/);
  assert.match(html, /beta\/api#5/);
  assert.doesNotMatch(html, /acme\/app#1</, 'o PR daqui não aparece de novo');
  assert.match(html, />Notebook</);
  assert.equal($('#panoramaRemoto').hidden, false);
  assert.equal($('#panoCount').textContent, '3', 'um daqui e dois de lá');
  assert.match($('#myPRsRemoto').innerHTML, /do Notebook, só leitura/);
  assert.equal($('#myPRsCount').textContent, '1');
});

test('o escopo de conta da barra filtra as linhas remotas', () => {
  emitir('sync-lists', PROJ);
  Est.definirEscopo('alice');
  emitir('state', estado({ panorama: [LOCAL] }));
  assert.doesNotMatch($('#panoramaRemoto').innerHTML, /beta\/api#5/, 'linha de outra conta fica de fora');
  assert.match($('#panoramaRemoto').innerHTML, /acme\/app#2/);
  assert.equal($('#panoCount').textContent, '2');
});

test('PR oculto em Meus PRs também some da linha remota', () => {
  emitir('sync-lists', PROJ);
  const e = estado();
  e.hiddenPRs = ['acme/app#36'];
  emitir('state', e);
  assert.doesNotMatch($('#myPRsRemoto').innerHTML, /acme\/app#36/);
});

test('visão desligada esconde as linhas remotas; bloqueada diz que bloqueou', () => {
  emitir('sync-lists', PROJ);
  emitir('state', estado({ sync: { shared: false } }));
  assert.equal($('#panoramaRemoto').hidden, true);
  assert.doesNotMatch($('#panoramaRemoto').innerHTML, /acme\/app#2/);
  emitir('state', estado({ sync: { bloqueioCompartilhamento: 'autenticacao-local' } }));
  assert.equal($('#panoramaRemoto').hidden, false);
  assert.match($('#panoramaRemoto').innerHTML, /bloque/);
  assert.doesNotMatch($('#panoramaRemoto').innerHTML, /acme\/app#2/);
});

test('leitura que falhou e leitura velha aparecem com frases diferentes', () => {
  emitir('state', estado());
  emitir('sync-lists', projecao([escopo('panorama', 'alice', [linha('acme/app#2', 'alice')], { estado: 'falhou', falhaEm: Date.now() - 1000 })]));
  const falhou = $('#panoramaRemoto').innerHTML;
  assert.match(falhou, /leitura falhou/);
  assert.match(falhou, /acme\/app#2/, 'a visão anterior continua');
  emitir('sync-lists', projecao([escopo('panorama', 'alice', [linha('acme/app#2', 'alice')], { lidoEm: Date.now() - 600000 })]));
  const velha = $('#panoramaRemoto').innerHTML;
  assert.match(velha, /desatualizad/);
  assert.doesNotMatch(velha, /leitura falhou/);
});

test('sync-live com falha diz que a leitura falhou e mantém o andamento', () => {
  emitir('state', estado());
  const op = { opId: 'op1', dev: 'dA', aparelho: 'Notebook', etapa: 'leitura', msPorEtapa: {}, subagentes: [], tipo: 'review', prTag: 'a'.repeat(32) };
  emitir('sync-live', { operacoes: [op] });
  assert.doesNotMatch($('#mdOperacoes').innerHTML, /falhou/);
  emitir('sync-live', { operacoes: [op], falhaEm: Date.now() });
  assert.match($('#mdOperacoes').innerHTML, /A última leitura falhou/);
  assert.match($('#mdOperacoes').innerHTML, /md-op/, 'o andamento anterior continua');
  emitir('sync-live', { operacoes: [op] });
  assert.doesNotMatch($('#mdOperacoes').innerHTML, /A última leitura falhou/, 'leitura boa limpa o aviso');
});

test('lista de revisões que falhou no banco aparece como falha, com o motivo', async () => {
  RESPOSTAS['/api/sync/reviews'] = { ok: false, code: 'indisponivel', motivo: 'não deu para ler as revisões dos aparelhos agora' };
  const Tela = await import('../ui/telas/radar-compartilhado.js');
  emitir('state', estado());
  await Tela.buscarRevisoes();
  assert.match($('#mdRevisoes').innerHTML, /A busca das revisões falhou/);
  assert.doesNotMatch($('#mdRevisoes').innerHTML, /Nenhuma revisão compartilhada/);
});

test('o bootstrap só repassa: connect() entrega sync-lists à tela', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
  const ini = fonte.indexOf('function connect()');
  const fim = fonte.indexOf('\n}\n', ini);
  const corpo = fonte.slice(ini, fim);
  assert.match(corpo, /addEventListener\('sync-lists', \(e\) => \{\s*const d = safeJsonParse\(e\.data\); if \(!d\) return;\s*aoListasRemotas\(d\);\s*\}\)/);
});

function comRelogio(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return fn(); } finally { Date.now = real; }
}

test('com a projeção já na tela, passar do piso não repete a busca', () => {
  emitir('sync-lists', PROJ);
  PEDIDOS.length = 0;
  comRelogio(Date.now() + 10 * 60000, () => emitir('state', estado({ panorama: [LOCAL] })));
  assert.equal(PEDIDOS.filter((p) => p.url === '/api/sync/lists').length, 0, 'quem já tem a projeção acompanha pelo evento');
});

test('a falha do andamento mostra a hora da última leitura BOA, não a da falha', () => {
  const T0 = Date.UTC(2026, 8, 16, 13, 0, 0);
  const op = { opId: 'op9', dev: 'dA', aparelho: 'Notebook', etapa: 'leitura', msPorEtapa: {}, subagentes: [], tipo: 'review', prTag: 'a'.repeat(32) };
  comRelogio(T0, () => { emitir('state', estado()); emitir('sync-live', { operacoes: [op] }); });
  comRelogio(T0 + 5 * 60000, () => emitir('sync-live', { operacoes: [op], falhaEm: T0 + 5 * 60000 }));
  const html = $('#mdOperacoes').innerHTML;
  assert.match(html, /falhou às 10:05/);
  assert.match(html, /Mostrando o andamento de 10:00/);
});

test('os contêineres existem no HTML, cada um na sua sub-aba', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
  const meus = html.indexOf('id="rpane-meus"');
  const pano = html.indexOf('id="rpane-pano"');
  const iMeus = html.indexOf('id="myPRsRemoto"');
  const iPano = html.indexOf('id="panoramaRemoto"');
  assert.ok(meus > 0 && iMeus > meus && iMeus < pano, 'Meus PRs remoto mora na sub-aba Meus PRs');
  assert.ok(iPano > pano, 'Panorama remoto mora na sub-aba Panorama');
});
