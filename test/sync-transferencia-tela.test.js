// Transferência e tomada PELA TELA, ponta a ponta entre dois engines no mesmo processo.
//
// Dois aparelhos sobre o banco e a identidade falsos: o ADMIN (a tela, e destino da
// transferência) e a ORIGEM (quem roda a análise). A tela de verdade (ui/app.js) é
// carregada contra o DOM de mentira, e o `fetch` dela vai ao servidor HTTP real do admin.
// Assim o caminho inteiro passa por código de produção: andamento publicado pela origem,
// lido e enriquecido pelo admin, botão habilitado na tela, lista de destinos pela rota,
// comando emitido, aplicado pela origem, recibo lido de volta pela tela.
//
// Os dois engines dividem o STATE_DIR (resolvido uma vez no import de lib/paths.js), e é
// por isso que o id de cada aparelho é fixado à mão depois do desbloqueio, como faz
// test/sync-coordinator.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-transferencia-tela-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;
process.env.TZ = 'America/Sao_Paulo';

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { fixarMemoriaLivre, restaurarMemoriaLivre } from './helpers/memoria-livre.js';
import { instalarDom } from './helpers/dom-stub.js';
import { SYNC } from '../lib/constants.js';

// a admissão recusa abaixo do piso de memória: sem fixar, a memória da máquina decide
fixarMemoriaLivre();

// o fetch de verdade fica guardado ANTES de o DOM de mentira trocar o global
const fetchReal = globalThis.fetch;
const { emitir } = instalarDom();

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const andamentoEng = (await import('../lib/engine/sync-andamento.js')).default;
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const comandos = (await import('../lib/engine/sync-comandos.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag, acctTag, matTag } = await import('../lib/sync/tags.js');
const { accountHash, prHash } = await import('../lib/sync/keys.js');
const { checkpointPath } = await import('../lib/engine/verification-checkpoint.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'conta-sintetica';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const ADMIN = 'dAdminTeste01';
const ORIGEM = 'dOrigemTeste01';
const VELHO = 'dVelhoTeste01';
const SUMIDO = 'dSumidoTeste01';
const HEAD = 'sha41aaaa';
const PR = { key: 'acme-exemplo/app-web#41', url: 'https://github.com/acme-exemplo/app-web/pull/41', title: 'Ajusta o rodapé', author: 'bruno-exemplo', repo: 'acme-exemplo/app-web', number: 41 };

let fake;
let identity;
let admin;
let origem;
let server;
let base;
const PEDIDOS = [];

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetchReal(alvo, init);
}

// o `api()` da tela chama caminho relativo: aqui ele vira o servidor real do admin
globalThis.fetch = async (url, init = {}) => {
  const rota = String(url);
  PEDIDOS.push({ url: rota, corpo: init.body ? JSON.parse(init.body) : null });
  if (!rota.startsWith('/api/')) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  return fetchReal(base + rota, init);
};

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    distribution: { enabled: true }, aceitarAdmin: true, deviceName: 'Aparelho', apiKey: API_KEY,
    databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

function fresca() {
  return { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
}

function frota() {
  const agora = Date.now();
  return {
    [ADMIN]: { name: 'Notebook de teste', contract: 2, keyReady: true, lastSeenAt: agora },
    [ORIGEM]: { name: 'Desktop antigo', contract: 2, keyReady: true, lastSeenAt: agora },
    [VELHO]: { name: 'Celular antigo', contract: 1, keyReady: true, lastSeenAt: agora },
    [SUMIDO]: { name: 'Tablet de teste', contract: 2, keyReady: true, lastSeenAt: agora },
  };
}

async function motor(deviceId) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['acme-exemplo'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.deviceId = deviceId;
  e.sync.devices = frota();
  e.sync.autoridade = fresca();
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  return e;
}

function kId(e) { return kek.bufferDe(e.sync.material.id); }
function arvore() { const t = fake.tree(); return (t && t.users && t.users.u1) || {}; }

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
});

after(async () => {
  restaurarMemoriaLivre();
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

async function subirServidor(e) {
  e.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(e, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  server = null;
});

// Os `await` de topo vêm ANTES do primeiro caso (ver test/sync-distribuicao.test.js).
await import('../ui/app.js');
const Tela = await import('../ui/telas/radar-compartilhado.js');
const $ = (s) => document.querySelector(s);

// Cada caso começa do banco vazio, com um admin novo (e o servidor dele) e a origem rodando
// a análise.
beforeEach(async () => {
  fake.setTree(null);
  PEDIDOS.length = 0;
  try { fs.rmSync(comandos.caminhoDosFeitos(), { force: true }); } catch { /* sem registro anterior */ }
  try { fs.rmSync(checkpointPath(PR.key, 'review'), { force: true }); } catch { /* sem checkpoint anterior */ }
  admin = await motor(ADMIN);
  assert.equal((await admin.syncTornarAdmin({ password: SENHA })).ok, true);
  admin.sync.autoridade = fresca();
  admin.sync.sinais = { ...(admin.sync.sinais || {}), admin: { dev: ADMIN, generation: 1 } };
  await subirServidor(admin);
  origem = await motor(ORIGEM);
  origem.cancelados = [];
  origem.cancelSession = (id) => { origem.cancelados.push(id); origem.activeReviews.delete(id); };
  origem.queue = [];
  // o objeto de sessão tem a forma do runHeadlessReview: o head mora na SESSÃO, e o PR
  // da sessão não traz headSha
  origem.activeReviews = new Map([['a-1', {
    id: 'a-1', keys: [PR.key], label: 'x', mode: 'auto', checkpoint: 'review', startedAt: Date.now(),
    pr: { key: PR.key, url: PR.url, title: PR.title, author: PR.author }, headSha: HEAD,
  }]]);
  origem.activity = new Map([['a-1', [{ t: Date.now(), k: 'tool', s: 'leitura' }]]]);
});

// A origem publica o que a tela do admin precisa: andamento, capacidade e catálogo.
async function origemPublica() {
  const cfg = origem.config.sync;
  const pub = await andamentoEng.sincronizarAndamentos(origem, cfg);
  assert.equal(pub.ok, true, pub.motivo);
  assert.equal(pub.escritas.length, 1);
  assert.equal((await publicacao.publicarCapacidade(origem, cfg)).ok, true);
  assert.equal((await publicacao.publicarNoCatalogo(origem, cfg, andamentoEng.prsDoCatalogo(origem))).ok, true);
  assert.equal((await publicacao.publicarCapacidade(admin, admin.config.sync)).ok, true);
}

// O admin lê o andamento como o relógio lê, e a tela recebe o mesmo evento.
async function adminLe() {
  const eventos = [];
  const ouvir = (p) => eventos.push(p);
  admin.on('sync-live', ouvir);
  await andamentoEng.lerEAplicar(admin, admin.config.sync, arvore().live.operations);
  admin.off('sync-live', ouvir);
  assert.equal(eventos.length, 1);
  return eventos[0];
}

function estadoDaTela() {
  const sync = syncMod.statusForUi(admin);
  return {
    app: { name: 'Farol', version: '2.59.7', platform: 'win32' },
    status: 'ocioso', account: { user: LOGIN, tokenOk: true },
    accounts: [{ user: LOGIN, owners: ['acme-exemplo'] }],
    config: { ghUser: LOGIN, owners: ['acme-exemplo'], accounts: [{ user: LOGIN, owners: ['acme-exemplo'] }], intervalSeconds: 300, sync: admin.config.sync, people: {}, defaultReviewers: {}, projectReviewers: {}, claudeProfiles: [] },
    lastCheckAt: Date.now(), nextCheckAt: Date.now() + 60000,
    queue: [], panorama: [], myPRs: [], hiddenPRs: [], selfAnalyses: {}, decisions: { pending: [], resolved: [] },
    activeSessions: [], headlessWaiting: [], chats: {}, reviewActions: {}, staleStates: {},
    usage: {}, usageSessions: [], toolRuns: {}, pushbacks: {}, team: [], highlights: [], update: { state: 'idle' },
    paths: { home: '/tmp/.farol', workspace: '/tmp/.farol/workspace' },
    sync,
  };
}

async function telaComAndamento() {
  await origemPublica();
  const live = await adminLe();
  emitir('state', estadoDaTela());
  emitir('sync-live', JSON.parse(JSON.stringify(live)));
  return live.operacoes[0];
}

function pedidosPara(rota) {
  return PEDIDOS.filter((p) => p.url === rota).map((p) => p.corpo);
}

async function lerReciboNaTela() {
  emitir('state', estadoDaTela());
  await Tela.atualizarRecibos(syncMod.statusForUi(admin).comandosEmitidos, { forcar: true });
  return $('#mdComandos').innerHTML;
}

/* ---------- 1. o dado chega ---------- */

test('o andamento lido pelo admin traz o commit, as tags e o PR resolvido pelo catálogo', async () => {
  await origemPublica();
  const { operacoes } = await adminLe();
  assert.equal(operacoes.length, 1);
  const op = operacoes[0];
  assert.equal(op.dev, ORIGEM);
  assert.equal(op.prTag, prTag(kId(admin), PR.key));
  assert.equal(op.matTag, matTag(kId(admin), HEAD));
  assert.equal(op.acctTag, acctTag(kId(admin), LOGIN));
  assert.deepEqual(op.pr, { key: PR.key, account: LOGIN, title: PR.title, author: PR.author });
  const cru = JSON.stringify(fake.tree());
  for (const proibido of [HEAD, PR.title, 'acme-exemplo/app-web']) assert.equal(cru.includes(proibido), false, proibido);
});

test('sem a linha do catálogo, o PR vem nulo e o resto do andamento continua', async () => {
  await andamentoEng.sincronizarAndamentos(origem, origem.config.sync);
  const { operacoes } = await adminLe();
  assert.equal(operacoes.length, 1);
  assert.equal(operacoes[0].pr, null, 'rótulo genérico é o fallback legítimo');
  assert.equal(operacoes[0].matTag, matTag(kId(admin), HEAD));
});

test('linha do catálogo de OUTRO PR no lugar desta tag não vira nome', async () => {
  await origemPublica();
  const tag = prTag(kId(admin), PR.key);
  const outro = prTag(kId(admin), 'acme-exemplo/app-web#99');
  await publicacao.publicarNoCatalogo(origem, origem.config.sync, [{ ...PR, key: 'acme-exemplo/app-web#99', number: 99 }]);
  const t = fake.tree();
  t.users.u1.catalog[tag] = t.users.u1.catalog[outro];
  fake.setTree(t);
  const { operacoes } = await adminLe();
  assert.equal(operacoes[0].pr, null, 'a linha transplantada não abre no caminho desta tag');
  // a conferência da própria tag vale também para o que já está na memória
  admin.sync.catalogoLru = new Map([[tag, { key: 'acme-exemplo/app-web#99', title: 'Outro', author: 'x', repo: 'acme-exemplo/app-web' }]]);
  assert.equal(await publicacao.prDaTag(admin, admin.config.sync, tag), null);
  assert.equal(await publicacao.prDaTag(admin, admin.config.sync, 'nao-e-tag'), null);
});

test('o catálogo publicado pela origem inclui o PR da sessão viva, sem repetir o da fila', () => {
  origem.queue = [PR];
  const lista = andamentoEng.prsDoCatalogo(origem);
  assert.deepEqual(lista.map((p) => p.key), [PR.key], 'o mesmo PR não sobe duas vezes com linhas diferentes');
  origem.queue = [];
  assert.deepEqual(andamentoEng.prsDoCatalogo(origem).map((p) => p.key), [PR.key]);
});

/* ---------- 2. destinos: elegível e inelegível com motivo ---------- */

test('a rota de destinos lista quem pode receber, e cada inapto com o motivo certo', async () => {
  await origemPublica();
  const r = await (await fetchReal(`${base}/api/sync/transfer-targets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1' },
    body: JSON.stringify({ dono: ORIGEM, acctTag: acctTag(kId(admin), LOGIN) }),
  })).json();
  assert.equal(r.ok, true, r.motivo);
  const motivos = Object.fromEntries(r.destinos.map((d) => [d.deviceId, d.motivo]));
  assert.deepEqual(motivos, { [ADMIN]: '', [ORIGEM]: 'dono-atual', [VELHO]: 'versao-antiga', [SUMIDO]: 'sem-sinal' });
  assert.equal(r.destinos[0].deviceId, ADMIN, 'os aptos vêm primeiro');
  assert.equal(r.destinos[0].apto, true);
  assert.equal(r.destinos[0].souEu, true);
  assert.equal(r.destinos[0].nome, 'Notebook de teste');
  assert.deepEqual(r.origem, { deviceId: ORIGEM, motivo: '' });
});

test('destino sem consentimento, pausado, sem credencial ou com memória desconhecida é inapto', async () => {
  await origemPublica();
  const dest = (await import('../lib/engine/sync-transferencia.js')).default;
  const motivoDoAdmin = async () => (await dest.destinosDaTransferencia(admin, admin.config.sync, { dono: ORIGEM, acctTag: acctTag(kId(admin), LOGIN) })).destinos.find((d) => d.deviceId === ADMIN).motivo;
  const republicar = async (extra) => {
    admin.sync.publicado = {};
    admin.updateSettings({ sync: syncCfg(extra) });
    if (admin.sync.iniciando) await admin.sync.iniciando;
    assert.equal((await publicacao.publicarCapacidade(admin, admin.config.sync)).ok, true);
  };
  await republicar({ aceitarAdmin: false });
  assert.equal(await motivoDoAdmin(), 'sem-consentimento');
  await republicar({});
  assert.equal((await dest.destinosDaTransferencia(admin, admin.config.sync, { dono: ORIGEM, acctTag: 'f'.repeat(32) })).destinos.find((d) => d.deviceId === ADMIN).motivo, 'sem-credencial');
  admin.doctorInfo = { claude: '', ghAuth: true };
  await republicar({});
  assert.equal(await motivoDoAdmin(), 'sem-ia');
  admin.doctorInfo = { claude: '1.0.0', ghAuth: true };
  restaurarMemoriaLivre();
  const os2 = (await import('node:os')).default;
  const livre = os2.freemem;
  const disponivel = process.availableMemory;
  os2.freemem = () => 0;
  process.availableMemory = () => 0;
  try {
    await republicar({});
    assert.equal(await motivoDoAdmin(), 'memoria-desconhecida');
  } finally {
    os2.freemem = livre;
    process.availableMemory = disponivel;
    fixarMemoriaLivre();
  }
  await republicar({});
  assert.equal(await motivoDoAdmin(), '');
});

test('a origem que não aceita comandos aparece como tal, e a tela não oferece o envio', async () => {
  origem.updateSettings({ sync: syncCfg({ aceitarAdmin: false }) });
  if (origem.sync.iniciando) await origem.sync.iniciando;
  origem.sync.deviceId = ORIGEM;
  origem.sync.devices = frota();
  origem.sync.autoridade = fresca();
  const op = await telaComAndamento();
  let visto = null;
  const r = await Tela.transferirOperacao(op.opId, async (d) => { visto = d; return ADMIN; }, async () => true);
  assert.equal(r, false);
  assert.equal(visto.pode, false);
  assert.match(visto.corpo, /não aceita comandos do admin/);
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

/* ---------- 3. ponta a ponta: pedido, execução e recibo ---------- */

test('transferir pela tela: botão habilitado, corpo exato, a origem aplica e a tela lê o recibo', async () => {
  const op = await telaComAndamento();
  assert.match($('#mdOperacoes').innerHTML, new RegExp(`md-transferir" data-op="${op.opId}"`), 'o botão está habilitado');
  assert.match($('#mdOperacoes').innerHTML, /Ajusta o rodapé/, 'o PR aparece pelo nome');
  let dialogo = null;
  let confirmacao = null;
  const enviado = await Tela.transferirOperacao(op.opId, async (d) => { dialogo = d; return ADMIN; }, async (c) => { confirmacao = c; return true; });
  assert.equal(enviado, true);
  assert.deepEqual(pedidosPara('/api/sync/transfer-targets'), [{ dono: ORIGEM, acctTag: acctTag(kId(admin), LOGIN) }]);
  assert.deepEqual(dialogo.aptos, [ADMIN]);
  assert.match(dialogo.corpo, /Celular antigo.*versão antiga/s);
  assert.match(confirmacao.title, /Transferir para este aparelho/);
  assert.deepEqual(pedidosPara('/api/sync/command'), [{
    alvo: ORIGEM, tipo: 'transferir', args: { prTag: prTag(kId(admin), PR.key), matTag: matTag(kId(admin), HEAD), destino: ADMIN },
  }]);
  // o registro do emitido amarra o comando ao PR (divergência 4)
  const emitido = syncMod.statusForUi(admin).comandosEmitidos[0];
  assert.equal(emitido.prTag, prTag(kId(admin), PR.key));
  assert.equal(emitido.prKey, PR.key);
  assert.equal(emitido.destino, ADMIN);
  assert.doesNotMatch(await lerReciboNaTela(), />aplicado</, 'sem recibo, nunca concluído');

  // a ORIGEM aplica: memória, encerramento e item de volta preferindo o destino
  const ciclo = await comandos.cicloDosComandos(origem, origem.config.sync);
  assert.deepEqual(ciclo.aplicados.map((a) => [a.estado, a.code || '']), [['aplicado', '']]);
  assert.deepEqual(origem.cancelados, ['a-1']);
  const fila = arvore().live.queue;
  const itemId = `${prTag(kId(admin), PR.key)}_${matTag(kId(admin), HEAD)}`;
  assert.equal(fila[itemId][ORIGEM].prefDev, ADMIN);

  const html = await lerReciboNaTela();
  assert.match(html, /<b>transferir<\/b> para Desktop antigo, destino este aparelho/);
  assert.match(html, /sync-chip ok">aplicado</);
});

test('tomar pela tela: aviso lido do lease real, confirmação, o admin aplica e registra o recibo', async () => {
  const op = await telaComAndamento();
  const agora = Date.now();
  await admin.sync.client.put(`/users/u1/leases/${accountHash(LOGIN)}/${prHash(PR.key)}`, {
    leaseId: 'L1', deviceId: ORIGEM, operationKind: 'review', headSha: '', acquiredAt: agora, heartbeatAt: agora, expiresAt: agora + SYNC.LEASE_TTL_MS,
  }, {});
  assert.match($('#mdOperacoes').innerHTML, new RegExp(`md-tomar" data-op="${op.opId}"`));
  // a fila real não traz headSha: o executor pergunta o head ATUAL
  admin.queue = [{ key: PR.key, url: PR.url, title: PR.title, author: PR.author, repo: PR.repo, number: PR.number }];
  admin.headSha = async () => HEAD;
  const vindos = [];
  admin.enfileirarDaDistribuicao = (item, vaga) => vindos.push({ key: item.key, tomar: item.tomarLease, vaga: !!vaga, manual: 'manual' in item });
  let visto = null;
  assert.equal(await Tela.tomarOperacao(op.opId, async (d) => { visto = d; return true; }), true);
  assert.deepEqual(pedidosPara('/api/sync/takeover-notice'), [{ prKey: PR.key, account: LOGIN }]);
  assert.match(visto.corpo, /Desktop antigo/);
  assert.deepEqual(pedidosPara('/api/sync/command'), [{ alvo: ADMIN, tipo: 'tomar', args: { prTag: prTag(kId(admin), PR.key), matTag: matTag(kId(admin), HEAD), confirmado: true } }]);
  await comandos.cicloDosComandos(admin, admin.config.sync);
  assert.deepEqual(vindos, [{ key: PR.key, tomar: true, vaga: true, manual: false }]);
  assert.match(await lerReciboNaTela(), /sync-chip ok">aplicado</);
});

/* ---------- 4. o estado muda entre a seleção e a execução ---------- */

test('o head muda depois da seleção: a origem recusa com head_mudou, e a tela mostra a recusa', async () => {
  const op = await telaComAndamento();
  assert.equal(await Tela.transferirOperacao(op.opId, async () => ADMIN, async () => true), true);
  origem.activeReviews.get('a-1').headSha = 'sha42bbbb';
  const ciclo = await comandos.cicloDosComandos(origem, origem.config.sync);
  assert.deepEqual(ciclo.aplicados.map((a) => a.code), ['head_mudou']);
  assert.deepEqual(origem.cancelados, [], 'nada foi encerrado');
  const html = await lerReciboNaTela();
  assert.match(html, /sync-chip bad">recusado</);
  assert.match(html, /o commit mudou desde o pedido/);
});

test('o destino perde o consentimento depois da seleção: a origem recusa com destino_inapto', async () => {
  const op = await telaComAndamento();
  assert.equal(await Tela.transferirOperacao(op.opId, async () => ADMIN, async () => true), true);
  admin.sync.publicado = {};
  admin.updateSettings({ sync: syncCfg({ aceitarAdmin: false }) });
  if (admin.sync.iniciando) await admin.sync.iniciando;
  assert.equal((await publicacao.publicarCapacidade(admin, admin.config.sync)).ok, true);
  const ciclo = await comandos.cicloDosComandos(origem, origem.config.sync);
  assert.deepEqual(ciclo.aplicados.map((a) => a.code), ['destino_inapto']);
  assert.deepEqual(origem.cancelados, []);
  admin.updateSettings({ sync: syncCfg() });
  if (admin.sync.iniciando) await admin.sync.iniciando;
  const html = await lerReciboNaTela();
  assert.match(html, /o destino não estava apto/);
});

test('o head muda antes da tomada: o executor recusa com head_mudou, e nada é enfileirado', async () => {
  const op = await telaComAndamento();
  const agora = Date.now();
  await admin.sync.client.put(`/users/u1/leases/${accountHash(LOGIN)}/${prHash(PR.key)}`, {
    leaseId: 'L1', deviceId: ORIGEM, operationKind: 'review', headSha: '', acquiredAt: agora, heartbeatAt: agora, expiresAt: agora + SYNC.LEASE_TTL_MS,
  }, {});
  admin.queue = [{ key: PR.key, repo: PR.repo, number: PR.number }];
  admin.headSha = async () => 'sha42bbbb';
  admin.enfileirarDaDistribuicao = () => assert.fail('head velho não enfileira');
  assert.equal(await Tela.tomarOperacao(op.opId, async () => true), true);
  await comandos.cicloDosComandos(admin, admin.config.sync);
  assert.match(await lerReciboNaTela(), /o commit mudou desde o pedido/);
});

test('escolha forjada fora da lista de aptos não sai, nem com confirmação', async () => {
  const op = await telaComAndamento();
  assert.equal(await Tela.transferirOperacao(op.opId, async () => VELHO, async () => true), false);
  assert.equal(await Tela.transferirOperacao(op.opId, async () => ADMIN, async () => false), false, 'sem confirmação, nada');
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});
