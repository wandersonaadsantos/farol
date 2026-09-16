// O grupo de consumo no banco (CT-GRUPO): publicado pelo admin, aceito pelo consumidor.
//
// O caso que mais importa aqui é o que prova uma NÃO ação: aceitar um teto de zero dólar
// não pode barrar nada, porque configurar e ativar são passos separados e a ativação é da
// C4b. Um teto que já barrasse aqui passaria por cima das quatro condições que a spec
// exige antes de ligar o gate.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2b-grupo-'));
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
const grupos = await import('../lib/engine/sync-grupo.js');
const grupo = (await import('../lib/sync/grupo.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
const noAssinado = (await import('../lib/sync/no-assinado.js')).default;
const ak = await import('../lib/sync/admin-chave.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const ID = 'a'.repeat(32);
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

async function motorAdmin(cfg = syncCfg()) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: cfg });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  return e;
}

function noPublicado(id = ID) {
  const t = fake.tree();
  const live = t && t.users && t.users.u1 ? t.users.u1.live : null;
  return (live && live.groups && live.groups[id]) || null;
}

function adminDoBanco() {
  return fake.tree().users.u1.live.control.admin;
}

function autoridade({ fresca = true } = {}) {
  return { fresca, agora: 1000, intervaloMs: SYNC.AUTORIDADE_INTERVALO_MS, ultimaMudancaEm: 1000 };
}

const GRUPO = { id: ID, nome: 'Casa', periodo: 'dia', tetoUsd: 12.5 };

test('publicar: o nó sobe cifrado e assinado, e o teto não aparece em claro', async () => {
  const e = await motorAdmin();
  const r = await e.syncPublicarGrupo({ grupo: GRUPO });
  assert.equal(r.ok, true, r.motivo);
  const no = noPublicado();
  assert.deepEqual(Object.keys(no).sort(), ['enc', 'generation', 'sig', 'v']);
  assert.match(no.enc, /^e1\.g1\./);
  const cru = JSON.stringify(no);
  assert.equal(cru.includes('12.5'), false, 'o teto em claro no banco');
  assert.equal(cru.includes('Casa'), false, 'o nome em claro no banco');
});

// C4b: o admin não publica `ativo` sem os requisitos, e a liberação da medição não vem de
// rota nem de config: é propriedade em memória do engine, só para teste.
test('publicar ativo: recusado sem a medição, aceito com ela', async () => {
  const e = await motorAdmin();
  const r = await e.syncPublicarGrupo({ grupo: { ...GRUPO, ativo: true } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ativacao-bloqueada');
  assert.match(r.motivo, /medi/);
  assert.equal(noPublicado(), null, 'nada subiu');
  e.ativacaoTetoGrupo = true;
  assert.equal((await e.syncPublicarGrupo({ grupo: { ...GRUPO, ativo: true } })).ok, true);
  assert.equal((await e.syncPublicarGrupo({ grupo: { ...GRUPO, id: 'e'.repeat(32), ativo: false } })).ok, true, 'desativar nunca é bloqueado');
});

test('publicar ativo sem teto é recusado mesmo com a medição', async () => {
  const e = await motorAdmin();
  e.ativacaoTetoGrupo = true;
  const r = await e.syncPublicarGrupo({ grupo: { id: ID, nome: 'Casa', ativo: true } });
  assert.equal(r.code, 'ativacao-bloqueada');
});

test('a liberação da ativação nasce desligada', async () => {
  const { ATIVACAO_TETO_GRUPO_C4B } = await import('../lib/constants.js');
  assert.equal(ATIVACAO_TETO_GRUPO_C4B, false);
});

test('publicar: quem não é admin da geração vigente não publica', async () => {
  const e = await motorAdmin();
  const arvore = fake.tree();
  arvore.users.u1.live.control.admin = { deviceId: 'dOutro', generation: 7, publicKey: 'x'.repeat(43), setAt: 1 };
  fake.setTree(arvore);
  const r = await e.syncPublicarGrupo({ grupo: GRUPO });
  assert.equal(r.code, 'nao-e-admin');
  assert.equal(noPublicado(), null);
});

test('aceitar: grupo assinado e fresco entra, e volta saneado', async () => {
  const e = await motorAdmin();
  await e.syncPublicarGrupo({ grupo: { ...GRUPO, desligarGates: true } });
  const r = grupos.aceitarGrupo(e, syncCfg(), { no: noPublicado(), admin: adminDoBanco(), autoridade: autoridade(), id: ID });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual(r.grupo, { id: ID, nome: 'Casa', periodo: 'dia', tetoUsd: 12.5 });
  assert.deepEqual(grupos.grupoAceito(e, ID), r.grupo);
});

test('aceitar: com aceitarAdmin desligado, nada muda', async () => {
  const e = await motorAdmin();
  await e.syncPublicarGrupo({ grupo: GRUPO });
  const r = grupos.aceitarGrupo(e, syncCfg({ aceitarAdmin: false }), { no: noPublicado(), admin: adminDoBanco(), autoridade: autoridade(), id: ID });
  assert.equal(r.code, 'nao-aceita-admin');
  assert.equal(grupos.grupoAceito(e, ID), null);
});

test('aceitar: assinatura inválida é recusada ANTES de decifrar', async () => {
  const e = await motorAdmin();
  await e.syncPublicarGrupo({ grupo: GRUPO });
  const no = { ...noPublicado(), enc: 'e1.g1.AAAA.BBBB.CCCC' };
  const r = grupos.aceitarGrupo(e, syncCfg(), { no, admin: adminDoBanco(), autoridade: autoridade(), id: ID });
  assert.equal(r.code, 'assinatura', 'o envelope não pode ter sido aberto');
});

test('aceitar: sem autoridade fresca, o grupo anterior continua valendo', async () => {
  const e = await motorAdmin();
  await e.syncPublicarGrupo({ grupo: GRUPO });
  assert.equal(grupos.aceitarGrupo(e, syncCfg(), { no: noPublicado(), admin: adminDoBanco(), autoridade: autoridade(), id: ID }).ok, true);
  await e.syncPublicarGrupo({ grupo: { ...GRUPO, tetoUsd: 99 } });
  const r = grupos.aceitarGrupo(e, syncCfg(), { no: noPublicado(), admin: adminDoBanco(), autoridade: autoridade({ fresca: false }), id: ID });
  assert.equal(r.code, 'autoridade');
  assert.equal(grupos.grupoAceito(e, ID).tetoUsd, 12.5, 'o anterior sobrevive');
});

// Configurado, ainda não ativo: este é o caso que guarda a fronteira com a C4b.
test('aceitar um teto de zero dólar não barra nada: configurar não é ativar', async () => {
  const e = await motorAdmin();
  await e.syncPublicarGrupo({ grupo: { ...GRUPO, tetoUsd: 0 } });
  const r = grupos.aceitarGrupo(e, syncCfg(), { no: noPublicado(), admin: adminDoBanco(), autoridade: autoridade(), id: ID });
  assert.equal(r.grupo.tetoUsd, 0);
  assert.equal(e.config.parallel === undefined || typeof e.config.parallel === 'number', true);
  assert.equal(e.syncSeguraAutomacao('dono/repo#1'), false, 'o teto configurado não segura automação nenhuma');
  const resumo = grupo.resumoDoGrupo(r.grupo, { vinculos: {} });
  assert.equal(resumo.estado, 'configurado', 'aparece como configurado, e é só isso que ele faz');
});

// O publicador já saneia, então este caso monta o nó À MÃO, com a chave do admin, para
// simular um admin rodando versão mais nova (ou com defeito) que publica campo fora da
// allowlist. A allowlist do CONSUMIDOR é o que precisa segurar isso, e sem um nó assim ela
// nunca era exercida.
test('o consumidor saneia de novo o que veio assinado: allowlist não é só do publicador', async () => {
  const e = await motorAdmin();
  const caminho = `live/groups/${ID}`;
  const cifrado = envelope.cifrar({
    uid: e.sync.uid, caminho, campo: 'grupo', no: 'live/groups', esquema: 'grupo1',
    cur: e.sync.cur, material: e.sync.material, r: 1,
    dados: { g: { ...GRUPO, tetoUsd: -5, desligarGates: true } },
  });
  assert.equal(cifrado.ok, true, cifrado.motivo);
  const minha = ak.lerChaveDeAdmin();
  const no = noAssinado.montarNoAssinado({ jwk: minha.jwk, uid: e.sync.uid, caminho, generation: 1, versao: 1, enc: cifrado.enc });
  const r = grupos.aceitarGrupo(e, syncCfg(), { no, admin: adminDoBanco(), autoridade: autoridade(), id: ID });
  assert.equal(r.ok, true, r.motivo);
  assert.equal('desligarGates' in r.grupo, false, 'campo fora da allowlist não entra nem assinado');
  assert.equal('tetoUsd' in r.grupo, false, 'teto negativo é descartado, não vira zero');
});

// Dois aparelhos publicando ao mesmo tempo terminam com um valor só. O concorrente é
// injetado entre a leitura e a escrita, que é exatamente a janela que o CAS fecha.
test('publicação concorrente perde no ETag em vez de sobrescrever', async () => {
  const e = await motorAdmin();
  assert.equal((await e.syncPublicarGrupo({ grupo: GRUPO })).ok, true);
  const get = e.sync.client.get.bind(e.sync.client);
  let intrometido = false;
  e.sync.client.get = async (caminho, opcoes) => {
    const r = await get(caminho, opcoes);
    if (!intrometido && caminho.endsWith(`live/groups/${ID}`)) {
      intrometido = true;
      const arvore = fake.tree();
      arvore.users.u1.live.groups[ID] = { ...arvore.users.u1.live.groups[ID], v: 9 };
      fake.setTree(arvore);
    }
    return r;
  };
  const r = await e.syncPublicarGrupo({ grupo: { ...GRUPO, tetoUsd: 1 } });
  e.sync.client.get = get;
  assert.equal(r.ok, false, 'a escrita cega passaria por cima do que o outro acabou de gravar');
  assert.equal(noPublicado().v, 9, 'quem chegou primeiro continua lá');
});
