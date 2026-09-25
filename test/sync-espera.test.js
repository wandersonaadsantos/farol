// O motivo da espera da distribuição, completo (divergência 5 da tela do Radar).
//
// Antes, o veredito do agendador morria no admin e a recusa do executor só era conhecida
// por ele mesmo. Aqui se prova que os dois chegam a quem publicou o candidato, com o
// detalhe por aparelho, sem sistema novo de sincronização: o veredito vai num campo do nó
// que já existe para o item (`live/assign/{item}/espera`), cifrado, e a recusa já estava no
// `live/ack`, agora com o detalhe da admissão.
//
// Um engine só faz os dois papéis. Para ele se comportar como o aparelho que publicou e NÃO
// agenda, o teste esconde a chave de admin durante o giro dele: no mundo real ela mora só
// na máquina do admin, e aqui os papéis dividem a mesma pasta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-espera-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;
process.env.TZ = 'America/Sao_Paulo';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { fixarMemoriaLivre, restaurarMemoriaLivre } from './helpers/memoria-livre.js';
import { SYNC } from '../lib/constants.js';

fixarMemoriaLivre();

const { Engine } = await import('../server.js');
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const dist = (await import('../lib/engine/sync-distribuicao.js')).default;
const espera = (await import('../lib/engine/sync-espera.js')).default;
const escolha = (await import('../lib/engine/escolha.js')).default;
const telas = (await import('../lib/engine/sync-telas.js')).default;
const admissao = (await import('../lib/engine/admissao.js')).default;
const adminChave = (await import('../lib/sync/admin-chave.js')).default;
const { notaDistribuicaoHtml } = await import('../ui/pure.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'conta-sintetica';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const T = Date.now();
let fake;
let identity;

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
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; fixarMemoriaLivre(); });

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

function cfg() {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    distribution: { enabled: true }, aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY,
    databaseUrl: fake.url, projectId: 'farol-local',
  };
}

async function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: cfg(), accounts: [{ user: LOGIN, owners: ['acme-exemplo'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  const t0 = Date.now();
  const login = await e.syncLogin({ email: EMAIL, password: SENHA });
  assert.equal(login.ok, true, JSON.stringify({ login, ms: Date.now() - t0 }));
  const t1 = Date.now();
  const unlock = await e.syncUnlock({ password: SENHA });
  assert.equal(unlock.ok, true, JSON.stringify({ unlock, ms: Date.now() - t1 }));
  e.sync.deviceId = 'dNotebook';
  e.sync.devices = { dNotebook: { name: 'Notebook de teste', contract: 2, keyReady: true, lastSeenAt: Date.now() }, dOutro: { name: 'Desktop antigo', contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  e.sync.autoridade = { fresca: true, agora: T, ultimaMudancaEm: T, intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
  e.sync.sinais = { conexaoEm: 0, lidos: new Set(), beat: null, modo: '', voltaPendente: false, voltando: false, ultimoBatimentoEm: 0, ready: { sequenciaVista: 1, fresca: true, ultimaMudancaEm: T } };
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  e.accountForPr = () => LOGIN;
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  return e;
}

const PR = { key: 'acme-exemplo/app-web#61', headSha: 'sha61aaaa', title: 'Titulo secreto', author: 'alguem', repo: 'acme-exemplo/app-web', number: 61 };

function no(caminho) {
  let atual = fake.tree() && fake.tree().users && fake.tree().users.u1;
  for (const seg of caminho.split('/')) atual = atual && atual[seg];
  return atual;
}

// o giro de quem publicou e NÃO agenda: a chave de admin fica fora do alcance dele
async function giroDeQuemPublicou(e, agora) {
  const ler = adminChave.lerChaveDeAdmin;
  adminChave.lerChaveDeAdmin = () => null;
  try {
    e.sync.motivosDaEspera = new Map();
    return await dist.cicloDaDistribuicao(e, e.config.sync, { agora });
  } finally {
    adminChave.lerChaveDeAdmin = ler;
  }
}

function esperandoDe(e) {
  return telas.distribuicaoParaTela(e).esperando[0];
}

async function comCandidatoEsperando(e) {
  e.headlessDistribuindo = new Map([[PR.key, { pr: PR, desde: T }]]);
  const r = await dist.publicarCandidato(e, e.config.sync, PR, { agora: T });
  assert.equal(r.ok, true);
  return r.itemId;
}

/* ---------- a parte pura: por que cada publicador ficou de fora ---------- */

test('motivo por aparelho: sem sinal, pausado, sem vaga e recusa recente, e o apto não aparece', () => {
  const item = { itemId: 'i1', publicadores: ['dSumido', 'dPausado', 'dCheio', 'dRecusou', 'dApto'] };
  const aparelhos = {
    dPausado: { apto: false, pausado: true, teto: 2, ocupadas: 0 },
    dCheio: { apto: true, pausado: false, teto: 1, ocupadas: 1 },
    dRecusou: { apto: true, pausado: false, teto: 2, ocupadas: 0 },
    dApto: { apto: true, pausado: false, teto: 2, ocupadas: 0 },
  };
  const recusas = { i1: { dRecusou: T + 1000 } };
  assert.deepEqual(escolha.motivosPorAparelho(item, aparelhos, { agora: T, recusas }), [
    { dev: 'dSumido', motivo: 'sem-sinal' },
    { dev: 'dPausado', motivo: 'pausado' },
    { dev: 'dCheio', motivo: 'sem-vaga' },
    { dev: 'dRecusou', motivo: 'recusou' },
  ]);
  const semResumo = { dApto: { apto: false, pausado: false, teto: 1, ocupadas: 0 } };
  assert.deepEqual(escolha.motivosPorAparelho({ itemId: 'i1', publicadores: ['dApto'] }, semResumo, { agora: T }), [{ dev: 'dApto', motivo: 'sem-sinal' }]);
});

test('o item sem aparelho sai da escolha com o motivo de cada publicador', () => {
  const itens = [{ itemId: 'i1', orgTag: 'o', publishedAt: 1, publicadores: ['dCheio'] }];
  const r = escolha.escolher(itens, { dCheio: { apto: true, teto: 1, ocupadas: 1 } }, { agora: T });
  assert.deepEqual(r.semAparelho, [{ itemId: 'i1', motivo: 'sem-aparelho-apto', aparelhos: [{ dev: 'dCheio', motivo: 'sem-vaga' }] }]);
});

/* ---------- o veredito sai do admin, cifrado, e chega a quem publicou ---------- */

test('o admin publica o veredito cifrado no nó do item, só quando ele muda', async () => {
  const e = await motor();
  const itemId = await comCandidatoEsperando(e);
  // teto 1 e vaga tomada: o próprio publicador está sem vaga quando o agendador olha
  e.updateSettings({ parallelReviews: 1 });
  assert.equal(admissao.reservar(e, { tipo: 'chat', agora: T }).ok, true);
  assert.equal((await publicacao.publicarCapacidade(e, e.config.sync)).ok, true);
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  assert.equal(ciclo.atribuido, null);
  const campo = no(`live/assign/${itemId}/espera`);
  assert.deepEqual(Object.keys(campo).sort(), ['enc', 'ttl', 'v']);
  assert.equal(campo.ttl, T + espera.TTL_MS);
  const cru = JSON.stringify(fake.tree());
  for (const proibido of ['sem-vaga', 'sem-aparelho-apto', PR.key, PR.headSha]) assert.equal(cru.includes(proibido), false, proibido);
  const escritas = () => fake.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/espera.json')).length;
  const antes = escritas();
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T + 10 });
  assert.equal(escritas(), antes, 'o mesmo veredito não é reescrito a cada giro');
});

test('quem publicou e não agenda lê o veredito, com o motivo de cada aparelho, e a nota do card diz qual', async () => {
  const e = await motor();
  await comCandidatoEsperando(e);
  e.updateSettings({ parallelReviews: 1 });
  assert.equal(admissao.reservar(e, { tipo: 'chat', agora: T }).ok, true);
  await publicacao.publicarCapacidade(e, e.config.sync);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const giro = await giroDeQuemPublicou(e, T + 5);
  assert.equal(giro.agenda.code, 'nao-e-admin', 'neste giro ele não agenda');
  const x = esperandoDe(e);
  assert.equal(x.motivo, 'sem-aparelho-apto');
  assert.deepEqual(x.aparelhos, [{ deviceId: 'dNotebook', motivo: 'sem-vaga' }]);
  const nota = notaDistribuicaoHtml(PR.key, { deviceId: 'dNotebook', devices: [], distribuicao: telas.distribuicaoParaTela(e) }, T + 5);
  assert.match(nota, /Por aparelho: este aparelho, sem vaga\./);
  assert.match(nota, /a recusa por peso não está ativa/);
  const deOutro = notaDistribuicaoHtml(PR.key, { deviceId: 'dCelular', devices: [{ deviceId: 'dNotebook', name: 'Notebook de teste' }], distribuicao: telas.distribuicaoParaTela(e) }, T + 5);
  assert.match(deOutro, /Notebook de teste, sem vaga/);
});

test('aparelho pausado e aparelho sem sinal aparecem cada um com o seu texto', async () => {
  const e = await motor();
  await comCandidatoEsperando(e);
  // sem capacidade publicada: sem sinal
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  await giroDeQuemPublicou(e, T + 1);
  assert.deepEqual(esperandoDe(e).aparelhos, [{ deviceId: 'dNotebook', motivo: 'sem-sinal' }]);
  const tela = { deviceId: 'dNotebook', devices: [], distribuicao: telas.distribuicaoParaTela(e) };
  assert.match(notaDistribuicaoHtml(PR.key, tela, T + 1), /este aparelho, sem sinal recente/);
  const pausado = notaDistribuicaoHtml(PR.key, { ...tela, distribuicao: { esperando: [{ key: PR.key, desde: T, motivo: 'sem-aparelho-apto', aparelhos: [{ deviceId: 'dNotebook', motivo: 'pausado' }] }] } }, T);
  assert.match(pausado, /este aparelho, pausado pelo admin/);
});

test('veredito vencido não aparece: motivo velho é pior que nenhum', async () => {
  const e = await motor();
  await comCandidatoEsperando(e);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const lidas = await espera.lerEsperas(e, { atribuicoes: no('live/assign'), agora: T + espera.TTL_MS + 1 });
  assert.equal(lidas.size, 0);
});

test('veredito transplantado para outro item não abre', async () => {
  const e = await motor();
  const itemId = await comCandidatoEsperando(e);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  const campo = no(`live/assign/${itemId}/espera`);
  const outro = await dist.publicarCandidato(e, e.config.sync, { ...PR, key: 'acme-exemplo/app-web#62', number: 62 }, { agora: T });
  const arvore = { [outro.itemId]: { espera: campo } };
  const lidas = await espera.lerEsperas(e, { atribuicoes: arvore, agora: T + 1 });
  assert.equal(lidas.has(outro.itemId), false);
});

test('a atribuição viva nomeia o aparelho escolhido', async () => {
  const e = await motor();
  const itemId = await comCandidatoEsperando(e);
  const arvore = { [itemId]: { itemId, dev: 'dOutro', rev: 1, generation: 1, ttl: T + SYNC.ATRIBUICAO_TTL_MS, sig: 'x' } };
  const lidas = await espera.lerEsperas(e, { atribuicoes: arvore, agora: T + 1 });
  assert.equal(lidas.get(itemId).motivo, 'atribuicao-viva');
  assert.equal(lidas.get(itemId).dev, 'dOutro');
  const nota = notaDistribuicaoHtml(PR.key, {
    deviceId: 'dNotebook', devices: [{ deviceId: 'dOutro', name: 'Desktop antigo' }],
    distribuicao: { esperando: [{ key: PR.key, desde: T, motivo: 'atribuicao-viva', dev: 'dOutro', aparelhos: [] }] },
  }, T);
  assert.match(nota, /O distribuidor escolheu Desktop antigo e espera ele aceitar/);
  assert.equal(nota.includes('escolheu um aparelho'), false, 'com o nome na frase, o motivo genérico vira eco');
});

/* ---------- a recusa do executor chega com o detalhe da admissão ---------- */

test('a recusa por memória desconhecida chega com o detalhe, e é a mais nova que vale', async () => {
  const e = await motor();
  const itemId = await comCandidatoEsperando(e);
  await publicacao.publicarCapacidade(e, e.config.sync);
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  assert.equal(ciclo.atribuido.itemId, itemId);
  fixarMemoriaLivre(0); // sem medida nenhuma: desconhecida, e a admissão não admite
  const resposta = await dist.aceitarAtribuicoes(e, e.config.sync, no('live/assign'), { agora: T + 1000 });
  fixarMemoriaLivre();
  assert.equal(resposta.recusas[0].code, 'inapto');
  const ack = no(`live/ack/${itemId}`);
  assert.equal(ack.detalhe, 'memoria-desconhecida');
  // a atribuição ainda está no prazo, mas a recusa é mais nova e é ela que vale
  const lidas = await espera.lerEsperas(e, { atribuicoes: no('live/assign'), agora: T + 2000 });
  assert.equal(lidas.get(itemId).motivo, 'inapto');
  assert.deepEqual(lidas.get(itemId).aparelhos, [{ deviceId: 'dNotebook', motivo: 'memoria-desconhecida' }]);
  const nota = notaDistribuicaoHtml(PR.key, { deviceId: 'dCelular', devices: [{ deviceId: 'dNotebook', name: 'Notebook de teste' }], distribuicao: { esperando: [{ key: PR.key, desde: T, motivo: 'inapto', dev: 'dNotebook', aparelhos: lidas.get(itemId).aparelhos }] } }, T);
  assert.match(nota, /o aparelho escolhido não estava apto/);
  assert.match(nota, /Notebook de teste, sem medida de memória livre/);
});

test('o detalhe da recusa é allowlist: texto livre não viaja', async () => {
  const e = await motor();
  await dist.responder(e, e.config.sync, { itemId: 'a_b', estado: 'recusada', code: 'inapto', detalhe: 'texto <b>livre</b>', agora: T });
  assert.equal(no('live/ack/a_b').detalhe, '');
  await dist.responder(e, e.config.sync, { itemId: 'a_b', estado: 'recusada', code: 'sem_vaga', detalhe: 'sem-vaga', agora: T });
  assert.equal(no('live/ack/a_b').detalhe, 'sem-vaga');
});

test('a recusa vencida não é lida como motivo', async () => {
  const e = await motor();
  const itemId = await comCandidatoEsperando(e);
  await dist.responder(e, e.config.sync, { itemId, estado: 'recusada', code: 'sem_vaga', detalhe: 'sem-vaga', esperaAte: T + 100, agora: T });
  assert.equal((await espera.lerEsperas(e, { atribuicoes: {}, agora: T + 50 })).get(itemId).motivo, 'sem_vaga');
  assert.equal((await espera.lerEsperas(e, { atribuicoes: {}, agora: T + 101 })).size, 0);
});

test('a atribuição de verdade substitui o veredito inteiro, e o executor a aceita', async () => {
  const e = await motor();
  const itemId = await comCandidatoEsperando(e);
  await dist.cicloDoAgendador(e, e.config.sync, { agora: T });
  assert.ok(no(`live/assign/${itemId}/espera`));
  await publicacao.publicarCapacidade(e, e.config.sync);
  const ciclo = await dist.cicloDoAgendador(e, e.config.sync, { agora: T + 1 });
  assert.equal(ciclo.atribuido.itemId, itemId, 'o nó só com o veredito não conta como atribuição viva');
  const node = no(`live/assign/${itemId}`);
  assert.equal(node.espera, undefined);
  assert.equal(node.rev, 1);
  const r = await dist.aceitarAtribuicoes(e, e.config.sync, no('live/assign'), { agora: T + 2 });
  assert.equal(r.aceitas.length, 1);
});

test('sem candidato próprio, o giro não gasta leitura com as recusas', async () => {
  const e = await motor();
  fake.requests.length = 0;
  const lidas = await espera.lerEsperas(e, { atribuicoes: {}, agora: T });
  assert.equal(lidas.size, 0);
  assert.equal(fake.requests.filter((r) => r.path.includes('/live/ack')).length, 0);
});
