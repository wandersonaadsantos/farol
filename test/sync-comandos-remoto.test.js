// Comandos remotos (7.C6) com o banco falso: emitir, aplicar no alvo e responder.
//
// Um aparelho só, nos dois papéis: ele é o admin que emite e o alvo que aplica. É o que
// deixa o caminho inteiro ser exercitado sem inventar um segundo processo, e os casos de
// "não é meu" usam um alvo que não existe aqui.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c6-comandos-'));
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
const comandos = (await import('../lib/engine/sync-comandos.js')).default;
const comando = (await import('../lib/sync/comando.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag, matTag } = await import('../lib/sync/tags.js');
const { itemIdDe } = await import('../lib/sync/pendencia.js');

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
beforeEach(() => {
  fake.setTree(null);
  try { fs.rmSync(comandos.caminhoDosFeitos(), { force: true }); } catch { /* sem registro anterior */ }
});

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

function fresca() {
  return { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
}

const PR = { key: 'dono/repo#7', headSha: 'sha7', title: 'Titulo', repo: 'dono/repo', number: 7, url: 'https://github.com/dono/repo/pull/7' };

async function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.emit = () => true;
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }], parallelReviews: 2 });
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
  // o executor pergunta o head ATUAL (repetir e iniciar): sem este dublê a pergunta iria ao
  // gh de verdade. Ajuste declarado: antes o repetir lia pr.headSha do objeto da fila.
  e.headSha = async () => PR.headSha;
  Object.assign(e, { queue: [PR], headlessQueue: [], headlessBusyAccounts: new Map(), writeInflight() { }, processHeadless() { } });
  return e;
}

function kId(e) { return kek.bufferDe(e.sync.material.id); }
function arvore() { const t = fake.tree(); return (t && t.users && t.users.u1) || {}; }
function recibo(cmdId) { return (arvore().commandReceipts || {})[cmdId]; }

async function emitirPara(e, dev, tipo, args, extra = {}) {
  const r = await comandos.emitir(e, e.config.sync, { alvo: dev, tipo, args, ...extra });
  assert.equal(r.ok, true, r.motivo);
  return r.cmdId;
}

test('o comando sobe cifrado e assinado, e o tipo não aparece em claro', async () => {
  const e = await motor();
  const cmdId = await emitirPara(e, e.sync.deviceId, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  const no = arvore().live.commands[cmdId];
  assert.deepEqual(Object.keys(no).sort(), ['alvo', 'enc', 'generation', 'sig', 'ttl', 'v']);
  const cru = JSON.stringify(fake.tree());
  for (const proibido of ['cancelar', 'dono/repo', 'sha7']) assert.equal(cru.includes(proibido), false, proibido);
});

test('quem não é admin da geração vigente não emite', async () => {
  const e = await motor();
  const ak = (await import('../lib/sync/admin-chave.js')).default;
  ak.apagarChaveDeAdmin();
  const r = await comandos.emitir(e, e.config.sync, { alvo: 'dOutro', tipo: 'cancelar', args: { prTag: prTag(kId(e), PR.key) } });
  assert.equal(r.code, 'nao-e-admin');
});

test('repetir: enfileira sem virar clique manual, e o recibo é o desfecho', async () => {
  const e = await motor();
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); return { ok: true, via: 'local' }; };
  const cmdId = await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  const r = await comandos.cicloDosComandos(e, e.config.sync);
  assert.deepEqual(r.aplicados.map((a) => a.estado), ['aplicado']);
  assert.equal(enfileirados.length, 1);
  assert.equal(enfileirados[0].viaComando, true);
  assert.equal('manual' in enfileirados[0], false);
  assert.equal('requested' in enfileirados[0], false);
  assert.equal(recibo(cmdId).estado, 'aplicado');
  assert.equal(recibo(cmdId).dev, e.sync.deviceId);
});

test('comando duplicado produz UM efeito', async () => {
  const e = await motor();
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); return { ok: true, via: 'local' }; };
  await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(enfileirados.length, 1, 'o segundo giro lê o mesmo comando e não repete');
});

test('comando para head antigo é recusado', async () => {
  const e = await motor();
  e.enqueueHeadless = () => assert.fail('não pode enfileirar com head antigo');
  const cmdId = await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), 'sha-velho') });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).estado, 'recusado');
  assert.equal(recibo(cmdId).code, 'head_mudou');
});

// O PR da fila vem da busca do GitHub, que NÃO traz o head: o executor pergunta agora.
test('repetir: PR da fila sem head pergunta o head atual e aplica quando ele bate', async () => {
  const e = await motor();
  const { headSha, ...semHead } = PR;
  e.queue = [semHead];
  const perguntas = [];
  e.headSha = async (pr) => { perguntas.push(pr.key); return headSha; };
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr.key); return { ok: true, via: 'local' }; };
  const cmdId = await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.deepEqual(perguntas, [PR.key]);
  assert.deepEqual(enfileirados, [PR.key]);
  assert.equal(recibo(cmdId).estado, 'aplicado');
});

test('repetir: head que não dá para perguntar é desconhecido, e desconhecido recusa', async () => {
  const e = await motor();
  const { headSha, ...semHead } = PR;
  e.queue = [semHead];
  e.enqueueHeadless = () => assert.fail('head desconhecido não enfileira');
  for (const resposta of [async () => '', async () => { throw new Error('sem rede'); }]) {
    e.headSha = resposta;
    const cmdId = await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), headSha) });
    await comandos.cicloDosComandos(e, e.config.sync);
    assert.equal(recibo(cmdId).code, 'head_mudou');
  }
});

test('repetir: o enfileiramento que recusa vira recibo com o código dele', async () => {
  const e = await motor();
  e.enqueueHeadless = () => ({ ok: false, code: 'duplicado' });
  const cmdId = await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).estado, 'recusado');
  assert.equal(recibo(cmdId).code, 'duplicado');
});

test('comando expirado não executa, e diz que venceu', async () => {
  const e = await motor();
  e.enqueueHeadless = () => assert.fail('vencido não executa');
  const cmdId = await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) }, { ttlMs: 1000 });
  await comandos.cicloDosComandos(e, e.config.sync, { agora: Date.now() + 5000 });
  assert.equal(recibo(cmdId).estado, 'ignorado');
  assert.equal(recibo(cmdId).code, 'vencido');
});

test('sem consentimento local o comando é ignorado com o porquê', async () => {
  const e = await motor();
  e.enqueueHeadless = () => assert.fail('sem consentimento não executa');
  const cmdId = await emitirPara(e, e.sync.deviceId, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  const r = await comandos.cicloDosComandos(e, { ...e.config.sync, aceitarAdmin: false });
  assert.deepEqual(r.aplicados.map((a) => a.code), ['nao-aceita-admin']);
  assert.equal(recibo(cmdId).estado, 'ignorado');
});

test('sem autoridade fresca o comando é ignorado, mesmo assinado', async () => {
  const e = await motor();
  const cmdId = await emitirPara(e, e.sync.deviceId, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  e.sync.autoridade = { ...fresca(), fresca: false };
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).code, 'autoridade');
});

test('comando de outro alvo não é meu: nem executa, nem vira recibo', async () => {
  const e = await motor();
  e.enqueueHeadless = () => assert.fail('comando de outro alvo');
  const cmdId = await emitirPara(e, 'dOutro', 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  const r = await comandos.cicloDosComandos(e, e.config.sync);
  assert.deepEqual(r.aplicados, []);
  assert.equal(recibo(cmdId), undefined, 'responder pelo alvo dos outros seria mentir');
});

test('cancelar sem sessão viva é recusa com motivo, não silêncio', async () => {
  const e = await motor();
  const cmdId = await emitirPara(e, e.sync.deviceId, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).code, 'nada_rodando');
});

test('cancelar com sessão viva encerra aquela sessão', async () => {
  const e = await motor();
  e.activeReviews = new Map([['s1', { keys: [PR.key], mode: 'auto' }]]);
  const cancelados = [];
  e.cancelSession = (id) => cancelados.push(id);
  const cmdId = await emitirPara(e, e.sync.deviceId, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.deepEqual(cancelados, ['s1']);
  assert.equal(recibo(cmdId).estado, 'aplicado');
});

test('decidir: pendência que não é deste aparelho não posta nada', async () => {
  const e = await motor();
  // existe uma pendência AQUI: o comando de outro dono não pode acabar decidindo esta
  e.decisions.pending.unshift({ id: 'minha', key: PR.key, pr: { repo: 'dono/repo', number: 7 }, createdAt: Date.now(), payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } } });
  e.decide = () => assert.fail('nenhum aparelho posta com credencial alheia');
  const cmdId = await emitirPara(e, e.sync.deviceId, 'decidir', { itemId: itemIdDe(kId(e), 'dOutro', 'd9'), acao: 'approve' });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).code, 'nao_e_minha');
});

test('decidir: pendência deste aparelho vai pelo caminho de sempre', async () => {
  const e = await motor();
  e.decisions.pending.unshift({ id: 'd1', key: PR.key, pr: { repo: 'dono/repo', number: 7 }, createdAt: Date.now(), payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } } });
  const decididos = [];
  e.decide = async (id, acao) => { decididos.push([id, acao]); return { ok: true }; };
  const cmdId = await emitirPara(e, e.sync.deviceId, 'decidir', { itemId: itemIdDe(kId(e), e.sync.deviceId, 'd1'), acao: 'approve' });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.deepEqual(decididos, [['d1', 'approve']]);
  assert.equal(recibo(cmdId).estado, 'aplicado');
});

// A admissão recusa abaixo do piso de memória, e a máquina do teste decide sem isto: no
// macOS do CI a memória livre medida fica abaixo do piso (medido no PR da v2.60.0).
async function comMemoriaLivre(fn) {
  const { fixarMemoriaLivre, restaurarMemoriaLivre } = await import('./helpers/memoria-livre.js');
  fixarMemoriaLivre();
  try { await fn(); } finally { restaurarMemoriaLivre(); }
}

test('iniciar aqui: passa pela admissão e volta pelo ramo local', () => comMemoriaLivre(async () => {
  const e = await motor();
  const item = `${prTag(kId(e), PR.key)}_${matTag(kId(e), PR.headSha)}`;
  e.sync.candidatos = new Map([[item, { pr: PR }]]);
  const vindos = [];
  e.enfileirarDaDistribuicao = (pr, admissaoId) => vindos.push([pr.key, !!admissaoId, pr.viaComando, pr.itemIdDistribuido]);
  const cmdId = await emitirPara(e, e.sync.deviceId, 'iniciar', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  // o item vai com a identidade dele: quem executa fecha o item no conjunto ao terminar
  assert.deepEqual(vindos, [[PR.key, true, true, item]], 'reserva vaga e entra pelo ramo local, sem virar manual');
  assert.equal(recibo(cmdId).estado, 'aplicado');
}));

test('tomar aqui: o item vai com o pedido de tomada e com a identidade dele', () => comMemoriaLivre(async () => {
  const e = await motor();
  const item = `${prTag(kId(e), PR.key)}_${matTag(kId(e), PR.headSha)}`;
  e.queue = [PR];
  const vindos = [];
  e.enfileirarDaDistribuicao = (pr, admissaoId) => vindos.push([pr.key, !!admissaoId, pr.tomarLease, pr.itemIdDistribuido]);
  const cmdId = await emitirPara(e, e.sync.deviceId, 'tomar', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha), confirmado: true });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.deepEqual(vindos, [[PR.key, true, true, item]]);
  assert.equal(recibo(cmdId).estado, 'aplicado');
}));

// O head guardado no candidato é o da publicação: comparar a tag com ele não confere
// nada. O executor pergunta o head de agora, e commit novo recusa.
test('iniciar aqui: o head de AGORA é conferido, não o que o candidato guardou', async () => {
  const e = await motor();
  const item = `${prTag(kId(e), PR.key)}_${matTag(kId(e), PR.headSha)}`;
  e.sync.candidatos = new Map([[item, { pr: PR }]]);
  const perguntados = [];
  e.headSha = async (pr) => { perguntados.push(pr.headSha); return 'sha-commit-novo'; };
  e.enfileirarDaDistribuicao = () => assert.fail('head novo não inicia o item antigo');
  const cmdId = await emitirPara(e, e.sync.deviceId, 'iniciar', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.deepEqual(perguntados, [''], 'o head do objeto fica de fora da pergunta');
  assert.equal(recibo(cmdId).code, 'head_mudou');
  e.headSha = async () => '';
  const outro = await emitirPara(e, e.sync.deviceId, 'iniciar', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(outro).code, 'head_mudou', 'head desconhecido também recusa');
});

test('iniciar aqui: sem vaga é recusa com sem_vaga, e nada é enfileirado', async () => {
  const e = await motor();
  const item = `${prTag(kId(e), PR.key)}_${matTag(kId(e), PR.headSha)}`;
  e.sync.candidatos = new Map([[item, { pr: PR }]]);
  e.enfileirarDaDistribuicao = () => assert.fail('sem vaga não executa');
  e.updateSettings({ parallelReviews: 1 });
  const admissao = (await import('../lib/engine/admissao.js')).default;
  const { fixarMemoriaLivre, restaurarMemoriaLivre } = await import('./helpers/memoria-livre.js');
  fixarMemoriaLivre();
  try {
    assert.equal(admissao.reservar(e, { tipo: 'chat' }).ok, true);
    const cmdId = await emitirPara(e, e.sync.deviceId, 'iniciar', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
    await comandos.cicloDosComandos(e, e.config.sync);
    assert.equal(recibo(cmdId).code, 'sem_vaga');
  } finally {
    restaurarMemoriaLivre();
  }
});

test('iniciar aqui: item que este aparelho não publicou é recusado', async () => {
  const e = await motor();
  e.sync.candidatos = new Map();
  e.enfileirarDaDistribuicao = () => assert.fail('não publiquei este item');
  const cmdId = await emitirPara(e, e.sync.deviceId, 'iniciar', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).code, 'nao_publiquei');
});

test('iniciar aqui: admissão que recusa vira recibo com motivo, e nada roda', async () => {
  const e = await motor();
  const item = `${prTag(kId(e), PR.key)}_${matTag(kId(e), PR.headSha)}`;
  e.sync.candidatos = new Map([[item, { pr: PR }]]);
  e.enfileirarDaDistribuicao = () => assert.fail('sem vaga não executa');
  e.sync.lastPresenceAt = 0; // presença vencida: requisito duro da admissão local
  const cmdId = await emitirPara(e, e.sync.deviceId, 'iniciar', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).estado, 'recusado');
  assert.equal(recibo(cmdId).code, 'inapto');
});

test('designar admin não promove sozinho: acende o pedido e espera a senha daqui', async () => {
  const e = await motor();
  const cmdId = await emitirPara(e, e.sync.deviceId, 'designar-admin', {});
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId), undefined, 'sem senha não há desfecho');
  assert.ok(e.sync.designacaoAdmin, 'o pedido fica visível na tela');
  const syncMod = (await import('../lib/engine/sync.js')).default;
  assert.equal(syncMod.statusForUi(e).designacaoAdmin.desde > 0, true, 'a tela enxerga o pedido');
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  assert.equal(recibo(cmdId).estado, 'aplicado');
  assert.equal(e.sync.designacaoAdmin, null);
});

test('o desfecho que o emissor enxerga é o recibo, e antes dele não existe sucesso', async () => {
  const e = await motor();
  const cmdId = await emitirPara(e, e.sync.deviceId, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  assert.equal(await comandos.desfechoDe(e, cmdId), null);
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal((await comandos.desfechoDe(e, cmdId)).estado, 'recusado');
});

test('o relógio roda os comandos depois do aceite', () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/sync-andamento.js', import.meta.url), 'utf8');
  const i = fonte.indexOf('aceite.cicloDoAceite(engine, cfg)');
  const j = fonte.indexOf('comandos.cicloDosComandos(engine, cfg, { agora })');
  assert.ok(i > 0 && j > i);
});

test('nenhum caminho de comando escreve manual ou requested', () => {
  for (const arquivo of ['../lib/sync/comando.js', '../lib/engine/sync-comandos.js']) {
    const fonte = fs.readFileSync(new URL(arquivo, import.meta.url), 'utf8');
    const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const proibido of ['manual: true', 'manual = true', 'requested: true', 'requested = true']) {
      assert.equal(codigo.includes(proibido), false, `${arquivo}: ${proibido}`);
    }
  }
});

/* ---------- 7.C6: o recibo pertence ao ALVO, e só a ele ----------
   O buraco medido em 20/09/2026: `podeAplicar` testava o consentimento ANTES do alvo,
   e o ciclo percorria a árvore inteira. Um aparelho com `aceitarAdmin: false` (o padrão)
   gravava `commandReceipts/{cmdId}` de um comando endereçado a OUTRO, carimbado com o
   próprio deviceId — e o emissor lia isso como recusa do alvo.

   O terceiro aparelho é simulado trocando `rt.deviceId`: é o único dado que separa os
   dois papéis neste caminho, e o resto do runtime (credencial, material, chave) é o
   mesmo de qualquer aparelho da conta. */

async function comoOutroAparelho(e, deviceId, fn) {
  const meu = e.sync.deviceId;
  e.sync.deviceId = deviceId;
  // o await tem que estar DENTRO do try: restaurar o id antes de a promessa resolver
  // devolveria o aparelho ao papel de alvo no meio do ciclo, e o teste mediria outra coisa
  try { return await fn(); } finally { e.sync.deviceId = meu; }
}

test('aparelho que não é o alvo não responde, mesmo sem aceitar admin', async () => {
  const e = await motor();
  const alvo = e.sync.deviceId;
  const cmdId = await emitirPara(e, alvo, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  // dTerceiro lê a árvore inteira com o consentimento DESLIGADO, que é o padrão do Farol
  const r = await comoOutroAparelho(e, 'dTerceiro', () => comandos.cicloDosComandos(e, { ...e.config.sync, aceitarAdmin: false }));
  assert.deepEqual(r.aplicados, [], 'comando de outro alvo não entra no resultado');
  assert.equal(recibo(cmdId), undefined, 'responder pelo alvo dos outros seria mentir');
  assert.equal(Object.hasOwn(comandos.lerFeitos(), cmdId), false, 'nem queima o id de um comando alheio');
});

test('o terceiro não responde antes do alvo: quem responde é o alvo, e o desfecho é dele', async () => {
  const e = await motor();
  const alvo = e.sync.deviceId;
  e.activeReviews = new Map([['s1', { keys: [PR.key], mode: 'auto' }]]);
  e.cancelSession = () => { };
  const cmdId = await emitirPara(e, alvo, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  await comoOutroAparelho(e, 'dTerceiro', () => comandos.cicloDosComandos(e, { ...e.config.sync, aceitarAdmin: false }));
  assert.equal(recibo(cmdId), undefined, 'o terceiro passou antes e não deixou rastro');
  await comandos.cicloDosComandos(e, e.config.sync);
  assert.equal(recibo(cmdId).dev, alvo);
  assert.equal(recibo(cmdId).estado, 'aplicado');
});

test('a recusa legítima do alvo continua representável, e sai carimbada com o alvo', async () => {
  const e = await motor();
  const alvo = e.sync.deviceId;
  const cmdId = await emitirPara(e, alvo, 'repetir', { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha) });
  await comandos.cicloDosComandos(e, { ...e.config.sync, aceitarAdmin: false });
  assert.equal(recibo(cmdId).estado, 'ignorado');
  assert.equal(recibo(cmdId).code, 'nao-aceita-admin');
  assert.equal(recibo(cmdId).dev, alvo);
});

test('reinício não faz o terceiro responder: sem registro local, ele continua sem escrever', async () => {
  const e = await motor();
  const alvo = e.sync.deviceId;
  const cmdId = await emitirPara(e, alvo, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  for (let volta = 0; volta < 3; volta += 1) {
    fs.rmSync(comandos.caminhoDosFeitos(), { force: true });
    await comoOutroAparelho(e, 'dTerceiro', () => comandos.cicloDosComandos(e, { ...e.config.sync, aceitarAdmin: false }));
  }
  assert.equal(recibo(cmdId), undefined);
});

test('recibo de terceiro não é desfecho do alvo: nem sucesso, nem recusa provada', async () => {
  const e = await motor();
  const alvo = e.sync.deviceId;
  const cmdId = await emitirPara(e, alvo, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  // um aparelho em versão antiga (ou fora do cliente oficial) grava o recibo do comando alheio
  await e.sync.client.put(`/users/u1/${comandos.NO_RECIBO}/${cmdId}`, { dev: 'dTerceiro', estado: 'ignorado', code: 'nao-aceita-admin', at: Date.now() }, {});
  const r = await e.syncDesfechoDoComando({ cmdId });
  assert.equal(r.ok, true);
  assert.equal(r.recibo, null, 'recibo de quem não é o alvo não vira desfecho');
  assert.equal(r.conferencia, 'de-outro');
});

test('recibo preexistente de terceiro não impede o alvo de registrar o desfecho verdadeiro', async () => {
  const e = await motor();
  const alvo = e.sync.deviceId;
  e.activeReviews = new Map([['s1', { keys: [PR.key], mode: 'auto' }]]);
  e.cancelSession = () => { };
  const cmdId = await emitirPara(e, alvo, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  await e.sync.client.put(`/users/u1/${comandos.NO_RECIBO}/${cmdId}`, { dev: 'dTerceiro', estado: 'ignorado', code: 'nao-aceita-admin', at: Date.now() }, {});
  await comandos.cicloDosComandos(e, e.config.sync);
  const r = await e.syncDesfechoDoComando({ cmdId });
  assert.equal(r.conferencia, 'do-alvo');
  assert.equal(r.recibo.estado, 'aplicado');
  assert.equal(r.recibo.dev, alvo);
});

test('sem recibo nenhum o desfecho é ausência, não sucesso', async () => {
  const e = await motor();
  const cmdId = await emitirPara(e, e.sync.deviceId, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  const r = await e.syncDesfechoDoComando({ cmdId });
  assert.equal(r.recibo, null);
  assert.equal(r.conferencia, 'ausente');
});

test('recibo sem forma conhecida não vira desfecho do alvo', async () => {
  const e = await motor();
  const cmdId = await emitirPara(e, e.sync.deviceId, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  await e.sync.client.put(`/users/u1/${comandos.NO_RECIBO}/${cmdId}`, { estado: 'aplicado' }, {});
  const r = await e.syncDesfechoDoComando({ cmdId });
  assert.equal(r.recibo, null);
  assert.equal(r.conferencia, 'de-outro', 'recibo sem dev não prova ter vindo do alvo');
});

test('o alvo é conferido contra o nó do comando, não só contra a memória da sessão', async () => {
  const e = await motor();
  const alvo = e.sync.deviceId;
  e.activeReviews = new Map([['s1', { keys: [PR.key], mode: 'auto' }]]);
  e.cancelSession = () => { };
  const cmdId = await emitirPara(e, alvo, 'cancelar', { prTag: prTag(kId(e), PR.key) });
  await comandos.cicloDosComandos(e, e.config.sync);
  e.sync.comandosEmitidos = []; // reinício do emissor: o registro local da emissão se perdeu
  const r = await e.syncDesfechoDoComando({ cmdId });
  assert.equal(r.conferencia, 'do-alvo');
  assert.equal(r.recibo.estado, 'aplicado');
});
