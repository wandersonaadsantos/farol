// Publicar e aceitar política por aparelho (7.C2 e CT-ADM-POL).
//
// A ordem das recusas é parte do contrato, não detalhe de implementação: o consentimento
// local vem primeiro, depois a geração, depois a assinatura, e só DEPOIS de tudo isso o
// envelope é aberto. Por isso os casos de recusa afirmam o CÓDIGO, e não só que recusou:
// um `enc` de lixo recusado por 'assinatura' prova que ninguém tentou decifrá-lo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-politicas-'));
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

const { IS_WIN } = await import('../lib/paths.js');
const { Engine } = await import('../server.js');
const { sanearPolitica } = await import('../lib/sync/politica.js');
const cachePolitica = await import('../lib/sync/cache-politica.js');
const politicas = await import('../lib/engine/sync-politicas.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const TAG_A = 'a'.repeat(32);
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
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; cachePolitica.apagarPolitica(); });

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

// Um aparelho logado, com a chave do conjunto aberta e já admin: é quem consegue publicar.
async function motorAdmin(cfg = syncCfg()) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: cfg });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true, 'a chave do conjunto precisa estar aberta');
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  return e;
}

function noPublicado(e) {
  const t = fake.tree();
  const live = t && t.users && t.users.u1 ? t.users.u1.live : null;
  return (live && live.devicePolicies && live.devicePolicies[e.sync.deviceId]) || null;
}

function adminDoBanco() {
  const t = fake.tree();
  return t.users.u1.live.control.admin;
}

function autoridade({ fresca = true } = {}) {
  return { fresca, agora: 1000, intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS, ultimaMudancaEm: 1000 };
}

test('allowlist: chave desconhecida é descartada e o resto da política vale', () => {
  const p = sanearPolitica({ pausado: true, tetoParalelismo: 2, desligarGates: true, qualquerCoisa: 'x' });
  assert.deepEqual(p, { pausado: true, tetoParalelismo: 2 });
});

test('allowlist: teto fora de 1 a 4 é clampado, não recusado', () => {
  assert.equal(sanearPolitica({ tetoParalelismo: 9 }).tetoParalelismo, 4);
  assert.equal(sanearPolitica({ tetoParalelismo: 0 }).tetoParalelismo, 1);
  assert.equal(sanearPolitica({ tetoParalelismo: -7 }).tetoParalelismo, 1);
  assert.equal('tetoParalelismo' in sanearPolitica({ tetoParalelismo: 'muito' }), false, 'lixo não vira teto');
});

test('allowlist: tipos fora da lista somem, contas precisam ter forma de tag', () => {
  const p = sanearPolitica({ tiposDeOperacao: ['review', 'merge', 'chat'], contasElegiveis: [TAG_A, 'wanderson', TAG_A] });
  assert.deepEqual(p.tiposDeOperacao, ['review', 'chat']);
  assert.deepEqual(p.contasElegiveis, [TAG_A], 'login em claro nunca entra, e repetida não duplica');
});

test('allowlist: campo ausente não vira campo falso', () => {
  assert.deepEqual(sanearPolitica({}), {});
  assert.deepEqual(sanearPolitica(null), {});
});

test('publicar: o nó sobe cifrado e assinado, e a política não aparece em claro', async () => {
  const e = await motorAdmin();
  const r = await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true, tetoParalelismo: 2, contasElegiveis: [TAG_A] } });
  assert.equal(r.ok, true, r.motivo);
  const no = noPublicado(e);
  assert.deepEqual(Object.keys(no).sort(), ['enc', 'generation', 'sig', 'v']);
  assert.equal(no.generation, 1);
  assert.equal(no.v, 1);
  assert.match(no.enc, /^e1\.g1\./);
  const cru = JSON.stringify(no);
  assert.equal(cru.includes('tetoParalelismo'), false, 'nome de campo em claro no banco');
  assert.equal(cru.includes(TAG_A), false, 'tag da conta em claro no banco');
});

test('publicar: quem não é admin da geração vigente não publica', async () => {
  const e = await motorAdmin();
  const arvore = fake.tree();
  arvore.users.u1.live.control.admin = { deviceId: 'dOutro', generation: 7, publicKey: 'x'.repeat(43), setAt: 1 };
  fake.setTree(arvore);
  const r = await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao-e-admin');
  assert.equal(noPublicado(e), null);
});

test('aceitar: política assinada, geração vigente e autoridade fresca entram no cache', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true, tetoParalelismo: 3 } });
  const r = politicas.aceitarPolitica(e, syncCfg(), { no: noPublicado(e), admin: adminDoBanco(), autoridade: autoridade() });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(r.politica, { pausado: true, tetoParalelismo: 3 });
  const cache = cachePolitica.lerPolitica();
  assert.deepEqual(cache.politica, { pausado: true, tetoParalelismo: 3 });
  assert.equal(cache.generation, 1);
});

test('aceitar: com aceitarAdmin desligado, a política não muda NADA', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true } });
  const r = politicas.aceitarPolitica(e, syncCfg({ aceitarAdmin: false }), { no: noPublicado(e), admin: adminDoBanco(), autoridade: autoridade() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao-aceita-admin');
  assert.equal(cachePolitica.lerPolitica(), null, 'nem o cache foi tocado');
});

test('aceitar: assinatura inválida é recusada ANTES de decifrar', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true } });
  // enc de lixo com forma válida: se a ordem fosse decifrar antes, o motivo seria de cifra
  const no = { ...noPublicado(e), enc: 'e1.g1.AAAA.BBBB.CCCC' };
  const r = politicas.aceitarPolitica(e, syncCfg(), { no, admin: adminDoBanco(), autoridade: autoridade() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'assinatura', 'o envelope não pode ter sido aberto');
  assert.equal(cachePolitica.lerPolitica(), null);
});

test('aceitar: geração diferente da vigente é recusada, e a pública de outro admin também', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true } });
  const no = noPublicado(e);
  const cfg = syncCfg();
  const velha = politicas.aceitarPolitica(e, cfg, { no: { ...no, generation: 0 }, admin: adminDoBanco(), autoridade: autoridade() });
  assert.equal(velha.code, 'geracao');
  const outra = politicas.aceitarPolitica(e, cfg, { no, admin: { ...adminDoBanco(), publicKey: 'z'.repeat(43) }, autoridade: autoridade() });
  assert.equal(outra.code, 'assinatura');
  assert.equal(cachePolitica.lerPolitica(), null);
});

test('aceitar: sem autoridade fresca a política nova não entra, e a anterior continua valendo', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: false, tetoParalelismo: 4 } });
  assert.equal(politicas.aceitarPolitica(e, syncCfg(), { no: noPublicado(e), admin: adminDoBanco(), autoridade: autoridade() }).ok, true);
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true, tetoParalelismo: 1 } });
  const r = politicas.aceitarPolitica(e, syncCfg(), { no: noPublicado(e), admin: adminDoBanco(), autoridade: autoridade({ fresca: false }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'autoridade');
  assert.deepEqual(cachePolitica.lerPolitica().politica, { pausado: false, tetoParalelismo: 4 }, 'a anterior sobrevive');
});

test('aceitar: chave fora da allowlist é descartada no caminho inteiro', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true, desligarGates: true, tetoParalelismo: 99 } });
  const r = politicas.aceitarPolitica(e, syncCfg(), { no: noPublicado(e), admin: adminDoBanco(), autoridade: autoridade() });
  assert.deepEqual(r.politica, { pausado: true, tetoParalelismo: 4 });
});

test('aceitar: versão antiga não sobrescreve a mais nova já aceita', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { tetoParalelismo: 1 } });
  const primeira = noPublicado(e);
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { tetoParalelismo: 3 } });
  assert.equal(politicas.aceitarPolitica(e, syncCfg(), { no: noPublicado(e), admin: adminDoBanco(), autoridade: autoridade() }).ok, true);
  const r = politicas.aceitarPolitica(e, syncCfg(), { no: primeira, admin: adminDoBanco(), autoridade: autoridade() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'antiga');
  assert.equal(cachePolitica.lerPolitica().politica.tetoParalelismo, 3);
});

test('o cache da política não guarda segredo, e em POSIX tem modo 0600', async () => {
  const e = await motorAdmin();
  await e.syncPublicarPolitica({ deviceId: e.sync.deviceId, politica: { pausado: true } });
  politicas.aceitarPolitica(e, syncCfg(), { no: noPublicado(e), admin: adminDoBanco(), autoridade: autoridade() });
  const cru = fs.readFileSync(cachePolitica.caminhoDoCache(), 'utf8');
  assert.equal(cru.includes(SENHA), false);
  assert.equal(cru.includes(API_KEY), false);
  assert.equal(cru.includes(e.sync.material.id), false, 'material de chave não mora aqui');
  if (!IS_WIN) assert.equal(fs.statSync(cachePolitica.caminhoDoCache()).mode & 0o777, 0o600);
});
