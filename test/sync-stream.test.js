// Tempo real da coordenação (lib/engine/sync-stream.js): o stream SSE dos leases, a
// árvore remota em memória e a derivação de leasesVistos que a tela mostra.
//
// A derivação é PURA e testada à parte. O ciclo de vida roda contra os dublês do
// Firebase com a Engine REAL (login de verdade no dublê do Auth, como em
// test/sync-engine.test.js), e o tempo do stream (vigia de inatividade e espera de
// reconexão) entra por um agendador que o teste dispara à mão: nenhum caso dorme o
// tempo de verdade.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-stream-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';
import { accountHash, prHash } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const stream = await import('../lib/engine/sync-stream.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { acquireLease, releaseLease } = await import('../lib/sync/lease.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-do-teste';
const TOKEN_OUTRO = 'tok-do-outro-aparelho';
const CONTA = 'eu';
const PR_CONHECIDO = 'Org/Repo#7';
const PR_MEU = 'Org/Repo#8';
const PR_VENCIDO = 'Org/Repo#9';
const PR_DESCONHECIDO = 'Org/Outro#1';

const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
// o banco aceita os ID tokens que o Auth de mentira emitiu, e o do "outro aparelho"
const rtdb = await startFakeRtdb({ token: (t) => t === TOKEN_OUTRO || identity.tokens.idTokens.includes(t) });

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const rede = { fora: false };
async function fetchDosDubles(url, init) {
  if (rede.fora) throw new TypeError('fetch failed');
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

// agendador de mentira: guarda cada timer e só dispara quando o teste manda
const timers = [];
const agendador = {
  setTimeout(fn, ms) { const t = { fn, ms, vivo: true }; timers.push(t); return t; },
  clearTimeout(t) { if (t) t.vivo = false; },
};
function vivos(ms) { return timers.filter((t) => t.vivo && t.ms === ms); }
function disparar(ms) {
  const t = vivos(ms).at(-1);
  assert.ok(t, `nenhum timer vivo de ${ms} ms para disparar`);
  t.vivo = false;
  t.fn();
}

// espera de I/O real (o dublê responde por socket); o tempo do stream NÃO passa por aqui
async function ate(cond, rotulo) {
  const limite = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function pedidosDeStream() {
  return rtdb.requests.filter((r) => r.method === 'GET' && String(r.headers.accept || '').includes('text/event-stream')).length;
}

const outro = createRtdbClient({ databaseUrl: rtdb.url, getIdToken: async () => ({ ok: true, idToken: TOKEN_OUTRO }) });
function ids(prKey) { return { uid: 'u1', accountHash: accountHash(CONTA), prHash: prHash(prKey) }; }
function dadosDoLease(leaseId, deviceId, nowMs = Date.now()) {
  return { leaseId, deviceId, operationKind: 'review', headSha: 'abc123', nowMs, farolVersion: '9.9.9' };
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

// --- derivação pura ---------------------------------------------------------------

test('aplicarEvento: put substitui o nó do caminho, data null apaga e o vazio some', () => {
  let arv = stream.aplicarEvento(null, { event: 'put', data: { path: '/', data: { a: { p1: { x: 1 } } } } });
  assert.deepEqual(arv, { a: { p1: { x: 1 } } });
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p2', data: { y: 2 } } });
  assert.deepEqual(arv, { a: { p1: { x: 1 }, p2: { y: 2 } } });
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p1', data: { z: 3 } } });
  assert.deepEqual(arv.a.p1, { z: 3 }, 'put troca o nó inteiro, não mescla');
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p1', data: null } });
  arv = stream.aplicarEvento(arv, { event: 'put', data: { path: '/a/p2', data: null } });
  assert.equal(arv, null, 'apagar o último filho apaga os pais vazios, como o banco');
});

test('aplicarEvento: patch mescla chave a chave, aceita caminho na chave e null apaga só a chave', () => {
  const base = { a: { p1: { x: 1 }, p2: { y: 2 } } };
  const arv = stream.aplicarEvento(base, { event: 'patch', data: { path: '/a', data: { p1: null, p3: { w: 4 }, 'p2/y': 5 } } });
  assert.deepEqual(arv, { a: { p2: { y: 5 }, p3: { w: 4 } } });
  assert.deepEqual(base, { a: { p1: { x: 1 }, p2: { y: 2 } } }, 'a árvore anterior não é mutada');
});

test('aplicarEvento: evento sem forma, de outro tipo ou com chave vazia não mexe na árvore', () => {
  const base = { a: { p1: { x: 1 } } };
  assert.equal(stream.aplicarEvento(base, { event: 'put', data: null }), base);
  assert.equal(stream.aplicarEvento(base, { event: 'put', data: { data: 1 } }), base, 'sem path');
  assert.equal(stream.aplicarEvento(base, { event: 'keep-alive', data: null }), base);
  assert.equal(stream.aplicarEvento(base, { event: 'patch', data: { path: '/a', data: 7 } }), base);
  assert.deepEqual(stream.aplicarEvento(base, { event: 'patch', data: { path: '/a', data: { '': 1 } } }), base, 'chave vazia não troca o nó inteiro');
});

test('mapaDePrs: cada PR conhecido vira accountHash/prHash da conta dona; PR sem chave válida fica fora', () => {
  const contaDe = (p) => p.account;
  const mapa = stream.mapaDePrs([
    { key: PR_CONHECIDO, account: 'Eu' }, { key: 'lixo', account: 'eu' }, null, { account: 'eu' },
  ], contaDe);
  assert.equal(mapa.size, 1);
  assert.equal(mapa.get(`${accountHash('eu')}/${prHash('org/repo#7')}`), PR_CONHECIDO, 'login e dono/repo sem diferença de caixa');
});

test('leasesVistosDe: só lease vivo de OUTRO aparelho em PR conhecido; o resto conta em outros ou some', () => {
  const agora = 1_800_000_000_000;
  const ah = accountHash(CONTA);
  const lease = (deviceId, expiresAt) => ({ leaseId: 'L', deviceId, operationKind: 'self', acquiredAt: agora - 10, expiresAt });
  const arvore = { [ah]: {
    [prHash(PR_CONHECIDO)]: lease('dev-outro', agora + 1),
    [prHash(PR_MEU)]: lease('dev-eu', agora + 1),
    [prHash(PR_VENCIDO)]: lease('dev-outro', agora),
    [prHash(PR_DESCONHECIDO)]: lease('dev-outro', agora + 1),
    [prHash('Org/Repo#10')]: { leaseId: 'L', deviceId: 'dev-outro' },
  } };
  const conhecidos = stream.mapaDePrs([PR_CONHECIDO, PR_MEU, PR_VENCIDO, 'Org/Repo#10'].map((key) => ({ key })), () => CONTA);
  const r = stream.leasesVistosDe(arvore, { euDeviceId: 'dev-eu', nowMs: agora, conhecidos, devices: { 'dev-outro': { name: 'Notebook' } } });
  assert.deepEqual(r.vistos, { [PR_CONHECIDO]: { deviceId: 'dev-outro', deviceName: 'Notebook', since: agora - 10, operationKind: 'self' } });
  assert.equal(r.outros, 1, 'lease vivo em PR que este aparelho não acompanha só conta');
  assert.deepEqual(stream.leasesVistosDe(null, { euDeviceId: 'dev-eu', nowMs: agora, conhecidos, devices: {} }), { vistos: {}, outros: 0 });
});

test('proximoVencimentoDe: o menor expiresAt entre os leases que a visão mostra ou conta; nenhum dá 0', () => {
  const agora = 1_800_000_000_000;
  const ah = accountHash(CONTA);
  const arvore = { [ah]: {
    [prHash(PR_CONHECIDO)]: { deviceId: 'dev-outro', expiresAt: agora + 5000 },
    [prHash(PR_DESCONHECIDO)]: { deviceId: 'dev-outro', expiresAt: agora + 3000 },
    [prHash(PR_MEU)]: { deviceId: 'dev-eu', expiresAt: agora + 1000 },
    [prHash(PR_VENCIDO)]: { deviceId: 'dev-outro', expiresAt: agora },
    [prHash('Org/Repo#10')]: { deviceId: 'dev-outro' },
  } };
  assert.equal(stream.proximoVencimentoDe(arvore, { euDeviceId: 'dev-eu', nowMs: agora }), agora + 3000,
    'lease de PR desconhecido também vence e muda a contagem de outros');
  assert.equal(stream.proximoVencimentoDe(null, { euDeviceId: 'dev-eu', nowMs: agora }), 0);
});

test('fecharStream desarma o timer do vencimento', () => {
  const t = agendador.setTimeout(() => { throw new Error('o timer do vencimento não podia disparar depois de fechar'); }, 1234);
  const rt = { agendadorStream: agendador, stream: { fechado: false, vigia: null, espera: null, controle: null, acordar: null, vencimento: t } };
  assert.equal(stream.fecharStream(rt), true);
  assert.equal(t.vivo, false);
});

// --- ciclo de vida contra os dublês --------------------------------------------------

const engine = new Engine();
engine.sync.fetchImpl = fetchDosDubles;
engine.sync.agendadorStream = agendador;
engine.panorama = [{ key: PR_CONHECIDO, url: 'https://github.com/Org/Repo/pull/7', repo: 'Org/Repo', number: 7, account: CONTA }];
engine.queue = [{ key: PR_VENCIDO, url: 'https://github.com/Org/Repo/pull/9', repo: 'Org/Repo', number: 9, account: CONTA }];
engine.myPRs = [{ key: PR_MEU, url: 'https://github.com/Org/Repo/pull/8', repo: 'Org/Repo', number: 8, account: CONTA }];
let pushes = 0;
engine.pushState = () => { pushes++; };
const logs = [];
engine.log = (nivel, msg) => { logs.push({ nivel, msg }); };

async function salvarSync(cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

test('coordenação desligada: conectar nunca abre stream', async () => {
  // o outro aparelho existe no banco antes do login, com nome, para a tela poder nomeá-lo
  assert.equal((await outro.patch('/users/u1/devices/dev-outro', { name: 'Notebook', platform: 'linux' })).ok, true);
  await salvarSync(syncCfg());
  const r = await engine.syncLogin({ email: EMAIL, password: SENHA });
  assert.equal(r.ok, true);
  assert.equal(engine.sync.status, 'conectado');
  await engine.syncTick();
  assert.equal(engine.sync.stream, null);
  assert.equal(pedidosDeStream(), 0);
  assert.equal(rtdb.streams, 0);
});

test('ligar a coordenação com a conexão de pé abre o stream em /users/{uid}/leases', async () => {
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  await ate(() => rtdb.streams === 1, 'stream aberto');
  const req = rtdb.requests.filter((q) => String(q.headers.accept || '').includes('text/event-stream')).at(-1);
  assert.equal(req.path, '/users/u1/leases.json');
});

test('outro aparelho adquire lease de PR conhecido: leasesVistos ganha o PR com o nome dele', async () => {
  const antes = pushes;
  const a = await acquireLease(outro, ids(PR_CONHECIDO), dadosDoLease('L-outro', 'dev-outro'));
  assert.equal(a.ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto');
  const visto = engine.sync.leasesVistos[PR_CONHECIDO];
  assert.equal(visto.deviceId, 'dev-outro');
  assert.equal(visto.deviceName, 'Notebook');
  assert.equal(visto.operationKind, 'review');
  assert.equal(visto.since, a.lease.acquiredAt);
  assert.ok(pushes > antes, 'a tela é avisada quando a visão muda');
  const s = engine.snapshot().sync;
  assert.deepEqual(s.leasesVistos[PR_CONHECIDO], visto);
  assert.equal(s.leasesOutros, 0);
});

test('lease do próprio aparelho, lease vencido e PR desconhecido não entram na visão', async () => {
  assert.equal((await acquireLease(outro, ids(PR_MEU), dadosDoLease('L-meu', engine.sync.deviceId))).ok, true);
  assert.equal((await acquireLease(outro, ids(PR_VENCIDO), dadosDoLease('L-velho', 'dev-outro', Date.now() - 10 * SYNC.LEASE_TTL_MS))).ok, true);
  assert.equal((await acquireLease(outro, ids(PR_DESCONHECIDO), dadosDoLease('L-x', 'dev-outro'))).ok, true);
  await ate(() => engine.sync.leasesOutros === 1, 'lease de PR desconhecido contado');
  assert.deepEqual(Object.keys(engine.sync.leasesVistos), [PR_CONHECIDO]);
  assert.equal(engine.snapshot().sync.leasesOutros, 1);
  const texto = JSON.stringify(engine.snapshot().sync);
  assert.equal(texto.includes(PR_DESCONHECIDO), false, 'o nome do PR desconhecido nunca aparece');
  assert.equal(texto.includes('auth='), false);
});

test('o release some com o PR da visão', async () => {
  const r = await releaseLease(outro, ids(PR_CONHECIDO), { leaseId: 'L-outro' });
  assert.equal(r.released, true);
  await ate(() => !engine.sync.leasesVistos[PR_CONHECIDO], 'lease solto');
  assert.deepEqual(engine.sync.leasesVistos, {});
});

// Atualizado DE PROPÓSITO na C0 (defeito 4). A versão anterior travava o comportamento
// "sai no tick seguinte": o lease de um aparelho que morreu não gera evento, e a tela o
// mostrava até o próximo ciclo de polling. Agora um timer acorda no menor vencimento
// visível e recalcula a visão sozinho. O relógio anda à mão, como antes, porque o que
// está sob teste é o lease vencer sem evento nenhum, não o socket ser rápido.
test('lease que vence sem evento nenhum sai da visão no timer do vencimento, sem ciclo', async () => {
  const relogio = engine.sync.agora;
  assert.equal((await acquireLease(outro, ids(PR_CONHECIDO), dadosDoLease('L-curto', 'dev-outro'))).ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease curto visto');
  const t = engine.sync.stream.vencimento;
  assert.ok(t && t.vivo, 'há um timer armado no menor vencimento visível');
  assert.ok(t.ms > 0 && t.ms <= SYNC.LEASE_TTL_MS, 'a espera vai até o vencimento, não até o ciclo');
  const antes = pushes;
  engine.sync.agora = () => relogio() + SYNC.LEASE_TTL_MS + 1000;
  try {
    t.vivo = false;
    t.fn();
    assert.equal(engine.sync.leasesVistos[PR_CONHECIDO], undefined, 'saiu da visão sem syncTick');
    assert.ok(pushes > antes, 'a tela é avisada');
  } finally {
    engine.sync.agora = relogio;
  }
  await releaseLease(outro, ids(PR_CONHECIDO), { leaseId: 'L-curto' });
});

test('auth_revoked invalida o token e reabre na hora', async () => {
  let invalidou = 0;
  const original = engine.sync.tokenSource.invalidate;
  engine.sync.tokenSource.invalidate = () => { invalidou++; original(); };
  const antes = pedidosDeStream();
  rtdb.emitirAuthRevoked();
  await ate(() => pedidosDeStream() === antes + 1 && rtdb.streams === 1, 'stream reaberto');
  assert.equal(invalidou, 1);
});

test('inatividade além de STREAM_IDLE_MS derruba a conexão e reconecta com espera', async () => {
  assert.equal(SYNC.STREAM_IDLE_MS, 90 * 1000);
  const antes = pedidosDeStream();
  disparar(SYNC.STREAM_IDLE_MS);
  await ate(() => rtdb.streams === 0, 'conexão derrubada');
  await ate(() => vivos(SYNC.STREAM_RECONNECT_MS).length === 1, 'reconexão agendada');
  assert.equal(pedidosDeStream(), antes, 'nada reabre antes da espera');
  disparar(SYNC.STREAM_RECONNECT_MS);
  await ate(() => pedidosDeStream() === antes + 1 && rtdb.streams === 1, 'stream reaberto');
});

test('cancel fecha, loga WARN uma vez e reabre com espera', async () => {
  const warns = () => logs.filter((l) => l.nivel === 'WARN' && /stream/.test(l.msg)).length;
  rtdb.emitirCancel();
  await ate(() => vivos(SYNC.STREAM_RECONNECT_MS).length === 1, 'reconexão agendada');
  assert.equal(warns(), 1);
  assert.doesNotMatch(logs.at(-1).msg, /auth=/);
  disparar(SYNC.STREAM_RECONNECT_MS);
  await ate(() => rtdb.streams === 1 && engine.sync.stream.esperaMs === SYNC.STREAM_RECONNECT_MS, 'stream reaberto e são');
  assert.equal(warns(), 1, 'reabrir não loga');
  // o put inicial da reconexão provou que o stream voltou são: um cancel novo é outro episódio
  rtdb.emitirCancel();
  await ate(() => warns() === 2, 'segundo episódio logado');
  await ate(() => vivos(SYNC.STREAM_RECONNECT_MS).length === 1, 'reconexão agendada');
  disparar(SYNC.STREAM_RECONNECT_MS);
  await ate(() => rtdb.streams === 1, 'stream reaberto');
});

test('sem rede, a espera dobra até STREAM_RECONNECT_MAX_MS e volta ao mínimo quando o stream responde', async () => {
  // o timer do vencimento (C0) também vive no agendador e não é espera de reconexão
  const esperaAgendada = () => timers.filter((t) => t.vivo && t.ms !== SYNC.STREAM_IDLE_MS && t !== (engine.sync.stream && engine.sync.stream.vencimento)).at(-1);
  rede.fora = true;
  rtdb.fecharStreams();
  const esperas = [];
  for (let i = 0; i < 6; i++) {
    await ate(() => esperaAgendada(), 'espera agendada');
    const t = esperaAgendada();
    esperas.push(t.ms);
    t.vivo = false;
    t.fn();
  }
  // a sexta tentativa também falha: a espera seguinte continua no teto
  await ate(() => esperaAgendada(), 'sétima espera');
  esperas.push(esperaAgendada().ms);
  const base = SYNC.STREAM_RECONNECT_MS;
  const teto = SYNC.STREAM_RECONNECT_MAX_MS;
  assert.deepEqual(esperas, [base, base * 2, base * 4, base * 8, teto, teto, teto]);
  rede.fora = false;
  const t = esperaAgendada();
  t.vivo = false;
  t.fn();
  await ate(() => rtdb.streams === 1 && engine.sync.stream.esperaMs === base, 'o put inicial zera o backoff');
});

test('desligar a coordenação fecha o stream e limpa a visão', async () => {
  assert.equal((await acquireLease(outro, ids(PR_CONHECIDO), dadosDoLease('L-2', 'dev-outro'))).ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto');
  await salvarSync(syncCfg());
  await ate(() => rtdb.streams === 0, 'stream fechado');
  assert.equal(engine.sync.stream, null);
  assert.deepEqual(engine.sync.leasesVistos, {});
  assert.equal(engine.sync.leasesOutros, 0);
});

test('startSync com a coordenação ligada abre o stream no fim; stopSync fecha', async () => {
  engine.syncLogout();
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal(rtdb.streams, 0, 'sem login não há stream');
  const r = await engine.syncLogin({ email: EMAIL, password: SENHA });
  assert.equal(r.ok, true);
  await ate(() => rtdb.streams === 1, 'stream aberto no fim do startSync');
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto pela conexão nova');
  engine.syncLogout();
  await ate(() => rtdb.streams === 0, 'stream fechado pelo stopSync');
  assert.equal(engine.sync.stream, null);
  assert.deepEqual(engine.sync.leasesVistos, {});
});

// A visão só é recalculada enquanto o stream corre. Soltar a conexão sem zerá-la deixava
// na tela, por tempo indefinido, "outro aparelho está analisando" apoiado num lease de
// dois minutos — e a reconexão que FALHA nunca mais passa por sincronizarStream.
test('reconexão que falha não deixa a visão de outro aparelho envelhecer na tela', async () => {
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  await ate(() => engine.sync.leasesVistos[PR_CONHECIDO], 'lease visto antes da queda');
  rede.fora = true;
  try {
    // projectId novo muda a assinatura da conexão: é reconexão, não ajuste de coordenação
    await salvarSync(syncCfg({ coordination: { enabled: true }, projectId: 'outro-projeto' }));
  } finally {
    rede.fora = false;
  }
  assert.equal(engine.sync.status, 'erro');
  assert.equal(engine.sync.stream, null);
  assert.deepEqual(engine.sync.leasesVistos, {}, 'sem stream ninguém recalcula: a visão não pode ficar');
  assert.equal(engine.sync.leasesOutros, 0);
});
