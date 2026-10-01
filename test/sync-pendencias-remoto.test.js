// "Precisa de você" em todos os aparelhos (7.C3, D3): publicar, ler, avisar e o visto.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3c-pendencias-'));
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
const pend = await import('../lib/engine/sync-pendencias.js');
const envelope = (await import('../lib/sync/envelope.js')).default;

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



function pendenciaLocal(e, id = 'd1', extra = {}) {
  e.decisions.pending.push({
    id, createdAt: 1_800_000_000_000, key: 'dono/repo#12', verdict: 'approve',
    pr: { repo: 'dono/repo', number: 12, title: 'Titulo secreto', account: LOGIN },
    reasons: [{ text: 'aguarda sua aprovação', kind: 'gate' }], reportMarkdown: 'RELATORIO INTERNO', ...extra,
  });
}

function no(nome) {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1.live && t.users.u1.live[nome]) || {};
}

// um segundo "aparelho" com a mesma chave, para ler o que o primeiro publicou. Task 9
// (28/09/2026): o AVISO da frota (o `emit('sync-pending', ...)`) só sai pro admin, então por
// padrão este segundo aparelho nasce admin de si mesmo (`admin: false` monta um executor
// comum, que lê e marca visto por dentro mas não recebe o evento pra própria tela).
function outroAparelho(e, { admin = true } = {}) {
  const rt = {
    ...e.sync, deviceId: 'dOutro', pendenciasPublicadas: new Map(), pendenciasNotificadas: new Set(),
    sinais: { admin: { dev: admin ? 'dOutro' : e.sync.deviceId } },
  };
  rt.devices = { [e.sync.deviceId]: { contract: 2, keyReady: true, lastSeenAt: Date.now(), name: 'Notebook' } };
  const eventos = [];
  return { config: e.config, sync: rt, decisions: { pending: [] }, emit: (n, p) => eventos.push([n, p]), eventos };
}

test('sem frota nada sobe', async () => {
  const e = await motorPronto({ comFrota: false });
  pendenciaLocal(e);
  assert.equal((await pend.sincronizarPendencias(e, e.config.sync)).code, 'sem-frota');
  assert.deepEqual(no('pending'), {});
});

test('a pendência sobe cifrada, sem relatório, título nem login', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const r = await pend.sincronizarPendencias(e, e.config.sync);
  assert.equal(r.escritas.length, 1);
  const item = no('pending')[r.escritas[0]];
  assert.deepEqual(Object.keys(item).sort(), ['at', 'dev', 'enc', 'v']);
  assert.equal(item.at, 1_800_000_000_000, 'at é o instante da decisão, e não muda');
  const cru = JSON.stringify(fake.tree());
  for (const p of ['RELATORIO', 'Titulo secreto', 'dono/repo', LOGIN, 'aguarda sua']) assert.equal(cru.includes(p), false, p);
});

test('republicar sem mudança não escreve; a pendência resolvida é apagada', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const { escritas: [id] } = await pend.sincronizarPendencias(e, e.config.sync);
  assert.deepEqual((await pend.sincronizarPendencias(e, e.config.sync)).escritas, []);
  e.decisions.pending.length = 0;
  const r = await pend.sincronizarPendencias(e, e.config.sync);
  assert.deepEqual(r.apagadas, [id]);
  assert.equal(no('pending')[id], undefined);
});

// 25/09/2026: três nós do admin ficaram no banco com zero pendências locais, o mais velho
// de 18/09. Resolvidas com o Firebase fora do ar e seguidas de um reinício, que zera o mapa
// do que esta sessão publicou: o apagar de sincronizarPendencias nunca mais as alcançava.
test('pendência resolvida antes de um reinício sai do banco pela conferência contra ele', async () => {
  const e = await motorPronto();
  pendenciaLocal(e, 'resolvida');
  pendenciaLocal(e, 'aberta');
  const { escritas } = await pend.sincronizarPendencias(e, e.config.sync);
  assert.equal(escritas.length, 2);
  // o reinício: memória nova, e a pendência foi resolvida enquanto ninguém apagava
  e.sync.pendenciasPublicadas = new Map();
  e.decisions.pending = e.decisions.pending.filter((p) => p.id === 'aberta');
  assert.deepEqual((await pend.sincronizarPendencias(e, e.config.sync)).apagadas, [], 'a memória sozinha não alcança a sobra');
  assert.equal(Object.keys(no('pending')).length, 2);
  const apagadas = await pend.apagarOrfas(e, e.config.sync, no('pending'));
  assert.equal(apagadas.length, 1);
  const restam = Object.keys(no('pending'));
  assert.equal(restam.length, 1, 'a pendência ainda aberta continua publicada');
  assert.equal(pend.aplicarPendencias(outroAparelho(e), no('pending'), {}).lista.length, 1,
    'o outro aparelho deixa de ver a resolvida');
});

test('a conferência nunca apaga o nó de outro aparelho', async () => {
  const e = await motorPronto();
  const alheio = { v: 1, at: 1_800_000_000_000, dev: 'dOutro', enc: 'e1.g1.aaaa.bbbb.cccc' };
  fake.setTree({ users: { u1: { live: { pending: { abc123: alheio } } } } });
  assert.deepEqual(await pend.apagarOrfas(e, e.config.sync, no('pending')), []);
  assert.deepEqual(no('pending').abc123, alheio);
});

test('sem frota a conferência não apaga nada', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  await pend.sincronizarPendencias(e, e.config.sync);
  e.decisions.pending.length = 0;
  e.sync.devices = { dOutro: { contract: 1, keyReady: false, lastSeenAt: Date.now() } };
  assert.deepEqual(await pend.apagarOrfas(e, e.config.sync, no('pending')), []);
  assert.equal(Object.keys(no('pending')).length, 1);
});

test('o outro aparelho lê, é avisado uma vez, e o próprio não aparece para si', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  await pend.sincronizarPendencias(e, e.config.sync);
  assert.deepEqual(pend.lerPendencias(e, no('pending'), {}), [], 'o próprio não aparece');
  const b = outroAparelho(e);
  const primeira = pend.aplicarPendencias(b, no('pending'), {});
  assert.equal(primeira.lista.length, 1);
  assert.equal(primeira.lista[0].veredito, 'approve');
  assert.equal(primeira.lista[0].aparelho, 'Notebook');
  assert.equal(primeira.lista[0].motivos[0].text, 'aguarda sua aprovação');
  assert.equal(primeira.novas.length, 1);
  assert.equal(pend.aplicarPendencias(b, no('pending'), {}).novas.length, 0, 'avisa uma vez só');
  assert.equal(b.eventos[0][0], 'sync-pending');
});

// Task 9 (28/09/2026): o aviso da frota é só do admin. Quem não é admin lê e marca como
// notificado por dentro (a lista e o "avisa uma vez" continuam certos), mas o evento pra
// própria tela nunca sai: nada da frota chega à interface de quem não decide por ela.
test('quem não é admin lê e marca como notificado, mas não recebe o evento pra própria tela', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  await pend.sincronizarPendencias(e, e.config.sync);
  const b = outroAparelho(e, { admin: false });
  const primeira = pend.aplicarPendencias(b, no('pending'), {});
  assert.equal(primeira.lista.length, 1, 'a leitura e a marcação continuam acontecendo');
  assert.equal(primeira.novas.length, 1);
  assert.deepEqual(b.eventos, [], 'sem admin, sem sync-pending pra própria tela');
  assert.equal(pend.aplicarPendencias(b, no('pending'), {}).novas.length, 0, 'o "avisa uma vez" vale por dentro mesmo sem emitir');
  assert.deepEqual(b.eventos, [], 'continua sem evento no ciclo seguinte');
});

test('visto em um aparelho cala o aviso no outro (D3)', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const { escritas: [id] } = await pend.sincronizarPendencias(e, e.config.sync);
  const r = await pend.marcarVisto(e, e.config.sync, id, { agora: 5 });
  assert.equal(r.gravado, true);
  assert.deepEqual(no('seen')[id], { at: 5, dev: e.sync.deviceId });
  const b = outroAparelho(e);
  const lido = pend.aplicarPendencias(b, no('pending'), no('seen'));
  assert.equal(lido.novas.length, 0, 'já visto noutro aparelho não avisa');
  assert.equal(lido.lista[0].visto, true);
});

test('o visto é gravado uma vez só: o segundo encontra o nó e não sobrescreve', async () => {
  const e = await motorPronto();
  const id = 'ab12';
  assert.equal((await pend.marcarVisto(e, e.config.sync, id, { agora: 5 })).gravado, true);
  const segundo = await pend.marcarVisto(e, e.config.sync, id, { agora: 9 });
  assert.equal(segundo.ok, true);
  assert.equal(segundo.gravado, false);
  assert.equal(no('seen')[id].at, 5, 'o primeiro visto vale');
  assert.equal((await pend.marcarVisto(e, e.config.sync, '../x')).code, 'forma');
});

test('item que não decifra some, e dev trocado não decifra', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  const { escritas: [id] } = await pend.sincronizarPendencias(e, e.config.sync);
  const b = outroAparelho(e);
  const arvore = no('pending');
  assert.deepEqual(pend.lerPendencias(b, { [id]: { ...arvore[id], at: 1 } }, {}), [], 'at fora da AAD');
  assert.deepEqual(pend.lerPendencias(b, { [id]: { ...arvore[id], enc: 'e1.g1.AAAA.BBBB.CCCC' } }, {}), []);
});

test('visto sai quando a pendência some; com a pendência viva, fica', async () => {
  const e = await motorPronto();
  const arvore = fake.tree() || { users: { u1: {} } };
  arvore.users.u1.live = { pending: { aa: { v: 1 } }, seen: { aa: { at: Date.now(), dev: 'x' }, bb: { at: Date.now(), dev: 'x' } } };
  fake.setTree(arvore);
  const feitos = await pend.limparVistos(e, no('pending'), no('seen'));
  assert.deepEqual(feitos, ['bb']);
  assert.ok(no('seen').aa);
});

test('aplicar não chama pushState', async () => {
  const e = await motorPronto();
  let empurrou = 0;
  e.pushState = () => { empurrou++; };
  pend.aplicarPendencias(e, {}, {});
  assert.equal(empurrou, 0);
});

test('o ciclo do relógio publica e lê pendências, e a rota do visto existe', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  // Task 9: o evento pra própria tela só sai do admin; este teste prova a fiação do SSE e
  // da rota do visto, então o aparelho precisa ser o admin de si mesmo para exercê-la, do
  // jeito de verdade (chave gravada no banco), senão o giro de sinais do próprio ciclo
  // desfaz um `sinais.admin` montado à mão.
  assert.equal((await e.syncTornarAdmin({ password: SENHA })).ok, true);
  const eventos = [];
  e.on('sync-pending', (p) => eventos.push(p));
  const andamentoEng = await import('../lib/engine/sync-andamento.js');
  await andamentoEng.ciclo(e, e.config.sync, { agora: Date.now() });
  assert.equal(Object.keys(no('pending')).length, 1);
  assert.equal(eventos.length, 1);
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
  assert.match(fonte, /p === '\/api\/sync\/seen'/);
  assert.match(fonte, /engine\.on\('sync-pending', p => broadcast\('sync-pending', p\)\)/);
});

test('o ciclo do relógio apaga a sobra de uma sessão anterior', async () => {
  const e = await motorPronto();
  pendenciaLocal(e);
  await pend.sincronizarPendencias(e, e.config.sync);
  e.sync.pendenciasPublicadas = new Map();
  e.decisions.pending.length = 0;
  const andamentoEng = await import('../lib/engine/sync-andamento.js');
  await andamentoEng.ciclo(e, e.config.sync, { agora: Date.now() });
  assert.deepEqual(no('pending'), {}, 'sem a fiação no relógio a função existiria e nunca rodaria');
});

/* ---------- a pendência que espera o CI (01/10/2026) ---------- */

// O aparelho dono aprova sozinho quando o CI fechar verde. O outro aparelho tem de saber
// disso para não mostrar "precisa de você" nem avisar (D3) algo que não precisa de ninguém.
const ESPERA_CI = { desde: 1_800_000_000_000, checks: [{ nome: 'ci / build-secreto', estado: 'rodando' }], pontos: [] };
const MOTIVO_DA_ESPERA = { text: 'aprovável, esperando o CI obrigatório', kind: 'gate', espera: true };

test('espera do CI: sobe só o fato, o outro aparelho lê como espera e NÃO avisa', async () => {
  const e = await motorPronto();
  pendenciaLocal(e, 'd1', { esperaCi: ESPERA_CI, reasons: [MOTIVO_DA_ESPERA] });
  const r = await pend.sincronizarPendencias(e, e.config.sync);
  assert.equal(r.escritas.length, 1, 'continua sendo publicada: o admin ainda pode aprovar na mão');
  assert.equal(JSON.stringify(fake.tree()).includes('build-secreto'), false);
  const b = outroAparelho(e);
  const lido = pend.aplicarPendencias(b, no('pending'), {});
  assert.equal(lido.lista.length, 1, 'está na lista, para a tela mostrar como espera');
  assert.equal(lido.lista[0].espera, 'ci');
  assert.equal(lido.lista[0].motivos[0].text, 'aprovável, esperando o CI obrigatório', 'o texto da espera já viaja como motivo');
  assert.deepEqual(Object.keys(lido.lista[0].motivos[0]).sort(), ['kind', 'text']);
  assert.deepEqual(lido.novas, [], 'nada a avisar: ninguém precisa fazer nada');
  assert.deepEqual(b.eventos.map(([n, p]) => [n, p.novas]), [['sync-pending', []]], 'a lista chega à tela, sem novidade que peça gente');
  assert.equal(pend.aplicarPendencias(b, no('pending'), {}).novas.length, 0);
});

test('espera largada: a mesma pendência passa a pedir gente e avisa nessa hora, uma vez', async () => {
  const e = await motorPronto();
  pendenciaLocal(e, 'd1', { esperaCi: ESPERA_CI, reasons: [MOTIVO_DA_ESPERA] });
  const { escritas: [id] } = await pend.sincronizarPendencias(e, e.config.sync);
  const b = outroAparelho(e);
  assert.deepEqual(pend.aplicarPendencias(b, no('pending'), {}).novas, []);
  // o que o largar() do espera-ci.js faz: tira a marca e põe o motivo da mesa
  Object.assign(e.decisions.pending[0], { esperaCi: null, reasons: [{ text: 'a política manda aguardar você', kind: 'gate' }] });
  assert.deepEqual((await pend.sincronizarPendencias(e, e.config.sync)).escritas, [id], 'a mudança sobe no mesmo nó');
  const depois = pend.aplicarPendencias(b, no('pending'), {});
  assert.equal(depois.lista[0].espera, '');
  assert.deepEqual(depois.novas.map((p) => p.itemId), [id], 'agora precisa de alguém, e o aviso sai');
  assert.equal(pend.aplicarPendencias(b, no('pending'), {}).novas.length, 0, 'uma vez só');
});

// O que um aparelho na 2.66.3 publica: a projeção SEM o campo. E o que não deveria chegar
// nunca: o campo com lixo. Os dois nós são cifrados como o motor cifra (mesmo nó e esquema).
function noDeOutroAparelho(e, itemId, projecao) {
  const no = { v: 1, at: 1_800_000_000_000, dev: 'dCelular' };
  const cifrado = envelope.cifrar({
    uid: e.sync.uid, caminho: `live/pending/${itemId}`, campo: 'pendencia', no: 'live/pending', esquema: 'pend1',
    cur: e.sync.cur, material: e.sync.material, r: 1, extras: [no.at, no.dev], dados: { p: projecao },
  });
  assert.equal(cifrado.ok, true, cifrado.motivo);
  return { ...no, enc: cifrado.enc };
}

test('nó de versão anterior (sem o campo) e nó com lixo no campo leem como pendência comum, e avisam', async () => {
  const e = await motorPronto();
  const antiga = { prTag: 'a'.repeat(32), acctTag: 'b'.repeat(32), veredito: 'approve', motivos: [{ text: 'aguarda', kind: 'gate' }], motivosOmitidos: 0, bloqueio: '', reviewId: '', acoes: ['approve', 'skip'] };
  const arvore = { aa01: noDeOutroAparelho(e, 'aa01', antiga) };
  const lixos = [true, 1, 'CI', 'qualquer', { ci: true }, ['ci'], null];
  lixos.forEach((lixo, i) => { arvore[`bb0${i}`] = noDeOutroAparelho(e, `bb0${i}`, { ...antiga, espera: lixo }); });
  const lido = pend.aplicarPendencias(e, arvore, {});
  assert.equal(lido.lista.length, 1 + lixos.length, 'nenhum nó é descartado');
  for (const p of lido.lista) assert.equal(p.espera, '', p.itemId);
  assert.equal(lido.novas.length, 1 + lixos.length, 'todos pedem gente, como antes desta versão');
  assert.equal(lido.lista.find((p) => p.itemId === 'aa01').veredito, 'approve', 'o resto da projeção segue intacto');
});
