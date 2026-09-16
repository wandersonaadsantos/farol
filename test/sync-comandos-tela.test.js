// Repetir, iniciar e designar admin PELA TELA, ponta a ponta entre dois engines no mesmo
// processo (o mesmo arranjo de test/sync-transferencia-tela.test.js).
//
// O ADMIN tem a tela (ui/app.js no DOM de mentira, com o `fetch` indo ao servidor HTTP real
// dele) e emite os comandos; o EXECUTOR é o outro aparelho, dono da revisão, publicador do
// candidato e alvo da designação. Cada caso passa por código de produção de ponta a ponta:
// dado publicado pelo executor, lido pelo admin, ação habilitada na tela, corpo exato da
// requisição, comando aplicado pelo executor com os gates dele, recibo lido de volta.
//
// Os dois engines dividem o STATE_DIR e o ~/.farol (resolvidos uma vez no import de
// lib/paths.js). Por isso o id de cada aparelho é fixado à mão, e o giro do executor que
// NÃO agenda esconde a chave de admin, que no mundo real mora só na máquina do admin.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-comandos-tela-'));
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

const fetchReal = globalThis.fetch;
const { emitir } = instalarDom();

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const historico = (await import('../lib/engine/sync-historico.js')).default;
const dist = (await import('../lib/engine/sync-distribuicao.js')).default;
const comandos = (await import('../lib/engine/sync-comandos.js')).default;
const admissao = (await import('../lib/engine/admissao.js')).default;
const adminChave = (await import('../lib/sync/admin-chave.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag, matTag } = await import('../lib/sync/tags.js');
const { STATE_DIR } = await import('../lib/paths.js');
const { notaDistribuicaoHtml } = await import('../ui/pure.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'conta-sintetica';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const ADMIN = 'dAdminTeste02';
const EXEC = 'dExecTeste02';
const VELHO = 'dVelhoTeste02';
const HEAD = 'sha51aaaa';
const PR = { key: 'acme-exemplo/app-web#51', url: 'https://github.com/acme-exemplo/app-web/pull/51', title: 'Corrige o cabeçalho', author: 'bruno-exemplo', repo: 'acme-exemplo/app-web', number: 51 };

let fake;
let identity;
let admin;
let exec;
let server;
let base;
const PEDIDOS = [];

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetchReal(alvo, init);
}

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
    [EXEC]: { name: 'Desktop de teste', contract: 2, keyReady: true, lastSeenAt: agora },
    [VELHO]: { name: 'Celular antigo', contract: 1, keyReady: true, lastSeenAt: agora },
    [ADMIN]: { name: 'Notebook de teste', contract: 2, keyReady: true, lastSeenAt: agora },
  };
}

async function motor(deviceId) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['acme-exemplo'] }], parallelReviews: 1 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.deviceId = deviceId;
  e.sync.devices = frota();
  e.sync.autoridade = fresca();
  e.sync.sinais = {
    conexaoEm: 0, lidos: new Set(), beat: null, modo: '', voltaPendente: false, voltando: false, ultimoBatimentoEm: 0,
    ready: { sequenciaVista: 1, fresca: true, ultimaMudancaEm: Date.now() },
  };
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  e.accountForPr = () => LOGIN;
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
  fixarMemoriaLivre();
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  server = null;
});

await import('../ui/app.js');
const Tela = await import('../ui/telas/radar-compartilhado.js');
const Aparelhos = await import('../ui/telas/sistema-aparelhos.js');
const { api: apiDaTela } = await import('../ui/telas/infra.js');
const $ = (s) => document.querySelector(s);

beforeEach(async () => {
  fake.setTree(null);
  PEDIDOS.length = 0;
  for (const f of [comandos.caminhoDosFeitos(), path.join(STATE_DIR, 'sync-historico.json')]) {
    try { fs.rmSync(f, { force: true }); } catch { /* sem registro anterior */ }
  }
  admin = await motor(ADMIN);
  assert.equal((await admin.syncTornarAdmin({ password: SENHA })).ok, true);
  admin.sync.autoridade = fresca();
  admin.sync.sinais.admin = { dev: ADMIN, generation: Number(arvore().live.control.admin.generation) };
  await subirServidor(admin);
  exec = await motor(EXEC);
  // a fila real vem da busca do GitHub, SEM head: o executor pergunta o head atual
  exec.queue = [{ key: PR.key, url: PR.url, title: PR.title, author: PR.author, repo: PR.repo, number: PR.number }];
  exec.headSha = async () => HEAD;
  exec.enfileirados = [];
  exec.enqueueHeadless = (pr) => { exec.enfileirados.push({ key: pr.key, manual: 'manual' in pr, requested: 'requested' in pr, viaComando: pr.viaComando }); return { ok: true, via: 'local' }; };
  exec.iniciados = [];
  exec.enfileirarDaDistribuicao = (pr, vaga) => { exec.iniciados.push({ key: pr.key, vaga: !!vaga, manual: 'manual' in pr }); return { ok: true }; };
  assert.equal((await publicacao.publicarNoCatalogo(exec, exec.config.sync, [PR])).ok, true);
});

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

function pedidosPara(rota) {
  return PEDIDOS.filter((p) => p.url === rota).map((p) => p.corpo);
}

async function lerReciboNaTela() {
  emitir('state', estadoDaTela());
  await Tela.atualizarRecibos(syncMod.statusForUi(admin).comandosEmitidos, { forcar: true });
  return $('#mdComandos').innerHTML;
}

// O desfecho de cada comando como o executor o gravou no RECIBO (estado e código): é o que
// a tela lê, e é o mesmo para as recusas de contrato, que o ciclo devolve só com o código.
async function cicloDoExecutor() {
  const r = await comandos.cicloDosComandos(exec, exec.config.sync);
  assert.equal(r.ok, true, r.code);
  const recibos = arvore().commandReceipts || {};
  return r.aplicados.map((a) => {
    const recibo = recibos[a.cmdId];
    return recibo ? [recibo.estado, recibo.code] : [a.estado, a.code || ''];
  });
}

/* ======================= repetir ======================= */

async function execPublicaRevisao(extra = {}) {
  const agora = Date.now();
  exec.decisions.resolved.unshift({
    id: 'dRev1', createdAt: agora + 1000, resolvedAt: agora + 2000, key: PR.key, verdict: 'approve',
    status: 'posted', action: 'approve', reasons: [], headSha: HEAD,
    pr: { repo: PR.repo, number: PR.number, title: PR.title, author: PR.author, account: LOGIN },
    reportMarkdown: 'relatório', ...extra,
  });
  const r = await historico.sincronizarHistorico(exec, exec.config.sync, { agora });
  assert.equal(r.ok, true, r.code);
  assert.equal(r.escritas.length, 1);
  return r.escritas[0];
}

async function telaComRevisoes() {
  emitir('state', estadoDaTela());
  await Tela.buscarRevisoes();
  return $('#mdRevisoes').innerHTML;
}

test('repetir pela tela: o índice traz o commit, o corpo sai exato, o dono aplica e a tela lê o recibo', async () => {
  const reviewId = await execPublicaRevisao();
  const html = await telaComRevisoes();
  assert.match(html, new RegExp(`md-repetir" data-review="${reviewId}" data-dev="${EXEC}"`), 'o botão está habilitado');
  assert.ok(!JSON.stringify(fake.tree()).includes(HEAD), 'o SHA não sobe em lugar nenhum');
  let confirmacao = null;
  assert.equal(await Tela.repetirRevisao(reviewId, async (c) => { confirmacao = c; return true; }), true);
  assert.equal(confirmacao.title, 'Repetir a análise no Desktop de teste?');
  assert.deepEqual(pedidosPara('/api/sync/command'), [{ alvo: EXEC, tipo: 'repetir', args: { prTag: prTag(kId(admin), PR.key), matTag: matTag(kId(admin), HEAD) } }]);
  assert.doesNotMatch(await lerReciboNaTela(), />aplicado</, 'sem recibo, nunca concluído');
  assert.deepEqual(await cicloDoExecutor(), [['aplicado', '']]);
  assert.deepEqual(exec.enfileirados, [{ key: PR.key, manual: false, requested: false, viaComando: true }]);
  const recibo = await lerReciboNaTela();
  assert.match(recibo, /<b>repetir<\/b> para Desktop de teste, <a[^>]*>acme-exemplo\/app-web#51<\/a>/);
  assert.match(recibo, /sync-chip ok">aplicado</);
});

test('repetir indisponível: revisão sem commit no índice, e admin sem sinal fresco, cada um com o motivo', async () => {
  const reviewId = await execPublicaRevisao({ headSha: '' });
  const html = await telaComRevisoes();
  assert.doesNotMatch(html, /md-repetir/);
  assert.match(html, /Repetir: indisponível, esta revisão foi publicada antes de o commit entrar no índice/);
  assert.equal(await Tela.repetirRevisao(reviewId, async () => true), false);
  admin.sync.autoridade = { ...fresca(), fresca: false };
  exec.decisions.resolved.length = 0;
  const outra = await execPublicaRevisao({ id: 'dRev2' });
  assert.match(await telaComRevisoes(), /Repetir: indisponível, o admin está sem sinal fresco agora/);
  assert.equal(await Tela.repetirRevisao(outra, async () => true), false);
  assert.equal(await Tela.repetirRevisao(outra, async () => false), false);
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

test('repetir sem confirmação não sai', async () => {
  const reviewId = await execPublicaRevisao();
  await telaComRevisoes();
  assert.equal(await Tela.repetirRevisao(reviewId, async () => false), false);
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

test('repetir: o head muda entre a escolha e a execução, o dono recusa com head_mudou e a tela mostra', async () => {
  const reviewId = await execPublicaRevisao();
  await telaComRevisoes();
  assert.equal(await Tela.repetirRevisao(reviewId, async () => true), true);
  exec.headSha = async () => 'sha52bbbb';
  assert.deepEqual(await cicloDoExecutor(), [['recusado', 'head_mudou']]);
  assert.deepEqual(exec.enfileirados, []);
  const html = await lerReciboNaTela();
  assert.match(html, /sync-chip bad">recusado</);
  assert.match(html, /o commit mudou desde o pedido/);
});

test('repetir: o admin perde a autoridade antes de o dono ler, e o dono ignora com o porquê', async () => {
  const reviewId = await execPublicaRevisao();
  await telaComRevisoes();
  assert.equal(await Tela.repetirRevisao(reviewId, async () => true), true);
  exec.sync.autoridade = { ...fresca(), fresca: false };
  assert.deepEqual(await cicloDoExecutor(), [['ignorado', 'autoridade']]);
  assert.deepEqual(exec.enfileirados, []);
  const html = await lerReciboNaTela();
  assert.match(html, /sync-chip mute">ignorado</);
  assert.match(html, /o admin estava sem sinal fresco/);
});

/* ======================= iniciar ======================= */

let reservaDoExec = '';

// O executor publica o candidato estando SEM VAGA (teto 1 e um chat ocupando), então o
// agendador do admin não o atribui, e o item fica esperando com o motivo.
async function candidatoEsperando() {
  const r = await dist.publicarCandidato(exec, exec.config.sync, { ...PR, headSha: HEAD }, { agora: Date.now() });
  assert.equal(r.ok, true, r.code);
  exec.headlessDistribuindo = new Map([[PR.key, { pr: PR, desde: Date.now() }]]);
  const reserva = admissao.reservar(exec, { tipo: 'chat' });
  assert.equal(reserva.ok, true, reserva.motivo);
  reservaDoExec = reserva.id;
  assert.equal((await publicacao.publicarCapacidade(exec, exec.config.sync)).ok, true);
  assert.equal((await publicacao.publicarCapacidade(admin, admin.config.sync)).ok, true);
  const ciclo = await dist.cicloDoAgendador(admin, admin.config.sync, { agora: Date.now() });
  assert.equal(ciclo.ok, true, ciclo.code);
  assert.equal(ciclo.atribuido, null, 'sem vaga, ninguém recebe o item');
  return r.itemId;
}

async function execGanhaVaga() {
  assert.equal(admissao.liberar(exec, reservaDoExec), true);
  exec.sync.publicado = {};
  assert.equal((await publicacao.publicarCapacidade(exec, exec.config.sync)).ok, true);
}

// o giro do executor, que publicou e NÃO agenda
async function giroDoExecutor() {
  const ler = adminChave.lerChaveDeAdmin;
  adminChave.lerChaveDeAdmin = () => null;
  try {
    return await dist.cicloDaDistribuicao(exec, exec.config.sync, { agora: Date.now() });
  } finally {
    adminChave.lerChaveDeAdmin = ler;
  }
}

test('o motivo da espera chega a quem publicou: o veredito do admin diz que este aparelho está sem vaga', async () => {
  await candidatoEsperando();
  const giro = await giroDoExecutor();
  assert.equal(giro.agenda.code, 'nao-e-admin');
  const s = syncMod.statusForUi(exec);
  const item = s.distribuicao.esperando[0];
  assert.equal(item.motivo, 'sem-aparelho-apto');
  assert.deepEqual(item.aparelhos, [{ deviceId: EXEC, motivo: 'sem-vaga' }]);
  const nota = notaDistribuicaoHtml(PR.key, s);
  assert.match(nota, /nenhum aparelho apto agora/);
  assert.match(nota, /Por aparelho: este aparelho, sem vaga\./);
  assert.match(nota, /a recusa por peso não está ativa/);
  assert.equal(s.distribuicao.candidatos.length, 0, 'quem não agenda não inventa a fila do conjunto');
});

test('iniciar pela tela: a fila do conjunto, os executores pela rota, o corpo exato, a execução e o recibo', async () => {
  const itemId = await candidatoEsperando();
  emitir('state', estadoDaTela());
  assert.equal($('#mdCandidatosWrap').hidden, false);
  assert.match($('#mdCandidatos').innerHTML, new RegExp(`md-iniciar" data-item="${itemId}"`));
  assert.match($('#mdCandidatos').innerHTML, /Corrige o cabeçalho/, 'o nome vem do catálogo');
  await execGanhaVaga();
  let dialogo = null;
  let confirmacao = null;
  const enviado = await Tela.iniciarCandidato(itemId, async (d) => { dialogo = d; return EXEC; }, async (c) => { confirmacao = c; return true; });
  assert.equal(enviado, true);
  assert.deepEqual(pedidosPara('/api/sync/transfer-targets'), [{ itemId }]);
  assert.deepEqual(dialogo.aptos, [EXEC]);
  assert.match(dialogo.corpo, /este aparelho \(Notebook de teste\).*não publicou este candidato/s);
  assert.match(dialogo.corpo, /Celular antigo.*versão antiga/s);
  assert.equal(confirmacao.title, 'Começar no Desktop de teste?');
  assert.deepEqual(pedidosPara('/api/sync/command'), [{ alvo: EXEC, tipo: 'iniciar', args: { prTag: prTag(kId(admin), PR.key), matTag: matTag(kId(admin), HEAD) } }]);
  assert.doesNotMatch(await lerReciboNaTela(), />aplicado</);
  assert.deepEqual(await cicloDoExecutor(), [['aplicado', '']]);
  assert.deepEqual(exec.iniciados, [{ key: PR.key, vaga: true, manual: false }]);
  const html = await lerReciboNaTela();
  assert.match(html, /<b>iniciar<\/b> para Desktop de teste/);
  assert.match(html, /sync-chip ok">aplicado</);
});

test('iniciar indisponível: sem vaga em quem publicou, a escolha diz por quê e nada sai', async () => {
  const itemId = await candidatoEsperando();
  emitir('state', estadoDaTela());
  let dialogo = null;
  assert.equal(await Tela.iniciarCandidato(itemId, async (d) => { dialogo = d; return EXEC; }, async () => true), false);
  assert.equal(dialogo.pode, false);
  assert.match(dialogo.corpo, /Desktop de teste.*sem vaga/s);
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

test('iniciar indisponível: quem publicou sem credencial da conta do item aparece com esse motivo', async () => {
  const itemId = await candidatoEsperando();
  emitir('state', estadoDaTela());
  exec.doctorInfo = { claude: '1.0.0', ghAuth: false };
  await execGanhaVaga();
  let dialogo = null;
  assert.equal(await Tela.iniciarCandidato(itemId, async (d) => { dialogo = d; return EXEC; }, async () => true), false);
  assert.match(dialogo.corpo, /Desktop de teste.*sem credencial desta conta/s, 'a conta do item vem do próprio candidato');
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

test('iniciar indisponível: publicação vencida não conta como executor', async () => {
  const itemId = await candidatoEsperando();
  emitir('state', estadoDaTela());
  await execGanhaVaga();
  const t = fake.tree();
  t.users.u1.live.queue[itemId][EXEC].ttl = Date.now() - 1;
  fake.setTree(t);
  let dialogo = null;
  assert.equal(await Tela.iniciarCandidato(itemId, async (d) => { dialogo = d; return EXEC; }, async () => true), false);
  assert.match(dialogo.corpo, /Desktop de teste.*não publicou este candidato/s);
});

test('iniciar indisponível: o distribuidor já escolheu o executor, e a fila diz quem', async () => {
  const itemId = await candidatoEsperando();
  await execGanhaVaga();
  const ciclo = await dist.cicloDoAgendador(admin, admin.config.sync, { agora: Date.now() });
  assert.equal(ciclo.atribuido.dev, EXEC);
  emitir('state', estadoDaTela());
  assert.match($('#mdCandidatos').innerHTML, /Começar agora: indisponível, o distribuidor já escolheu o Desktop de teste e espera ele aceitar/);
  assert.equal(await Tela.iniciarCandidato(itemId, async () => EXEC, async () => true), false);
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

test('iniciar indisponível sem admin fresco: a fila mostra o motivo e o ato não sai', async () => {
  const itemId = await candidatoEsperando();
  admin.sync.autoridade = { ...fresca(), fresca: false };
  emitir('state', estadoDaTela());
  assert.doesNotMatch($('#mdCandidatos').innerHTML, /md-iniciar/);
  assert.match($('#mdCandidatos').innerHTML, /Começar agora: indisponível, o admin está sem sinal fresco agora/);
  assert.equal(await Tela.iniciarCandidato(itemId, async () => EXEC, async () => true), false);
  assert.deepEqual(pedidosPara('/api/sync/transfer-targets'), []);
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

test('iniciar: a vaga some entre a escolha e a execução, o executor recusa com sem_vaga e a tela mostra', async () => {
  const itemId = await candidatoEsperando();
  emitir('state', estadoDaTela());
  await execGanhaVaga();
  assert.equal(await Tela.iniciarCandidato(itemId, async () => EXEC, async () => true), true);
  assert.equal(admissao.reservar(exec, { tipo: 'chat' }).ok, true);
  assert.deepEqual(await cicloDoExecutor(), [['recusado', 'sem_vaga']]);
  assert.deepEqual(exec.iniciados, []);
  assert.match(await lerReciboNaTela(), /o aparelho estava sem vaga/);
});

test('iniciar: o head muda entre a escolha e a execução, e o candidato antigo não começa', async () => {
  const itemId = await candidatoEsperando();
  emitir('state', estadoDaTela());
  await execGanhaVaga();
  assert.equal(await Tela.iniciarCandidato(itemId, async () => EXEC, async () => true), true);
  exec.headSha = async () => 'sha52bbbb';
  assert.deepEqual(await cicloDoExecutor(), [['recusado', 'head_mudou']]);
  assert.deepEqual(exec.iniciados, []);
  assert.match(await lerReciboNaTela(), /o commit mudou desde o pedido/);
});

test('iniciar: escolha forjada fora dos aptos não sai, nem com confirmação', async () => {
  const itemId = await candidatoEsperando();
  emitir('state', estadoDaTela());
  await execGanhaVaga();
  assert.equal(await Tela.iniciarCandidato(itemId, async () => ADMIN, async () => true), false);
  assert.equal(await Tela.iniciarCandidato(itemId, async () => EXEC, async () => false), false);
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

/* ======================= designar admin ======================= */

function depsDaTela(confirma = true) {
  const d = {
    confirmacoes: [], avisos: [],
    api: apiDaTela,
    get: async () => null,
    toast: (tipo, texto) => d.avisos.push({ tipo, texto }),
    confirmarComCampo: async (opcoes) => { d.confirmacoes.push(opcoes); return { ok: confirma, valor: '' }; },
  };
  return d;
}

function telaDeAparelhos() {
  emitir('state', estadoDaTela());
  Aparelhos.renderAparelhos();
  return $('#devicesManager').innerHTML;
}

test('designar pela tela: pedido enviado, pendente até a senha lá, e o recibo fecha a pendência', async () => {
  assert.match(telaDeAparelhos(), new RegExp(`data-apar-designar="${EXEC}">Designar como admin`));
  const d = depsDaTela();
  assert.equal(await Aparelhos.designarAdmin(EXEC, d), true);
  assert.match(d.confirmacoes[0].body, /só quando alguém digitar a senha da sincronização lá/);
  assert.deepEqual(pedidosPara('/api/sync/command'), [{ alvo: EXEC, tipo: 'designar-admin', args: {} }]);
  assert.deepEqual(await cicloDoExecutor(), [['pendente', 'espera_senha']]);
  assert.ok(syncMod.statusForUi(exec).designacaoAdmin, 'o cartão do pedido aparece no destino');
  telaDeAparelhos();
  assert.equal(await Aparelhos.lerRecibosDaDesignacao(d, { forcar: true }), false, 'sem senha, sem recibo');
  // sem forçar, o piso de tempo segura a próxima consulta: cada snapshot não vira uma leitura
  const contadas = [];
  const contando = { ...d, api: async (rota, corpo) => { contadas.push(rota); return apiDaTela(rota, corpo); } };
  assert.equal(await Aparelhos.lerRecibosDaDesignacao(contando), false);
  assert.deepEqual(contadas, []);
  assert.match(telaDeAparelhos(), /designação pendente/);
  // a senha é digitada no DESTINO, e só isso promove
  assert.equal((await exec.syncTornarAdmin({ password: SENHA })).ok, true);
  assert.equal(await Aparelhos.lerRecibosDaDesignacao(d, { forcar: true }), true);
  assert.doesNotMatch(telaDeAparelhos(), /designação pendente/);
  assert.match(await lerReciboNaTela(), /<b>designar admin<\/b> para Desktop de teste.*sync-chip ok">aplicado</s);
});

test('designar: a recusa no destino chega à tela como recusa', async () => {
  telaDeAparelhos();
  const d = depsDaTela();
  assert.equal(await Aparelhos.designarAdmin(EXEC, d), true);
  assert.deepEqual(await cicloDoExecutor(), [['pendente', 'espera_senha']]);
  assert.equal((await exec.syncRecusarDesignacao()).ok, true);
  telaDeAparelhos();
  assert.equal(await Aparelhos.lerRecibosDaDesignacao(d, { forcar: true }), true);
  assert.match(telaDeAparelhos(), /recusou ser admin/);
  assert.match(await lerReciboNaTela(), /recusado por quem está naquele aparelho/);
});

test('designar indisponível: admin sem sinal fresco não vê o ato, aparelho aposentado mostra o motivo, e nada sai', async () => {
  admin.sync.devices[VELHO] = { ...admin.sync.devices[VELHO], contract: 2, retiredAt: Date.now() };
  const html = telaDeAparelhos();
  assert.match(html, /designar: aparelho aposentado/);
  assert.doesNotMatch(html, new RegExp(`data-apar-designar="${VELHO}"`));
  assert.doesNotMatch(html, new RegExp(`data-apar-designar="${ADMIN}"`), 'este aparelho não se designa');
  assert.equal(await Aparelhos.designarAdmin(VELHO, depsDaTela()), false);
  admin.sync.autoridade = { ...fresca(), fresca: false };
  assert.doesNotMatch(telaDeAparelhos(), /data-apar-designar/);
  assert.equal(await Aparelhos.designarAdmin(EXEC, depsDaTela()), false);
  admin.sync.autoridade = fresca();
  assert.equal(await Aparelhos.designarAdmin(EXEC, depsDaTela(false)), false, 'sem confirmação, nada');
  assert.deepEqual(pedidosPara('/api/sync/command'), []);
});

test('designar: o admin perde a autoridade antes de o destino ler, e o destino ignora com o porquê', async () => {
  telaDeAparelhos();
  const d = depsDaTela();
  assert.equal(await Aparelhos.designarAdmin(EXEC, d), true);
  exec.sync.autoridade = { ...fresca(), fresca: false };
  assert.deepEqual(await cicloDoExecutor(), [['ignorado', 'autoridade']]);
  assert.equal(exec.sync.designacaoAdmin || null, null, 'nenhum pedido acende sem autoridade');
  telaDeAparelhos();
  assert.equal(await Aparelhos.lerRecibosDaDesignacao(d, { forcar: true }), true);
  assert.match(telaDeAparelhos(), /ignorou a designação/);
  assert.match(await lerReciboNaTela(), /o admin estava sem sinal fresco/);
});
