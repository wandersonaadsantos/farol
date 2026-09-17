// Teto do grupo ativo (7.C4b), com o banco falso: os critérios de aceite da entrega.
//
// Os outros aparelhos entram pelo que eles deixariam no banco: o rollup diário em claro e
// a capacidade cifrada com a mesma chave do conjunto.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c4b-grupo-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { fixarMemoriaLivre, restaurarMemoriaLivre } from './helpers/memoria-livre.js';
import { SYNC, ATIVACAO_TETO_GRUPO_C4B } from '../lib/constants.js';

// a admissão recusa abaixo do piso de memória: sem fixar, a memória da máquina decide
fixarMemoriaLivre();

const { Engine } = await import('../server.js');
const cgEng = (await import('../lib/engine/sync-consumo-grupo.js')).default;
const publicacao = (await import('../lib/engine/sync-publicacao.js')).default;
const aceite = (await import('../lib/engine/sync-aceite.js')).default;
const vinculo = (await import('../lib/sync/vinculo.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
const reviewMod = (await import('../lib/engine/review.js')).default;
const { brasiliaDay } = await import('../lib/sync/keys.js');

const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-de-teste';
const LOGIN = 'wandersonaadsantos';
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
const G = 'c'.repeat(32);
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
beforeEach(() => {
  fake.setTree(null);
  vinculo.apagarVinculos();
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

const PERFIL = { id: 'p1', label: 'Principal', kind: 'claude' };

// Motor com um grupo ATIVO aceito, o perfil vinculado e dB na frota.
async function motorComGrupo({ tetoUsd = 10, periodo = 'dia', tipo = 'assinatura', perfil = PERFIL, vincular = true } = {}) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.emit = () => true;
  e.sync.fetchImpl = fetchDosDubles;
  e.updateSettings({ sync: syncCfg(), accounts: [{ user: LOGIN, owners: ['org'] }] });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal((await e.syncUnlock({ password: SENHA })).ok, true);
  e.sync.devices = { dB: { contract: 2, keyReady: true, lastSeenAt: Date.now() } };
  e.sync.autoridade = fresca();
  e.doctorInfo = { claude: '1.0.0', ghAuth: true };
  e.sync.lastPresenceAt = Date.now();
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  e.ativacaoTetoGrupo = true;
  const pub = await e.syncPublicarGrupo({ grupo: { id: G, nome: 'Time', periodo, tetoUsd, ativo: true } });
  assert.equal(pub.ok, true, pub.motivo);
  e.sync.autoridade = fresca();
  const r = await aceite.cicloDoAceite(e, e.config.sync);
  assert.equal(r.grupos[G].ok, true);
  e.profileOfAccount = () => perfil;
  if (vincular) assert.equal(vinculo.vincular(perfil.id, { grupo: G, tipo, agora: Date.now() - 1000 }), true);
  e.usageSessions = { sessions: [] };
  return e;
}

const HOJE = () => brasiliaDay(Date.now());

async function rollupDe(e, dev, { seq = 1, c = 0, d = 0, t = 2 } = {}) {
  const w = await e.sync.client.put(`/users/u1/usageDaily/${dev}/${HOJE()}`, { v: 1, u: Date.now(), seq, g: { [G]: { c, s: seq, d, t } } }, {});
  assert.equal(w.ok, true);
}

async function capacidadeDe(e, dev, { seq = 1, reservas = 0, u = Date.now() } = {}) {
  const caminho = `live/deviceStatus/${dev}`;
  const consumo = { seq, dia: HOJE(), grupos: reservas ? { [G]: reservas } : {} };
  const cif = envelope.cifrar({
    uid: e.sync.uid, caminho, campo: 'capacidade', no: 'live/deviceStatus', esquema: 'cap1',
    cur: e.sync.cur, material: e.sync.material, r: 1, dados: { c: { consumo } },
  });
  assert.equal(cif.ok, true);
  const w = await e.sync.client.put(`/users/u1/${caminho}`, { v: 1, u, enc: cif.enc }, {});
  assert.equal(w.ok, true);
}

test('a ativação nasce protegida: sem a medição, o grupo ativo não barra nada', async () => {
  assert.equal(ATIVACAO_TETO_GRUPO_C4B, false);
  const e = await motorComGrupo();
  await rollupDe(e, 'dB', { c: 50 });
  await capacidadeDe(e, 'dB');
  e.ativacaoTetoGrupo = false;
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.statusDoGrupo(e, LOGIN), null);
  assert.equal(e.budgetBlockedFor(LOGIN), null);
  const tela = cgEng.resumoParaTela(e);
  assert.deepEqual(tela[0].requisitos, ['medicao-pendente'], 'a tela sabe por que não oferece ativar');
});

test('o consumo de B no mesmo grupo barra a admissão em A', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB', { c: 12 });
  await capacidadeDe(e, 'dB');
  await cgEng.recalcular(e, e.config.sync);
  const st = cgEng.statusDoGrupo(e, LOGIN);
  assert.equal(st.bloqueado, true);
  assert.equal(st.motivo, 'diario');
  assert.equal(e.budgetBlockedFor(LOGIN).id, `grupo:${G}`);
  assert.equal(e._avisoDeOrcamentoAindaVale(`grupo:${G}`), true, 'o aviso único segue valendo enquanto o grupo barra');
});

test('abaixo do teto, nada barra', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB', { c: 2 });
  await capacidadeDe(e, 'dB');
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.statusDoGrupo(e, LOGIN).bloqueado, false);
  assert.equal(e.budgetBlockedFor(LOGIN), null);
  assert.equal(e._avisoDeOrcamentoAindaVale(`grupo:${G}`), false);
});

test('reservas vivas de três aparelhos admitindo ao mesmo tempo são somadas', async () => {
  const e = await motorComGrupo({ tetoUsd: 7 });
  e.sync.devices = { dB: { contract: 2, keyReady: true }, dC: { contract: 2, keyReady: true }, dD: { contract: 2, keyReady: true } };
  for (const dev of ['dB', 'dC', 'dD']) {
    await rollupDe(e, dev, { c: 0, t: 2 });
    await capacidadeDe(e, dev, { reservas: 1 });
  }
  await cgEng.recalcular(e, e.config.sync);
  const st = cgEng.statusDoGrupo(e, LOGIN);
  assert.equal(st.bloqueado, true, 'três reservas de US$ 2 mais a candidata passam de US$ 7');
  assert.equal(st.motivo, 'diario-previsto');
  assert.equal(st.projecaoUsd, 6);
  e.sync.devices = { dB: { contract: 2, keyReady: true }, dC: { contract: 2, keyReady: true } };
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.statusDoGrupo(e, LOGIN).bloqueado, false, 'com duas, cabe');
});

test('a reserva local também entra na conta', async () => {
  const e = await motorComGrupo({ tetoUsd: 5 });
  await rollupDe(e, 'dB', { c: 0, t: 2 });
  await capacidadeDe(e, 'dB', { reservas: 1 });
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.statusDoGrupo(e, LOGIN).bloqueado, false);
  e.admissao = { reservas: new Map([['adm1', { id: 'adm1', grupo: G, estado: 'execucao' }]]), seq: 1 };
  assert.equal(cgEng.statusDoGrupo(e, LOGIN).bloqueado, true);
});

test('evento de valor desconhecido usa a reserva e marca parcialmente estimado', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB', { c: 1, d: 1 });
  await capacidadeDe(e, 'dB');
  await cgEng.recalcular(e, e.config.sync);
  const st = cgEng.statusDoGrupo(e, LOGIN);
  assert.equal(st.naoVerificavel, false);
  assert.equal(st.parcialmenteEstimado, true);
  assert.equal(cgEng.resumoParaTela(e)[0].parcialmenteEstimado, true);
});

test('lacuna deixa o orçamento não verificável e segura o automático e o clique, sem estacionar', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB', { seq: 1 });
  await capacidadeDe(e, 'dB', { seq: 3 });
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(e.grupoSegura(LOGIN), 'lacuna');
  assert.equal(e.budgetBlockedFor(LOGIN), null, 'não verificável não é estouro: não entra no fluxo que estaciona');
  const iniciadas = [];
  Object.assign(e, { headlessQueue: [{ key: 'org/r#1', manual: true }], headlessBusyAccounts: new Map() });
  e.accountForPr = () => LOGIN;
  e.runOneHeadless = (pr) => iniciadas.push(pr.key);
  reviewMod.processHeadless(e);
  assert.deepEqual(iniciadas, [], 'o clique também não atravessa');
  assert.equal(e.headlessQueue.length, 1, 'o PR espera na fila');
  assert.equal(e.autoReviewParked.size, 0, 'nada estacionado');
});

test('evento inválido também deixa não verificável', async () => {
  const e = await motorComGrupo();
  await e.sync.client.put(`/users/u1/usageDaily/dB/${HOJE()}`, { v: 1, u: Date.now(), seq: 1, g: { [G]: { c: 'muito', s: 1, d: 0 } } }, {});
  await capacidadeDe(e, 'dB');
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(e.grupoSegura(LOGIN), 'invalido');
});

test('outra conta, sem teto de grupo que a segure, continua saindo', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB', { seq: 1 });
  await capacidadeDe(e, 'dB', { seq: 3 });
  await cgEng.recalcular(e, e.config.sync);
  const iniciadas = [];
  Object.assign(e, { headlessQueue: [{ key: 'org/r#1' }, { key: 'outra/r#2' }], headlessBusyAccounts: new Map() });
  e.accountForPr = (pr) => (pr.key.startsWith('outra') ? 'outra-conta' : LOGIN);
  e.profileOfAccount = (acct) => (acct === LOGIN ? PERFIL : { id: 'codex1', kind: 'codex' });
  e.runOneHeadless = (pr) => iniciadas.push(pr.key);
  reviewMod.processHeadless(e);
  assert.deepEqual(iniciadas, ['outra/r#2'], 'a conta segurada não trava a fila das outras');
});

test('Codex aparece como não controlado', async () => {
  const e = await motorComGrupo({ perfil: { id: 'cx', label: 'Codex', kind: 'codex' }, tipo: 'codex' });
  await rollupDe(e, 'dB', { c: 99 });
  await capacidadeDe(e, 'dB');
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.statusDoGrupo(e, LOGIN), null);
  const tela = cgEng.resumoParaTela(e)[0];
  assert.deepEqual(tela.naoControlados, ['cx']);
  assert.deepEqual(tela.controlados, []);
});

// O tipo do VÍNCULO também decide: um perfil medido pode estar vinculado como tipo sem
// métrica, e aí o grupo não controla aquele consumo.
test('vínculo de tipo não controlado fica fora do teto, mesmo com perfil medido', async () => {
  const e = await motorComGrupo({ tipo: 'codex' });
  await rollupDe(e, 'dB', { c: 99 });
  await capacidadeDe(e, 'dB');
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.statusDoGrupo(e, LOGIN), null, 'perfil claude vinculado como codex não é controlado');
  assert.equal(e.budgetBlockedFor(LOGIN), null);
});

test('rotação de credencial não zera a contagem', async () => {
  const e = await motorComGrupo({ tetoUsd: 100 });
  e.usageSessions = { sessions: [{ id: 's1', at: Date.now(), day: HOJE(), kind: 'review', profileId: 'p1', costUsd: 4, costSource: 'medido' }] };
  await capacidadeDe(e, 'dB', { seq: 0 });
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.resumoParaTela(e)[0].custoUsd, 4);
  // a chave troca, o vínculo não: revincular ao mesmo grupo não abre intervalo novo
  vinculo.vincular('p1', { grupo: G, tipo: 'assinatura', agora: Date.now() });
  e.usageSessions.sessions.push({ id: 's2', at: Date.now() + 1, day: HOJE(), kind: 'review', profileId: 'p1', costUsd: 2, costSource: 'medido' });
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(cgEng.resumoParaTela(e)[0].custoUsd, 6, 'os US$ 4 de antes da rotação continuam contando');
  assert.equal(vinculo.historicoDoVinculo('p1').length, 1, 'nenhum intervalo novo');
});

test('perfil sem vínculo não escapa do teto ativo', async () => {
  const e = await motorComGrupo({ vincular: false });
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(e.grupoSegura(LOGIN), 'perfil-nao-identificado');
});

test('retrato velho não decide nada', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB');
  await capacidadeDe(e, 'dB');
  await cgEng.recalcular(e, e.config.sync, { agora: Date.now() - SYNC.GRUPO_RETRATO_MAX_MS - 1000 });
  assert.equal(e.grupoSegura(LOGIN), 'retrato-velho');
});

test('reserva anunciada por aparelho que sumiu vira cobertura incompleta', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB');
  await capacidadeDe(e, 'dB', { reservas: 1, u: Date.now() - SYNC.RESERVA_GRUPO_TTL_MS - 1000 });
  await cgEng.recalcular(e, e.config.sync);
  assert.equal(e.grupoSegura(LOGIN), 'reserva-vencida');
});

test('o rollup local sobe uma vez por mudança, e a capacidade anuncia a mesma sequência', async () => {
  const e = await motorComGrupo();
  e.usageSessions = { sessions: [
    { id: 's1', at: Date.now(), kind: 'review', profileId: 'p1', costUsd: 3, costSource: 'medido' },
    { id: 's2', at: Date.now() + 1, kind: 'chat', profileId: 'p1', costUsd: 0, costSource: 'sem-base' },
    { id: 's3', at: Date.now() + 2, kind: 'review', profileId: 'sem-grupo', costUsd: 9, costSource: 'medido' },
  ] };
  const r = await cgEng.publicarRollups(e, e.config.sync);
  assert.deepEqual(r.escritas, [HOJE()]);
  const no = fake.tree().users.u1.usageDaily[e.sync.deviceId][HOJE()];
  assert.equal(no.seq, 2, 'só as sessões com grupo contam');
  assert.deepEqual(no.g[G], { c: 3, s: 2, d: 1, t: 3 });
  assert.deepEqual((await cgEng.publicarRollups(e, e.config.sync)).escritas, [], 'sem mudança, sem escrita');
  assert.deepEqual(cgEng.consumoParaCapacidade(e), { seq: 2, dia: HOJE(), grupos: {} });
});

test('falha ao subir o rollup não avança: o próximo giro tenta de novo', async () => {
  const e = await motorComGrupo();
  e.usageSessions = { sessions: [{ id: 's1', at: Date.now(), kind: 'review', profileId: 'p1', costUsd: 3, costSource: 'medido' }] };
  const put = e.sync.client.put;
  e.sync.client.put = async () => ({ ok: false, code: 'indisponivel' });
  try {
    assert.equal((await cgEng.publicarRollups(e, e.config.sync)).ok, false);
  } finally {
    e.sync.client.put = put;
  }
  assert.deepEqual((await cgEng.publicarRollups(e, e.config.sync)).escritas, [HOJE()]);
});

test('boca da sessão: não verificável volta à fila sem estacionar e sem rodar', async () => {
  const e = await motorComGrupo();
  await rollupDe(e, 'dB', { seq: 1 });
  await capacidadeDe(e, 'dB', { seq: 3 });
  await cgEng.recalcular(e, e.config.sync);
  e.accountForPr = () => LOGIN;
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => assert.fail('não pode rodar');
  e.headlessBusyAccounts = new Map([[LOGIN, 1]]);
  e.queue = [];
  await reviewMod.runOneHeadless(e, { key: 'org/r#9' }, LOGIN);
  assert.deepEqual(e.queue.map((p) => p.key), ['org/r#9']);
  assert.equal(e.autoReviewParked.size, 0);
  assert.equal(e.headlessBusyAccounts.get(LOGIN) || 0, 0, 'a vaga foi devolvida');
});

// É a capacidade que leva a sequência e as reservas deste aparelho aos outros: sem ela no
// nó, ninguém enxerga lacuna nem reserva alheia.
test('a capacidade publicada leva o consumo do grupo', async () => {
  const e = await motorComGrupo();
  e.usageSessions = { sessions: [{ id: 's1', at: Date.now(), kind: 'review', profileId: 'p1', costUsd: 1, costSource: 'medido' }] };
  e.admissao = { reservas: new Map([['adm1', { id: 'adm1', grupo: G, estado: 'reserva' }]]), seq: 1 };
  const cap = publicacao.capacidadeDe(e, e.config.sync);
  assert.deepEqual(cap.consumo, { seq: 1, dia: HOJE(), grupos: { [G]: 1 } });
});

test('o relógio roda o rollup e o retrato antes da capacidade', async () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/sync-andamento.js', import.meta.url), 'utf8');
  const i = fonte.indexOf('consumoGrupo.cicloDoConsumoDoGrupo(engine, cfg, { agora })');
  assert.ok(i > 0);
  assert.ok(i < fonte.indexOf('publicacao.publicarCapacidade(engine, cfg)'));
});
