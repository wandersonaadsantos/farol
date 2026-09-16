// As divergências entre o desenho e o contrato das seções Aparelhos e Grupos de consumo
// (evidência tela-aparelhos-grupos.md, seção 2). Cada caso aqui prova um dado que o
// engine JÁ sabia e que passou a chegar à tela, pelo servidor HTTP real, com o banco e a
// identidade falsos. Sem conta real, sem rede de fora.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-divergencias-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const limpeza = (await import('../lib/sync/limpeza.js')).default;
const { POSTAGEM_COORDENADA_DESDE } = await import('../lib/sync/cobertura-postagem.js');
const consumoGrupo = (await import('../lib/engine/sync-consumo-grupo.js')).default;

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const GRUPO = 'c'.repeat(32);
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
    distribution: { enabled: false }, aceitarAdmin: true, deviceName: 'Notebook de teste', apiKey: API_KEY,
    databaseUrl: fake.url, projectId: 'farol-local',
  };
}

function autoridadeFresca(ultimaMudancaEm = Date.now()) {
  return { fresca: true, agora: Date.now(), ultimaMudancaEm, intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
}

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
  engine = new Engine();
  engine.log = () => { };
  engine.sync.fetchImpl = fetchDosDubles;
  engine.config.port = 0;
  engine.updateSettings({ sync: syncCfg(), accounts: [{ user: 'conta-sintetica', owners: ['acme-exemplo'] }] });
  if (engine.sync.iniciando) await engine.sync.iniciando;
  assert.equal((await engine.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await engine.syncUnlock({ password: SENHA })).ok, true);
  engine.sync.autoridade = autoridadeFresca();
  assert.equal((await engine.syncTornarAdmin({ password: SENHA })).ok, true);
  engine.sync.autoridade = autoridadeFresca();
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
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function pedir(rota, corpo) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(corpo || {});
    const headers = { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    const req = http.request(base + rota, { method: 'POST', headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

/* ---------- item 4: tempo sem batimento ---------- */

test('item 4: o admin da tela leva o instante do último batimento fresco que ESTE aparelho observou', () => {
  const quando = Date.now() - 18 * 60 * 1000;
  engine.sync.sinais = { ...(engine.sync.sinais || {}), admin: { dev: engine.sync.deviceId, generation: 1 } };
  engine.sync.autoridade = { ...autoridadeFresca(quando), fresca: false };
  const s = syncMod.statusForUi(engine);
  assert.equal(s.admin.ultimoBatimentoEm, quando);
  assert.equal(s.admin.fresca, false);
  engine.sync.autoridade = null;
  assert.equal(syncMod.statusForUi(engine).admin.ultimoBatimentoEm, 0, 'sem observação não existe instante inventado');
  engine.sync.autoridade = autoridadeFresca();
});

/* ---------- item 5: versão mínima da arbitragem ---------- */

test('item 5: o snapshot leva a versão da postagem coordenada, da mesma constante que a cobertura usa', () => {
  assert.equal(syncMod.statusForUi(engine).versaoPostagemCoordenada, POSTAGEM_COORDENADA_DESDE);
});

/* ---------- item 6: sem presença ---------- */

test('item 6: aparelho sem sinal dentro da janela da frota sai marcado sem presença; o próprio e o aposentado não', () => {
  const agora = Date.now();
  engine.sync.devices = {
    [engine.sync.deviceId]: { name: 'Notebook de teste', lastSeenAt: agora - 3 * SYNC.FROTA_JANELA_MS, retiredAt: 0 },
    dVelho: { name: 'Desktop antigo', lastSeenAt: agora - SYNC.FROTA_JANELA_MS - 1000, retiredAt: 0 },
    dNovo: { name: 'Celular de teste', lastSeenAt: agora - 1000, retiredAt: 0 },
    dNunca: { name: 'Tablet', lastSeenAt: 0, retiredAt: 0 },
    dApos: { name: 'Aposentado', lastSeenAt: agora - 9 * SYNC.FROTA_JANELA_MS, retiredAt: agora },
  };
  const porId = Object.fromEntries(syncMod.statusForUi(engine).devices.map((d) => [d.deviceId, d]));
  assert.equal(porId.dVelho.semPresenca, true);
  assert.equal(porId.dNunca.semPresenca, true);
  assert.equal(porId.dNovo.semPresenca, false);
  assert.equal(porId[engine.sync.deviceId].semPresenca, false, 'este aparelho está aqui, por definição');
  assert.equal(porId.dApos.semPresenca, false, 'aposentado já tem o próprio selo');
  engine.sync.devices = {};
});

/* ---------- itens 1 e 2: política publicada e lida de volta ---------- */

test('itens 1 e 2: publicar devolve a versão, e a leitura devolve a política vigente no banco, com o que a tela não edita', async () => {
  const tag = 'f'.repeat(32);
  const r1 = await pedir('/api/sync/policy', { deviceId: 'dOutro', politica: { pausado: true, tetoParalelismo: 2, contasElegiveis: [tag] } });
  assert.equal(r1.body.ok, true, r1.body.motivo);
  assert.equal(r1.body.versao, 1);
  const r2 = await pedir('/api/sync/policy', { deviceId: 'dOutro', politica: { pausado: false, tetoParalelismo: 3, contasElegiveis: [tag], tiposDeOperacao: ['review'] } });
  assert.equal(r2.body.versao, 2);
  const lida = await pedir('/api/sync/policy-read', { deviceId: 'dOutro' });
  assert.equal(lida.body.ok, true, lida.body.motivo);
  assert.equal(lida.body.existe, true);
  assert.equal(lida.body.valida, true);
  assert.equal(lida.body.versao, 2);
  assert.deepEqual(lida.body.politica, { pausado: false, tetoParalelismo: 3, contasElegiveis: [tag], tiposDeOperacao: ['review'] });
});

test('item 2: aparelho sem política publicada responde existe: false, e sem aparelho é recusa de forma', async () => {
  const vazia = await pedir('/api/sync/policy-read', { deviceId: 'dNinguem' });
  assert.deepEqual(vazia.body, { ok: true, existe: false });
  const torta = await pedir('/api/sync/policy-read', { deviceId: '' });
  assert.equal(torta.body.ok, false);
  assert.equal(torta.body.code, 'forma');
});

test('item 2: política de outra geração no banco é lida como inválida, sem abrir o conteúdo', async () => {
  const no = fake.tree().users.u1.live.devicePolicies.dOutro;
  await engine.sync.client.put('/users/u1/live/devicePolicies/dAntigo', { ...no, generation: 99 }, {});
  const r = await pedir('/api/sync/policy-read', { deviceId: 'dAntigo' });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.existe, true);
  assert.equal(r.body.valida, false);
  assert.equal(r.body.code, 'geracao');
  assert.equal('politica' in r.body, false, 'o que não se prova não é mostrado');
});

/* ---------- item 3: recusar o pedido de designação ---------- */

test('item 3: recusar a designação fecha o pedido com recibo de recusa, e sem pedido nada acontece', async () => {
  const cmdId = '1'.repeat(32);
  engine.sync.designacaoAdmin = { cmdId, desde: Date.now() };
  const r = await pedir('/api/sync/designation-decline', {});
  assert.equal(r.body.ok, true, r.body.motivo);
  assert.equal(engine.sync.designacaoAdmin, null);
  assert.equal(syncMod.statusForUi(engine).designacaoAdmin, null);
  const recibo = fake.tree().users.u1.commandReceipts[cmdId];
  assert.equal(recibo.estado, 'recusado');
  assert.equal(recibo.code, 'recusado_no_aparelho');
  assert.equal(recibo.dev, engine.sync.deviceId);
  const sem = await pedir('/api/sync/designation-decline', {});
  assert.equal(sem.body.ok, false);
  assert.equal(sem.body.code, 'sem-pedido');
});

/* ---------- item 12: vínculo na resposta e no snapshot ---------- */

test('item 12: vincular devolve o vínculo, e o snapshot conhece o vínculo mesmo sem o grupo ter chegado', async () => {
  const r = await pedir('/api/sync/link', { perfilId: 'pLab', grupo: GRUPO, tipo: 'api' });
  assert.equal(r.body.ok, true, r.body.motivo);
  assert.equal(r.body.vinculo.grupo, GRUPO);
  assert.equal(r.body.vinculo.tipo, 'api');
  const s = syncMod.statusForUi(engine);
  assert.equal(s.gruposDeConsumo.length, 0, 'o grupo não chegou a este aparelho');
  assert.deepEqual(Object.keys(s.vinculosDePerfis), ['pLab']);
  assert.equal(s.vinculosDePerfis.pLab.grupo, GRUPO);
  const d = await pedir('/api/sync/link', { perfilId: 'pLab', desvincular: true });
  assert.equal(d.body.ok, true);
  assert.equal(d.body.vinculo, null);
  assert.deepEqual(syncMod.statusForUi(engine).vinculosDePerfis, {});
});

/* ---------- item 13: grupo publicado devolve a versão ---------- */

test('item 13: publicar grupo devolve a versão publicada', async () => {
  const r = await pedir('/api/sync/group', { grupo: { id: GRUPO, nome: 'Grupo do time', periodo: 'mes', tetoUsd: 120 } });
  assert.equal(r.body.ok, true, r.body.motivo);
  assert.equal(r.body.versao, 1);
});

/* ---------- item 11: o que a soma do grupo já sabia ---------- */

function aceitarGrupoAtivo(tetoUsd) {
  engine.ativacaoTetoGrupo = true;
  engine.sync.grupos = { [GRUPO]: { grupo: { id: GRUPO, nome: 'Grupo do laboratório', periodo: 'mes', tetoUsd, ativo: true }, versao: 1, generation: 1 } };
}

function retrato(extra) {
  return { verificavel: true, motivos: [], inicio: '2026-09-01', custo: 0, desconhecidas: 0, reservas: 0, tipico: 0, parcialmenteEstimado: false, calculadoEm: Date.now(), ...extra };
}

test('item 11: não verificável leva o motivo e o aparelho, e a hora da soma', () => {
  aceitarGrupoAtivo(30);
  const calc = Date.now() - 1000;
  engine.sync.consumoGrupo = { publicadoSeq: 0, cursorAt: 0, retratos: { [GRUPO]: retrato({ verificavel: false, motivos: [{ dev: 'dVelho', motivo: 'sem-dados' }], calculadoEm: calc }) } };
  const [g] = consumoGrupo.resumoParaTela(engine);
  assert.equal(g.verificavel, false);
  assert.deepEqual(g.motivos, [{ dev: 'dVelho', motivo: 'sem-dados' }]);
  assert.equal(g.calculadoEm, calc);
});

test('item 11: retrato velho é não verificável na tela, como é no gate', () => {
  aceitarGrupoAtivo(30);
  engine.sync.consumoGrupo = { publicadoSeq: 0, cursorAt: 0, retratos: { [GRUPO]: retrato({ calculadoEm: Date.now() - SYNC.GRUPO_RETRATO_MAX_MS - 5000 }) } };
  const [g] = consumoGrupo.resumoParaTela(engine);
  assert.equal(g.verificavel, false);
  assert.deepEqual(g.motivos, [{ dev: '', motivo: 'retrato-velho' }]);
});

test('item 11: teto atingido e a projeção das reservas saem da MESMA conta do gate', () => {
  aceitarGrupoAtivo(30);
  engine.sync.consumoGrupo = { publicadoSeq: 0, cursorAt: 0, retratos: { [GRUPO]: retrato({ custo: 30.4, reservas: 1, tipico: 0.7 }) } };
  const [g] = consumoGrupo.resumoParaTela(engine);
  assert.equal(g.verificavel, true);
  assert.equal(g.custoUsd, 30.4);
  assert.equal(g.tetoAtingido, true);
  assert.ok(Math.abs(g.projecaoUsd - 0.7) < 1e-9, `projeção ${g.projecaoUsd}`);
  engine.sync.consumoGrupo.retratos[GRUPO] = retrato({ custo: 5, reservas: 0, tipico: 0.7 });
  const [folga] = consumoGrupo.resumoParaTela(engine);
  assert.equal(folga.tetoAtingido, false);
  assert.equal(folga.projecaoUsd, 0);
});

test('item 11: sem retrato nada é afirmado (nem motivo, nem teto atingido, nem hora)', () => {
  aceitarGrupoAtivo(30);
  engine.sync.consumoGrupo = { publicadoSeq: 0, cursorAt: 0, retratos: {} };
  const [g] = consumoGrupo.resumoParaTela(engine);
  assert.equal(g.verificavel, null);
  assert.deepEqual(g.motivos, []);
  assert.equal(g.tetoAtingido, null);
  assert.equal(g.projecaoUsd, null);
  assert.equal(g.calculadoEm, 0);
  engine.sync.grupos = {};
  engine.ativacaoTetoGrupo = false;
});

/* ---------- itens 8 e 9: trava e categorias da limpeza ---------- */

test('item 9: o estado da chave traz as categorias alcançáveis e as nunca apagadas, da lista do engine', async () => {
  const r = await pedir('/api/sync/cleanup-state');
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.categorias, limpeza.CATEGORIAS);
  assert.deepEqual(r.body.nuncaApagadas, limpeza.PROIBIDOS);
  assert.equal(r.body.travada, null);
});

test('item 8: trava viva no banco aparece como limpeza em andamento, com o prazo; trava vencida não', async () => {
  const ate = Date.now() + 5 * 60 * 1000;
  await engine.sync.client.put('/users/u1/live/control/cleanupLock', { dev: 'dOutro', x: ate }, {});
  const viva = await pedir('/api/sync/cleanup-state');
  assert.deepEqual(viva.body.travada, { dev: 'dOutro', ate });
  await engine.sync.client.put('/users/u1/live/control/cleanupLock', { dev: 'dOutro', x: Date.now() - 1000 }, {});
  assert.equal((await pedir('/api/sync/cleanup-state')).body.travada, null);
  await engine.sync.client.del('/users/u1/live/control/cleanupLock');
});

test('item 9: limpar devolve o que foi apagado e o que falhou, por categoria', async () => {
  engine.sync.autoridade = autoridadeFresca();
  assert.equal((await engine.syncChaveDeLimpeza({ ligada: true })).ok, true);
  const r = await pedir('/api/sync/cleanup', { password: SENHA });
  assert.equal(r.body.ok, true, r.body.motivo);
  assert.deepEqual(r.body.apagadas, limpeza.CATEGORIAS);
  assert.deepEqual(r.body.falharam, []);
  assert.equal(r.body.corteGravado, true);
  assert.equal('password' in r.body, false);
});
