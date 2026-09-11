// Outbox de consumo da sincronização entre dispositivos (lib/sync/outbox.js) e a
// fiação dela no engine (lib/engine/sync-usage.js, ganchos de lib/engine/usage.js,
// flush no syncTick). O que está em jogo é a contagem de dinheiro: evento duplicado
// infla o consumo consolidado, evento perdido some dele. Por isso cada caso trava uma
// das duas direções.
//
// FAROL_HOME é fixado antes de qualquer import do repo que alcance lib/paths.js
// (os caminhos são const de nível de módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-outbox-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const outbox = await import('../lib/sync/outbox.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const syncUsage = await import('../lib/engine/sync-usage.js');
const { eventIdFor, accountHash, prHash } = await import('../lib/sync/keys.js');
const { Engine } = await import('../server.js');

const OUTBOX_FILE = path.join(FAROL_HOME, 'workspace', 'state', SYNC.OUTBOX_FILE);
const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const EMAIL2 = 'outra@b.com';
const DEV = 'aparelho-de-teste-1';
const VERSAO = '9.9.9';

// duas contas do Firebase: a troca de destino é o que o caso do cursor amarrado prova
const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' }, [EMAIL2]: { password: SENHA, uid: 'u2' } } });
const rtdb = await startFakeRtdb({ token: (t) => t === 'tok-ok' || identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function cliente() {
  return createRtdbClient({ databaseUrl: rtdb.url, projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: 'tok-ok' }) });
}

function sessao(extra = {}) {
  return {
    id: 'a1', at: 1_800_000_000_000, day: '2027-01-15', kind: 'review', ref: 'Org/Repo#7', account: 'fulano',
    model: 'Opus 5', profileId: 'perfil-1', inputTokens: 10, outputTokens: 20, cacheReadTokens: 30,
    cacheCreationTokens: 40, costUsd: 1.25, farol: '2.58.0', costSource: 'medido', status: 'ok', ...extra,
  };
}

function eventosRemotos(uid = 'u1', device = DEV) {
  const t = rtdb.tree() || {};
  return (((t.users || {})[uid] || {}).usageEvents || {})[device] || {};
}

// cliente de mentira pro caminho de falha: devolve sempre o mesmo resultado e conta
function clienteQueResponde(resultado) {
  const chamadas = [];
  return { chamadas, patch: async (p, corpo) => { chamadas.push({ p, corpo }); return resultado; } };
}

test('payloadFor: hash no lugar do texto legível, e profileId/costSource sobrevivem', () => {
  const p = outbox.payloadFor(sessao({ costSource: 'estimado' }), DEV, VERSAO);
  assert.equal(p.accountHash, accountHash('fulano'));
  assert.equal(p.refHash, prHash('Org/Repo#7'));
  assert.equal(p.profileId, 'perfil-1');
  assert.equal(p.costSource, 'estimado');
  assert.equal(p.localId, 'a1');
  assert.equal(p.status, 'ok');
  assert.equal(p.farolVersion, '2.58.0', 'a versão que gravou a sessão, não a que migrou');
  const texto = JSON.stringify(p);
  assert.equal(texto.includes('Org/Repo'), false, 'nome de PR nunca sobe');
  assert.equal(texto.includes('fulano'), false, 'login nunca sobe');
  const antiga = outbox.payloadFor(sessao({ costSource: undefined, farol: undefined, ref: 'Kudos (fulano)' }), DEV, VERSAO);
  assert.equal(antiga.costSource, 'medido', 'registro antigo sem origem conta como medido, como na aba Consumo');
  assert.equal(antiga.farolVersion, VERSAO);
  assert.equal(antiga.refHash, '', 'rótulo de ferramenta não é PR e não vira hash');
});

test('sessões com o mesmo id local em boots diferentes não colidem', () => {
  const ob = outbox.defaultOutbox();
  assert.equal(outbox.enqueueSession(ob, sessao({ id: 'a1', at: 1000 }), DEV, VERSAO), true);
  assert.equal(outbox.enqueueSession(ob, sessao({ id: 'a1', at: 2000 }), DEV, VERSAO), true);
  assert.equal(ob.pending.length, 2);
  assert.notEqual(ob.pending[0].eventId, ob.pending[1].eventId);
  assert.equal(ob.cursorAt, 2000);
});

test('migração repetida não duplica: o mesmo eventId cai no mesmo nó remoto', async () => {
  const sessions = [sessao({ id: 'a1', at: 1000 }), sessao({ id: 'a2', at: 2000 }), sessao({ id: 'a3', at: 3000 })];
  const ob = outbox.defaultOutbox();
  assert.equal(outbox.reconcileFromSessions(ob, sessions, DEV, VERSAO), 3);
  assert.equal(outbox.reconcileFromSessions(ob, sessions, DEV, VERSAO), 0, 'cursor avançado não reenfileira');
  const r1 = await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  assert.equal(r1.ok, true);
  assert.equal(r1.enviados, 3);
  assert.equal(ob.pending.length, 0);

  outbox.resetForFullSync(ob);
  assert.equal(ob.cursorAt, 0);
  assert.equal(outbox.reconcileFromSessions(ob, sessions, DEV, VERSAO), 3, 'migração reenfileira o histórico inteiro');
  const r2 = await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  assert.equal(r2.ok, true);
  const remotos = eventosRemotos();
  assert.equal(Object.keys(remotos).length, 3, 'reenviar tudo não cria evento novo');
  assert.deepEqual(Object.keys(remotos).sort(), sessions.map((s) => eventIdFor(s, DEV)).sort());
  assert.equal(ob.enviados, 6);
  assert.ok(ob.lastSentAt > 0);
});

test('crash entre o save local e a outbox: a reconciliação recupera a sessão', () => {
  const s1 = sessao({ id: 'a1', at: 1000 });
  const s2 = sessao({ id: 'a2', at: 2000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s1, DEV, VERSAO);
  assert.equal(outbox.saveOutbox(ob), true);
  // s2 foi gravada em usage-sessions.json e o processo morreu antes do gancho
  const relida = outbox.readOutbox();
  assert.equal(relida.cursorAt, 1000);
  assert.equal(outbox.reconcileFromSessions(relida, [s1, s2], DEV, VERSAO), 1);
  assert.deepEqual(relida.pending.map((e) => e.eventId), [eventIdFor(s1, DEV), eventIdFor(s2, DEV)]);
  fs.rmSync(OUTBOX_FILE, { force: true });
});

test('correção de status reenvia o MESMO eventId com o status novo', async () => {
  const s = sessao({ id: 'a9', at: 9000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  const id = eventIdFor(s, DEV);
  assert.equal(eventosRemotos()[id].status, 'ok');
  s.status = 'descartada';
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  assert.equal(ob.pending.length, 1);
  assert.equal(ob.pending[0].eventId, id);
  await outbox.flushOutbox(cliente(), 'u1', DEV, ob);
  assert.equal(eventosRemotos()[id].status, 'descartada');
});

// A correção que chega ANTES do envio tem que substituir a entrada, não se somar a
// ela: duas entradas do mesmo eventId inflariam pendentes e enviados, e uma recusa de
// lote contaria o mesmo evento duas vezes.
test('correção antes do envio substitui a entrada: um eventId, um pendente, o payload novo', () => {
  const s = sessao({ id: 'a12', at: 12000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  outbox.enqueueSession(ob, { ...s, status: 'descartada' }, DEV, VERSAO);
  assert.equal(ob.pending.length, 1, 'a correção não vira uma segunda entrada');
  assert.equal(ob.pending[0].eventId, eventIdFor(s, DEV));
  assert.equal(ob.pending[0].payload.status, 'descartada');
});

test('correção que chega durante o envio não se perde', async () => {
  const s = sessao({ id: 'a10', at: 10000 });
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, s, DEV, VERSAO);
  const lento = {
    patch: async () => {
      outbox.enqueueSession(ob, { ...s, status: 'erro' }, DEV, VERSAO);
      return { ok: true, status: 200, data: {} };
    },
  };
  const r = await outbox.flushOutbox(lento, 'u1', DEV, ob);
  assert.equal(r.ok, true);
  assert.equal(ob.pending.length, 1, 'o payload corrigido fica para o próximo envio');
  assert.equal(ob.pending[0].payload.status, 'erro');
});

test('rede caída, timeout e token recusado mantêm tudo pendente, sem contar rejeição', async () => {
  for (const code of ['indisponivel', 'timeout', 'nao_autorizado']) {
    const ob = outbox.defaultOutbox();
    outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
    const c = clienteQueResponde({ ok: false, code, status: 0, motivo: 'x' });
    for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES + 2; i++) {
      const r = await outbox.flushOutbox(c, 'u1', DEV, ob);
      assert.equal(r.ok, false);
      assert.equal(r.code, code);
    }
    assert.equal(ob.pending.length, 1, code);
    assert.equal(ob.pending[0].tentativas, 0, code);
    assert.equal(ob.rejeitados, 0, code);
    assert.equal(ob.paused, true, 'envio pausado enquanto o banco não responde');
  }
});

test('4xx repetido vai para rejeitados depois de OUTBOX_MAX_REJEICOES', async () => {
  const ob = outbox.defaultOutbox();
  outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
  const c = clienteQueResponde({ ok: false, code: 'resposta_invalida', status: 400, motivo: 'x' });
  for (let i = 1; i < SYNC.OUTBOX_MAX_REJEICOES; i++) {
    await outbox.flushOutbox(c, 'u1', DEV, ob);
    assert.equal(ob.pending.length, 1, `tentativa ${i} ainda pendente`);
  }
  await outbox.flushOutbox(c, 'u1', DEV, ob);
  assert.equal(ob.pending.length, 0);
  assert.equal(ob.rejeitados, 1);
});

test('evento recusado não arrasta os vizinhos do lote para rejeitados', async () => {
  const ob = outbox.defaultOutbox();
  const ruim = sessao({ id: 'ruim', at: 1 });
  for (const s of [ruim, sessao({ id: 'b1', at: 2 }), sessao({ id: 'b2', at: 3 })]) outbox.enqueueSession(ob, s, DEV, VERSAO);
  const idRuim = eventIdFor(ruim, DEV);
  const seletivo = {
    patch: async (p, corpo) => (corpo[idRuim] ? { ok: false, code: 'resposta_invalida', status: 400 } : { ok: true, status: 200, data: {} }),
  };
  for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES * 3 && ob.pending.length; i++) await outbox.flushOutbox(seletivo, 'u1', DEV, ob);
  assert.equal(ob.pending.length, 0);
  assert.equal(ob.rejeitados, 1, 'só o evento ruim foi rejeitado');
  assert.equal(ob.enviados, 2);
});

// cliente REAL do banco com a resposta HTTP fixa: o que decide rejeitar ou pausar é o
// status que chega do fio, e um cliente de mentira esconderia a tradução status -> código
function clienteHttp(status, corpo, tipo = 'application/json', observar = () => {}) {
  return createRtdbClient({
    databaseUrl: 'http://127.0.0.1:9', projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: 'tok-ok' }),
    fetchImpl: async (url, init) => {
      observar(init);
      return new Response(corpo, { status, headers: { 'content-type': tipo } });
    },
  });
}

test('rate limit, proxy e portal cativo pausam: nenhum deles tira evento da fila', async () => {
  const casos = [
    ['429 Too Many Requests', 429, '{"error":"Too Many Requests"}'],
    ['408 Request Timeout', 408, '{"error":"Request Timeout"}'],
    ['407 proxy', 407, '<html>autentique no proxy</html>', 'text/html'],
    ['403 proxy corporativo', 403, '<html>bloqueado</html>', 'text/html'],
    ['200 HTML de portal cativo', 200, '<html>entre na rede</html>', 'text/html'],
  ];
  for (const [nome, status, corpo, tipo] of casos) {
    const ob = outbox.defaultOutbox();
    outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
    const c = clienteHttp(status, corpo, tipo);
    for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES; i++) assert.equal((await outbox.flushOutbox(c, 'u1', DEV, ob)).ok, false, nome);
    assert.equal(ob.pending.length, 1, `${nome}: o pendente fica intacto`);
    assert.equal(ob.pending[0].tentativas, 0, `${nome}: não conta tentativa`);
    assert.equal(ob.rejeitados, 0, nome);
    assert.equal(ob.paused, true, nome);
  }
});

test('400 e 413 do evento sozinho são recusa dele e levam a rejeitados', async () => {
  for (const status of [400, 413]) {
    const ob = outbox.defaultOutbox();
    outbox.enqueueSession(ob, sessao(), DEV, VERSAO);
    const c = clienteHttp(status, '{"error":"recusado"}');
    for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES; i++) await outbox.flushOutbox(c, 'u1', DEV, ob);
    assert.equal(ob.pending.length, 0, String(status));
    assert.equal(ob.rejeitados, 1, String(status));
  }
});

test('413 de lote não rejeita evento bom: o envio passa a ser de um em um', async () => {
  const ob = outbox.defaultOutbox();
  for (const s of [sessao({ id: 'g1', at: 1 }), sessao({ id: 'g2', at: 2 }), sessao({ id: 'g3', at: 3 })]) outbox.enqueueSession(ob, s, DEV, VERSAO);
  const c = createRtdbClient({
    databaseUrl: 'http://127.0.0.1:9', projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: 'tok-ok' }),
    fetchImpl: async (url, init) => {
      const grande = Object.keys(JSON.parse(init.body)).length > 1;
      return new Response(grande ? '{"error":"Payload Too Large"}' : '{}', { status: grande ? 413 : 200, headers: { 'content-type': 'application/json' } });
    },
  });
  for (let i = 0; i < SYNC.OUTBOX_MAX_REJEICOES * 3 && ob.pending.length; i++) await outbox.flushOutbox(c, 'u1', DEV, ob);
  assert.equal(ob.pending.length, 0);
  assert.equal(ob.rejeitados, 0, 'nenhum evento bom foi descartado');
  assert.equal(ob.enviados, 3);
});

// ---------- fiação no engine ----------

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

async function salvarSync(engine, cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

const RESULTADO = { usage: { input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.5 };

test('consolidação desligada nunca grava sync-outbox.json', async () => {
  const semSync = new Engine();
  assert.equal(semSync.syncEnqueueUsage(sessao()), false);
  semSync.recordUsage('a1', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#1');
  await semSync.syncTick();
  assert.equal(fs.existsSync(OUTBOX_FILE), false);

  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg());
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const envios = () => rtdb.requests.filter((r) => r.path.includes('/usageEvents/')).length;
  const enviosAntes = envios();
  engine.recordUsage('a2', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#2');
  engine.marcarDesfecho('a2', 'descartada');
  await engine.syncTick();
  assert.equal(fs.existsSync(OUTBOX_FILE), false, 'sincronização ligada sem consolidação não escreve outbox');
  assert.equal(engine.snapshot().sync.outbox, null);
  assert.equal(envios(), enviosAntes, 'nenhum evento de consumo subiu');
});

test('flush no syncTick: sessão nova e correção de desfecho sobem com o mesmo eventId', async () => {
  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const deviceId = engine.sync.deviceId;
  const antes = engine.usageSessions.sessions.length;

  engine.recordUsage('a7', 'Fulano', RESULTADO, 'opus', 'perfil-7', 'Org/Repo#7');
  assert.ok(fs.existsSync(OUTBOX_FILE), 'o gancho gravou a outbox depois do save local');
  const registro = engine.usageSessions.sessions.at(-1);
  const id = eventIdFor(registro, deviceId);

  await engine.syncTick();
  const remoto = eventosRemotos('u1', deviceId);
  assert.equal(Object.keys(remoto).length, antes + 1, 'o histórico anterior sobe junto (migração inicial)');
  assert.equal(remoto[id].status, 'ok');
  assert.equal(remoto[id].profileId, 'perfil-7');
  assert.equal(remoto[id].costSource, 'medido');
  const ob = engine.snapshot().sync.outbox;
  assert.equal(ob.pendentes, 0);
  assert.ok(ob.enviados >= 1);

  engine.marcarDesfecho('a7', 'descartada');
  await engine.syncTick();
  assert.equal(eventosRemotos('u1', deviceId)[id].status, 'descartada');
  assert.equal(Object.keys(eventosRemotos('u1', deviceId)).length, antes + 1, 'correção não cria evento');
});

test('sessão perdida no caminho pra outbox volta quando o engine reabre', async () => {
  const deviceId = JSON.parse(fs.readFileSync(path.join(FAROL_HOME, 'workspace', 'state', SYNC.DEVICE_FILE), 'utf8')).deviceId;
  const anterior = new Engine();
  // simula o processo morto entre saveSessions e o gancho: a sessão entra no disco sem passar pela outbox
  anterior.syncEnqueueUsage = undefined;
  anterior.recordUsage('a8', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#8');
  const perdida = anterior.usageSessions.sessions.at(-1);

  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  await engine.syncTick();
  assert.ok(eventosRemotos('u1', deviceId)[eventIdFor(perdida, deviceId)], 'a reconciliação pegou a sessão pelo cursor');
});

// O 401 do banco também é a recusa de uma REGRA sobre o próprio evento. Com a
// coordenação ligada, tratar a recusa de usageEvents como queda do banco derrubava o
// status em tick sim, tick não, e cada tick 'erro' segurava a revisão automática.
test('recusa do consumo não derruba a coordenação: 401 só em usageEvents deixa a automação livre', async () => {
  const engine = new Engine();
  const logs = [];
  engine.log = (nivel, msg) => logs.push(`${nivel} ${msg}`);
  engine.sync.fetchImpl = async (url, init) => {
    if (init && init.method === 'PATCH' && String(url).includes('/usageEvents/')) {
      return new Response('{"error":"Permission denied"}', { status: 401, headers: { 'content-type': 'application/json' } });
    }
    return fetchDosDubles(url, init);
  };
  await salvarSync(engine, syncCfg({ coordination: { enabled: true }, consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  engine.recordUsage('a11', 'fulano', RESULTADO, 'opus', 'perfil-1', 'o/r#11');
  for (let i = 0; i < 4; i++) {
    await engine.syncTick();
    assert.equal(engine.sync.status, 'conectado', `tick ${i}: o consumo não decide o estado da conexão`);
    assert.equal(engine.syncSeguraAutomacao('o/r#11'), false, `tick ${i}: a automação segue livre`);
  }
  const ob = engine.snapshot().sync.outbox;
  assert.ok(ob.pendentes >= 1, 'o evento recusado fica na fila');
  assert.equal(ob.rejeitados, 0);
  assert.equal(ob.paused, true, 'o envio de consumo fica pausado');
  assert.equal(logs.some((l) => /coordena[cç][aã]o entre dispositivos indispon/i.test(l)), false, 'recusa de consumo não vira queda da coordenação no log');
  assert.equal(logs.filter((l) => l.includes('consumo entre dispositivos') && l.includes('nao_autorizado')).length, 1, 'a pausa do consumo loga uma vez só');
});

// M4: o destino era relido a cada lote. Logout ou reconexão no meio do laço deixava
// rt.client null e o lote seguinte lançava TypeError DENTRO do tick, contra a regra de
// que nada do consumo lança para o engine.
test('conexão trocada no meio do envio para o laço, em vez de lançar', async () => {
  const ob = outbox.defaultOutbox();
  for (let i = 0; i < 60; i++) outbox.enqueueSession(ob, sessao({ id: `m${i}`, at: 1_800_000_000_000 + i }), DEV, VERSAO);
  const rt = { status: 'conectado', uid: 'u1', deviceId: DEV, geracao: 1, outbox: ob, client: null, enviandoConsumo: null };
  // o primeiro lote sobe e, no meio dele, alguém desliga a conexão (logout, troca de conta)
  rt.client = { patch: async () => { rt.client = null; rt.geracao += 1; return { ok: true }; } };
  const engine = {
    config: { sync: { enabled: true, consolidation: { enabled: true }, databaseUrl: rtdb.url } },
    sync: rt, usageSessions: { sessions: [] },
  };
  const r = await syncUsage.flushUsage(engine);
  assert.equal(r.ok, true);
  assert.equal(r.enviados, SYNC.OUTBOX_BATCH, 'o lote que estava em voo foi contado');
  assert.equal(ob.pending.length, 60 - SYNC.OUTBOX_BATCH, 'o resto fica para o próximo tick, com o destino novo');
  // este caso escreve no sync-outbox.json compartilhado do FAROL_HOME do arquivo: sem
  // limpar, os pendentes de mentira entrariam no envio dos casos seguintes
  fs.rmSync(OUTBOX_FILE, { force: true });
});

// M5: o cursor quer dizer "tudo até aqui já subiu", e isso só vale PARA UM DESTINO.
test('retargetOutbox: destino novo zera o cursor; o mesmo destino e o destino vazio não mexem', () => {
  const ob = outbox.defaultOutbox();
  ob.cursorAt = 999;
  assert.equal(outbox.retargetOutbox(ob, ''), false, 'sem uid não há destino a marcar');
  assert.equal(ob.cursorAt, 999);
  const destino = outbox.outboxTarget('u1', `${rtdb.url}/`);
  assert.equal(destino, outbox.outboxTarget('u1', rtdb.url), 'barra no fim não é outro destino');
  assert.equal(outbox.retargetOutbox(ob, destino), true);
  assert.equal(ob.cursorAt, 0);
  ob.cursorAt = 42;
  assert.equal(outbox.retargetOutbox(ob, destino), false);
  assert.equal(ob.cursorAt, 42, 'o mesmo destino não refaz a migração a cada tick');
});

test('trocar a conta do Firebase manda o histórico inteiro para o destino novo', async () => {
  const engine = new Engine();
  engine.sync.fetchImpl = fetchDosDubles;
  await salvarSync(engine, syncCfg({ consolidation: { enabled: true } }));
  if (engine.sync.status !== 'conectado') assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  const deviceId = engine.sync.deviceId;
  engine.recordUsage('a9', 'Fulano', RESULTADO, 'opus', 'perfil-9', 'Org/Repo#9');
  await engine.syncTick();
  const noPrimeiro = Object.keys(eventosRemotos('u1', deviceId)).length;
  assert.ok(noPrimeiro >= 1, 'o destino antigo recebeu o histórico');
  assert.equal(engine.sync.outbox.pending.length, 0, 'a fila esvaziou no destino antigo');

  engine.syncLogout();
  assert.equal((await engine.syncLogin({ email: EMAIL2, password: SENHA })).ok, true);
  assert.equal(engine.sync.uid, 'u2');
  await engine.syncTick();
  assert.equal(Object.keys(eventosRemotos('u2', deviceId)).length, noPrimeiro, 'o destino novo recebe tudo, não só o que vier depois');
});
