// História de revisões entre aparelhos (7.C3): índice, corpo versionado e ponteiro.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3d-historico-'));
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
const syncMod = (await import('../lib/engine/sync.js')).default;
const hist = await import('../lib/engine/sync-historico.js');
const { STATE_DIR } = await import('../lib/paths.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
let fake;
let identity;

before(async () => {
  identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' } } });
  fake = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
});
after(async () => {
  await fake.close();
  await identity.close();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: false, deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function motorPronto({ comFrota = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = comFrota
    ? { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } }
    : { dOutro: { contract: 1, keyReady: false, lastSeenAt: Date.now() } };
  fake.requests.length = 0;
  return e;
}




beforeEach(() => { try { fs.rmSync(path.join(STATE_DIR, 'sync-historico.json'), { force: true }); } catch { /* sem marco anterior */ } });

const AGORA = Date.now();

function decisao(e, id, extra = {}) {
  const d = {
    id, createdAt: AGORA + 1000, resolvedAt: AGORA + 2000, key: `dono/repo#${id}`, verdict: 'approve',
    status: 'posted', action: 'approve', reasons: [{ text: 'motivo', kind: 'gate' }],
    pr: { repo: 'dono/repo', number: 1, title: 'Titulo secreto', author: 'alguem', account: LOGIN },
    reportMarkdown: 'RELATORIO INTERNO', ...extra,
  };
  e.decisions.resolved.unshift(d);
  return d;
}

function arvore(nome) {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1[nome]) || {};
}

function outro(e) {
  return { sync: { ...e.sync, deviceId: 'dOutro' } };
}

test('sem frota nada sobe', async () => {
  const e = await motorPronto({ comFrota: false });
  decisao(e, 'd1');
  assert.equal((await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA })).code, 'sem-frota');
  assert.deepEqual(arvore('recentReviews'), {});
});

test('o que é anterior ao compartilhamento não sobe sozinho: isso é o envio explícito', async () => {
  const e = await motorPronto();
  decisao(e, 'antiga', { createdAt: AGORA - 100000, resolvedAt: AGORA - 90000 });
  decisao(e, 'nova');
  const r = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  assert.equal(r.escritas.length, 1, 'só a nova');
});

test('o marco sobrevive a reinício: o que aconteceu no meio não é empurrado para fora', async () => {
  const e = await motorPronto();
  await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  e.sync.historicoDesde = 0;
  decisao(e, 'no-meio', { createdAt: AGORA + 500 });
  const r = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA + 999999 });
  assert.equal(r.escritas.length, 1);
});

test('índice com t, d, dt em claro e o resto cifrado; corpo versionado; ponteiro', async () => {
  const e = await motorPronto();
  const d = decisao(e, 'd1');
  const { escritas: [id] } = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  const idx = arvore('recentReviews')[id];
  assert.deepEqual(Object.keys(idx).sort(), ['d', 'dt', 'enc', 't', 'v']);
  assert.equal(idx.t, d.createdAt);
  assert.equal(idx.dt, `${e.sync.deviceId}|${String(d.createdAt).padStart(13, '0')}`);
  assert.ok(arvore('reviewBodies')[id][String(d.resolvedAt)], 'versão = instante do status');
  assert.equal(fake.tree().users.u1.live.rev.recentReviews[e.sync.deviceId], d.createdAt);
  const cru = JSON.stringify(fake.tree());
  for (const p of ['Titulo secreto', 'RELATORIO', LOGIN, 'dono/repo']) assert.equal(cru.includes(p), false, p);
});

test('mudança de status cria versão nova e mantém a antiga', async () => {
  const e = await motorPronto();
  const d = decisao(e, 'd1', { status: 'pending', resolvedAt: undefined });
  const { escritas: [id] } = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  assert.deepEqual((await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA })).escritas, [], 'sem mudança, nada');
  Object.assign(d, { status: 'posted', resolvedAt: AGORA + 5000 });
  await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  assert.deepEqual(Object.keys(arvore('reviewBodies')[id]).sort(), [String(d.createdAt), String(AGORA + 5000)].sort());
  const aberta = await hist.abrirRevisao(outro(e), id);
  assert.equal(aberta.versao, AGORA + 5000, 'vale a maior versão');
  assert.equal(aberta.status, 'posted');
  assert.equal(aberta.pr.title, 'Titulo secreto');
  assert.equal(aberta.account, undefined);
});

test('corpo é write-once: republicar depois de reiniciar não sobrescreve', async () => {
  const e = await motorPronto();
  decisao(e, 'd1');
  const { escritas: [id] } = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  const antes = JSON.stringify(arvore('reviewBodies')[id]);
  e.sync.historicoPublicado = new Map();
  const r = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  assert.equal(r.escritas.length, 1, '412 no corpo conta como já publicado');
  assert.equal(JSON.stringify(arvore('reviewBodies')[id]), antes);
});

test('versão corrompida não esconde a anterior', async () => {
  const e = await motorPronto();
  const d = decisao(e, 'd1', { status: 'pending', resolvedAt: undefined });
  const { escritas: [id] } = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  const t = fake.tree();
  t.users.u1.reviewBodies[id]['9999999999999'] = { v: 1, enc: 'e1.g1.AAAA.BBBB.CCCC' };
  fake.setTree(t);
  const aberta = await hist.abrirRevisao(outro(e), id);
  assert.equal(aberta.versao, d.createdAt);
  assert.equal(await hist.abrirRevisao(outro(e), '../x'), null);
});

test('lê as recentes de todos, ordenadas, e as de um aparelho só', async () => {
  const e = await motorPronto();
  for (let i = 0; i < 3; i++) decisao(e, `d${i}`, { createdAt: AGORA + 1000 + i });
  await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  const t = fake.tree();
  const [umId, um] = Object.entries(t.users.u1.recentReviews)[0];
  t.users.u1.recentReviews.zz = { ...um, d: 'dOutro' };
  fake.setTree(t);
  const todas = await hist.lerRecentes(outro(e));
  assert.equal(todas.length, 3, 'o item com d trocado não decifra e some');
  assert.deepEqual(todas.map((x) => x.t), [AGORA + 1002, AGORA + 1001, AGORA + 1000]);
  assert.equal(todas[0].veredito, 'approve');
  const deste = await hist.lerRecentes(outro(e), { dev: e.sync.deviceId });
  assert.equal(deste.length, 3);
  assert.deepEqual(await hist.lerRecentes(outro(e), { dev: 'ninguem' }), []);
  const novas = await hist.lerRecentes(outro(e), { desdeT: AGORA + 1002 });
  assert.deepEqual(novas.map((x) => x.t), [AGORA + 1002]);
  assert.ok(umId);
});

test('teto por ciclo: um aparelho atrasado não despeja tudo de uma vez', async () => {
  const e = await motorPronto();
  for (let i = 0; i < hist.LIMITE_POR_CICLO + 5; i++) decisao(e, `d${i}`, { createdAt: AGORA + 1000 + i });
  const r = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  assert.equal(r.escritas.length, hist.LIMITE_POR_CICLO);
  const r2 = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  assert.equal(r2.escritas.length, 5, 'o resto vai no ciclo seguinte');
});

test('as rotas da história existem e o envelope diz se achou', async () => {
  const e = await motorPronto();
  decisao(e, 'd1');
  const { escritas: [id] } = await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  assert.equal((await e.syncRecentes({})).revisoes.length, 1);
  assert.equal((await e.syncAbrirRevisao({ reviewId: id })).reviewId, id);
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
  assert.match(fonte, /p === '\/api\/sync\/reviews'/);
  assert.match(fonte, /r \? \{ found: true, revisao: r \} : \{ found: false \}/, 'nunca a revisão crua nem 404');
});

test('sem a projeção da tela, o relatório cru não sobe', async () => {
  const e = await motorPronto();
  decisao(e, 'd1');
  const semProjecao = Object.create(e);
  semProjecao.decisionForUi = undefined;
  const { escritas: [id] } = await hist.sincronizarHistorico(semProjecao, e.config.sync, { agora: AGORA });
  const aberta = await hist.abrirRevisao(outro(e), id);
  assert.equal(aberta.reportMarkdown, undefined);
});

// Quadro C3Historico: "1 revisão não abriu". A linha que não decifra continua fora da lista
// (nunca pela metade), mas a tela precisa saber QUANTAS ficaram de fora, para não parecer
// que a lista está completa.
test('as recentes contam quantas não abriram, e a rota entrega a contagem', async () => {
  const e = await motorPronto();
  for (let i = 0; i < 2; i++) decisao(e, `d${i}`, { createdAt: AGORA + 1000 + i });
  await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  const t = fake.tree();
  const [, um] = Object.entries(t.users.u1.recentReviews)[0];
  t.users.u1.recentReviews.zz = { ...um, d: 'dOutro' };
  fake.setTree(t);
  const contadas = await hist.lerRecentesContadas(outro(e));
  assert.equal(contadas.revisoes.length, 2);
  assert.equal(contadas.naoAbriram, 1);
  assert.equal((await hist.lerRecentes(outro(e))).length, 2, 'a leitura antiga continua devolvendo a lista');
  const pela = await e.syncRecentes({});
  assert.equal(pela.revisoes.length, 2);
  assert.equal(pela.naoAbriram, 1, 'o aparelho carimbado foi trocado: a linha não abre para ninguém');
});

// O índice da história leva o PR só como tag; o nome sai do catálogo cifrado, como nas
// pendências. Sem a linha do catálogo, `pr` é nulo e a tela fica com o rótulo genérico.
test('as recentes lidas pela tela trazem o PR resolvido pelo catálogo, ou nulo', async () => {
  const pub = await import('../lib/engine/sync-publicacao.js');
  const e = await motorPronto();
  decisao(e, 'd1', { createdAt: AGORA + 1001, key: 'dono/repo#11' });
  decisao(e, 'd2', { createdAt: AGORA + 1002, key: 'dono/repo#12' });
  await hist.sincronizarHistorico(e, e.config.sync, { agora: AGORA });
  await pub.publicarNoCatalogo(e, e.config.sync, [{ key: 'dono/repo#11', title: 'Titulo do um', author: 'alguem', number: 11, repo: 'dono/repo' }]);
  e.sync.catalogoLru = new Map();
  const r = await e.syncRecentes({});
  const porT = Object.fromEntries(r.revisoes.map((x) => [x.t, x]));
  assert.equal(porT[AGORA + 1001].pr.key, 'dono/repo#11');
  assert.equal(porT[AGORA + 1001].pr.title, 'Titulo do um');
  assert.equal(porT[AGORA + 1002].pr, null, 'fora do catálogo, sem nome inventado');
});
