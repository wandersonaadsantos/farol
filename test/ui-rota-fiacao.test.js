// A fiação do endereço da página (ui/telas/rota.js) no app CARREGADO de verdade.
//
// test/ui-rota.test.js prova a tradução hash <-> rota. Este prova a fiação, contra o DOM de
// mentira (test/helpers/dom-stub.js) com um histórico que só registra: o endereço de entrada
// é aplicado e só vira canônico quando o estado chega, Voltar e Avançar aplicam a rota da
// entrada, endereço inválido cai no padrão sem lançar, troca de lugar empilha e filtro
// substitui. Limite honesto: o stub não tem eventos nem layout de verdade; clique real,
// Voltar real e o login foram verificados no navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

const { emitir, listeners } = instalarDom();
// toda leitura do engine responde vazio (null), como uma falha de rede: o stub padrão
// responde {} e o log do Sistema, aberto pela rota, espera lista
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => null, text: async () => '' });
const ouvintes = new Map();
globalThis.addEventListener = (tipo, fn) => { ouvintes.set(tipo, [...(ouvintes.get(tipo) || []), fn]); };
const disparar = (tipo) => { for (const fn of ouvintes.get(tipo) || []) fn({ type: tipo, target: {} }); };
// o endereço aberto direto, antes de o app carregar, na grafia antiga (sem barra, nome
// interno da seção): o app aceita e reescreve na canônica
globalThis.location.hash = '#sistema/accounts';

await import('../ui/app.js');
const { abaAtual, escopo } = await import('../ui/telas/estado.js');
const { radarSubAtual, switchRadarSub } = await import('../ui/telas/radar.js');
const { secaoDoSistema } = await import('../ui/telas/sistema.js');

// o connect() roda depois do precisaParear(), que é assíncrono
for (let i = 0; i < 50 && !listeners.has('state'); i++) await new Promise((r) => setTimeout(r, 10));

const ESTADO = {
  app: { name: 'Farol', version: '2.72.0', platform: 'win32' },
  status: 'ocioso', error: null,
  account: { user: 'alice', tokenOk: true },
  accounts: [
    { user: 'alice', owners: ['acme'], label: 'Pessoal', color: '#f80' },
    { user: 'bob', owners: ['beta'], label: 'Trabalho', color: '#08f' },
  ],
  config: {
    ghUser: 'alice', owners: ['acme'], accounts: [{ user: 'alice', owners: ['acme'] }, { user: 'bob', owners: ['beta'] }],
    intervalSeconds: 300, parallelReviews: 1, theme: 'dark', mergeBlockedRepos: [],
    teamHighlights: false, deliveriesEnabled: false, defaultReviewers: {}, projectReviewers: {},
    people: {}, claudeProfiles: [], claudeProfileId: '',
  },
  queue: [], panorama: [], myPRs: [], hiddenPRs: [], selfAnalyses: {}, decisions: { pending: [], resolved: [] },
  activeSessions: [], headlessWaiting: [], chats: {}, reviewActions: {}, staleStates: {},
  usage: {}, usageSessions: [], toolRuns: {}, pushbacks: {}, team: [], highlights: [],
  update: { state: 'idle' }, doctor: null, deliveries: null,
  paths: { home: '/tmp/.farol', workspace: '/tmp/.farol/workspace' },
};
const ultima = () => history.chamadas[history.chamadas.length - 1];

test('o endereço de entrada espera o estado e não é reescrito antes dele', () => {
  // as telas não desenham sem estado (Sistema lê o snapshot ao entrar): aplicar antes
  // explodia o aoEntrar, e foi este teste que mostrou
  assert.equal(abaAtual(), 'radar');
  assert.deepEqual(history.chamadas, [], 'o endereço fica como veio');
  disparar('click');
  assert.deepEqual(history.chamadas, [], 'clique antes do estado não apaga a rota de entrada');
});

test('o primeiro estado aplica a entrada e grava o endereço canônico, substituindo', () => {
  assert.equal(emitir('state', ESTADO), 1);
  assert.equal(abaAtual(), 'sistema');
  assert.equal(secaoDoSistema(), 'accounts');
  assert.deepEqual(ultima(), ['replace', '#/sistema/contas']);
});

test('Voltar/Avançar aplicam a rota da entrada, e o hashchange gêmeo não faz nada', () => {
  location.hash = '#/radar/meus-prs';
  disparar('popstate');
  assert.equal(abaAtual(), 'radar');
  assert.equal(radarSubAtual(), 'meus');
  const n = history.chamadas.length;
  disparar('hashchange');
  assert.equal(history.chamadas.length, n, 'a mesma troca chega duas vezes e só vale uma');
});

test('endereço inválido cai no padrão e o endereço é corrigido', () => {
  location.hash = '#/nao-existe/%E0%A4%A?pr=lixo';
  assert.doesNotThrow(() => disparar('popstate'));
  assert.equal(abaAtual(), 'radar');
  assert.equal(radarSubAtual(), 'mim');
  assert.deepEqual(ultima(), ['replace', '#/radar/pra-mim']);
});

test('trocar de lugar pela tela empilha; trocar de conta substitui', () => {
  switchRadarSub('pano');
  disparar('click');
  assert.deepEqual(ultima(), ['push', '#/radar/panorama']);
  // a conta é filtro: a barra de contas só existe com duas contas, que o estado tem
  location.hash = '#/radar/panorama?conta=bob';
  disparar('popstate');
  assert.equal(escopo(), 'bob');
  location.hash = '#/radar/panorama';
  disparar('popstate');
  assert.equal(escopo(), 'all', 'sem conta no endereço, numa aba com a barra, é Todas');
});

test('aba opcional desligada cai no Radar e o endereço diz isso', () => {
  location.hash = '#/entregas?dias=30';
  disparar('popstate');
  assert.equal(abaAtual(), 'radar');
  assert.match(ultima()[1], /^#\/radar\//);
});

test('clique que não muda nada não escreve no histórico', () => {
  const n = history.chamadas.length;
  disparar('click');
  disparar('keydown');
  assert.equal(history.chamadas.length, n);
});

// ---------------------------------------------------------------- revisão do Codex sobre 8c1a1e2

test('Codex 4: conta que não está configurada no endereço cai em Todas na hora, e o endereço é corrigido', () => {
  location.hash = '#/radar/panorama?conta=bob';
  disparar('popstate');
  assert.equal(escopo(), 'bob', 'controle: conta configurada vale');
  location.hash = '#/radar/panorama?conta=fulano';
  disparar('popstate');
  assert.equal(escopo(), 'all', 'conta desconhecida não vira escopo, nem guardado');
  assert.equal(localStorage.getItem('farol-scope'), 'all');
  assert.deepEqual(ultima(), ['replace', '#/radar/panorama']);
});

test('Codex 5: link só com ?repo= ou ?pessoa= troca o agrupamento para o do foco', async () => {
  const { filtrosDeEntregas } = await import('../ui/telas/entregas.js');
  emitir('state', { ...ESTADO, config: { ...ESTADO.config, deliveriesEnabled: true } });
  localStorage.setItem('farol-deliv-by', 'author');
  location.hash = '#/entregas?pessoa=carol';
  disparar('popstate');
  assert.equal(filtrosDeEntregas().agrupar, 'author');
  location.hash = '#/entregas?repo=acme/api';
  disparar('popstate');
  assert.equal(filtrosDeEntregas().agrupar, 'repo', 'o grupo do repositório só existe na visão por repositório');
  assert.equal(filtrosDeEntregas().repo, 'acme/api');
  location.hash = '#/entregas?pessoa=carol';
  disparar('popstate');
  assert.equal(filtrosDeEntregas().agrupar, 'author');
  emitir('state', ESTADO);
});

test('Codex 6: caixa de revisão cuja busca termina depois de a rota mudar não abre nem empilha', async () => {
  const { caixaAberta } = await import('../ui/telas/caixa-revisao.js');
  let liberar;
  const real = globalThis.fetch;
  globalThis.fetch = (url) => (String(url).includes('/api/decision')
    ? new Promise((r) => { liberar = () => r({ ok: true, status: 200, json: async () => ({ found: true, decision: { key: 'acme/api#9', verdict: 'approve', reasons: [] } }) }); })
    : real(url));
  try {
    location.hash = '#/consumo?pr=acme%2Fapi%239';
    disparar('popstate');
    location.hash = '#/consumo';
    disparar('popstate');
    const n = history.chamadas.length;
    liberar();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(caixaAberta(), '', 'a busca velha não abre a caixa');
    assert.equal(history.chamadas.slice(n).some(([tipo]) => tipo === 'push'), false, 'e não empilha nada');
  } finally { globalThis.fetch = real; }
});
