// O ui/app.js CARREGA e DESENHA sem explodir.
//
// A lacuna que este arquivo fecha: nenhum teste executava o app.js. Os outros quatro
// leem o fonte como texto e casam regex, e é por isso que dois bugs meus passaram por
// `node --check`, `npm run lint`, `npm test` e CI verde nos três sistemas em 18/08:
//
//   1. bloco de Consumo movido pro pure.js deixando USAGE_KIND_COLOR pra trás
//   2. regex de conversão enfiando `ctxRev` DENTRO da string 'var(--accent)'
//
// Os dois eram erro de runtime com sintaxe válida. O segundo quebrava a tela inteira
// de Reviewers, e quem descobriu foi o Wanderson, usando.
//
// O caminho exercitado aqui é o mesmo do app real: o handler de `state` do SSE, que é
// o orquestrador de render (chama ~15 funções de tela numa tacada). Disparar um estado
// plausível nele passa por status, contas, fila, decisões, Meus PRs, panorama,
// configurações, ferramentas e atualização.
//
// Limite honesto: o DOM é um stub burro (test/helpers/dom-stub.js). Verde aqui NÃO diz
// que a tela está certa, diz que ela não explode. Continua sendo obrigatório abrir o
// app pra validar visual e clique. Runner nativo, ZERO deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

// NOTA sobre o `--test-force-exit` no script de test: carregar o app.js liga os
// timers dele (countdown, tick de elapsed, backoff de reconexão do SSE). O stub já
// faz unref e neutraliza o setInterval, mas o runner do node ainda espera o event
// loop drenar e a suíte inteira pendurava. A flag encerra quando os testes acabam.
// Medido: com ela, os 1383 testes seguem passando iguais.

const { emitir, listeners } = instalarDom();
// carrega DEPOIS do stub: o app.js toca `document` no topo
const UI = await import('../ui/app.js');

// estado plausível, no formato do snapshot() do engine
const ESTADO = {
  app: { name: 'Farol', version: '2.48.2', platform: 'win32' },
  status: 'ocioso', error: null,
  account: { user: 'alice', tokenOk: true },
  accounts: [{ user: 'alice', owners: ['acme'], label: 'Pessoal', color: '#f80' }],
  config: {
    ghUser: 'alice', owners: ['acme'], accounts: [{ user: 'alice', owners: ['acme'] }],
    intervalSeconds: 300, autoReview: true, autoApproveAll: false, autoApproveContested: false,
    parallelReviews: 1, theme: 'dark', autoUpdate: true, autoPushback: true,
    reviewModel: '', reviewEffort: '', codexReviewModel: '', codexReviewEffort: '',
    mergeBlockedRepos: [], soundEnabled: true,
    teamHighlights: false, deliveriesEnabled: false,
    defaultReviewers: { acme: ['bob'] }, projectReviewers: { 'acme/api': ['carol'] },
    people: { bob: { papel: 'senior' } }, claudeProfiles: [], claudeProfileId: '',
  },
  lastCheckAt: Date.now() - 60_000, nextCheckAt: Date.now() + 240_000,
  queue: [{ key: 'acme/api#1', url: 'u', title: 'Corrige o gate', author: 'bob', updatedAt: new Date().toISOString() }],
  panorama: [{ key: 'acme/web#2', url: 'u', title: 'Sobe versão', author: 'carol', updatedAt: new Date().toISOString(), mine: true }],
  myPRs: [{ key: 'acme/api#3', url: 'u', title: 'Meu PR', author: 'alice', updatedAt: new Date().toISOString() }],
  hiddenPRs: [], selfAnalyses: {}, decisions: { pending: [], resolved: [] },
  // sessão ativa de verdade no fixture: sem ela o cartão de "Analisando agora" nunca é
  // desenhado no smoke test, e ele é justamente um render de DADO — o lugar onde
  // objeto interpolado passa despercebido.
  activeSessions: [{ id: 'sess-1', mode: 'auto', label: 'acme/repo#42', startedAt: 1755600000000, cancellable: true, pr: { url: 'https://github.com/acme/repo/pull/42', user: 'alice' } }],
  headlessWaiting: ['acme/repo#43'], chats: {}, reviewActions: {}, staleStates: {},
  usage: {}, usageSessions: [], toolRuns: {}, pushbacks: {}, team: [], highlights: [],
  update: { state: 'idle' }, doctor: null, deliveries: null,
  // o painel Sistema le daqui; sem isto o renderDoctor quebra, e foi o proprio teste
  // que apontou o fixture incompleto
  paths: { home: '/tmp/.farol', workspace: '/tmp/.farol/workspace' },
};

// Assertiva que faltava, e é a lição do bug de 18/08 à noite: os testes abaixo
// perguntavam só "levanta exceção?", e `[object Object]` NÃO levanta. Depois que
// `reasons` virou { text, kind }, o card de "Precisa de você" passou a imprimir isso
// na tela do usuário com a suíte inteira verde, e quem viu foi o Wanderson, usando.
// Interpolar objeto em template é erro silencioso por natureza, então vira asserção.
function semObjectObject(rotulo) {
  // `#relNotes` fica de FORA: as notas de versão são prosa escrita por nós, e uma
  // delas descreve justamente este bug ("mostrava [object Object] no lugar dos
  // motivos"). O guarda existe pra pegar OBJETO INTERPOLADO em render de DADO, e
  // incluir texto autoral só produziria falso positivo — que foi o que aconteceu ao
  // escrever a nota da v2.48.3.
  const alvos = ['#decisions', '#queue', '#panorama', '#myPRs', '#resolved', '#team', '#usage', '#reviewersEditor', '#activeSessions'];
  for (const sel of alvos) {
    const html = document.querySelector(sel).innerHTML || '';
    assert.ok(!html.includes('[object Object]'), `${rotulo}: "${sel}" imprimiu [object Object]`);
  }
}

test('o app.js carrega e registra o handler de state do SSE', () => {
  assert.ok(listeners.has('state'), 'sem isto a tela nunca receberia estado nenhum');
});

test('toast trata conteúdo recebido como texto, nunca como HTML', () => {
  const payload = '<img src=x onerror="globalThis.executou=true">';
  const item = UI.toast('info', payload, 0);
  assert.equal(item.textContent, payload);
  assert.equal(item.innerHTML, '');
  assert.equal(globalThis.executou, undefined);
});

test('desenhar a tela com um estado plausível não levanta exceção', () => {
  // é o teste que teria pego os dois bugs de 18/08
  assert.equal(emitir('state', ESTADO), 1, 'o handler rodou');
  semObjectObject('estado cheio');
});

test('Destaques e Entregas só ficam visíveis quando habilitados em Sistema', () => {
  const destaques = document.querySelector('#tabbtn-destaques');
  const entregas = document.querySelector('#tabbtn-entregas');
  emitir('state', { ...ESTADO, config: { ...ESTADO.config, teamHighlights: false, deliveriesEnabled: false } });
  assert.equal(destaques.hidden, true);
  assert.equal(entregas.hidden, true);
  emitir('state', { ...ESTADO, config: { ...ESTADO.config, teamHighlights: true, deliveriesEnabled: true } });
  assert.equal(destaques.hidden, false);
  assert.equal(entregas.hidden, false);
});

test('estado vazio (primeiro boot, antes de qualquer checagem) não explode', () => {
  const vazio = { ...ESTADO, queue: [], panorama: [], myPRs: [], accounts: [], account: { user: '', tokenOk: false }, config: { ...ESTADO.config, accounts: [] } };
  assert.equal(emitir('state', vazio), 1);
});

test('config sem reviewers e sem pessoas não explode', () => {
  // exercita o editor de Reviewers e o picker de papel com os mapas vazios, que é o
  // caminho onde o ctx faltando quebrava
  const magro = { ...ESTADO, config: { ...ESTADO.config, defaultReviewers: {}, projectReviewers: {}, people: {} } };
  assert.equal(emitir('state', magro), 1);
});

test('org de config sem conta dona (o bloco "Outros") não explode', () => {
  // é exatamente o ramo que a chamada corrompida quebrava primeiro
  const orfa = { ...ESTADO, config: { ...ESTADO.config, defaultReviewers: { semdono: ['x'] }, projectReviewers: { 'semdono/repo': ['y'] } } };
  assert.equal(emitir('state', orfa), 1);
});

test('decisão pendente com motivos e ressalvas não explode', () => {
  const comDecisao = {
    ...ESTADO,
    decisions: {
      pending: [{
        id: 'd1', key: 'acme/api#1', createdAt: Date.now(), status: 'pending', verdict: 'approve',
        pr: { repo: 'acme/api', number: 1, url: 'u', title: 't', author: 'bob' },
        reasons: [{ text: 'falha ao postar', kind: 'infra' }, { text: 'card não comprovado', kind: 'content' }],
        attention: [], reportMarkdown: '## Achados\n\nnada', postRetry: { event: 'approve', attempts: 1 },
      }],
      resolved: [{
        id: 'd0', key: 'acme/web#9', resolvedAt: Date.now(), status: 'auto_approved', action: 'approve',
        pr: { repo: 'acme/web', number: 9, url: 'u', title: 't', author: 'carol' },
        reasons: [], attention: [], stages: { totalMs: 1000, stages: [{ id: 'leitura', label: 'leitura', ms: 1000 }] },
      }],
    },
  };
  assert.equal(emitir('state', comDecisao), 1);
  semObjectObject('decisão pendente');
});

/* As abas Sistema e Consumo só desenham quando estão ATIVAS (o handler de state
   checa `classList.contains('active')` antes de chamar renderDoctor/renderUsage).
   Sem ativar, esses ramos nunca rodavam aqui — e foi assim que a primeira versão
   deste arquivo deixou passar a mutação da constante do Consumo deixada pra trás,
   que é justamente um dos dois bugs que motivaram o teste. */

test('aba Consumo ativa: os gráficos desenham sem explodir', () => {
  document.querySelector('#tab-consumo').classList.add('active');
  const comUso = {
    ...ESTADO,
    usage: {
      series: [{ day: new Date().toISOString().slice(0, 10), costUsd: 1.5, inputTokens: 900, outputTokens: 800, sessions: 3 }],
      totals: { sessions: 3, costUsd: 1.5, inputTokens: 900, outputTokens: 800 },
      matrixKindNames: ['review'], matrixModelNames: ['opus'],
      matrixSeries: [{ day: new Date().toISOString().slice(0, 10), cells: { review: { opus: { costUsd: 1.5, inputTokens: 900, outputTokens: 800 } } } }],
      budgets: [{ id: 'p1', label: 'Assinatura', apiKey: false, blocked: false, today: 0, sinceCutoff: 0, budgetDaily: null, budgetTotal: null }],
      sessions: [{ id: 's1', at: Date.now(), kind: 'review', model: 'opus', costUsd: 0.4, inputTokens: 400, outputTokens: 500, ref: 'acme/api#1', result: 'ok' }],
      kindNames: ['review'], modelNames: ['opus'],
    },
  };
  assert.equal(emitir('state', comUso), 1);
  document.querySelector('#tab-consumo').classList.remove('active');
});

test('aba Sistema ativa: doctor, contas e perfis desenham sem explodir', () => {
  document.querySelector('#tab-sistema').classList.add('active');
  const comSistema = {
    ...ESTADO,
    doctor: { gh: { ok: true, detail: 'ok' }, claude: { ok: true, detail: 'ok' }, account: { ok: true, detail: 'alice' } },
    config: { ...ESTADO.config, claudeProfiles: [{ id: 'p1', label: 'Pessoal', dir: '/tmp/x' }], claudeProfileId: 'p1' },
  };
  assert.equal(emitir('state', comSistema), 1);
  document.querySelector('#tab-sistema').classList.remove('active');
});

/* Import morto: símbolo trazido do pure.js que ninguém mais usa depois de uma
   extração. Não quebra nada em runtime, então passa por `node --check`, pelo lint,
   pela suíte e pelo CI — e vai apodrecendo. Quando este teste nasceu havia 17 deles
   acumulados dos passos 2 a 5 da onda 5, todos meus.

   Um cético do workflow de análise apontou o risco antes de eu cometer o próximo. */

test('nenhum símbolo importado do pure.js está morto no app.js', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
  const m = src.match(/import \{([\s\S]*?)\} from '\.\/pure\.js';/);
  assert.ok(m, 'o app.js importa do pure.js');
  const nomes = m[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.ok(nomes.length >= 40, `esperava o import cheio, achei ${nomes.length}`);
  const corpo = src.slice(m.index + m[0].length);
  const mortos = nomes.filter(n => !new RegExp(`\\b${n}\\b`).test(corpo));
  assert.deepEqual(mortos, [], 'símbolo importado e não usado: sobrou de uma extração');
});

test('shell Electron declara Farol como nome do processo', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /app\.setName\('Farol'\)/, 'macOS nao pode herdar "Electron" como nome do app em runtime');
});
