// A tela da visão compartilhada (ui/telas/radar-compartilhado.js), carregada de verdade
// pelo ui/app.js contra o DOM de mentira (test/helpers/dom-stub.js).
//
// O que este arquivo prova, e o que ele NÃO prova: prova que o bootstrap entrega os dois
// eventos SSE próprios à tela, que a tela só aparece com a visão valendo, e que cada ação
// manda à rota exatamente o corpo do contrato, e nada antes da confirmação. Não prova
// visual, CSS nem clique real (o stub não tem eventos): isso é a jornada no app.
process.env.TZ = 'America/Sao_Paulo';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

const { emitir } = instalarDom();

// cada chamada à API fica registrada; a resposta sai do mapa por rota
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
const Tela = await import('../ui/telas/radar-compartilhado.js');
const $ = (s) => document.querySelector(s);

const DEVICES = [{ deviceId: 'dEu', name: 'Notebook de teste', euMesmo: true }, { deviceId: 'dOutro', name: 'Desktop antigo' }];

function estado({ sync = {}, cfgSync = {} } = {}) {
  return {
    app: { name: 'Farol', version: '2.59.5', platform: 'win32' },
    status: 'ocioso', account: { user: 'alice', tokenOk: true },
    accounts: [{ user: 'alice', owners: ['acme-exemplo'] }],
    config: { ghUser: 'alice', owners: ['acme-exemplo'], accounts: [{ user: 'alice', owners: ['acme-exemplo'] }], intervalSeconds: 300, sync: cfgSync, people: {}, defaultReviewers: {}, projectReviewers: {}, claudeProfiles: [] },
    lastCheckAt: Date.now(), nextCheckAt: Date.now() + 60000,
    queue: [], panorama: [], myPRs: [], hiddenPRs: [], selfAnalyses: {}, decisions: { pending: [], resolved: [] },
    activeSessions: [], headlessWaiting: [], chats: {}, reviewActions: {}, staleStates: {},
    usage: {}, usageSessions: [], toolRuns: {}, pushbacks: {}, team: [], highlights: [], update: { state: 'idle' },
    paths: { home: '/tmp/.farol', workspace: '/tmp/.farol/workspace' },
    sync: { enabled: true, shared: true, bloqueioCompartilhamento: '', deviceId: 'dEu', devices: DEVICES, distribuicao: { modo: 'distribuido', esperando: [] }, comandosEmitidos: [], tomadasSofridas: [], ...sync },
  };
}

const ADMIN = { deviceId: 'dEu', generation: 1, souEu: true, fresca: true };
const OP = { opId: 'op1', dev: 'dOutro', aparelho: 'Desktop antigo', t0: 1, situacao: 'viva', etapa: 'leitura', msPorEtapa: { leitura: 1000 }, subagentes: [], modelo: 'opus', prTag: 'a'.repeat(32), acctTag: 'b'.repeat(32), tipo: 'review' };
// o PR em claro chega em `pr`, resolvido pelo catálogo no engine (antes o teste o punha em
// `prKey`/`account`, campos que o engine nunca mandou)
const OP_COMPLETA = { ...OP, opId: 'op2', matTag: 'c'.repeat(32), pr: { key: 'acme-exemplo/app-web#41', account: 'alice', title: 'Ajusta o rodapé', author: 'bruno-exemplo' } };
const PEND = { itemId: 'ab12', dev: 'dOutro', aparelho: 'Desktop antigo', at: 1, visto: false, veredito: 'approve', motivos: [], bloqueio: '' };

beforeEach(() => {
  PEDIDOS.length = 0;
  RESPOSTAS = {};
});

function pedidosPara(rota) {
  return PEDIDOS.filter((p) => p.url === rota);
}

/* ---------- visibilidade ---------- */

test('com a visão valendo, as seções aparecem e a faixa do modo sai do snapshot', () => {
  assert.equal(emitir('state', estado({ sync: { admin: ADMIN }, cfgSync: { distribution: { enabled: true } } })), 1);
  assert.equal($('#mdCompartilhado').hidden, false);
  assert.equal($('#mdHistorico').hidden, false);
  assert.equal($('#mdFaixa').hidden, false);
  assert.match($('#mdFaixa').innerHTML, /fila distribuída/);
  assert.match($('#mdLocal').innerHTML, /Destaques, Kudos e Time/);
});

test('bloqueada pelo Farol: as seções somem e a faixa diz bloqueada', () => {
  emitir('state', estado({ sync: { bloqueioCompartilhamento: 'autenticacao-local' }, cfgSync: { distribution: { enabled: true } } }));
  assert.equal($('#mdCompartilhado').hidden, true);
  assert.equal($('#mdHistorico').hidden, true);
  assert.equal($('#mdFaixa').hidden, false);
  assert.match($('#mdFaixa').innerHTML, />bloqueada</);
  assert.doesNotMatch($('#mdFaixa').innerHTML, /fila distribuída/, 'bloqueada não fala de modo como se valesse');
});

test('desligada ou sem projeção de sync: nada aparece e nada explode', () => {
  emitir('state', estado({ sync: { shared: false } }));
  assert.equal($('#mdCompartilhado').hidden, true);
  assert.equal($('#mdFaixa').hidden, true);
  const semSync = estado();
  delete semSync.sync;
  assert.equal(emitir('state', semSync), 1);
  assert.equal($('#mdCompartilhado').hidden, true);
});

/* ---------- eventos SSE próprios ---------- */

test('sync-live chega à tela pelo bootstrap e desenha o andamento', () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  assert.equal(emitir('sync-live', { operacoes: [OP] }), 1, 'o bootstrap escuta sync-live');
  assert.match($('#mdOperacoes').innerHTML, /md-cancelar" data-op="op1"/);
  assert.doesNotMatch($('#mdOperacoes').innerHTML, /leitura atrasada/, 'leitura recém-chegada não é atrasada');
});

test('sync-pending chega à tela, conta as abertas e oferece decidir ao admin', () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  assert.equal(emitir('sync-pending', { pendencias: [PEND], novas: ['ab12'] }), 1, 'o bootstrap escuta sync-pending');
  assert.match($('#mdPendencias').innerHTML, /md-decidir" data-item="ab12"/);
  assert.match($('#mdPendencias').innerHTML, />nova</);
  assert.equal($('#mdPendCount').hidden, false);
});

test('sem ser admin, a pendência explica em vez de oferecer o comando', () => {
  emitir('state', estado({ sync: { admin: { ...ADMIN, souEu: false } } }));
  emitir('sync-pending', { pendencias: [PEND], novas: [] });
  assert.doesNotMatch($('#mdPendencias').innerHTML, /md-decidir/);
  assert.match($('#mdPendencias').innerHTML, /este não é o admin/);
});

test('o bootstrap só repassa: connect() entrega sync-live e sync-pending à tela', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
  const ini = fonte.indexOf('function connect()');
  const fim = fonte.indexOf('\n}\n', ini);
  const corpo = fonte.slice(ini, fim);
  assert.ok(ini > 0 && fim > ini, 'connect() existe');
  assert.match(corpo, /addEventListener\('sync-live', \(e\) => \{\s*const d = safeJsonParse\(e\.data\); if \(!d\) return;\s*aoAndamentoRemoto\(d\);\s*\}\)/);
  assert.match(corpo, /addEventListener\('sync-pending', \(e\) => \{\s*const d = safeJsonParse\(e\.data\); if \(!d\) return;\s*aoPendenciasRemotas\(d\);\s*\}\)/);
});

/* ---------- ações: o corpo do contrato, e nada antes da confirmação ---------- */

test('marcar visto manda só o itemId', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-pending', { pendencias: [PEND], novas: [] });
  RESPOSTAS['/api/sync/seen'] = { ok: true };
  assert.equal(await Tela.marcarVisto('ab12'), true);
  assert.deepEqual(pedidosPara('/api/sync/seen').map((p) => p.corpo), [{ itemId: 'ab12' }]);
  assert.match($('#mdPendencias').innerHTML, />visto</);
});

test('marcar visto que falha não finge ter marcado', async () => {
  emitir('sync-pending', { pendencias: [PEND], novas: [] });
  RESPOSTAS['/api/sync/seen'] = { ok: false, code: 'indisponivel', motivo: 'não deu' };
  assert.equal(await Tela.marcarVisto('ab12'), false);
  assert.doesNotMatch($('#mdPendencias').innerHTML, />visto</);
});

test('decidir: sem escolha nada sai; com escolha vai o comando decidir ao dono', async () => {
  const alvo = { itemId: 'ab12', dev: 'dOutro', aparelho: 'Desktop antigo' };
  assert.equal(await Tela.decidirNoAparelho(alvo, async () => null), false);
  assert.equal(PEDIDOS.length, 0);
  RESPOSTAS['/api/sync/command'] = { ok: true, cmdId: '1'.repeat(32), estado: 'enviado' };
  assert.equal(await Tela.decidirNoAparelho(alvo, async () => 'approve'), true);
  assert.deepEqual(pedidosPara('/api/sync/command').map((p) => p.corpo), [{ alvo: 'dOutro', tipo: 'decidir', args: { itemId: 'ab12', acao: 'approve' } }]);
});

test('decidir com valor fora do contrato não sai', async () => {
  assert.equal(await Tela.decidirNoAparelho({ itemId: 'ab12', dev: 'dOutro' }, async () => 'comment'), false);
  assert.equal(PEDIDOS.length, 0);
});

test('cancelar: pede confirmação antes, e manda só o prTag ao aparelho da operação', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP] });
  assert.equal(await Tela.cancelarOperacao('op1', async () => false), false);
  assert.equal(PEDIDOS.length, 0);
  RESPOSTAS['/api/sync/command'] = { ok: true, cmdId: '2'.repeat(32) };
  assert.equal(await Tela.cancelarOperacao('op1', async () => true), true);
  assert.deepEqual(pedidosPara('/api/sync/command').map((p) => p.corpo), [{ alvo: 'dOutro', tipo: 'cancelar', args: { prTag: OP.prTag } }]);
});

test('cancelar sem ser admin não sai, nem com confirmação', async () => {
  emitir('state', estado({ sync: { admin: { ...ADMIN, fresca: false } } }));
  emitir('sync-live', { operacoes: [OP] });
  assert.equal(await Tela.cancelarOperacao('op1', async () => true), false);
  assert.equal(PEDIDOS.length, 0);
});

test('tomar: sem commit no andamento, nem o aviso é pedido', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP] });
  assert.equal(await Tela.tomarOperacao('op1', async () => true), false);
  assert.equal(PEDIDOS.length, 0);
});

test('tomar: o aviso vem primeiro, e sem confirmação o comando não sai', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP_COMPLETA] });
  RESPOSTAS['/api/sync/takeover-notice'] = { ok: true, podeTomar: true, dono: 'dOutro', risco: 'provavel', aviso: 'Este PR está sendo analisado em Desktop antigo.' };
  let visto = null;
  assert.equal(await Tela.tomarOperacao('op2', async (d) => { visto = d; return false; }), false);
  assert.deepEqual(pedidosPara('/api/sync/takeover-notice').map((p) => p.corpo), [{ prKey: OP_COMPLETA.pr.key, account: 'alice' }]);
  assert.equal(pedidosPara('/api/sync/command').length, 0, 'sem confirmação, nenhum comando');
  assert.match(visto.corpo, /Duplicidade provável/, 'quem confirma viu o risco');
});

test('tomar: confirmado, o comando leva confirmado true para ESTE aparelho', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP_COMPLETA] });
  RESPOSTAS['/api/sync/takeover-notice'] = { ok: true, podeTomar: true, risco: 'possivel', aviso: 'x' };
  RESPOSTAS['/api/sync/command'] = { ok: true, cmdId: '3'.repeat(32) };
  assert.equal(await Tela.tomarOperacao('op2', async () => true), true);
  assert.deepEqual(pedidosPara('/api/sync/command').map((p) => p.corpo), [{ alvo: 'dEu', tipo: 'tomar', args: { prTag: OP_COMPLETA.prTag, matTag: OP_COMPLETA.matTag, confirmado: true } }]);
});

test('tomar: aviso que diz nada a tomar não vira comando, mesmo com confirmação', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP_COMPLETA] });
  RESPOSTAS['/api/sync/takeover-notice'] = { ok: true, podeTomar: false, motivo: 'sem-lease' };
  assert.equal(await Tela.tomarOperacao('op2', async () => true), false);
  assert.equal(pedidosPara('/api/sync/command').length, 0);
});

/* ---------- transferir ---------- */

const DESTINOS = {
  ok: true, origem: { deviceId: 'dOutro', motivo: '' },
  destinos: [
    { deviceId: 'dEu', nome: 'Notebook de teste', apto: true, motivo: '', souEu: true },
    { deviceId: 'dCel', nome: 'Celular de teste', apto: false, motivo: 'pausado', souEu: false },
  ],
};

test('transferir: com o commit no andamento o botão aparece, e sem ele o motivo', () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP, OP_COMPLETA] });
  const html = $('#mdOperacoes').innerHTML;
  assert.match(html, /md-transferir" data-op="op2"/);
  assert.doesNotMatch(html, /md-transferir" data-op="op1"/);
  assert.match(html, /Transferir: indisponível, o andamento não traz o commit/);
});

test('transferir: lista lida primeiro, escolha entre os aptos, confirmação, e o corpo exato', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP_COMPLETA] });
  RESPOSTAS['/api/sync/transfer-targets'] = DESTINOS;
  RESPOSTAS['/api/sync/command'] = { ok: true, cmdId: '4'.repeat(32) };
  let visto = null;
  let confirmacao = null;
  assert.equal(await Tela.transferirOperacao('op2', async (d) => { visto = d; return 'dEu'; }, async (c) => { confirmacao = c; return true; }), true);
  assert.deepEqual(pedidosPara('/api/sync/transfer-targets').map((p) => p.corpo), [{ dono: 'dOutro', acctTag: OP.acctTag }]);
  assert.deepEqual(visto.aptos, ['dEu']);
  assert.match(visto.corpo, /Celular de teste.*pausado pelo admin/s);
  assert.match(confirmacao.title, /Transferir para este aparelho\?/);
  assert.deepEqual(pedidosPara('/api/sync/command').map((p) => p.corpo), [{ alvo: 'dOutro', tipo: 'transferir', args: { prTag: OP_COMPLETA.prTag, matTag: OP_COMPLETA.matTag, destino: 'dEu' } }]);
});

test('transferir: destino inapto escolhido, sem confirmação ou lista que falhou não mandam nada', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  emitir('sync-live', { operacoes: [OP_COMPLETA] });
  RESPOSTAS['/api/sync/transfer-targets'] = DESTINOS;
  assert.equal(await Tela.transferirOperacao('op2', async () => 'dCel', async () => true), false, 'inapto não sai');
  assert.equal(await Tela.transferirOperacao('op2', async () => 'dEu', async () => false), false, 'sem confirmação não sai');
  RESPOSTAS['/api/sync/transfer-targets'] = null;
  let visto = null;
  assert.equal(await Tela.transferirOperacao('op2', async (d) => { visto = d; return 'dEu'; }, async () => true), false);
  assert.equal(visto.pode, false);
  assert.match(visto.corpo, /Não deu para ler/);
  assert.equal(pedidosPara('/api/sync/command').length, 0);
});

test('transferir sem ser admin, ou sem o commit, nem pede a lista', async () => {
  emitir('state', estado({ sync: { admin: { ...ADMIN, souEu: false } } }));
  emitir('sync-live', { operacoes: [OP_COMPLETA, OP] });
  assert.equal(await Tela.transferirOperacao('op2', async () => 'dEu', async () => true), false);
  emitir('state', estado({ sync: { admin: ADMIN } }));
  assert.equal(await Tela.transferirOperacao('op1', async () => 'dEu', async () => true), false);
  assert.equal(PEDIDOS.length, 0);
});

test('tomadas feitas aparecem numa lista própria, que some vazia', () => {
  emitir('state', estado({ sync: { admin: ADMIN, tomadas: [{ prKey: 'acme-exemplo/app-web#41', de: 'dOutro', para: 'dEu', geracao: 2, risco: 'provavel', at: 1 }] } }));
  assert.equal($('#mdTomadasWrap').hidden, false);
  assert.match($('#mdTomadas').innerHTML, /Desktop antigo para este aparelho/);
  emitir('state', estado({ sync: { admin: ADMIN, tomadas: [] } }));
  assert.equal($('#mdTomadasWrap').hidden, true);
  assert.equal($('#mdTomadas').innerHTML, '');
});

test('comando recusado pelo executor aparece com o motivo na lista de comandos', async () => {
  const cmd = { cmdId: '5'.repeat(32), tipo: 'transferir', alvo: 'dOutro', at: Date.now(), vence: Date.now() + 60000, prTag: OP.prTag, prKey: 'acme-exemplo/app-web#41', destino: 'dEu' };
  RESPOSTAS['/api/sync/command-status'] = { ok: true, recibo: { dev: 'dOutro', estado: 'recusado', code: 'head_mudou', at: Date.now() } };
  emitir('state', estado({ sync: { admin: ADMIN, comandosEmitidos: [cmd] } }));
  await Tela.atualizarRecibos([cmd], { forcar: true });
  assert.match($('#mdComandos').innerHTML, /sync-chip bad">recusado</);
  assert.match($('#mdComandos').innerHTML, /o commit mudou desde o pedido/);
  assert.match($('#mdComandos').innerHTML, /destino este aparelho/);
});

/* ---------- envio do histórico ---------- */

test('medir e enviar: a impressão da medida vai em cada lote até concluir', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  RESPOSTAS['/api/sync/history-measure'] = { ok: true, categorias: { revisoes: 120 }, pendentes: 120, bytes: 1000, impressao: 'imp-1' };
  const medido = await Tela.medirHistorico();
  assert.equal(medido.fase, 'medido');
  assert.match($('#mdEnvio').innerHTML, /Enviar 120 revisões/);
  const lotes = [{ ok: true, enviados: 50, restantes: 70, concluido: false }, { ok: true, enviados: 50, restantes: 20, concluido: false }, { ok: true, enviados: 20, restantes: 0, concluido: true }];
  RESPOSTAS['/api/sync/history-send'] = () => lotes.shift();
  const fim = await Tela.enviarHistorico();
  assert.equal(fim.fase, 'concluido');
  assert.deepEqual(pedidosPara('/api/sync/history-send').map((p) => p.corpo), [{ impressao: 'imp-1' }, { impressao: 'imp-1' }, { impressao: 'imp-1' }]);
  assert.match($('#mdEnvio').innerHTML, />enviado</);
});

test('enviar: medida vencida para na hora e pede medir de novo', async () => {
  RESPOSTAS['/api/sync/history-measure'] = { ok: true, categorias: { revisoes: 3 }, pendentes: 3, bytes: 10, impressao: 'imp-2' };
  await Tela.medirHistorico();
  RESPOSTAS['/api/sync/history-send'] = { ok: false, code: 'medida-vencida', motivo: 'mudou' };
  const fim = await Tela.enviarHistorico();
  assert.equal(fim.fase, 'vencida');
  assert.equal(pedidosPara('/api/sync/history-send').length, 1);
});

test('medir que falha aparece como falha, nunca como nada a enviar', async () => {
  RESPOSTAS['/api/sync/history-measure'] = null;
  const r = await Tela.medirHistorico();
  assert.equal(r.fase, 'falha');
  assert.doesNotMatch($('#mdEnvio').innerHTML, /Nada a enviar/);
  assert.match($('#mdEnvio').innerHTML, /falhou/);
});

test('enviar sem medida não chama a rota', async () => {
  RESPOSTAS['/api/sync/history-measure'] = null;
  await Tela.medirHistorico();
  PEDIDOS.length = 0;
  await Tela.enviarHistorico();
  assert.equal(pedidosPara('/api/sync/history-send').length, 0);
});

// reforço da contraprova M17: medida sem impressão não autoriza envio nenhum, porque o
// engine só aceita confirmar AQUELE conteúdo medido
test('enviar com medida sem impressão não chama a rota', async () => {
  RESPOSTAS['/api/sync/history-measure'] = { ok: true, categorias: { revisoes: 3 }, pendentes: 3, bytes: 10 };
  const medido = await Tela.medirHistorico();
  assert.equal(medido.fase, 'medido');
  await Tela.enviarHistorico();
  assert.equal(pedidosPara('/api/sync/history-send').length, 0);
});

test('revisões: a contagem das que não abriram, vinda da rota, chega ao cartão', async () => {
  emitir('state', estado({ sync: { admin: ADMIN } }));
  RESPOSTAS['/api/sync/reviews'] = { ok: true, revisoes: [], naoAbriram: 1 };
  await Tela.buscarRevisoes();
  assert.match($('#mdRevisoes').innerHTML, /1 revisão não abriu/);
  RESPOSTAS['/api/sync/reviews'] = { ok: true, revisoes: [] };
  await Tela.buscarRevisoes();
  assert.doesNotMatch($('#mdRevisoes').innerHTML, /não abriu/, 'sem contagem, nada a dizer');
});
