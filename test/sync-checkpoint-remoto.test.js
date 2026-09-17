// Checkpoint compartilhado (7.C7) com o banco falso: publicar, herdar e falhar fechado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c7a-checkpoint-'));
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
const chk = (await import('../lib/engine/sync-checkpoint.js')).default;
const checkpoint = (await import('../lib/sync/checkpoint.js')).default;
const { checkpointPath, appendCheckpointEntry, readCheckpoint } = await import('../lib/engine/verification-checkpoint.js');
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag } = await import('../lib/sync/tags.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const PR = 'dono/repo#4';
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
  for (const loja of ['review', 'self']) {
    try { fs.rmSync(checkpointPath(PR, loja), { force: true }); } catch { /* sem checkpoint anterior */ }
  }
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

function entrada(extra = {}) {
  return { claim: 'x.ts:10 confirma y', file: 'x.ts', line: 10, verdict: 'confirmado', evidence: 'li o arquivo', sessionId: 's1', headSha: 'sha4', blobSha: 'blob1', at: '2026-09-16T10:00:00', ...extra };
}

async function motor({ comFrota = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.emit = () => true;
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }] });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = comFrota ? { dOutro: { contract: 2, keyReady: true, lastSeenAt: Date.now() } } : {};
  return e;
}

function arvore() { const t = fake.tree(); return (t && t.users && t.users.u1) || {}; }
function noDaLoja(e, loja) { return ((arvore().checkpoints || {})[loja] || {})[prTag(kek.bufferDe(e.sync.material.id), PR)] || {}; }

// Põe uma entrada "de outro aparelho" no banco, cifrada com a chave do conjunto.
async function entradaRemota(e, loja, dados, { dev = 'dOutro' } = {}) {
  const envelope = (await import('../lib/sync/envelope.js')).default;
  const kId = kek.bufferDe(e.sync.material.id);
  const id = checkpoint.idDaEntrada(kId, { dev, prKey: PR, entrada: dados });
  const caminho = `checkpoints/${loja}/${prTag(kId, PR)}/${id}`;
  const cif = envelope.cifrar({
    uid: e.sync.uid, caminho, campo: 'checkpoint', no: `checkpoints/${loja}`, esquema: 'chk1',
    cur: e.sync.cur, material: e.sync.material, r: 1, dados: { e: checkpoint.sanearEntrada(dados) },
  });
  assert.equal(cif.ok, true);
  const w = await e.sync.client.put(`/users/u1/${caminho}`, { v: 1, u: Date.now(), dev, enc: cif.enc }, {});
  assert.equal(w.ok, true);
  return { id, caminho };
}

test('o que este aparelho verificou sobe cifrado, e a afirmação não aparece em claro', async () => {
  const e = await motor();
  appendCheckpointEntry(checkpointPath(PR, 'review'), PR, '', entrada());
  const r = await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.escritas.length, 1);
  const no = Object.values(noDaLoja(e, 'review'))[0];
  assert.deepEqual(Object.keys(no).sort(), ['dev', 'enc', 'u', 'v']);
  const cru = JSON.stringify(fake.tree());
  for (const proibido of ['confirma y', 'x.ts', 'dono/repo']) assert.equal(cru.includes(proibido), false, proibido);
});

test('a mesma entrada não sobe duas vezes', async () => {
  const e = await motor();
  appendCheckpointEntry(checkpointPath(PR, 'review'), PR, '', entrada());
  assert.equal((await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR })).escritas.length, 1);
  assert.equal((await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR })).escritas.length, 0);
});

test('sem outro aparelho pronto, nada sobe', async () => {
  const e = await motor({ comFrota: false });
  appendCheckpointEntry(checkpointPath(PR, 'review'), PR, '', entrada());
  const r = await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR });
  assert.equal(r.ok, false);
  assert.equal(arvore().checkpoints, undefined);
});

test('herdar traz o que o outro verificou, com o aparelho de origem, e diz o desfecho', async () => {
  const e = await motor();
  await entradaRemota(e, 'review', entrada({ claim: 'outra coisa', sessionId: 'sX' }));
  const r = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, headSha: 'sha4' });
  assert.equal(r.herdadas, 1);
  assert.equal(r.desfecho, 'integral');
  const local = readCheckpoint(checkpointPath(PR, 'review'));
  assert.equal(local.entries[0].dev, 'dOutro');
  assert.equal(local.entries[0].sessionId, 'dOutro:sX', 'a passada do outro aparelho fica distinguível');
  const denovo = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, headSha: 'sha4' });
  assert.equal(denovo.herdadas, 0, 'herdar duas vezes não duplica');
});

// O que veio de fora não volta para o banco com o meu nome: isso mudaria o dono da
// verificação e faria o outro aparelho herdar de volta a própria entrada, agora atribuída
// a mim.
test('entrada herdada não é republicada como minha', async () => {
  const e = await motor();
  await entradaRemota(e, 'review', entrada({ claim: 'veio de fora' }));
  assert.equal((await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, headSha: 'sha4' })).herdadas, 1);
  const r = await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR });
  assert.deepEqual(r.escritas, []);
  const donos = Object.values(noDaLoja(e, 'review')).map((n) => n.dev);
  assert.deepEqual(donos, ['dOutro']);
});

test('checkpoint de outro head não é retomado integralmente', async () => {
  const e = await motor();
  await entradaRemota(e, 'review', entrada({ headSha: 'sha-antigo', claim: 'a', sessionId: 'sA' }));
  await entradaRemota(e, 'review', entrada({ headSha: 'sha4', claim: 'b', sessionId: 'sB' }));
  const r = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, headSha: 'sha4' });
  assert.equal(r.herdadas, 2);
  assert.equal(r.relevantes, 1);
  assert.equal(r.desfecho, 'parcial');
});

test('entrada do head antigo volta a valer quando o arquivo não mudou', async () => {
  const e = await motor();
  await entradaRemota(e, 'review', entrada({ headSha: 'sha-antigo', blobSha: 'blob1' }));
  const r = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, headSha: 'sha4', blobs: { 'x.ts': 'blob1' } });
  assert.equal(r.desfecho, 'integral');
});

test('entrada que não decifra não entra no gate: fica de fora inteira e é contada', async () => {
  const e = await motor();
  const { caminho } = await entradaRemota(e, 'review', entrada());
  await e.sync.client.put(`/users/u1/${caminho}/enc`, 'e1.g1.aaaa.bbbb.cccc', {});
  const r = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, headSha: 'sha4' });
  assert.equal(r.herdadas, 0);
  assert.equal(r.ilegiveis, 1);
  assert.deepEqual(readCheckpoint(checkpointPath(PR, 'review')).entries, []);
});

test('as duas lojas não se misturam: entrada da autoanálise não entra na revisão', async () => {
  const e = await motor();
  await entradaRemota(e, 'self', entrada({ claim: 'analisei meu proprio PR' }));
  const revisao = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, loja: 'review', headSha: 'sha4' });
  assert.equal(revisao.herdadas, 0);
  const propria = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, loja: 'self', headSha: 'sha4' });
  assert.equal(propria.herdadas, 1);
});

test('envelope da autoanálise transplantado para a revisão não abre', async () => {
  const e = await motor();
  const { id, caminho } = await entradaRemota(e, 'self', entrada());
  const daSelf = (arvore().checkpoints.self[prTag(kek.bufferDe(e.sync.material.id), PR)] || {})[id];
  assert.ok(daSelf && caminho.includes('self'));
  await e.sync.client.put(`/users/u1/checkpoints/review/${prTag(kek.bufferDe(e.sync.material.id), PR)}/${id}`, daSelf, {});
  const r = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, loja: 'review', headSha: 'sha4' });
  assert.equal(r.herdadas, 0, 'a loja entra no envelope, não só no caminho');
  assert.equal(r.ilegiveis, 1);
});

// O transplante usando o que a PUBLICAÇÃO deste aparelho gravou: é o caminho real, e é o
// que prova que a loja entra no envelope também na escrita.
// O que este aparelho publicou tem que abrir no OUTRO aparelho, na mesma loja: é a outra
// metade do caso do transplante, e sem ela um erro de caminho na escrita passaria batido.
test('entrada publicada abre na mesma loja, vista de outro aparelho', async () => {
  const e = await motor();
  appendCheckpointEntry(checkpointPath(PR, 'review'), PR, '', entrada());
  assert.equal((await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR })).escritas.length, 1);
  const tag = prTag(kek.bufferDe(e.sync.material.id), PR);
  const [id, no] = Object.entries(noDaLoja(e, 'review'))[0];
  await e.sync.client.put(`/users/u1/checkpoints/review/${tag}/${id}`, { ...no, dev: 'dOutro' }, {});
  fs.rmSync(checkpointPath(PR, 'review'), { force: true });
  const lido = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, headSha: 'sha4' });
  assert.equal(lido.ilegiveis, 0);
  assert.equal(lido.herdadas, 1);
});

test('entrada publicada na autoanálise não abre na revisão', async () => {
  const e = await motor();
  appendCheckpointEntry(checkpointPath(PR, 'self'), PR, '', entrada());
  const r = await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR, loja: 'self' });
  assert.equal(r.escritas.length, 1);
  const tag = prTag(kek.bufferDe(e.sync.material.id), PR);
  const [id, no] = Object.entries(noDaLoja(e, 'self'))[0];
  // o nó vai para a outra loja com dono de outro aparelho: é o transplante que alguém com
  // a credencial da conta conseguiria fazer no banco
  await e.sync.client.put(`/users/u1/checkpoints/review/${tag}/${id}`, { ...no, dev: 'dOutro' }, {});
  const lido = await chk.herdarCheckpoint(e, e.config.sync, { prKey: PR, loja: 'review', headSha: 'sha4' });
  assert.equal(lido.herdadas, 0);
  assert.equal(lido.ilegiveis, 1);
});

test('loja desconhecida não vira caminho', async () => {
  const e = await motor();
  const r = await chk.publicarCheckpoint(e, e.config.sync, { prKey: PR, loja: 'inventada' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'forma');
});

test('o relógio publica o que as sessões vivas verificaram', async () => {
  const e = await motor();
  appendCheckpointEntry(checkpointPath(PR, 'review'), PR, '', entrada());
  e.activeReviews = new Map([['s1', { pr: { key: PR }, checkpoint: 'review', keys: [PR] }]]);
  const feitas = await chk.publicarDeSessoesVivas(e, e.config.sync);
  assert.deepEqual(feitas, [{ prKey: PR, loja: 'review', escritas: 1 }]);
  const andamento = fs.readFileSync(new URL('../lib/engine/sync-andamento.js', import.meta.url), 'utf8');
  assert.match(andamento, /checkpointSync\.publicarDeSessoesVivas\(engine, cfg, \{ agora \}\)/);
});

test('a revisão herda antes de montar o prompt', () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/review.js', import.meta.url), 'utf8');
  const i = fonte.indexOf('herdarDoConjunto(engine, pr, headShaAtual, blobsAtuais)');
  const j = fonte.indexOf('readCheckpoint(checkpointPath(pr.key))');
  assert.ok(i > 0 && i < j, 'herdar depois de ler o checkpoint local não serviria de nada');
});

// A herança decidida vai para a sessão, e dela ao andamento que a tela dos outros lê
// (divergência 9 da tela do Radar). Só quando a leitura do conjunto aconteceu: o fallback
// de erro diz "reinício" sem ter lido nada, e isso não pode virar afirmação na tela.
test('a revisão grava na sessão a herança que decidiu, só com leitura feita', () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/review.js', import.meta.url), 'utf8');
  const i = fonte.indexOf('herdarDoConjunto(engine, pr, headShaAtual, blobsAtuais)');
  const trecho = fonte.slice(i, i + 400);
  assert.match(trecho, /if \(doConjunto\.ok && engine\.activeReviews\.get\(id\)\) engine\.activeReviews\.get\(id\)\.heranca = doConjunto\.desfecho;/);
  const fallback = fonte.slice(fonte.indexOf('async function herdarDoConjunto'), fonte.indexOf('function cfgDaSync'));
  assert.doesNotMatch(fallback, /ok: true/, 'o caminho de erro não pode se apresentar como leitura feita');
});
