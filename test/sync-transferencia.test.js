// Transferência voluntária (7.C7b): a parte pura e o caminho no banco falso.
//
// O caso que carrega o contrato: transferência só sai para destino APTO, e "apto" inclui
// ter a credencial da conta do PR. Sem credencial lá, o trabalho pararia em silêncio.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c7b-transferencia-'));
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
const transferencia = (await import('../lib/sync/transferencia.js')).default;
const transfEng = (await import('../lib/engine/sync-transferencia.js')).default;
const escolha = (await import('../lib/engine/escolha.js')).default;
const candidato = (await import('../lib/sync/candidato.js')).default;
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { prTag, acctTag, matTag } = await import('../lib/sync/tags.js');
const { checkpointPath, appendCheckpointEntry } = await import('../lib/engine/verification-checkpoint.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const PR = { key: 'dono/repo#3', headSha: 'sha3', title: 'Titulo', repo: 'dono/repo', number: 3 };
const T = Date.now();
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
  try { fs.rmSync(checkpointPath(PR.key, 'review'), { force: true }); } catch { /* sem checkpoint anterior */ }
});

// --- parte pura -----------------------------------------------------------------------

function resumo(extra = {}) {
  return { frescoAte: T + 1000, pausado: false, iaPronta: true, token: true, contas: ['tagDaConta'], teto: 2, ocupadas: 0, ...extra };
}

test('destino apto exige resumo fresco, sem pausa, com IA, com vaga e com credencial', () => {
  assert.deepEqual(transferencia.destinoApto(resumo(), { acctTag: 'tagDaConta', agora: T }), { apto: true, motivo: '' });
  assert.equal(transferencia.destinoApto(null, { agora: T }).motivo, 'sem-resumo');
  assert.equal(transferencia.destinoApto(resumo({ frescoAte: T - 1 }), { agora: T }).motivo, 'sem-resumo');
  assert.equal(transferencia.destinoApto(resumo({ pausado: true }), { agora: T }).motivo, 'pausado');
  assert.equal(transferencia.destinoApto(resumo({ iaPronta: false }), { agora: T }).motivo, 'sem-ia');
  assert.equal(transferencia.destinoApto(resumo({ ocupadas: 2 }), { agora: T }).motivo, 'sem-vaga');
  assert.equal(transferencia.destinoApto(resumo({ contas: [] }), { acctTag: 'tagDaConta', agora: T }).motivo, 'sem-credencial');
  assert.equal(transferencia.destinoApto(resumo({ token: false }), { acctTag: 'tagDaConta', agora: T }).motivo, 'sem-credencial');
});

test('a preferência vale enquanto não vence, e vencida não existe', () => {
  assert.equal(transferencia.preferenciaValida({ dev: 'dB', ate: T + 1 }, { agora: T }), 'dB');
  assert.equal(transferencia.preferenciaValida({ dev: 'dB', ate: T }, { agora: T }), '');
  assert.equal(transferencia.preferenciaValida(null, { agora: T }), '');
});

const APTO = { apto: true, teto: 2, ocupadas: 0, prioridade: 0 };

test('a colocação respeita a preferência viva, e ignora a vencida', () => {
  const item = { itemId: 'i1', orgTag: 'org1', publishedAt: T, publicadores: ['dA', 'dB'], prefDev: 'dB', prefAte: T + 1000 };
  assert.equal(escolha.escolherOnde(item, { dA: APTO, dB: APTO }, { agora: T }).dev, 'dB');
  assert.equal(escolha.escolherOnde({ ...item, prefAte: T - 1 }, { dA: APTO, dB: APTO }, { agora: T }).dev, 'dA', 'vencida, volta a ordem de sempre');
});

test('preferência por aparelho inelegível não segura o item', () => {
  const item = { itemId: 'i1', orgTag: 'org1', publishedAt: T, publicadores: ['dA', 'dB'], prefDev: 'dB', prefAte: T + 1000 };
  assert.equal(escolha.escolherOnde(item, { dA: APTO, dB: { ...APTO, ocupadas: 2 } }, { agora: T }).dev, 'dA');
});

test('a preferência viaja no candidato só quando existe, e com prazo', () => {
  const kId = Buffer.alloc(32, 3);
  const semPref = candidato.candidatoDe(PR, { kId, conta: 'c', agora: T, ttlMs: 1000 });
  assert.equal('prefDev' in semPref, false);
  const comPref = candidato.candidatoDe(PR, { kId, conta: 'c', agora: T, ttlMs: 1000, preferencia: { dev: 'dB', ate: T + 5 } });
  assert.deepEqual([comPref.prefDev, comPref.prefAte], ['dB', T + 5]);
  assert.equal('prefDev' in candidato.candidatoDe(PR, { kId, conta: 'c', agora: T, ttlMs: 1000, preferencia: { dev: 'dB' } }), false, 'sem prazo não é preferência');
});

test('a preferência de um publicador vale para o item fundido', () => {
  const kId = Buffer.alloc(32, 3);
  const semPref = candidato.candidatoDe(PR, { kId, conta: 'c', agora: T, ttlMs: 10000 });
  const comPref = candidato.candidatoDe(PR, { kId, conta: 'c', agora: T, ttlMs: 10000, preferencia: { dev: 'dB', ate: T + 5000 } });
  // quem publicou PRIMEIRO não tem preferência: ela chega no segundo publicador, e é aí
  // que a fusão precisa carregá-la para o item
  const item = candidato.fundir({ dA: [semPref], dB: [comPref] }, { agora: T })[0];
  assert.equal(item.prefDev, 'dB');
  assert.equal(item.prefAte, T + 5000);
});

// --- caminho completo -----------------------------------------------------------------

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: true }, consolidation: { enabled: false }, shared: { enabled: true },
    distribution: { enabled: true }, aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY,
    databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function fetchDosDubles(url, init) {
  const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
  if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
  return fetch(alvo, init);
}

async function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.emit = () => true;
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['dono'] }], parallelReviews: 2 });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = { dB: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  e.sync.autoridade = { fresca: true, agora: Date.now(), ultimaMudancaEm: Date.now(), intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS };
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  e.accountForPr = () => LOGIN;
  e.cancelados = [];
  e.cancelSession = (id) => e.cancelados.push(id);
  e.activeReviews = new Map([['s1', { pr: PR, keys: [PR.key], checkpoint: 'review', mode: 'auto' }]]);
  return e;
}

function kId(e) { return kek.bufferDe(e.sync.material.id); }
function arvore() { const t = fake.tree(); return (t && t.users && t.users.u1) || {}; }

// A capacidade que o destino teria publicado.
async function capacidadeDoDestino(e, extra = {}) {
  const envelope = (await import('../lib/sync/envelope.js')).default;
  const c = {
    nome: 'Celular', contas: [acctTag(kId(e), LOGIN)], token: true, iaPronta: true, paralelismo: 2,
    ramLivre: 'alta', aceitarAdmin: true, keyReady: true, pausado: false,
    admissao: { total: 0, porEstado: { reserva: 0, execucao: 0 }, porTipo: {} }, ...extra,
  };
  const caminho = 'live/deviceStatus/dB';
  const cif = envelope.cifrar({
    uid: e.sync.uid, caminho, campo: 'capacidade', no: 'live/deviceStatus', esquema: 'cap1',
    cur: e.sync.cur, material: e.sync.material, r: 1, dados: { c },
  });
  assert.equal(cif.ok, true);
  assert.equal((await e.sync.client.put(`/users/u1/${caminho}`, { v: 1, u: Date.now(), enc: cif.enc }, {})).ok, true);
}

function argsDaTransferencia(e, destino = 'dB') {
  return { prTag: prTag(kId(e), PR.key), matTag: matTag(kId(e), PR.headSha), destino };
}

test('transferir: manda a memória, encerra a sessão daqui e devolve o item preferindo o destino', async () => {
  const e = await motor();
  appendCheckpointEntry(checkpointPath(PR.key, 'review'), PR.key, '', { claim: 'a', file: 'x.ts', line: 1, verdict: 'confirmado', evidence: 'e', sessionId: 's1', headSha: 'sha3', at: '2026-09-16T10:00:00' });
  await capacidadeDoDestino(e);
  const r = await transfEng.transferir(e, e.config.sync, argsDaTransferencia(e));
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(e.cancelados, ['s1'], 'a sessão de origem termina');
  assert.ok(Object.keys(arvore().checkpoints.review).length, 'a memória subiu antes');
  const registro = arvore().live.queue[r.itemId][e.sync.deviceId];
  assert.equal(registro.prefDev, 'dB');
  assert.ok(registro.prefAte > Date.now());
});

test('transferir para destino sem a credencial da conta é recusado, e a sessão continua', async () => {
  const e = await motor();
  await capacidadeDoDestino(e, { contas: [] });
  const r = await transfEng.transferir(e, e.config.sync, argsDaTransferencia(e));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'destino_inapto');
  assert.match(r.motivo, /sem-credencial/);
  assert.deepEqual(e.cancelados, [], 'nada foi encerrado');
  assert.equal((arvore().live || {}).queue, undefined);
});

test('transferir para destino pausado ou sem capacidade publicada é recusado', async () => {
  const e = await motor();
  const semNada = await transfEng.transferir(e, e.config.sync, argsDaTransferencia(e));
  assert.equal(semNada.code, 'destino_inapto');
  await capacidadeDoDestino(e, { pausado: true });
  const pausado = await transfEng.transferir(e, e.config.sync, argsDaTransferencia(e));
  assert.match(pausado.motivo, /pausado/);
  assert.deepEqual(e.cancelados, []);
});

test('transferir sem sessão viva, para si mesmo ou com head velho é recusado', async () => {
  const e = await motor();
  await capacidadeDoDestino(e);
  assert.equal((await transfEng.transferir(e, e.config.sync, { ...argsDaTransferencia(e), destino: e.sync.deviceId })).code, 'forma');
  assert.equal((await transfEng.transferir(e, e.config.sync, { ...argsDaTransferencia(e), matTag: matTag(kId(e), 'sha-velho') })).code, 'head_mudou');
  e.activeReviews = new Map();
  assert.equal((await transfEng.transferir(e, e.config.sync, argsDaTransferencia(e))).code, 'nada_rodando');
  assert.deepEqual(e.cancelados, []);
});

test('a memória vai ANTES de encerrar a sessão', () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/sync-transferencia.js', import.meta.url), 'utf8');
  const i = fonte.indexOf('checkpointSync.publicarCheckpoint');
  const j = fonte.indexOf('engine.cancelSession');
  const k = fonte.indexOf('distribuicao.publicarCandidato');
  assert.ok(i > 0 && i < j && j < k, 'ordem: memória, encerrar, publicar');
});

test('a capacidade publicada leva o que a aptidão do destino precisa ler', async () => {
  const e = await motor();
  const cap = publicacao.capacidadeDe(e, e.config.sync);
  for (const campo of ['contas', 'token', 'iaPronta', 'paralelismo', 'pausado', 'admissao']) {
    assert.ok(campo in cap, `a aptidão do destino lê ${campo}`);
  }
});
