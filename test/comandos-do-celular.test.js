// Controle do celular (28/09/2026), parte 3: os comandos novos, do admin ao alvo.
//
// Um motor real nos dois papéis (o padrão de test/sync-comandos-remoto.test.js): ele emite
// como admin, com assinatura e cifra de verdade no banco falso, e aplica como executor. O
// efeito é conferido no engine de verdade: a fila, o estacionamento, os ignorados, os
// ocultos, a config da conta e o rastro de política.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-comandos-celular-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { comoExecutor } from './helpers/papel.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const comandos = (await import('../lib/engine/sync-comandos.js')).default;
const comando = (await import('../lib/sync/comando.js')).default;
const reviewMod = (await import('../lib/engine/review.js')).default;
const contasConfig = (await import('../lib/engine/contas-config.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag, acctTag } = await import('../lib/sync/tags.js');
const P = await import('../ui/pure.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'conta-do-celular';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const TAG = 'a'.repeat(32);
const NOVOS = ['revisar', 'ignorar', 'restaurar', 'ocultar', 'mostrar', 'config-conta'];
let fake;
let identity;
const MOTORES = [];

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
});
after(async () => {
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  fake.setTree(null);
  try { fs.rmSync(comandos.caminhoDosFeitos(), { force: true }); } catch { /* sem registro anterior */ }
});
afterEach(() => { for (const e of MOTORES.splice(0)) syncMod.stopSync(e); });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: true, deviceName: 'Celular', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

function fresca() {
  return { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
}

const PR = { key: 'acme/app#7', title: 'Titulo', author: 'alguem', repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/pull/7', mine: true };
const MEU = { key: 'acme/app#8', title: 'Meu PR', author: LOGIN, repo: 'acme/app', number: 8, url: 'https://github.com/acme/app/pull/8', updatedAt: 'x' };

async function motor({ distribuicao = false } = {}) {
  const e = new Engine();
  MOTORES.push(e);
  e.log = () => { };
  e.pushState = () => { };
  e.emit = () => true;
  e.checkNow = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(distribuicao ? { distribution: { enabled: true } } : {}), accounts: [{ user: LOGIN, owners: ['acme'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  e.sync.autoridade = fresca();
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  e.sync.autoridade = fresca();
  e.accountForPr = () => LOGIN;
  e.tokenFor = () => 'token-de-teste';
  e.headSha = async () => 'sha7';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false });
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  e.outrosRevisando = () => [];
  Object.assign(e, { queue: [{ ...PR }], panorama: [{ ...PR }], myPRs: [{ ...MEU }], headlessQueue: [], headlessBusyAccounts: new Map(), writeInflight() { }, processHeadless() { } });
  return e;
}

function kId(e) { return kek.bufferDe(e.sync.material.id); }
function arvore() { const t = fake.tree(); return (t && t.users && t.users.u1) || {}; }
function recibo(cmdId) { return (arvore().commandReceipts || {})[cmdId]; }

async function emitirPara(e, tipo, args) {
  const r = await comandos.emitir(e, e.config.sync, { alvo: e.sync.deviceId, tipo, args });
  assert.equal(r.ok, true, r.motivo);
  return r.cmdId;
}

// executa como o aparelho alvo, com o admin sendo OUTRO aparelho (o "Computador")
async function aplicar(e, cfg = e.config.sync) {
  e.sync.devices['dev-admin-remoto'] = { name: 'Computador', contract: 2, keyReady: true, lastSeenAt: Date.now() };
  const restaurar = comoExecutor(e);
  try { return await comandos.cicloDosComandos(e, cfg); } finally { restaurar(); }
}

/* ---------- forma e allowlist ---------- */

test('forma: os comandos da fila levam só o prTag, e config-conta só conta, campo e valor', () => {
  for (const tipo of ['revisar', 'ignorar', 'restaurar', 'ocultar', 'mostrar']) {
    assert.deepEqual(comando.sanearComando({ tipo, args: { prTag: TAG, manual: true, requested: true, matTag: TAG } }), { tipo, args: { prTag: TAG } }, tipo);
    assert.equal(comando.sanearComando({ tipo, args: {} }), null, `${tipo} sem PR não é comando`);
    assert.equal(comando.sanearComando({ tipo, args: { prTag: 'acme/app#7' } }), null, `${tipo}: PR em claro não é tag`);
  }
  assert.deepEqual(
    comando.sanearComando({ tipo: 'config-conta', args: { acctTag: TAG, campo: 'onClean', valor: 'approve', extra: 1 } }),
    { tipo: 'config-conta', args: { acctTag: TAG, campo: 'onClean', valor: 'approve' } },
  );
});

test('config-conta: campo ou valor fora da allowlist não é comando, e o emissor recusa por forma', async () => {
  const validos = [['autoReview', true], ['autoReview', false], ['muted', true], ['muted', false], ['onClean', 'approve'], ['onClean', 'wait'],
    ['onCaveats', 'approve'], ['onCaveats', 'wait'], ['onReject', 'request_changes'], ['onReject', 'wait']];
  for (const [campo, valor] of validos) assert.ok(comando.sanearComando({ tipo: 'config-conta', args: { acctTag: TAG, campo, valor } }), `${campo}=${valor}`);
  const invalidos = [['owners', ['org']], ['claudeProfileId', 'p1'], ['autoReview', 'true'], ['onClean', 'request_changes'], ['onReject', 'approve'], ['label', 'x'], ['__proto__', true]];
  for (const [campo, valor] of invalidos) assert.equal(comando.sanearComando({ tipo: 'config-conta', args: { acctTag: TAG, campo, valor } }), null, `${campo}=${valor}`);
  const e = await motor();
  const r = await comandos.emitir(e, e.config.sync, { alvo: e.sync.deviceId, tipo: 'config-conta', args: { acctTag: TAG, campo: 'owners', valor: ['x'] } });
  assert.equal(r.code, 'forma');
});

test('sem consentimento local, cada comando novo é ignorado com o porquê e não mexe em nada', async () => {
  const e = await motor();
  const tagPr = prTag(kId(e), PR.key);
  const args = { revisar: { prTag: tagPr }, ignorar: { prTag: tagPr }, restaurar: { prTag: tagPr }, ocultar: { prTag: prTag(kId(e), MEU.key) }, mostrar: { prTag: tagPr },
    'config-conta': { acctTag: acctTag(kId(e), LOGIN), campo: 'muted', valor: true } };
  const ids = [];
  for (const tipo of NOVOS) ids.push(await emitirPara(e, tipo, args[tipo]));
  let enfileirados = 0;
  e.enqueueHeadless = () => { enfileirados += 1; return { ok: true }; };
  await aplicar(e, { ...e.config.sync, aceitarAdmin: false });
  for (const id of ids) assert.deepEqual([recibo(id).estado, recibo(id).code], ['ignorado', 'nao-aceita-admin']);
  assert.equal(enfileirados, 0);
  assert.equal(e.seen.has(PR.key), false, 'nada foi ignorado');
  assert.deepEqual(Object.keys(e.hiddenPRs), [], 'nada foi ocultado');
  assert.equal(e.isMuted(LOGIN), false, 'a conta não foi silenciada');
});

/* ---------- revisar ---------- */

function prontidaoFresca(e) {
  e.sync.sinais = {
    conexaoEm: 0, lidos: new Set(), beat: null, modo: '', voltaPendente: false, voltando: false, ultimoBatimentoEm: 0,
    ready: { sequenciaVista: 1, fresca: true, ultimaMudancaEm: Date.now() }, adminLidoEm: 0,
  };
}

test('revisar: enfileira AQUI mesmo com a distribuição valendo, tira do estacionamento e nunca vira clique', async () => {
  const e = await motor({ distribuicao: true });
  prontidaoFresca(e);
  e.sync.autoridade = fresca();
  // a premissa: um PR automático qualquer iria para a distribuição
  const restaurar = comoExecutor(e);
  assert.equal(reviewMod.enqueueHeadless(e, { key: 'acme/app#99', headSha: 's', author: 'x', repo: 'acme/app', number: 99 }).via, 'distribuicao');
  restaurar();
  e.autoReviewParked.add(PR.key);
  e.parkedMotivos = { [PR.key]: { at: new Date().toISOString(), tipo: 'esgotado', motivo: 'm' } };
  e.retryAfterNet.set(PR.key, { tries: 1, pr: PR });
  const cmdId = await emitirPara(e, 'revisar', { prTag: prTag(kId(e), PR.key) });
  await aplicar(e);
  assert.deepEqual([recibo(cmdId).estado, recibo(cmdId).code], ['aplicado', '']);
  const item = e.headlessQueue.find((p) => p.key === PR.key);
  assert.ok(item, 'entrou na fila LOCAL, não na distribuição');
  assert.equal(item.viaAdmin, true);
  assert.equal(item.viaComando, true);
  assert.equal('manual' in item, false, 'CT-FIO: não é clique');
  assert.equal('requested' in item, false, 'CT-FIO: sem requested, nunca aprova sozinho');
  assert.equal(e.headlessDistribuindo.has(PR.key), false);
  assert.equal(e.autoReviewParked.has(PR.key), false, 'saiu do estacionamento');
  assert.equal(e.retryAfterNet.has(PR.key), false, 'o retry não vira segunda revisão');
  assert.equal(e.queue.some((p) => p.key === PR.key), false);
  assert.equal(e.seen.has(PR.key), true);
});

test('revisar: o gate de consciência segura, e o recibo diz qual; o estacionamento fica', async () => {
  const e = await motor();
  e.autoReviewParked.add(PR.key);
  e.bloqueadoPorHistorico = async () => ({ bloqueado: true, motivo: 'reprovado por pessoa' });
  const cmdId = await emitirPara(e, 'revisar', { prTag: prTag(kId(e), PR.key) });
  await aplicar(e);
  assert.deepEqual([recibo(cmdId).estado, recibo(cmdId).code], ['recusado', 'bloqueado_historico']);
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.autoReviewParked.has(PR.key), true, 'recusa não desfaz nada');
});

test('revisar: checks obrigatórios, saída de cena, outra pessoa revisando e PR desconhecido seguram com o próprio código', async () => {
  const casos = [
    ['checks_pendentes', (e) => { e.bloqueadoPorChecks = async () => ({ bloqueado: true, faltando: ['ci'] }); }],
    ['saida-de-cena', (e) => { e.skipComentado = { [PR.key]: { at: 1 } }; }],
    ['outros_revisando', (e) => { e.outrosRevisando = () => ['colega']; }],
    ['sem_token', (e) => { e.tokenFor = () => null; }],
  ];
  for (const [code, preparar] of casos) {
    const e = await motor();
    preparar(e);
    const cmdId = await emitirPara(e, 'revisar', { prTag: prTag(kId(e), PR.key) });
    await aplicar(e);
    assert.deepEqual([recibo(cmdId).estado, recibo(cmdId).code], ['recusado', code], code);
    assert.equal(e.headlessQueue.length, 0, code);
    fake.setTree(null);
    fs.rmSync(comandos.caminhoDosFeitos(), { force: true });
  }
  const e = await motor();
  const cmdId = await emitirPara(e, 'revisar', { prTag: 'f'.repeat(32) });
  await aplicar(e);
  assert.equal(recibo(cmdId).code, 'nao_conheco');
});

/* ---------- ignorar, restaurar, ocultar, mostrar ---------- */

test('ignorar e restaurar fazem o mesmo que os botões locais', async () => {
  const e = await motor();
  const tagPr = prTag(kId(e), PR.key);
  const c1 = await emitirPara(e, 'ignorar', { prTag: tagPr });
  await aplicar(e);
  assert.equal(recibo(c1).estado, 'aplicado');
  assert.equal(e.seen.has(PR.key), true);
  assert.equal(e.ignorados.has(PR.key), true);
  assert.equal(e.queue.some((p) => p.key === PR.key), false);
  // o ignorado saiu da fila e do Panorama: a tag ainda resolve pelos ignorados
  e.panorama = [];
  let checou = 0;
  e.checkNow = () => { checou += 1; };
  const c2 = await emitirPara(e, 'restaurar', { prTag: tagPr });
  await aplicar(e);
  assert.equal(recibo(c2).estado, 'aplicado');
  assert.equal(e.seen.has(PR.key), false);
  assert.equal(e.ignorados.has(PR.key), false);
  assert.equal(checou, 1, 'restaurar pede a checagem, como a rota local');
});

test('ocultar e mostrar fazem o mesmo que os botões de Meus PRs; PR que não é meu não se oculta', async () => {
  const e = await motor();
  const c1 = await emitirPara(e, 'ocultar', { prTag: prTag(kId(e), MEU.key) });
  const c2 = await emitirPara(e, 'ocultar', { prTag: prTag(kId(e), PR.key) });
  await aplicar(e);
  assert.equal(recibo(c1).estado, 'aplicado');
  assert.deepEqual([recibo(c2).estado, recibo(c2).code], ['recusado', 'nao_conheco']);
  assert.deepEqual(Object.keys(e.hiddenPRs), [MEU.key]);
  e.myPRs = [];
  const c3 = await emitirPara(e, 'mostrar', { prTag: prTag(kId(e), MEU.key) });
  await aplicar(e);
  assert.equal(recibo(c3).estado, 'aplicado');
  assert.deepEqual(Object.keys(e.hiddenPRs), []);
});

/* ---------- config-conta ---------- */

test('config-conta: aplica pela edição por operação e registra origem admin com o nome de quem mandou', async () => {
  const e = await motor();
  e.updateSettings({ accounts: [{ user: LOGIN, owners: ['acme'], onClean: 'wait', color: '#123456' }] });
  const cmdId = await emitirPara(e, 'config-conta', { acctTag: acctTag(kId(e), LOGIN), campo: 'onClean', valor: 'approve' });
  await aplicar(e);
  assert.equal(recibo(cmdId).estado, 'aplicado');
  const conta = e.config.accounts.find((a) => a.user === LOGIN);
  assert.equal(conta.onClean, 'approve');
  assert.equal(conta.color, '#123456', 'os outros campos da conta ficam como estavam');
  const ultima = contasConfig.historicoRecente(e, 5)[0];
  assert.deepEqual({ conta: ultima.conta, campo: ultima.campo, de: ultima.de, para: ultima.para, origem: ultima.origem, aparelho: ultima.aparelho },
    { conta: LOGIN, campo: 'onClean', de: 'wait', para: 'approve', origem: 'admin', aparelho: 'Computador' });
  // o motivo "a política manda aguardar" passa a dizer que veio do admin
  const c2 = await emitirPara(e, 'config-conta', { acctTag: acctTag(kId(e), LOGIN), campo: 'onClean', valor: 'wait' });
  await aplicar(e);
  assert.equal(recibo(c2).estado, 'aplicado');
  assert.match(contasConfig.motivoDaPolitica(e, LOGIN, true), /pelo admin \(Computador\)/);
});

test('config-conta: conta que o aparelho não tem é recusada, e nada muda', async () => {
  const e = await motor();
  const antes = JSON.stringify(e.config.accounts);
  const cmdId = await emitirPara(e, 'config-conta', { acctTag: acctTag(kId(e), 'conta-de-outro-aparelho'), campo: 'autoReview', valor: true });
  await aplicar(e);
  assert.deepEqual([recibo(cmdId).estado, recibo(cmdId).code], ['recusado', 'conta_desconhecida']);
  assert.equal(JSON.stringify(e.config.accounts), antes);
});

test('config-conta libera: ligar a revisão automática remotamente vale no aparelho', async () => {
  const e = await motor();
  e.updateSettings({ accounts: [{ user: LOGIN, owners: ['acme'], autoReview: false }] });
  assert.equal(e.autoReviewFor(LOGIN), false);
  const cmdId = await emitirPara(e, 'config-conta', { acctTag: acctTag(kId(e), LOGIN), campo: 'autoReview', valor: true });
  await aplicar(e);
  assert.equal(recibo(cmdId).estado, 'aplicado');
  assert.equal(e.autoReviewFor(LOGIN), true);
});

// O com ressalvas nunca é mais permissivo que o limpo, também pelo caminho remoto
// (30/09/2026): o comando do admin passa pela mesma edição por operação da tela de Contas.
test('config-conta: pôr o sem ressalvas em espera à distância põe o com ressalvas junto', async () => {
  const e = await motor();
  e.updateSettings({ accounts: [{ user: LOGIN, owners: ['acme'], autoReview: false, onClean: 'approve', onCaveats: 'approve' }] });
  assert.equal(e.approvePolicyFor(LOGIN, false), 'approve');
  const cmdId = await emitirPara(e, 'config-conta', { acctTag: acctTag(kId(e), LOGIN), campo: 'onClean', valor: 'wait' });
  await aplicar(e);
  assert.equal(recibo(cmdId).estado, 'aplicado');
  const conta = e.config.accounts.find((a) => a.user === LOGIN);
  assert.deepEqual([conta.onClean, conta.onCaveats], ['wait', 'wait']);
  assert.equal(e.approvePolicyFor(LOGIN, false), 'wait');
});

test('config-conta: pedir aprovação com ressalvas em conta cujo limpo espera é recusa, e nada muda', async () => {
  const e = await motor();
  e.updateSettings({ accounts: [{ user: LOGIN, owners: ['acme'], autoReview: false, onClean: 'wait' }] });
  const antes = JSON.stringify(e.config.accounts);
  const cmdId = await emitirPara(e, 'config-conta', { acctTag: acctTag(kId(e), LOGIN), campo: 'onCaveats', valor: 'approve' });
  await aplicar(e);
  assert.deepEqual([recibo(cmdId).estado, recibo(cmdId).code], ['recusado', 'nao_editou']);
  assert.equal(JSON.stringify(e.config.accounts), antes);
  assert.equal(e.approvePolicyFor(LOGIN, false), 'wait');
});

/* ---------- CT-FIO e a tela ---------- */

test('nenhum caminho dos comandos novos escreve manual ou requested', () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/sync-comandos-fila.js', import.meta.url), 'utf8');
  const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const proibido of ['manual: true', 'manual = true', 'requested: true', 'requested = true', '.manual =', '.requested =']) {
    assert.equal(codigo.includes(proibido), false, proibido);
  }
});

test('a tela tem texto para cada código novo de recusa e para cada tipo novo', () => {
  for (const code of ['bloqueado_historico', 'checks_pendentes', 'outros_revisando', 'sem_token', 'conta_desconhecida', 'nao_editou', 'nao_ocultou']) {
    const r = P.reciboEstado({ tipo: 'revisar' }, { estado: 'recusado', code, at: 0 });
    assert.equal(r.estado, 'recusado');
    assert.equal(r.detalhe.includes(`código ${code}`), false, `${code} sem texto na tela`);
  }
  const rotulos = { revisar: 'revisar agora', ignorar: 'ignorar', restaurar: 'restaurar', ocultar: 'ocultar', mostrar: 'mostrar', 'config-conta': 'configurar a conta' };
  for (const tipo of NOVOS) {
    const html = P.comandosEmitidosHtml([{ cmdId: 'c'.repeat(32), tipo, alvo: 'd', at: 1, vence: Date.now() + 60_000 }], {});
    assert.ok(html.includes(`<b>${rotulos[tipo]}</b>`), `${tipo} sem rótulo em português na tela`);
  }
});
