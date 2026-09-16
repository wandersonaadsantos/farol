// A chave da limpeza protegida (7.C2, decisão D-b) e o alcance da limpeza.
//
// Ligar a chave NÃO pede senha, de propósito: ligar não apaga nada, e pedir senha num
// momento inofensivo treina a pessoa a digitar sem ler justamente no momento que importa.
// A senha é pedida no clique em apagar. Este arquivo prova as duas metades: que ligar não
// pede senha, e que ligar, sozinho, não apaga nada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2b-limpeza-chave-'));
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
const limpeza = (await import('../lib/sync/limpeza.js')).default;
const limpezaEngine = await import('../lib/engine/sync-limpeza.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
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
    aceitarAdmin: true, deviceName: 'Notebook', apiKey: API_KEY, databaseUrl: fake.url, projectId: 'farol-local', ...extra,
  };
}

async function motorAdmin() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg() });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  return e;
}

function controle() {
  const t = fake.tree();
  const live = t && t.users && t.users.u1 ? t.users.u1.live : null;
  return (live && live.control) || {};
}

function adminDoBanco() { return controle().admin; }

function autoridade({ fresca = true } = {}) {
  return { fresca, agora: 1000, intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS, ultimaMudancaEm: 1000 };
}

test('a lista de alcance é positiva: proibido e inventado ficam fora', () => {
  for (const no of limpeza.PROIBIDOS) {
    assert.equal(limpeza.alcancavel(no), false, no);
    assert.equal(limpeza.alcancavel(`${no}/alguma/coisa`), false, `${no} em profundidade`);
  }
  assert.equal(limpeza.alcancavel('no/que/ninguem/reviu'), false, 'nó novo é preservado por omissão');
  assert.equal(limpeza.alcancavel(''), false);
  for (const cat of limpeza.CATEGORIAS) assert.equal(limpeza.alcancavel(cat), true, cat);
  assert.equal(limpeza.alcancavel('live/groups/abc'), true, 'filho de categoria entra junto');
});

test('pedido com categoria proibida não recusa o pacote: só o proibido some', () => {
  const pedidas = ['live/groups', 'keyring', 'leases', 'usageEvents'];
  assert.deepEqual(limpeza.categoriasAlcancaveis(pedidas), ['live/groups', 'usageEvents']);
  assert.deepEqual(limpeza.categoriasAlcancaveis(null), limpeza.CATEGORIAS, 'sem pedido, o alcance inteiro');
});

test('a trava vence em dez minutos, e vencida não segura ninguém', () => {
  const t = limpeza.formaDaTrava({ dev: 'd1', agora: 1000 });
  assert.deepEqual(Object.keys(t).sort(), ['dev', 'x']);
  assert.equal(t.x, 1000 + SYNC.LIMPEZA_TRAVA_MS);
  assert.equal(limpeza.travaViva(t, 1000 + SYNC.LIMPEZA_TRAVA_MS - 1), true);
  assert.equal(limpeza.travaViva(t, 1000 + SYNC.LIMPEZA_TRAVA_MS + 1), false, 'ato interrompido não trava o conjunto para sempre');
});

test('ligar a chave não pede senha e publica assinado', async () => {
  const e = await motorAdmin();
  const r = await e.syncChaveDeLimpeza({ ligada: true });
  assert.equal(r.ok, true, r.motivo);
  const no = controle().cleanup;
  assert.deepEqual(Object.keys(no).sort(), ['enabled', 'generation', 'rev', 'sig']);
  assert.equal(no.enabled, true);
  assert.equal(no.rev, 1);
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no, admin: adminDoBanco(), autoridade: autoridade() }), true);
});

test('ligar a chave, sozinho, não apaga nada', async () => {
  const e = await motorAdmin();
  const arvore = fake.tree();
  arvore.users.u1.usageEvents = { d1: { e1: { at: 1, kind: 'review', costUsd: 1 } } };
  arvore.users.u1.keyring = { v: 1, rev: 1 };
  fake.setTree(arvore);
  await e.syncChaveDeLimpeza({ ligada: true });
  const t = fake.tree();
  assert.ok(t.users.u1.usageEvents.d1.e1, 'o conteúdo alcançável continua lá');
  assert.ok(t.users.u1.keyring, 'e o proibido também');
});

test('nó ausente, assinatura de outro admin ou geração antiga contam como desligada', async () => {
  const e = await motorAdmin();
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no: null, admin: adminDoBanco(), autoridade: autoridade() }), false);
  await e.syncChaveDeLimpeza({ ligada: true });
  const no = controle().cleanup;
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no: { ...no, sig: 'x'.repeat(86) }, admin: adminDoBanco(), autoridade: autoridade() }), false, 'assinatura que não fecha');
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no: { ...no, generation: 9 }, admin: adminDoBanco(), autoridade: autoridade() }), false, 'geração antiga');
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no, admin: adminDoBanco(), autoridade: autoridade({ fresca: false }) }), false, 'admin sem sinal de vida');
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no: { ...no, enabled: 'sim' }, admin: adminDoBanco(), autoridade: autoridade() }), false, 'só true liga');
});

// O rev repetido ser RECUSADO é regra do banco, e está em test/sync-rules-contrato.js;
// aqui se prova o lado do cliente: o rev sempre anda para cima.
test('desligar a chave anda o rev para cima', async () => {
  const e = await motorAdmin();
  await e.syncChaveDeLimpeza({ ligada: true });
  const r = await e.syncChaveDeLimpeza({ ligada: false });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(controle().cleanup.enabled, false);
  assert.equal(controle().cleanup.rev, 2, 'o rev só anda para cima');
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no: controle().cleanup, admin: adminDoBanco(), autoridade: autoridade() }), false);
});

test('quem não é admin da geração vigente não mexe na chave', async () => {
  const e = await motorAdmin();
  const arvore = fake.tree();
  arvore.users.u1.live.control.admin = { deviceId: 'dOutro', generation: 7, publicKey: 'x'.repeat(43), setAt: 1 };
  fake.setTree(arvore);
  const r = await e.syncChaveDeLimpeza({ ligada: true });
  assert.equal(r.code, 'nao-e-admin');
  assert.equal(controle().cleanup, undefined);
});

// `valorDaChave` normaliza `enabled` antes de assinar, então um nó DESLIGADO com o campo
// trocado por um valor truthy continua com assinatura válida. O que segura esse caso é a
// exigência de `true` explícito, e só um nó assim a exercita.
test('valor truthy no lugar de true não liga a chave, mesmo com assinatura boa', async () => {
  const e = await motorAdmin();
  await e.syncChaveDeLimpeza({ ligada: false });
  const desligada = controle().cleanup;
  const adulterada = { ...desligada, enabled: 'sim' };
  assert.equal(limpezaEngine.chaveDeLimpezaLigada(e, { no: adulterada, admin: adminDoBanco(), autoridade: autoridade() }), false);
});
