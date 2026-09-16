// Envio do historico local existente (7.C3): medido antes, confirmado pelo que foi
// medido, retomavel e sem duplicar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c3g-envio-'));
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
const envio = await import('../lib/engine/sync-envio-historico.js');
const { STATE_DIR } = await import('../lib/paths.js');

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




beforeEach(() => {
  for (const f of ['sync-historico.json', 'sync-envio.json']) {
    try { fs.rmSync(path.join(STATE_DIR, f), { force: true }); } catch { /* sem arquivo anterior */ }
  }
});

const AGORA = Date.now();

function antigas(e, n) {
  for (let i = 0; i < n; i++) {
    e.decisions.resolved.push({
      id: `h${i}`, createdAt: AGORA - 100000 + i, resolvedAt: AGORA - 90000 + i, key: `dono/repo#${i}`,
      verdict: 'approve', status: 'posted', action: 'approve', reasons: [{ text: 'm', kind: 'gate' }],
      pr: { repo: 'dono/repo', number: i, title: `Titulo ${i}`, account: LOGIN }, reportMarkdown: 'RELATORIO',
    });
  }
}

function indice() {
  const t = fake.tree();
  return (t && t.users && t.users.u1 && t.users.u1.recentReviews) || {};
}

async function pronto(n) {
  const e = await motorPronto();
  e.sync.historicoDesde = AGORA;
  antigas(e, n);
  return e;
}

test('sem frota, nem medir', async () => {
  const e = await motorPronto({ comFrota: false });
  assert.equal(envio.medirEnvio(e, e.config.sync).code, 'sem-frota');
});

test('medir não escreve nada e devolve o tamanho medido', async () => {
  const e = await pronto(3);
  fake.requests.length = 0;
  const m = envio.medirEnvio(e, e.config.sync);
  assert.equal(m.ok, true);
  assert.equal(m.categorias.revisoes, 3);
  assert.equal(m.pendentes, 3);
  assert.ok(m.bytes > 3 * 200, `tamanho medido de verdade: ${m.bytes}`);
  assert.deepEqual(fake.requests, [], 'medir não toca o banco');
});

test('o tamanho medido acompanha o conteúdo', async () => {
  const e = await pronto(1);
  const pequeno = envio.medirEnvio(e, e.config.sync).bytes;
  e.decisions.resolved[0].reasons = Array.from({ length: 10 }, (_, i) => ({ text: `${i} `.repeat(140), kind: 'gate' }));
  assert.ok(envio.medirEnvio(e, e.config.sync).bytes > pequeno + 1000);
});

test('sem confirmar a medição, não envia', async () => {
  const e = await pronto(2);
  const r = await envio.enviarHistorico(e, e.config.sync, {});
  assert.equal(r.code, 'medida-vencida');
  assert.deepEqual(indice(), {});
});

test('histórico mudou depois da medição: recusa e pede medir de novo', async () => {
  const e = await pronto(2);
  const m = envio.medirEnvio(e, e.config.sync);
  antigas(e, 3);
  const r = await envio.enviarHistorico(e, e.config.sync, { impressao: m.impressao });
  assert.equal(r.code, 'medida-vencida');
  assert.deepEqual(indice(), {});
});

test('envia o anterior ao marco, e só ele, sem relatório nem login', async () => {
  const e = await pronto(2);
  e.decisions.resolved.push({ id: 'depois', createdAt: AGORA + 1000, resolvedAt: AGORA + 2000, key: 'x#1', status: 'posted', verdict: 'approve', pr: {} });
  const m = envio.medirEnvio(e, e.config.sync);
  assert.equal(m.categorias.revisoes, 2, 'o posterior ao marco sobe sozinho, não por aqui');
  const r = await envio.enviarHistorico(e, e.config.sync, { impressao: m.impressao });
  assert.deepEqual([r.enviados, r.restantes, r.concluido], [2, 0, true]);
  assert.equal(Object.keys(indice()).length, 2);
  const cru = JSON.stringify(fake.tree());
  for (const p of ['RELATORIO', LOGIN, 'Titulo 0']) assert.equal(cru.includes(p), false, p);
});

test('interrompido no meio, retoma de onde parou', async () => {
  const e = await pronto(envio.LOTE + 5);
  const m = envio.medirEnvio(e, e.config.sync);
  const primeira = await envio.enviarHistorico(e, e.config.sync, { impressao: m.impressao });
  assert.deepEqual([primeira.enviados, primeira.restantes], [envio.LOTE, 5]);
  assert.equal(envio.medirEnvio(e, e.config.sync).pendentes, 5, 'a medição seguinte conta só o que falta');
  const segunda = await envio.enviarHistorico(e, e.config.sync, { impressao: m.impressao });
  assert.deepEqual([segunda.enviados, segunda.concluido], [5, true]);
  assert.equal(Object.keys(indice()).length, envio.LOTE + 5);
});

test('repetir o envio inteiro, sem progresso, não duplica nada', async () => {
  const e = await pronto(3);
  const m = envio.medirEnvio(e, e.config.sync);
  await envio.enviarHistorico(e, e.config.sync, { impressao: m.impressao });
  const antes = JSON.stringify(fake.tree().users.u1.reviewBodies);
  fs.rmSync(path.join(STATE_DIR, 'sync-envio.json'), { force: true });
  const r = await envio.enviarHistorico(e, e.config.sync, { impressao: envio.medirEnvio(e, e.config.sync).impressao });
  assert.equal(r.enviados, 3, 'refaz o percurso');
  assert.equal(Object.keys(indice()).length, 3, 'e o banco continua com três');
  assert.equal(JSON.stringify(fake.tree().users.u1.reviewBodies), antes, 'corpo write-once não muda');
});

test('o módulo não lê credencial, config inteira nem histórico do CLI', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'sync-envio-historico.js'), 'utf8');
  for (const p of ['credentials', 'CONFIG_FILE', 'engine.config', '.claude', 'sessions']) assert.equal(fonte.includes(p), false, p);
});

test('as rotas de medir e enviar existem e passam pela fachada', async () => {
  const e = await pronto(1);
  const m = e.syncMedirEnvio();
  assert.equal(m.pendentes, 1);
  assert.equal((await e.syncEnviarHistorico({ impressao: m.impressao })).concluido, true);
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
  assert.match(fonte, /p === '\/api\/sync\/history-measure'/);
  assert.match(fonte, /p === '\/api\/sync\/history-send'/);
  assert.match(fonte, /bytes: r\.bytes, impressao: r\.impressao/, 'a rota devolve o tamanho medido');
});

// Mesma quantidade, conteúdo diferente: uma revisão antiga mudou de status (versão nova)
// entre medir e confirmar. Contar itens não basta para saber que é outro envio.
test('mudança só de versão, com a mesma contagem, também vence a medição', async () => {
  const e = await pronto(2);
  const m = envio.medirEnvio(e, e.config.sync);
  e.decisions.resolved[0].resolvedAt += 5;
  const r = await envio.enviarHistorico(e, e.config.sync, { impressao: m.impressao });
  assert.equal(r.code, 'medida-vencida');
});
