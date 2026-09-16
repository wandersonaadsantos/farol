// Distribuicao entre aparelhos (7.C5, anexo S3): publicar, atribuir, aceitar e recusar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c5c-distribuicao-'));
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
const publicacao = await import('../lib/engine/sync-publicacao.js');
const dist = await import('../lib/engine/sync-distribuicao.js');
const admissao = (await import('../lib/engine/admissao.js')).default;
const prontidao = (await import('../lib/sync/prontidao.js')).default;

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


const T = Date.now();

function prDe(n, extra = {}) {
  return { key: `dono/repo#${n}`, headSha: `sha${n}`, title: 'Titulo secreto', author: 'alguem', requested: true, ...extra };
}

function no(caminho) {
  const t = fake.tree();
  let atual = t && t.users && t.users.u1;
  for (const seg of caminho.split('/')) atual = atual && atual[seg];
  return atual || {};
}

function cfgDist(extra = {}) {
  return { ...syncCfg(), coordination: { enabled: true }, distribution: { enabled: true }, aceitarAdmin: true, ...extra };
}

function prontidaoFresca(e, fresca = true) {
  e.sync.sinais = {
    conexaoEm: 0, lidos: new Set(), beat: null, modo: '', voltaPendente: false, voltando: false, ultimoBatimentoEm: 0,
    ready: { sequenciaVista: 1, fresca, ultimaMudancaEm: Date.now() },
  };
}

async function motorDistribuidor(opcoes = {}) {
  const e = await motorPronto(opcoes);
  e.updateSettings({ sync: cfgDist() });
  if (e.sync.iniciando) await e.sync.iniciando;
  e.sync.autoridade = { fresca: true, agora: T, ultimaMudancaEm: T, intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
  // C5d: desviar para a distribuição exige também a prontidão fresca observada
  prontidaoFresca(e);
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  e.accountForPr = () => LOGIN;
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  return e;
}

// Os `await` de topo vêm ANTES do primeiro caso: com `--test-force-exit`, o processo
// encerra quando os casos já registrados terminam, e um `await` que só volta depois
// disso deixa os casos seguintes CANCELADOS, numa rodada que ainda diz "0 falhas".
const reviewMod = (await import('../lib/engine/review.js')).default;

test('com a distribuição desligada, nada é publicado', async () => {
  const e = await motorPronto();
  e.sync.autoridade = { fresca: true, agora: T, ultimaMudancaEm: T };
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  assert.equal(r.code, 'distribuicao-desligada');
  assert.deepEqual(no('live/queue'), {});
});

test('sem autoridade fresca também não publica: distribuir exige admin vivo', async () => {
  const e = await motorDistribuidor();
  e.sync.autoridade = { fresca: false };
  assert.equal((await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T })).code, 'distribuicao-desligada');
});

test('o candidato sobe como ponteiro, e o PR não aparece em claro', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  assert.equal(r.ok, true, r.code);
  const registro = no(`live/queue/${r.itemId}`)[e.sync.deviceId];
  assert.deepEqual(Object.keys(registro).sort(), ['acctTag', 'enc', 'isDraft', 'itemId', 'matTag', 'orgTag', 'prTag', 'publishedAt', 'rodadaAutomatica', 'ttl']);
  const cru = JSON.stringify(fake.tree());
  for (const p of ['dono/repo', 'Titulo secreto', 'alguem', 'sha1', LOGIN, 'requested']) {
    assert.equal(cru.includes(p), false, p);
  }
});

test('o nome do owner só abre no lugar dele: transplantado de outro candidato não vale', async () => {
  const e = await motorDistribuidor();
  const a = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  const b = await dist.publicarCandidato(e, e.config.sync, prDe(2), { agora: T });
  const fila = no('live/queue');
  assert.equal(dist.fundirFila(e, fila, { agora: T }).itens.find((i) => i.itemId === a.itemId).owner, 'dono');
  const trocado = { [a.itemId]: { [e.sync.deviceId]: { ...fila[a.itemId][e.sync.deviceId], enc: fila[b.itemId][e.sync.deviceId].enc } } };
  const lido = dist.fundirFila(e, trocado, { agora: T }).itens[0];
  assert.equal(lido.owner, '', 'rótulo genérico, e o item continua elegível pelo tag');
  assert.equal(lido.itemId, a.itemId);
});

test('registro fora do contrato é isolado, e o registro válido do outro aparelho segue', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  const bom = no('live/queue')[r.itemId][e.sync.deviceId];
  const arvore = { [r.itemId]: { [e.sync.deviceId]: bom, dQuebrado: { itemId: r.itemId, prTag: '' } } };
  const { itens, defeituosos } = dist.fundirFila(e, arvore, { agora: T });
  assert.equal(itens.length, 1, 'o PR continua elegível');
  assert.deepEqual(itens[0].publicadores, [e.sync.deviceId]);
  assert.deepEqual(defeituosos, [{ itemId: r.itemId, dev: 'dQuebrado', motivo: 'campo-fora-do-contrato' }]);
});

test('o ciclo do agendador atribui, e o relatório diz que foi saudável', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  assert.equal(ciclo.ok, true, ciclo.code);
  assert.equal(ciclo.atribuido.itemId, r.itemId);
  assert.equal(prontidao.cicloSaudavel(ciclo.relatorio).ok, true);
  const atribuicao = no('live/assign')[r.itemId];
  assert.deepEqual(Object.keys(atribuicao).sort(), ['dev', 'generation', 'itemId', 'rev', 'sig', 'ttl', 'v']);
  assert.equal(atribuicao.ttl, T + SYNC.ATRIBUICAO_TTL_MS);
});

test('fila vazia é ciclo saudável e não atribui nada', async () => {
  const e = await motorDistribuidor();
  await publicacao.publicarCapacidade(e, e.config.sync);
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  assert.equal(ciclo.atribuido, null);
  assert.equal(prontidao.cicloSaudavel(ciclo.relatorio).ok, true);
  assert.deepEqual(ciclo.relatorio.avaliados, []);
});

test('aparelho sem resumo publicado é inapto: o item fica com motivo, e o ciclo é saudável', async () => {
  const e = await motorDistribuidor();
  await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  assert.equal(ciclo.atribuido, null);
  assert.deepEqual(ciclo.relatorio.avaliados.map((a) => a.desfecho), ['sem-aparelho-apto']);
  assert.equal(prontidao.cicloSaudavel(ciclo.relatorio).ok, true, 'ninguém apto é resultado legítimo');
});

test('item já atribuído e vivo não é reatribuído', async () => {
  const e = await motorDistribuidor();
  await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const segundo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T + 1000 });
  assert.equal(segundo.atribuido, null);
  assert.deepEqual(segundo.relatorio.avaliados.map((a) => a.motivo), ['atribuicao-viva']);
});

test('o executor aceita: reserva vaga e responde com o id da reserva', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const resposta = await dist.aceitarAtribuicoes(e, e.config.sync, no('live/assign'), { agora: T });
  assert.equal(resposta.aceitas.length, 1);
  assert.equal(resposta.aceitas[0].pr.key, 'dono/repo#1');
  const ack = no('live/ack')[r.itemId];
  assert.equal(ack.estado, 'aceita');
  assert.ok(ack.admissaoId, 'a atribuição aceita vira reserva com id');
  assert.equal(admissao.resumo(e).total, 1);
});

test('head mudou: recusa explícita com código, e nada é reservado', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  e.sync.candidatos.get(r.itemId).pr.headSha = 'sha-novo';
  const resposta = await dist.aceitarAtribuicoes(e, e.config.sync, no('live/assign'), { agora: T });
  assert.deepEqual(resposta.aceitas, []);
  assert.equal(resposta.recusas[0].code, 'head_mudou');
  assert.equal(no('live/ack')[r.itemId].code, 'head_mudou');
  assert.equal(admissao.resumo(e).total, 0);
});

test('sem vaga: recusa com o código e com a espera, e o agendador respeita', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  // teto do aparelho em 1, e a vaga tomada por um chat: a atribuição chega sem vaga
  e.updateSettings({ parallelReviews: 1 });
  admissao.reservar(e, { tipo: 'chat', agora: T });
  const resposta = await dist.aceitarAtribuicoes(e, e.config.sync, no('live/assign'), { agora: T });
  assert.equal(resposta.recusas[0].code, 'sem_vaga');
  const ack = no('live/ack')[r.itemId];
  assert.ok(ack.esperaAte > T, 'a recusa carrega até quando esperar');
});

test('atribuição de outro aparelho, ou com assinatura trocada, não é aceita', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const boa = no('live/assign')[r.itemId];
  const deOutro = { [r.itemId]: { ...boa, dev: 'dOutro' } };
  assert.deepEqual((await dist.aceitarAtribuicoes(e, e.config.sync, deOutro, { agora: T })).aceitas, []);
  const adulterada = { [r.itemId]: { ...boa, ttl: boa.ttl + 999999 } };
  const rr = await dist.aceitarAtribuicoes(e, e.config.sync, adulterada, { agora: T });
  assert.deepEqual(rr.aceitas, []);
  assert.equal(rr.recusas[0].problema, 'assinatura');
});

test('sem consentimento local, a atribuição não é aceita', async () => {
  const e = await motorDistribuidor();
  await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const semConsentimento = { ...e.config.sync, aceitarAdmin: false };
  const rr = await dist.aceitarAtribuicoes(e, semConsentimento, no('live/assign'), { agora: T });
  assert.deepEqual(rr.aceitas, []);
  assert.equal(rr.recusas[0].problema, 'nao-aceita-admin');
});

test('atribuição vencida não é aceita', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const rr = await dist.aceitarAtribuicoes(e, e.config.sync, no('live/assign'), { agora: T + SYNC.ATRIBUICAO_TTL_MS + 1 });
  assert.deepEqual(rr.aceitas, []);
  assert.equal(rr.recusas[0].problema, 'vencida');
  assert.ok(r.itemId);
});

// Fiação no enqueueHeadless: as três correções obrigatórias do anexo S3.

function motorFila(e) {
  return Object.assign(e, {
    headlessQueue: [], headlessBusyAccounts: new Map(), activeReviews: new Map(),
    skipComentado: {}, writeInflight() { }, processHeadless() { }, headlessAcct: () => LOGIN,
  });
}

test('enqueueHeadless devolve desfecho: saída de cena e duplicado deixam de ser silêncio', async () => {
  const e = motorFila(await motorPronto());
  e.skipComentado = { 'dono/repo#1': true };
  assert.deepEqual(reviewMod.enqueueHeadless(e, prDe(1)), { ok: false, code: 'saida-de-cena' });
  e.skipComentado = {};
  assert.deepEqual(reviewMod.enqueueHeadless(e, prDe(2)), { ok: true, via: 'local' });
  assert.deepEqual(reviewMod.enqueueHeadless(e, prDe(2)), { ok: false, code: 'duplicado' });
});

test('com a distribuição ligada, o item vira candidato e fica visível esperando', async () => {
  const e = motorFila(await motorDistribuidor());
  const r = reviewMod.enqueueHeadless(e, prDe(7));
  assert.deepEqual(r, { ok: true, via: 'distribuicao' });
  assert.equal(e.headlessQueue.length, 0, 'não entra na fila local');
  assert.ok(e.headlessDistribuindo.get('dono/repo#7'), 'o PR fica visível como esperando distribuição');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(Object.keys(no('live/queue')).length, 1);
});

// C5d: sem prontidão fresca do distribuidor o item fica no escalonador local, mesmo com
// autoridade fresca e a distribuição ligada.
test('sem prontidão fresca, o item fica local', async () => {
  const e = motorFila(await motorDistribuidor());
  prontidaoFresca(e, false);
  assert.deepEqual(reviewMod.enqueueHeadless(e, prDe(9)), { ok: true, via: 'local' });
  assert.equal(e.headlessQueue.length, 1);
});

// CT-RET: item com retomada fica no aparelho que consegue executá-la.
test('item com retomada NÃO é distribuído, e a retomada não é consumida para decidir', async () => {
  const e = motorFila(await motorDistribuidor());
  const retomada = (await import('../lib/engine/retomada-duravel.js')).default;
  retomada.guardarRetomada(e, prDe(8), { retomarSid: 'a'.repeat(36), knownHead: 'sha8' });
  const r = reviewMod.enqueueHeadless(e, prDe(8));
  assert.deepEqual(r, { ok: true, via: 'local' });
  assert.equal(e.headlessQueue.length, 1);
  assert.ok(retomada.lerRetomada(e, 'dono/repo#8'), 'a referência continua lá: decidir não consome');
});

test('clique manual não distribui: quem mandou revisar está na frente deste aparelho', async () => {
  const e = motorFila(await motorDistribuidor());
  const r = reviewMod.enqueueHeadless(e, prDe(9, { manual: true }));
  assert.deepEqual(r, { ok: true, via: 'local' });
  assert.equal(e.headlessQueue.length, 1);
});

// Casos que faltavam, achados por contraprovas que não reprovaram nada.

test('leitura que não conclui NÃO é ciclo saudável, e não vira fila vazia', async () => {
  const e = await motorDistribuidor();
  await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  const get = e.sync.client.get.bind(e.sync.client);
  e.sync.client.get = async (caminho, opcoes) => {
    if (caminho.endsWith('live/deviceStatus')) return { ok: false, code: 'indisponivel' };
    return get(caminho, opcoes);
  };
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  e.sync.client.get = get;
  assert.equal(ciclo.relatorio.erro, 'leitura-incompleta');
  assert.equal(ciclo.relatorio.leituras.ocupacao, false);
  assert.equal(prontidao.cicloSaudavel(ciclo.relatorio).ok, false, 'falha não renova a prontidão');
});

test('resumo VELHO deixa o aparelho inapto: existir não basta, tem que ser fresco', async () => {
  const e = await motorDistribuidor();
  await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  const arvore = fake.tree();
  const status = arvore.users.u1.live.deviceStatus;
  status[e.sync.deviceId].u = T - SYNC.FROTA_JANELA_MS - 1000;
  fake.setTree(arvore);
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  assert.equal(ciclo.atribuido, null);
  assert.deepEqual(ciclo.relatorio.avaliados.map((a) => a.desfecho), ['sem-aparelho-apto']);
});

test('atribuição VÁLIDA de outro aparelho não é minha: nem aceita, nem respondida', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  const ak = await import('../lib/sync/admin-chave.js');
  const assinatura = (await import('../lib/sync/assinatura.js')).default;
  const minha = ak.lerChaveDeAdmin();
  const base = { v: 1, itemId: r.itemId, dev: 'dOutro', rev: 1, generation: 1, ttl: T + 60000 };
  const sig = assinatura.assinar(minha.jwk, {
    uid: e.sync.uid, caminho: `live/assign/${r.itemId}`, generation: 1,
    valor: { itemId: base.itemId, dev: base.dev, rev: base.rev, ttl: base.ttl },
  });
  const rr = await dist.aceitarAtribuicoes(e, e.config.sync, { [r.itemId]: { ...base, sig } }, { agora: T });
  assert.deepEqual(rr.aceitas, []);
  assert.deepEqual(rr.recusas, [], 'nem recusa: a atribuição é de outro, e responder por ele seria mentira');
  assert.equal(no('live/ack')[r.itemId], undefined);
});

test('registro quebrado de um publicador não apaga o registro bom do outro', async () => {
  const e = await motorDistribuidor();
  const r = await dist.publicarCandidato(e, e.config.sync, prDe(1), { agora: T });
  const bom = no('live/queue')[r.itemId][e.sync.deviceId];
  // o quebrado vem PRIMEIRO na ordem das chaves: se ele derrubasse o item, o bom que vem
  // depois não salvaria, e é justamente essa ordem que o caso precisa exercitar
  const arvore = { [r.itemId]: { aQuebrado: { itemId: r.itemId, prTag: '' }, [e.sync.deviceId]: bom } };
  const { itens, defeituosos } = dist.fundirFila(e, arvore, { agora: T });
  assert.equal(itens.length, 1);
  assert.deepEqual(itens[0].publicadores, [e.sync.deviceId]);
  assert.equal(itens[0].owner, 'dono', 'o nome sai do registro válido');
  assert.equal(defeituosos.length, 1);
});

// O giro completo do relógio: agenda, renova a prontidão e responde.
test('um giro completo atribui, aceita, enfileira no ramo local e renova a prontidão', async () => {
  const e = motorFila(await motorDistribuidor());
  e.enfileirarDaDistribuicao = (pr, admissaoId) => reviewMod.enfileirarDaDistribuicao(e, pr, admissaoId);
  await dist.publicarCandidato(e, e.config.sync, prDe(3), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  const giro = await dist.cicloDaDistribuicao(e, e.config.sync, { agora: T });
  assert.equal(giro.ok, true);
  assert.equal(giro.saudavel.ok, true);
  assert.equal(giro.resposta.aceitas.length, 1);
  assert.equal(e.headlessQueue.length, 1, 'voltou pelo ramo local');
  assert.equal(admissao.resumo(e).total, 1, 'uma vaga só: o aceite já reservou');
  const pronto = no('live/control')['ready'];
  assert.equal(pronto.sequencia, 1);
  assert.ok(pronto.sig);
  // a sequência ANDA a cada renovação: é ela que prova frescor no outro aparelho, e um
  // valor repetido seria reentrega, que por contrato não renova nada
  await dist.publicarCandidato(e, e.config.sync, prDe(31), { agora: T + 10 });
  await dist.cicloDaDistribuicao(e, e.config.sync, { agora: T + 10 });
  assert.equal(no('live/control')['ready'].sequencia, 2);
});

test('ciclo que não foi saudável não renova a prontidão', async () => {
  const e = motorFila(await motorDistribuidor());
  await dist.publicarCandidato(e, e.config.sync, prDe(4), { agora: T });
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDaDistribuicao(e, e.config.sync, { agora: T });
  const get = e.sync.client.get.bind(e.sync.client);
  e.sync.client.get = async (caminho, opcoes) => {
    if (caminho.endsWith('live/deviceStatus')) return { ok: false, code: 'indisponivel' };
    return get(caminho, opcoes);
  };
  const giro = await dist.cicloDaDistribuicao(e, e.config.sync, { agora: T + 1000 });
  e.sync.client.get = get;
  assert.equal(giro.saudavel.ok, false);
  assert.equal(no('live/control')['ready'].sequencia, 1, 'a sequência não anda numa falha');
});
