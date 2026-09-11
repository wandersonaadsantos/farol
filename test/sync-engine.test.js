// Composição da sincronização entre dispositivos (lib/engine/sync.js) vista pela Engine
// REAL: boot, login, presença, tick, logout, apagar remoto, desligar e o gate que segura
// a automação. Os dublês do Firebase (test/helpers/) ouvem em 127.0.0.1; a rede entra
// pelo fetchImpl que o runtime guarda. O banco do dublê é http local, então o login vai
// para o endereço do emulador de Auth (o mesmo caminho da validação manual do
// firebase/README.md), e o teste só troca a porta fixa do emulador pela do dublê.
// Qualquer destino fora da máquina reprova o teste, inclusive o Auth de produção.
//
// FAROL_HOME é fixado antes do import do server.js (os caminhos são const de nível de
// módulo): por isso o await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-engine-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { startFakeIdentity } from './helpers/fake-identity.js';
import { SYNC } from '../lib/constants.js';

const { Engine } = await import('../server.js');

const CRED_FILE = path.join(FAROL_HOME, SYNC.CREDENTIALS_FILE);
const DEVICE_FILE = path.join(FAROL_HOME, 'workspace', 'state', SYNC.DEVICE_FILE);
const API_KEY = 'chave-web-de-teste';
const EMAIL = 'a@b.com';
const SENHA = 'senha-que-nunca-aparece';
const EMAIL2 = 'outra@b.com';
const RELOGIO_SERVIDOR = 1_800_000_000_000;

const identity = await startFakeIdentity({ apiKey: API_KEY, users: { [EMAIL]: { password: SENHA, uid: 'u1' }, [EMAIL2]: { password: SENHA, uid: 'u2' } } });
// o banco aceita qualquer ID token que o Auth de mentira emitiu, como o de verdade
const rtdb = await startFakeRtdb({ token: (t) => identity.tokens.idTokens.includes(t) });
rtdb.setNow(RELOGIO_SERVIDOR);

after(async () => {
  await rtdb.close();
  await identity.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// fetch dos dublês: troca a origem fixa do emulador de Auth pela do dublê e recusa
// qualquer destino fora de 127.0.0.1. `fora` simula a rede caída.
const ORIGEM_EMULADOR_AUTH = new URL(SYNC.AUTH_EMULATOR_IDENTITY_URL).origin;
function fetchDosDubles(controle) {
  return async (url, init) => {
    controle.chamadas++;
    if (controle.fora) throw new TypeError('fetch failed');
    const alvo = String(url).replace(ORIGEM_EMULADOR_AUTH, identity.url);
    if (!alvo.startsWith('http://127.0.0.1:')) throw new Error('o teste tentou sair da máquina');
    return fetch(alvo, init);
  };
}

function syncCfg(extra = {}) {
  return {
    enabled: true, coordination: { enabled: false }, consolidation: { enabled: false },
    deviceName: 'Mesa', apiKey: API_KEY, databaseUrl: rtdb.url, projectId: 'farol-local', ...extra,
  };
}

// Salva como a tela salva (updateSettings) e espera o efeito que ELE dispara. Chamar a
// fachada aplicarConfig à mão depois de salvar esconderia uma fiação apagada no
// updateSettings, e é justamente ela que liga, desliga e reconecta na vida real.
async function salvarSync(cfg) {
  engine.updateSettings({ sync: cfg });
  if (engine.sync.iniciando) await engine.sync.iniciando;
}

function patchesDePresenca() {
  return rtdb.requests.filter((r) => r.method === 'PATCH' && r.path.includes('/devices/')).length;
}

test('(a) boot com sync ausente: desligado, nenhuma rede e nenhum arquivo de sincronização', async () => {
  const engine = new Engine();
  const controle = { chamadas: 0, fora: false };
  const spy = fetchDosDubles(controle);
  engine.sync.fetchImpl = spy;
  assert.equal(engine.sync.status, 'desligado');
  assert.equal(engine.snapshot().sync.enabled, false);
  assert.equal(engine.snapshot().sync.status, 'desligado');
  await engine.syncTick();
  const login = await engine.syncLogin({ email: EMAIL, password: SENHA }, spy);
  assert.equal(login.ok, false);
  assert.equal(login.code, 'desligado');
  assert.equal((await engine.syncTest()).ok, false);
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false);
  assert.equal(engine.syncCoordenacaoAtiva(), false);
  assert.equal(controle.chamadas, 0, 'nenhuma chamada ao fetch injetado');
  assert.equal(fs.existsSync(CRED_FILE), false, 'sync-credentials.json não nasce');
  assert.equal(fs.existsSync(DEVICE_FILE), false, 'sync-device.json não nasce');
});

// Engine compartilhada pelos casos seguintes, na ordem em que o usuário vive o recurso.
const controle = { chamadas: 0, fora: false };
const engine = new Engine();
engine.sync.fetchImpl = fetchDosDubles(controle);
const toasts = [];
engine.on('toast', (t) => toasts.push(t));
// o log real continua sendo escrito; o espelho só conta as linhas de sincronização
const logs = [];
const logReal = engine.log.bind(engine);
engine.log = (nivel, msg) => { logs.push({ nivel, msg }); return logReal(nivel, msg); };
function warnsDeSync() {
  return logs.filter((l) => l.nivel === 'WARN' && /entre dispositivos/.test(l.msg)).length;
}

test('(b) habilitar + login: conectado, credencial sem senha, aparelho persistido e presença com hora do servidor', async () => {
  await salvarSync(syncCfg());
  assert.equal(engine.sync.status, 'sem-credencial');
  assert.equal(controle.chamadas, 0, 'habilitar sem login não toca a rede');

  const r = await engine.syncLogin({ email: EMAIL, password: SENHA });
  assert.deepEqual(r, { ok: true, uid: 'u1', email: EMAIL });
  assert.equal(engine.sync.status, 'conectado');

  const texto = fs.readFileSync(CRED_FILE, 'utf8');
  assert.equal(texto.includes(SENHA), false, 'a senha nunca é gravada');
  const cred = JSON.parse(texto);
  assert.equal(cred.uid, 'u1');
  assert.ok(identity.tokens.refreshTokens.includes(cred.refreshToken), 'guarda um refresh token emitido pelo Auth');

  const dev = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
  assert.equal(dev.deviceId, engine.sync.deviceId);
  const no = rtdb.tree().users.u1.devices[dev.deviceId];
  assert.equal(no.lastSeenAt, RELOGIO_SERVIDOR, 'lastSeenAt é carimbo do servidor, não do relógio local');
  assert.equal(no.createdAt, RELOGIO_SERVIDOR);
  assert.equal(no.name, 'Mesa');
  assert.equal(no.platform, process.platform);
  assert.ok(Math.abs(engine.sync.skewMs - (RELOGIO_SERVIDOR - Date.now())) < 60000, 'skew medido na presença');
});

test('(c) syncTick respeita PRESENCE_TICK_MS', async () => {
  const antes = patchesDePresenca();
  await engine.syncTick();
  assert.equal(patchesDePresenca(), antes, 'dentro da janela não carimba de novo');
  engine.sync.lastPresenceAt -= SYNC.PRESENCE_TICK_MS;
  await engine.syncTick();
  assert.equal(patchesDePresenca(), antes + 1, 'vencida a janela, carimba uma vez');
  assert.equal(engine.sync.status, 'conectado');
  assert.ok(engine.snapshot().sync.devices.some((d) => d.euMesmo && d.name === 'Mesa'), 'aparelhos lidos no tick');
});

// O e-mail é a EXCEÇÃO declarada à regra de nunca expor e-mail em snapshot: a tela
// mostra "Conectado como <e-mail>" (desenho da seção sys-sync), e o snapshot é o único
// canal dela. A exceção é estreita: um campo só, no bloco sync. Log, toast e resposta
// de rota continuam proibidos, e o caso (j) confere os dois primeiros.
test('(h) snapshot nunca carrega senha, refresh token, ID token nem auth=; e-mail só em sync.email', () => {
  const texto = JSON.stringify(engine.snapshot());
  assert.equal(texto.includes(SENHA), false);
  assert.equal(texto.includes('auth='), false);
  for (const t of identity.tokens.refreshTokens) assert.equal(texto.includes(t), false, 'refresh token no snapshot');
  for (const t of identity.tokens.idTokens) assert.equal(texto.includes(t), false, 'ID token no snapshot');
  const s = engine.snapshot().sync;
  assert.equal(s.status, 'conectado');
  assert.equal(s.uid.startsWith('u1'), true);
  assert.equal(s.outbox, null);
  assert.equal(s.email, EMAIL, 'a tela precisa do e-mail para dizer com quem está conectada');
  assert.equal(texto.split(EMAIL).length - 1, 1, 'o e-mail aparece uma vez só, no campo sync.email');
});

test('(g) seguraAutomacao: desligada não segura; ligada segura sem conexão e com espera vigente', async () => {
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false, 'coordenação desligada nunca segura');
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal(engine.syncCoordenacaoAtiva(), true);
  assert.equal(engine.sync.status, 'conectado', 'ligar a coordenação não derruba a conexão');
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false, 'conectado e sem espera: não segura');

  engine.syncRegistrarEspera('o/r#1', { admitted: false, reason: 'alheio', detail: { deviceName: 'Notebook' } });
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), true, 'espera vigente segura');
  assert.equal(engine.syncSeguraAutomacao('o/r#2'), false, 'a espera é por PR');
  assert.equal(engine.snapshot().sync.espera['o/r#1'].deviceName, 'Notebook');
  engine.syncRegistrarEspera('o/r#3', { admitted: false, reason: 'recibo', detail: {} });
  assert.equal(engine.sync.espera['o/r#3'], undefined, 'recibo não vira espera');
  engine.sync.espera['o/r#1'].until = Date.now() - 1;
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), false, 'espera vencida solta');

  controle.fora = true;
  engine.sync.lastPresenceAt -= SYNC.PRESENCE_TICK_MS;
  const warnsAntes = warnsDeSync();
  await engine.syncTick();
  assert.equal(engine.sync.status, 'erro');
  assert.equal(engine.sync.lastError.code, 'indisponivel');
  assert.equal(engine.syncSeguraAutomacao('o/r#9'), true, 'fora de conectado segura qualquer PR');
  assert.equal(engine.syncSeguraAutomacao('o/r#8'), true);
  assert.equal(toasts.filter((t) => /aparelhos/.test(t.text)).length, 1, 'avisa uma vez por janela');
  // o segundo tick sem rede tenta reconectar e ouve a MESMA recusa: o farol.log é de
  // falha, não de estado, então a queda sai uma vez só
  await engine.syncTick();
  assert.equal(engine.sync.status, 'erro');
  assert.equal(warnsDeSync() - warnsAntes, 1, 'dois ticks sem rede, um WARN só');

  controle.fora = false;
  await engine.syncTick();
  assert.equal(engine.sync.status, 'conectado', 'o tick seguinte reconecta sozinho');
  assert.equal(engine.syncSeguraAutomacao('o/r#9'), false);
  await salvarSync(syncCfg());
});

test('(e) erase-remote apaga /users/{uid} inteiro, só do próprio uid, e nada local', async () => {
  // a árvore real tem mais que presença; e o dublê poda pai vazio, então sem estes nós
  // apagar só /devices produziria a mesma árvore vazia e o teste não distinguiria
  const arvore = rtdb.tree();
  Object.assign(arvore.users.u1, {
    leases: { a1: { p1: { leaseId: 'l1', deviceId: 'd1', operationKind: 'review', expiresAt: 1 } } },
    receipts: { a1: { p1: { review_x: { operationKind: 'review', completedAt: 1 } } } },
    usageEvents: { d1: { e1: { at: 1, kind: 'review', costUsd: 0 } } },
  });
  arvore.users.u2 = { devices: { outro: { name: 'Aparelho de outra pessoa' } } };
  rtdb.setTree(arvore);

  const r = await engine.syncEraseRemote();
  assert.deepEqual(r, { ok: true });
  const depois = rtdb.tree();
  assert.equal(depois.users.u1, undefined, 'a árvore do usuário foi apagada inteira');
  assert.deepEqual(depois.users.u2, { devices: { outro: { name: 'Aparelho de outra pessoa' } } }, 'o apagão respeita o uid');
  assert.equal(engine.sync.status, 'conectado');
  assert.ok(fs.existsSync(CRED_FILE), 'a credencial local fica');
  assert.ok(fs.existsSync(DEVICE_FILE), 'a identidade local do aparelho fica');
  const t = await engine.syncTest();
  assert.deepEqual(t, { ok: true, uid: 'u1', devices: 0 });
});

test('(f) desligar para tudo e volta a desligado sem apagar nada', async () => {
  engine.sync.lastPresenceAt -= SYNC.PRESENCE_TICK_MS;
  await engine.syncTick();
  const arvore = rtdb.tree();
  assert.ok(arvore.users.u1.devices[engine.sync.deviceId], 'presença recriada depois do apagão');
  const deletes = rtdb.requests.filter((r) => r.method === 'DELETE').length;
  const chamadas = controle.chamadas;

  await salvarSync(syncCfg({ enabled: false }));
  assert.equal(engine.sync.status, 'desligado');
  assert.equal(engine.snapshot().sync.enabled, false);
  await engine.syncTick();
  assert.equal(controle.chamadas, chamadas, 'desligado não fala com o Firebase');
  assert.equal(rtdb.requests.filter((r) => r.method === 'DELETE').length, deletes, 'desligar não apaga nada remoto');
  assert.deepEqual(rtdb.tree(), arvore);
  assert.ok(fs.existsSync(CRED_FILE), 'desligar não apaga a credencial');
  assert.ok(fs.existsSync(DEVICE_FILE), 'desligar não apaga a identidade do aparelho');
});

test('(d) logout apaga a credencial e volta a sem-credencial', async () => {
  await salvarSync(syncCfg());
  assert.equal(engine.sync.status, 'conectado', 'religar com credencial reconecta');
  assert.deepEqual(await engine.syncLogout(), { ok: true });
  assert.equal(fs.existsSync(CRED_FILE), false);
  assert.equal(engine.sync.status, 'sem-credencial');
  assert.equal(engine.snapshot().sync.email, '');
  const t = await engine.syncTest();
  assert.equal(t.ok, false);

  // sem login e com a coordenação ligada o gate fica FECHADO: sem banco não há como
  // saber se outro aparelho já pegou o PR (o caso 'conectando' está no teste de boot)
  const avisosAntes = toasts.length;
  await salvarSync(syncCfg({ coordination: { enabled: true } }));
  assert.equal(engine.sync.status, 'sem-credencial');
  assert.equal(engine.syncSeguraAutomacao('o/r#1'), true, 'sem credencial segura a automação');
  const avisos = toasts.slice(avisosAntes);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].text, /nenhum login/, 'o aviso diz o que falta de verdade');
  await salvarSync(syncCfg());
});

// Só a RESPOSTA das rotas: o e-mail chega à tela pelo snapshot (exceção do caso (h)).
test('(i) rotas /api/sync/*: a resposta é allowlist e nunca ecoa senha, e-mail ou uid', async () => {
  const { startServer } = await import('../lib/http-server.js');
  // porta 0: o sistema escolhe uma livre, sem disputar a do Farol que estiver aberto
  engine.config.port = 0;
  const server = startServer(engine);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (rota, corpo) => {
    const res = await fetch(base + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1' }, body: JSON.stringify(corpo || {}) });
    return res.text();
  };
  try {
    const recusa = await post('/api/sync/login', { email: EMAIL, password: 'senha-errada-que-tambem-nao-volta' });
    assert.equal(recusa.includes('senha-errada'), false);
    assert.equal(JSON.parse(recusa).code, 'credencial_invalida');

    const aceita = await post('/api/sync/login', { email: EMAIL, password: SENHA });
    assert.deepEqual(JSON.parse(aceita), { ok: true }, 'sem e-mail nem uid na resposta');
    assert.equal(aceita.includes(SENHA), false);
    assert.equal(engine.sync.status, 'conectado');

    assert.deepEqual(JSON.parse(await post('/api/sync/test')), { ok: true, devices: 1 });
    assert.deepEqual(JSON.parse(await post('/api/sync/erase-remote')), { ok: true });
    assert.deepEqual(JSON.parse(await post('/api/sync/logout')), { ok: true });
    assert.equal(engine.sync.status, 'sem-credencial');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('(j) nenhum toast nem linha de log da bateria carregou o e-mail ou a senha', () => {
  assert.ok(toasts.length > 0 && logs.length > 0, 'a bateria produziu toasts e logs para conferir');
  for (const t of toasts) {
    assert.equal(String(t.text).includes(EMAIL), false, 'e-mail em toast');
    assert.equal(String(t.text).includes(SENHA), false, 'senha em toast');
  }
  for (const l of logs) {
    assert.equal(String(l.msg).includes(EMAIL), false, 'e-mail no log');
    assert.equal(String(l.msg).includes(SENHA), false, 'senha no log');
  }
});

// M6: o helper de "não dá pra falar com o banco agora" estava duplicado em
// lib/engine/sync.js e lib/engine/sync-usage.js, e os dois respondiam sem_credencial no
// estado 'conectando': a quem ACABOU de entrar, a tela dizia "nenhum login do Firebase
// foi feito neste aparelho" e mandava entrar de novo numa conta em que ele já estava.
test('(k) conexão em andamento responde indisponibilidade, nunca "nenhum login foi feito"', async () => {
  const e = new Engine();
  e.log = () => {};
  e.config.sync = { ...syncCfg({ consolidation: { enabled: true } }) };
  e.sync.status = 'conectando';
  const r = await e.syncTest();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'indisponivel');
  assert.match(r.motivo, /conexão com o Firebase ainda está sendo estabelecida/);
  const c = await e.syncConsolidated(30);
  assert.equal(c.code, 'indisponivel', 'um helper só: os dois módulos respondem igual');
  e.sync.status = 'sem-credencial';
  assert.equal((await e.syncTest()).code, 'sem_credencial', 'sem login continua sendo sem login');
});

// M7: a falha transitória é a mesma; o NOME dela depende do que a pessoa ligou. Com a
// coordenação desligada, o Diagnóstico mostrava "Coordenação indisponível" para quem
// nem ligou a coordenação.
test('(l) com só a consolidação ligada, a falha transitória não se chama coordenação', async () => {
  const ctrl = { chamadas: 0, fora: false };
  const e = new Engine();
  const linhas = [];
  e.log = (nivel, msg) => linhas.push(`${nivel} ${msg}`);
  e.sync.fetchImpl = fetchDosDubles(ctrl);
  e.updateSettings({ sync: syncCfg({ consolidation: { enabled: true } }) });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);

  ctrl.fora = true;
  // o tick só toca a rede dentro da janela de presença; sem isto ele não tentaria nada
  e.sync.lastPresenceAt = 0;
  await e.syncTick();
  assert.equal(e.sync.status, 'erro');
  const warn = linhas.filter((l) => /indispon/.test(l)).at(-1);
  assert.ok(warn, 'a queda produziu uma linha de indisponibilidade');
  assert.match(warn, /sincronização entre dispositivos indisponível/);
  assert.doesNotMatch(warn, /coordenação entre dispositivos/);
});

// M12: o startSync reaproveita o start EM VOO, e aquele leu a credencial antiga. Sem a
// espera, o login voltava ok e a tela dizia "conectado" com a conta de antes.
test('(m) login com um start em voo conecta com a credencial NOVA', async () => {
  const ctrl = { chamadas: 0, fora: false };
  const e = new Engine();
  e.log = () => {};
  e.sync.fetchImpl = fetchDosDubles(ctrl);
  e.updateSettings({ sync: syncCfg() });
  if (e.sync.iniciando) await e.sync.iniciando;
  assert.equal((await e.syncLogin({ email: EMAIL, password: SENHA })).ok, true);
  assert.equal(e.sync.uid, 'u1');

  // reconexão disparada e NÃO aguardada: ela leu a credencial de u1
  e.updateSettings({ sync: syncCfg({ projectId: 'outro-projeto' }) });
  assert.ok(e.sync.iniciando, 'o caso precisa de um start realmente em voo');
  const r = await e.syncLogin({ email: EMAIL2, password: SENHA });
  assert.deepEqual(r, { ok: true, uid: 'u2', email: EMAIL2 });
  assert.equal(e.sync.status, 'conectado');
  assert.equal(e.sync.uid, 'u2', 'a conexão é da conta nova, não da que o start em voo leu');
  assert.equal(e.sync.email, EMAIL2);
});
