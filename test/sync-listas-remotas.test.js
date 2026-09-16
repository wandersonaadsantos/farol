// Panorama e Meus PRs de outros aparelhos, e o nome do PR nas pendências (7.C3).
//
// Dois motores reais no mesmo processo, no mesmo banco falso e com a mesma chave do
// conjunto: A publica (escopos, catálogo, pendência), B lê. O que este arquivo prova é o
// caminho inteiro do lado do engine, e que a projeção que chega à tela, passada pelas
// funções puras da tela, mostra a origem certa sem contar o mesmo PR duas vezes.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-listas-remotas-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const listas = (await import('../lib/engine/sync-listas.js')).default;
const escopos = (await import('../lib/engine/sync-escopo.js')).default;
const pendencias = (await import('../lib/engine/sync-pendencias.js')).default;
const andamento = (await import('../lib/engine/sync-andamento.js')).default;
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag } = await import('../lib/sync/tags.js');
const pure = await import('../ui/pure.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const T = Date.now();
// a projeção do snapshot que a tela recebe com a visão compartilhada valendo
const SYNC_TELA = { shared: true, bloqueioCompartilhamento: '' };
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
// motor de um caso não pode seguir escrevendo no banco do caso seguinte
const MOTORES = [];
afterEach(() => { for (const e of MOTORES.splice(0)) syncMod.stopSync(e); });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(nome) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: false, deviceName: nome, apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local',
  };
}

const PAN = [
  { key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'Troca a biblioteca', author: 'ana', repo: 'acme/app', number: 1, updatedAt: 'x' },
  { key: 'acme/app#2', url: 'https://github.com/acme/app/pull/2', title: 'Melhora o log', author: 'bia', repo: 'acme/app', number: 2, updatedAt: 'y' },
];
const MEUS = [{ key: 'acme/app#3', url: 'https://github.com/acme/app/pull/3', title: 'Filtro por status', author: LOGIN, repo: 'acme/app', number: 3, mergeable: 'MERGEABLE' }];

// Um aparelho com a chave aberta. Os dois dividem o STATE_DIR (um processo só), então o
// id do segundo é trocado depois do login: é só isso que os separa no banco.
async function aparelho(nome, deviceId) {
  const e = new Engine();
  MOTORES.push(e);
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(nome), accounts: [{ user: LOGIN, owners: ['acme'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  const login = await e.syncLogin({ email: EMAIL, password: SENHA });
  assert.equal(login.ok, true, JSON.stringify(login));
  const aberta = await e.syncUnlock({ password: SENHA });
  assert.equal(aberta.ok, true, JSON.stringify(aberta));
  if (deviceId) e.sync.deviceId = deviceId;
  e.sync.deviceName = nome;
  e.accountForPr = () => LOGIN;
  e.eventos = [];
  e.on('sync-lists', (p) => e.eventos.push(['sync-lists', p]));
  e.on('sync-pending', (p) => e.eventos.push(['sync-pending', p]));
  return e;
}

// A publica, B lê; cada um vê o outro como aparelho v2 pronto
async function par() {
  const a = await aparelho('Notebook', 'dA');
  const b = await aparelho('Desktop antigo', 'dB');
  a.sync.devices = { dB: { contract: 2, keyReady: true, lastSeenAt: Date.now(), name: 'Desktop antigo' } };
  b.sync.devices = { dA: { contract: 2, keyReady: true, lastSeenAt: Date.now(), name: 'Notebook' } };
  return { a, b };
}

async function publicarDeA(a, { panorama = PAN, meus = MEUS, agora = Date.now() } = {}) {
  const cfg = a.config.sync;
  assert.equal((await escopos.publicarEscopo(a, cfg, { tipo: 'panorama', conta: LOGIN, prs: panorama, agora })).ok, true);
  assert.equal((await escopos.publicarEscopo(a, cfg, { tipo: 'myPrs', conta: LOGIN, prs: meus, agora })).ok, true);
}

function escopoDe(proj, tipo) {
  return proj.escopos.find((x) => x.tipo === tipo);
}

function leiturasDeLinhas(tipo) {
  return fake.requests.filter((r) => r.method === 'GET' && r.path === `/users/u1/${tipo}.json` && r.query.orderBy);
}

/* ---------- Panorama e Meus PRs ---------- */

test('B lê o que A publicou: origem, conta, hora e Meus PRs só leitura', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  const r = await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  assert.equal(r.estado, 'ligada');
  const proj = b.syncListasRemotas();
  assert.equal(proj.ok, true);
  assert.equal(proj.limiteMs, SYNC.LISTAS_IDADE_MAX_MS);
  const pano = escopoDe(proj, 'panorama');
  assert.equal(pano.dev, 'dA');
  assert.equal(pano.aparelho, 'Notebook');
  assert.equal(pano.estado, 'ok');
  assert.equal(pano.account, LOGIN);
  assert.equal(pano.lidoEm, T + 10);
  assert.ok(pano.confirmadoAte > T, 'o prazo do publicador vem do meta');
  assert.deepEqual(pano.linhas.map((l) => l.key).sort(), ['acme/app#1', 'acme/app#2']);
  for (const l of pano.linhas) {
    assert.equal(l.account, LOGIN);
    assert.equal(l.u, T);
    assert.equal(l.somenteLeitura, false);
  }
  const [meu] = escopoDe(proj, 'myPrs').linhas;
  assert.equal(meu.somenteLeitura, true, 'dado remoto nunca habilita merge');
  assert.equal(meu.mergeable, 'MERGEABLE');
  const evento = b.eventos.find(([n]) => n === 'sync-lists');
  assert.ok(evento, 'a leitura avisa a tela por evento próprio');
  assert.equal(escopoDe(evento[1], 'panorama').linhas.length, 2);
});

test('a tela mostra a origem certa e não conta dobrado o PR visto aqui e lá', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  const proj = b.syncListasRemotas();
  // B também vê o #1 localmente: ele fica com a origem "este" e não aparece de novo
  const locais = [{ key: 'ACME/app#1', account: LOGIN }, { key: 'acme/app#9', account: LOGIN }];
  const m = pure.mesclarListaRemota(locais, proj, 'panorama', { sync: SYNC_TELA, agora: T + 20 });
  assert.deepEqual(m.remotas.map((l) => l.key), ['acme/app#2']);
  assert.equal(m.remotas[0].aparelho, 'Notebook');
  assert.equal(m.total, 3, 'dois daqui e um de lá, sem o repetido');
  assert.equal(m.outros, 1);
  const html = pure.panoramaRemotoHtml(m, { agora: T + 20 });
  assert.match(html, /3 PRs: 2 deste aparelho e 1 de 1 outro/);
  assert.match(html, /acme\/app#2/);
  assert.match(html, /Notebook/);
  assert.doesNotMatch(html, /acme\/app#1"/, 'o PR local não aparece de novo');
  assert.doesNotMatch(html, /act-review/, 'linha de outro aparelho não oferece ação');
  const meus = pure.meusPrsRemotoHtml(pure.mesclarListaRemota([], proj, 'myPrs', { sync: SYNC_TELA, agora: T + 20 }), { agora: T + 20 });
  assert.match(meus, /do Notebook, só leitura/);
  assert.match(meus, /Merge desabilitado aqui/);
  assert.doesNotMatch(meus, /act-merge|act-set-reviewers/, 'nada que escreva no GitHub');
});

test('sem mudança no ponteiro não relê as linhas; com mudança, lê só o que é novo', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  fake.requests.length = 0;
  await publicarDeA(a, { agora: T + 20 });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 30 });
  assert.equal(leiturasDeLinhas('panorama').length, 0, 'ponteiro igual, nenhuma leitura das linhas');
  await publicarDeA(a, { panorama: [PAN[0], { ...PAN[1], title: 'Novo título' }], agora: T + 40 });
  fake.requests.length = 0;
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 50 });
  const [leitura] = leiturasDeLinhas('panorama');
  assert.ok(leitura, 'o ponteiro mudou, então lê');
  assert.match(leitura.query.startAt, /\|0*\d{13}"$/);
  assert.ok(!/\|0000000000000"$/.test(leitura.query.startAt), 'leitura incremental, não desde o zero');
  const linhas = escopoDe(b.syncListasRemotas(), 'panorama').linhas;
  assert.equal(linhas.length, 2, 'o incremental soma ao que já estava');
  assert.equal(linhas.find((l) => l.key === 'acme/app#2').title, 'Novo título');
});

test('PR que saiu em A some em B', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  await publicarDeA(a, { panorama: [PAN[0]], agora: T + 20 });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 30 });
  assert.deepEqual(escopoDe(b.syncListasRemotas(), 'panorama').linhas.map((l) => l.key), ['acme/app#1']);
});

test('linha que não abre fica de fora e é contada', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  const t = fake.tree();
  const [id] = Object.keys(t.users.u1.panorama);
  t.users.u1.panorama[id].enc = `${t.users.u1.panorama[id].enc.slice(0, -4)}AAAA`;
  fake.setTree(t);
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  const pano = escopoDe(b.syncListasRemotas(), 'panorama');
  assert.equal(pano.linhas.length, 1);
  assert.equal(pano.naoAbriram, 1);
  const html = pure.panoramaRemotoHtml(pure.mesclarListaRemota([], b.syncListasRemotas(), 'panorama', { sync: SYNC_TELA, agora: T + 20 }), { agora: T + 20 });
  assert.match(html, /1 item de outro aparelho não abriu e ficou de fora/);
});

test('leitura que falha vira estado de falha e mantém a visão anterior', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  await publicarDeA(a, { panorama: [PAN[0]], agora: T + 20 });
  const real = b.sync.client;
  b.sync.client = { ...real, get: async (p, o) => (p.endsWith('/panorama') ? { ok: false, code: 'indisponivel' } : real.get(p, o)) };
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 30 });
  b.sync.client = real;
  const pano = escopoDe(b.syncListasRemotas(), 'panorama');
  assert.equal(pano.estado, 'falhou');
  assert.equal(pano.falhaEm, T + 30);
  assert.equal(pano.lidoEm, T + 10, 'a última leitura boa continua sendo a de antes');
  assert.equal(pano.linhas.length, 2, 'a visão anterior fica');
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 40 });
  const depois = escopoDe(b.syncListasRemotas(), 'panorama');
  assert.equal(depois.estado, 'ok', 'a falha não tranca o ponteiro: a próxima leitura busca de novo');
  assert.equal(depois.linhas.length, 1);
});

test('falha ao ler o ponteiro marca todos os escopos como falha', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  const real = b.sync.client;
  b.sync.client = { ...real, get: async (p, o) => (p.endsWith('/live/rev') ? { ok: false, code: 'indisponivel' } : real.get(p, o)) };
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 30 });
  b.sync.client = real;
  for (const x of b.syncListasRemotas().escopos) assert.equal(x.estado, 'falhou', x.tipo);
});

test('a conta que ESTE aparelho publica não aparece como remota', async () => {
  const { a } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(a, a.config.sync, { agora: T + 10 });
  for (const x of a.syncListasRemotas().escopos) {
    assert.equal(x.estado, 'local', x.tipo);
    assert.deepEqual(x.linhas, []);
  }
});

test('estados sem leitura: desligada, sem frota e sem chave são ditos, não viram lista vazia', async () => {
  const { a, b } = await par();
  b.sync.devices = { dA: { contract: 1, keyReady: false, lastSeenAt: Date.now() } };
  await andamento.ciclo(b, b.config.sync, { agora: Date.now() });
  assert.equal(b.syncListasRemotas().estado, 'sem-frota');
  const semChave = { sync: { ...a.sync, material: null }, config: a.config, emit: () => true, accountList: () => a.accountList() };
  assert.equal((await listas.lerListasRemotas(semChave, a.config.sync, { agora: T })).estado, 'sem-chave');
  a.updateSettings({ sync: { ...a.config.sync, shared: { enabled: false } } });
  assert.equal(a.syncListasRemotas().estado, 'desligada');
  assert.deepEqual(a.syncListasRemotas().escopos, []);
});

test('o ciclo do relógio lê as listas depois de publicar', async () => {
  const { a, b } = await par();
  a.panorama = PAN;
  a.myPRs = MEUS;
  await andamento.ciclo(a, a.config.sync, { agora: Date.now() });
  await andamento.ciclo(b, b.config.sync, { agora: Date.now() });
  const pano = escopoDe(b.syncListasRemotas(), 'panorama');
  assert.equal(pano.dev, 'dA');
  assert.equal(pano.linhas.length, 2);
});

test('o evento não se repete sem mudança, e o batimento o reenvia', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 20 });
  assert.equal(b.eventos.filter(([n]) => n === 'sync-lists').length, 1);
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 20 + SYNC.LISTAS_BATIMENTO_MS });
  assert.equal(b.eventos.filter(([n]) => n === 'sync-lists').length, 2);
});

/* ---------- o nome do PR nas pendências ---------- */

function pendenciaEm(e) {
  e.decisions.pending.push({
    id: 'd1', createdAt: T, key: 'acme/app#12', verdict: 'request_changes',
    pr: { repo: 'acme/app', number: 12, title: 'Troca a biblioteca de datas', account: LOGIN, author: 'ana', url: 'https://github.com/acme/app/pull/12' },
    reasons: [{ text: 'trava', kind: 'content' }], reportMarkdown: 'RELATORIO',
  });
}

async function arvoreDasPendencias() {
  const t = fake.tree();
  return (t && t.users.u1.live && t.users.u1.live.pending) || {};
}

test('a pendência de A chega a B com o PR nomeado pelo catálogo', async () => {
  const { a, b } = await par();
  pendenciaEm(a);
  await andamento.ciclo(a, a.config.sync, { agora: Date.now() });
  const r = await pendencias.aplicarPendenciasIdentificadas(b, b.config.sync, await arvoreDasPendencias(), {});
  assert.equal(r.lista.length, 1);
  assert.deepEqual(r.lista[0].pr, { key: 'acme/app#12', account: LOGIN, title: 'Troca a biblioteca de datas', author: 'ana' });
  const [, evento] = b.eventos.find(([n]) => n === 'sync-pending');
  assert.equal(evento.pendencias[0].pr.key, 'acme/app#12', 'o nome chega à tela pelo evento');
  const html = pure.pendenciasCompartilhadasHtml(evento.pendencias, {});
  assert.match(html, /pr-ref-mention[^>]*>acme\/app#12</);
  assert.match(html, /Troca a biblioteca de datas/);
  assert.match(html, /person-mention[^>]*href="https:\/\/github\.com\/ana"/);
});

test('o ciclo de B lê as pendências já identificadas', async () => {
  const { a, b } = await par();
  pendenciaEm(a);
  await andamento.ciclo(a, a.config.sync, { agora: Date.now() });
  await andamento.ciclo(b, b.config.sync, { agora: Date.now() });
  const [, evento] = b.eventos.find(([n]) => n === 'sync-pending');
  assert.equal(evento.pendencias[0].pr.title, 'Troca a biblioteca de datas');
});

async function catalogoTrocado(a, mutar) {
  const t = fake.tree();
  const kId = kek.bufferDe(a.sync.material.id);
  const tag = prTag(kId, 'acme/app#12');
  mutar(t.users.u1.catalog, tag, kId);
  fake.setTree(t);
}

test('catálogo adulterado cai no rótulo genérico, nunca em nome de outro PR', async () => {
  const { a, b } = await par();
  pendenciaEm(a);
  a.queue = [{ key: 'acme/app#77', title: 'Outro PR qualquer', author: 'zeca', repo: 'acme/app', number: 77 }];
  await andamento.ciclo(a, a.config.sync, { agora: Date.now() });
  // a linha do #77 posta no lugar da do #12: a AAD amarra o caminho, e não abre
  await catalogoTrocado(a, (cat, tag, kId) => { cat[tag] = cat[prTag(kId, 'acme/app#77')]; });
  const r = await pendencias.aplicarPendenciasIdentificadas(b, b.config.sync, await arvoreDasPendencias(), {});
  assert.equal(r.lista[0].pr, null);
  const html = pure.pendenciasCompartilhadasHtml(r.lista, {});
  assert.doesNotMatch(html, /acme\/app#77|Outro PR qualquer/);
  assert.match(html, /Um PR seu/);
});

test('catálogo cifrado com chave de outra época cai no rótulo genérico', async () => {
  const { a, b } = await par();
  pendenciaEm(a);
  await andamento.ciclo(a, a.config.sync, { agora: Date.now() });
  const outraEpoca = kek.novoMaterial();
  await catalogoTrocado(a, (cat, tag) => {
    const c = envelope.cifrar({
      uid: 'u1', caminho: `catalog/${tag}`, campo: 'linha', no: 'catalog', esquema: 'cat1', cur: 'g1', material: outraEpoca,
      r: 1, dados: { l: { key: 'acme/app#12', title: 'Nome de outra época', author: 'x' } },
    });
    cat[tag] = { v: 1, u: Date.now(), enc: c.enc };
  });
  const r = await pendencias.aplicarPendenciasIdentificadas(b, b.config.sync, await arvoreDasPendencias(), {});
  assert.equal(r.lista[0].pr, null);
});

test('linha do catálogo que abre mas nomeia outro PR não é aceita', async () => {
  const { a, b } = await par();
  const kId = kek.bufferDe(a.sync.material.id);
  const tag = prTag(kId, 'acme/app#12');
  const c = envelope.cifrar({
    uid: 'u1', caminho: `catalog/${tag}`, campo: 'linha', no: 'catalog', esquema: 'cat1', cur: a.sync.cur, material: a.sync.material,
    r: 1, dados: { l: { key: 'acme/app#77', title: 'Outro PR', author: 'zeca' } },
  });
  assert.equal((await a.sync.client.put(`/users/u1/catalog/${tag}`, { v: 1, u: Date.now(), enc: c.enc }, {})).ok, true);
  assert.equal(await publicacao.prDaTag(b, b.config.sync, tag), null);
});

test('sem tag, sem compartilhamento ou sem catálogo: null, e a pendência sai com pr null', async () => {
  const { b } = await par();
  assert.equal(await publicacao.prDaTag(b, b.config.sync, ''), null);
  assert.equal(await publicacao.prDaTag(b, b.config.sync, 'f'.repeat(32)), null);
  assert.equal(await publicacao.prDaTag(b, { ...b.config.sync, shared: { enabled: false } }, 'f'.repeat(32)), null);
  const lista = pendencias.lerPendencias(b, {}, {});
  assert.deepEqual(lista, []);
});

test('um campo pr dentro da pendência cifrada é ignorado: só o catálogo nomeia', async () => {
  const { a, b } = await par();
  const no = { v: 1, at: T, dev: 'dA' };
  const c = envelope.cifrar({
    uid: 'u1', caminho: 'live/pending/ab12', campo: 'pendencia', no: 'live/pending', esquema: 'pend1', cur: a.sync.cur, material: a.sync.material,
    r: 1, extras: [no.at, no.dev], dados: { p: { prTag: '', acctTag: '', veredito: 'approve', motivos: [], bloqueio: '', pr: { key: 'acme/app#99', title: 'Nome plantado', author: 'x', account: LOGIN } } },
  });
  assert.equal(c.ok, true);
  const [lida] = pendencias.lerPendencias(b, { ab12: { ...no, enc: c.enc } }, {});
  assert.ok(lida, 'a pendência abre');
  assert.equal(lida.pr, null, 'o nome não pode vir de dentro do item');
  const r = await pendencias.aplicarPendenciasIdentificadas(b, b.config.sync, { ab12: { ...no, enc: c.enc } }, {});
  assert.equal(r.lista[0].pr, null, 'sem tag não há nome, mesmo com o campo plantado');
});

test('o catálogo publicado inclui o PR das pendências e das sessões vivas', async () => {
  const { a } = await par();
  pendenciaEm(a);
  a.activeReviews = new Map([['s1', { pr: { key: 'acme/app#41', title: 'Sessão viva', author: 'caio', repo: 'acme/app', number: 41 }, keys: ['acme/app#41'], mode: 'auto' }]]);
  await andamento.ciclo(a, a.config.sync, { agora: Date.now() });
  const kId = kek.bufferDe(a.sync.material.id);
  const cat = fake.tree().users.u1.catalog || {};
  assert.ok(cat[prTag(kId, 'acme/app#12')], 'a pendência tem nome no catálogo');
  assert.ok(cat[prTag(kId, 'acme/app#41')], 'a sessão viva tem nome no catálogo');
});

/* ---------- o andamento: a leitura que falha é dita ---------- */

test('leitura do andamento que falha emite a falha com a visão anterior, e não a apaga', async () => {
  const { a, b } = await par();
  a.activeReviews = new Map([['s1', { pr: { key: 'acme/app#41', title: 'Sessão viva', repo: 'acme/app', number: 41 }, keys: ['acme/app#41'], mode: 'auto', startedAt: Date.now() }]]);
  await andamento.ciclo(a, a.config.sync, { agora: Date.now() });
  const vivos = [];
  b.on('sync-live', (p) => vivos.push(p));
  await andamento.ciclo(b, b.config.sync, { agora: Date.now() });
  assert.equal(vivos.at(-1).operacoes.length, 1);
  assert.equal('falhaEm' in vivos.at(-1), false, 'leitura boa não fala de falha');
  const real = b.sync.client;
  b.sync.client = { ...real, get: async (p, o) => (p.endsWith('/live/operations') ? { ok: false, code: 'indisponivel' } : real.get(p, o)) };
  const quando = Date.now();
  await andamento.ciclo(b, b.config.sync, { agora: quando });
  b.sync.client = real;
  const ultimo = vivos.at(-1);
  assert.equal(ultimo.falhaEm, quando, 'a falha chega à tela');
  assert.equal(ultimo.operacoes.length, 1, 'com a visão anterior, não com lista vazia');
  assert.equal(b.sync.andamentoRemoto.length, 1);
});

test('a rota SSE repassa sync-lists', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
  assert.match(fonte, /engine\.on\('sync-lists', p => broadcast\('sync-lists', p\)\)/);
});

/* ---------- a lista de revisões: falha é falha ---------- */

async function comServidor(engine, fn) {
  const { startServer } = await import('../lib/http-server.js');
  engine.config.port = 0;
  const server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (rota, corpo = {}) => {
    const r = await fetch(base + rota, { method: 'POST', headers: { 'x-farol': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    return r.json();
  };
  try { return await fn(post); } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

test('a leitura das revisões que falha chega como falha, e a vazia como lista vazia', async () => {
  const { b } = await par();
  assert.deepEqual(await b.syncRecentes({}), { revisoes: [], naoAbriram: 0 }, 'banco sem revisão é lista vazia');
  const real = b.sync.client;
  b.sync.client = { ...real, get: async () => ({ ok: false, code: 'indisponivel' }) };
  assert.equal(await b.syncRecentes({}), null, 'falha não vira lista vazia');
  await comServidor(b, async (post) => {
    const falha = await post('/api/sync/reviews', {});
    assert.equal(falha.ok, false, 'a rota diz que falhou');
    assert.equal(falha.code, 'indisponivel');
    assert.equal('revisoes' in falha, false);
    b.sync.client = real;
    assert.deepEqual(await post('/api/sync/reviews', {}), { ok: true, revisoes: [], naoAbriram: 0 });
  });
  b.sync.client = real;
});

test('a rota das listas entrega a projeção, com envelope', async () => {
  const { a, b } = await par();
  await publicarDeA(a, { agora: T });
  await listas.lerListasRemotas(b, b.config.sync, { agora: T + 10 });
  await comServidor(b, async (post) => {
    const r = await post('/api/sync/lists', { qualquer: 'coisa' });
    assert.equal(r.ok, true);
    assert.equal(r.estado, 'ligada');
    assert.equal(escopoDe(r, 'panorama').linhas.length, 2);
    assert.equal(JSON.stringify(r).includes('qualquer'), false, 'nada do corpo volta');
  });
});
