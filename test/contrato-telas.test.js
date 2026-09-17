// Contrato das telas (brief B2, seção 5): cada rota nova vai até o efeito e a resposta, pelo
// servidor HTTP real, com o banco e a identidade falsos. Sem conta real, sem rede de fora.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-contrato-telas-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag } = await import('../lib/sync/tags.js');
const { accountHash, prHash } = await import('../lib/sync/keys.js');
const { emitirSessao, revogarTodas } = await import('../lib/local-auth/sessoes.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'conta-sintetica';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
let fake;
let identity;
let engine;
let server;
let base;

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg() {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    distribution: { enabled: true }, aceitarAdmin: true, deviceName: 'Notebook de teste', apiKey: API_KEY,
    databaseUrl: fake.url, projectId: 'farol-local',
  };
}

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
  engine = new Engine();
  engine.log = () => { };
  engine.sync.fetchImpl = fetchDosDubles;
  engine.config.port = 0;
  engine.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['acme-exemplo'] }] });
  if (engine.sync.iniciando) await engine.sync.iniciando;
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await engine.syncUnlock({ password: SENHA })).ok, true);
  engine.sync.devices = { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now(), name: 'Celular de teste' } };
  engine.sync.autoridade = { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
  engine.doctorInfo = { claude: '1.0.0', ghAuth: true };
  engine.sync.lastPresenceAt = Date.now();
  assert.equal((await engine.syncTornarAdmin({ password: SENHA })).ok, true);
  engine.sync.autoridade = { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  await fake.close();
  await identity.close();
  revogarTodas();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { revogarTodas(); });

function pedir(rota, corpo, cabecalhos = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(corpo || {});
    const headers = { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...cabecalhos };
    const req = http.request(base + rota, { method: 'POST', headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function kId() { return kek.bufferDe(engine.sync.material.id); }

test('o snapshot da sincronização leva admin, distribuição, admissão e comandos emitidos', () => {
  engine.sync.sinais = { ...(engine.sync.sinais || {}), admin: { dev: engine.sync.deviceId, generation: 1 }, modo: 'local' };
  const s = syncMod.statusForUi(engine);
  // ultimoBatimentoEm entrou com a resolução das divergências de Aparelhos (item 4)
  assert.deepEqual(s.admin, { deviceId: engine.sync.deviceId, generation: 1, souEu: true, fresca: true, ultimoBatimentoEm: engine.sync.autoridade.ultimaMudancaEm });
  // candidatos entrou com o comando iniciar pela tela: a fila do conjunto, vazia fora do admin que agenda
  assert.deepEqual(s.distribuicao, { modo: 'local', esperando: [], candidatos: [] });
  assert.equal(s.admissao.teto >= 1, true);
  assert.equal(s.admissao.pausado, false);
  assert.deepEqual(s.comandosEmitidos, []);
  const cru = JSON.stringify(s.admissao);
  assert.equal(cru.includes('acme-exemplo'), false, 'a ocupação não leva referência de PR');
});

test('emitir comando pela rota registra o emitido, e o desfecho só aparece com recibo', async () => {
  const r = await pedir('/api/sync/command', { alvo: 'dOutro', tipo: 'cancelar', args: { prTag: prTag(kId(), 'acme-exemplo/app#1') } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, r.body.motivo);
  assert.equal(r.body.estado, 'enviado');
  const emitidos = syncMod.statusForUi(engine).comandosEmitidos;
  assert.equal(emitidos[0].cmdId, r.body.cmdId);
  assert.equal(emitidos[0].tipo, 'cancelar');
  // o prazo que a tela mostra é o MESMO gravado no nó do comando, nunca um palpite dela
  const no = await engine.sync.client.get(`/users/u1/live/commands/${r.body.cmdId}`);
  assert.equal(emitidos[0].vence, no.data.ttl);
  assert.ok(emitidos[0].vence > emitidos[0].at, 'o prazo fica depois da emissão');
  const antes = await pedir('/api/sync/command-status', { cmdId: r.body.cmdId });
  assert.deepEqual(antes.body, { ok: true, recibo: null }, 'sem recibo, sem desfecho');
  await engine.sync.client.put(`/users/u1/commandReceipts/${r.body.cmdId}`, { dev: 'dOutro', estado: 'recusado', code: 'nada_rodando', at: Date.now() }, {});
  const depois = await pedir('/api/sync/command-status', { cmdId: r.body.cmdId });
  assert.equal(depois.body.recibo.estado, 'recusado');
  assert.equal(depois.body.recibo.code, 'nada_rodando');
});

test('desfecho de comando com identificador torto é recusado com motivo', async () => {
  const r = await pedir('/api/sync/command-status', { cmdId: '../../x' });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, 'forma');
});

test('publicar política pela rota chega ao banco assinada', async () => {
  const r = await pedir('/api/sync/policy', { deviceId: 'dOutro', politica: { pausado: true, tetoParalelismo: 2 } });
  assert.equal(r.body.ok, true, r.body.motivo);
  const no = fake.tree().users.u1.live.devicePolicies.dOutro;
  assert.ok(no.sig && no.enc);
  assert.equal(JSON.stringify(no).includes('pausado'), false, 'a política viaja cifrada');
});

test('aviso da tomada: sem lease de outro não há o que tomar; com lease vivo, o aviso vem com o risco', async () => {
  const semLease = await pedir('/api/sync/takeover-notice', { prKey: 'acme-exemplo/app#2', account: LOGIN });
  assert.deepEqual(semLease.body, { ok: true, podeTomar: false, motivo: 'sem-lease', aviso: '' });
  const agora = Date.now();
  await engine.sync.client.put(`/users/u1/leases/${accountHash(LOGIN)}/${prHash('acme-exemplo/app#2')}`, {
    leaseId: 'L1', deviceId: 'dOutro', operationKind: 'review', headSha: '', acquiredAt: agora, heartbeatAt: agora, expiresAt: agora + SYNC.LEASE_TTL_MS,
  }, {});
  const comLease = await pedir('/api/sync/takeover-notice', { prKey: 'acme-exemplo/app#2', account: LOGIN });
  assert.equal(comLease.body.podeTomar, true);
  assert.equal(comLease.body.dono, 'dOutro');
  assert.equal(comLease.body.risco, 'provavel');
  assert.match(comLease.body.aviso, /Celular de teste/);
  assert.match(comLease.body.aviso, /custar duas vezes/);
});

test('aviso da tomada sem PR ou sem conta é recusado', async () => {
  const r = await pedir('/api/sync/takeover-notice', { prKey: '', account: '' });
  assert.equal(r.body.code, 'forma');
});

test('estado da chave de limpeza: desligada quando não há nó, ligada depois de o admin ligar', async () => {
  assert.equal((await pedir('/api/sync/cleanup-state')).body.estado, 'desligada');
  assert.equal((await engine.syncChaveDeLimpeza({ ligada: true })).ok, true);
  assert.equal((await pedir('/api/sync/cleanup-state')).body.estado, 'ligada');
  assert.equal((await engine.syncChaveDeLimpeza({ ligada: false })).ok, true);
  assert.notEqual((await pedir('/api/sync/cleanup-state')).body.estado, 'ligada', 'desligada pelo admin não aparece como ligada');
});

test('o admin da projeção vem da observação real dos sinais', async () => {
  const sinais = (await import('../lib/engine/sync-sinais.js')).default;
  engine.sync.sinais = null;
  assert.equal('admin' in syncMod.statusForUi(engine), false, 'sem observar, ninguém é admin na tela');
  await sinais.observarSinais(engine, { agora: Date.now() });
  const admin = syncMod.statusForUi(engine).admin;
  assert.equal(admin.deviceId, engine.sync.deviceId);
  assert.equal(admin.souEu, true);
  assert.ok(admin.generation >= 1);
});

test('sessões da A4: a lista marca a atual e nunca leva hash inteiro nem token', async () => {
  const minha = emitirSessao('navegador de teste');
  emitirSessao('outro navegador');
  const r = await pedir('/api/auth/sessions', {}, { Authorization: `Bearer ${minha}` });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.sessoes.length, 2);
  const atual = r.body.sessoes.find((s) => s.atual);
  assert.equal(atual.rotulo, 'navegador de teste');
  for (const s of r.body.sessoes) {
    assert.match(s.id, /^[0-9a-f]{16}$/);
    assert.deepEqual(Object.keys(s).sort(), ['atual', 'criadoEm', 'id', 'rotulo', 'ultimoUsoEm']);
  }
  assert.equal(JSON.stringify(r.body).includes(minha), false);
});

test('revogar uma sessão: some da lista, e revogar a própria avisa a tela', async () => {
  const minha = emitirSessao('navegador de teste');
  emitirSessao('outro navegador');
  const lista = (await pedir('/api/auth/sessions', {}, { Authorization: `Bearer ${minha}` })).body.sessoes;
  const outra = lista.find((s) => !s.atual);
  const r1 = await pedir('/api/auth/revoke', { id: outra.id }, { Authorization: `Bearer ${minha}` });
  assert.deepEqual(r1.body, { ok: true, eraAtual: false });
  const propria = lista.find((s) => s.atual);
  const r2 = await pedir('/api/auth/revoke', { id: propria.id }, { Authorization: `Bearer ${minha}` });
  assert.deepEqual(r2.body, { ok: true, eraAtual: true });
  const r3 = await pedir('/api/auth/revoke', { id: propria.id });
  assert.deepEqual(r3.body, { ok: false, code: 'sessao_inexistente' });
  assert.equal((await pedir('/api/auth/revoke', { id: 'nao-e-id' })).body.code, 'sessao_inexistente');
});
