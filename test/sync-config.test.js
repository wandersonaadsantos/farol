// lib/sync/config.js: o saneador da chave `sync` do config.json. A sincronização é
// opt-in: nasce desligada, só liga com `true` explícito, e a URL do banco passa por
// allowlist de host (é para lá que o ID token viaja na query).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// mkdtemp e não um nome derivado do pid: o nome previsível no diretório temporário
// compartilhado deixa outro processo criar o caminho antes e decidir o que o teste lê.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-config-'));
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import cfgMod, {
  syncDefaults, parseSyncConfig, coordinationActive, consolidationActive, databaseUrlProblema, authUrlsFor,
} from '../lib/sync/config.js';
import { SYNC } from '../lib/constants.js';
import { EDITAVEIS, defaults, sanear } from '../lib/settings.js';

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const DB = 'https://farol-abc-default-rtdb.firebaseio.com';
const VALIDO = {
  enabled: true, coordination: { enabled: true }, consolidation: { enabled: true }, shared: { enabled: true },
  aceitarAdmin: true,
  deviceName: 'Notebook', apiKey: 'AIzaSyA-1234567890_abc', databaseUrl: DB, projectId: 'farol-abc',
};

test('syncDefaults: tudo desligado e vazio, objeto novo a cada chamada', () => {
  assert.deepEqual(syncDefaults(), {
    enabled: false, coordination: { enabled: false }, consolidation: { enabled: false }, shared: { enabled: false },
    aceitarAdmin: false,
    deviceName: '', apiKey: '', databaseUrl: '', projectId: '',
  });
  const a = syncDefaults();
  a.coordination.enabled = true;
  assert.equal(syncDefaults().coordination.enabled, false, 'mutar um não contamina o próximo');
});

test('parseSyncConfig: objeto válido passa inteiro', () => {
  assert.deepEqual(parseSyncConfig(VALIDO, syncDefaults()), VALIDO);
});

test('parseSyncConfig: devolve objeto NOVO, nunca a referência que chegou', () => {
  const saida = parseSyncConfig(VALIDO, syncDefaults());
  assert.notEqual(saida, VALIDO);
  assert.notEqual(saida.coordination, VALIDO.coordination);
  assert.notEqual(saida.consolidation, VALIDO.consolidation);
});

test('parseSyncConfig: os três interruptores só ligam com true explícito', () => {
  for (const v of ['true', 1, 'sim', {}, [], null]) {
    const s = parseSyncConfig({ enabled: v, coordination: { enabled: v }, consolidation: { enabled: v } }, syncDefaults());
    assert.equal(s.enabled, false, String(v));
    assert.equal(s.coordination.enabled, false, String(v));
    assert.equal(s.consolidation.enabled, false, String(v));
  }
  const s = parseSyncConfig({ enabled: true, coordination: true, consolidation: 'x' }, syncDefaults());
  assert.equal(s.coordination.enabled, false, 'interruptor que não é objeto não liga');
  assert.equal(s.consolidation.enabled, false);
});

test('parseSyncConfig: valor lixo não liga nada', () => {
  for (const lixo of [undefined, null, 'ligado', 42, true, [], [VALIDO]]) {
    const s = parseSyncConfig(lixo, syncDefaults());
    assert.deepEqual(s, syncDefaults(), String(lixo));
  }
});

test('parseSyncConfig: deviceName aparado e cortado em 40', () => {
  assert.equal(parseSyncConfig({ deviceName: '  Mac do trabalho  ' }, syncDefaults()).deviceName, 'Mac do trabalho');
  assert.equal(parseSyncConfig({ deviceName: 'x'.repeat(60) }, syncDefaults()).deviceName.length, 40);
  assert.equal(parseSyncConfig({ deviceName: { a: 1 } }, syncDefaults()).deviceName, '');
});

test('parseSyncConfig: apiKey e projectId por allowlist, inválido vira vazio', () => {
  for (const ruim of ['curta', 'tem espaço dentro', 'a'.repeat(129), 'aspas"aqui123', 'subshell$(x)1234']) {
    assert.equal(parseSyncConfig({ apiKey: ruim }, syncDefaults()).apiKey, '', ruim);
  }
  assert.equal(parseSyncConfig({ apiKey: 'a'.repeat(128) }, syncDefaults()).apiKey, 'a'.repeat(128));
  for (const ruim of ['Farol', 'farol_x', 'a'.repeat(65), 'a b', '']) {
    assert.equal(parseSyncConfig({ projectId: ruim }, syncDefaults()).projectId, '', ruim);
  }
  assert.equal(parseSyncConfig({ projectId: 'farol-local' }, syncDefaults()).projectId, 'farol-local');
});

test('databaseUrlProblema: hosts do Firebase em https e emulador em http local', () => {
  for (const ok of [DB, DB + '/', 'https://x.europe-west1.firebasedatabase.app', 'http://127.0.0.1:9000', 'http://localhost:9000']) {
    assert.equal(databaseUrlProblema(ok), '', ok);
  }
  for (const ruim of [
    'http://farol-abc.firebaseio.com', 'https://evil.com', 'https://firebaseio.com', 'https://x.firebaseio.com.evil.com',
    DB + '/users', DB + '?auth=x', 'https://u:p@x.firebaseio.com', 'https://localhost:9000', 'http://10.0.0.1:9000',
    'ftp://x.firebaseio.com', 'nao e url', '', undefined, null, 42,
  ]) {
    const p = databaseUrlProblema(ruim);
    assert.equal(typeof p, 'string', String(ruim));
    assert.ok(p.length > 0, `devia recusar ${String(ruim)}`);
    assert.doesNotMatch(p, /\u2014/, 'frase de tela sem travessão');
  }
});

test('parseSyncConfig: databaseUrl válida sai sem barra final', () => {
  assert.equal(parseSyncConfig({ databaseUrl: DB + '/' }, syncDefaults()).databaseUrl, DB);
  assert.equal(parseSyncConfig({ databaseUrl: '  ' + DB + '  ' }, syncDefaults()).databaseUrl, DB);
});

test('parseSyncConfig: emulador http://127.0.0.1:9000 é aceito', () => {
  assert.equal(parseSyncConfig({ databaseUrl: 'http://127.0.0.1:9000' }, syncDefaults()).databaseUrl, 'http://127.0.0.1:9000');
});

test('parseSyncConfig: databaseUrl inválida mantém a anterior (ou vazio sem anterior)', () => {
  const atual = { ...syncDefaults(), databaseUrl: DB };
  assert.equal(parseSyncConfig({ databaseUrl: 'https://evil.com' }, atual).databaseUrl, DB);
  assert.equal(parseSyncConfig({ databaseUrl: 'https://evil.com' }, undefined).databaseUrl, '');
  assert.equal(parseSyncConfig({ databaseUrl: 'https://evil.com' }, null).databaseUrl, '');
});

test('parseSyncConfig: http em host remoto é recusado', () => {
  const atual = { ...syncDefaults(), databaseUrl: DB };
  assert.equal(parseSyncConfig({ databaseUrl: 'http://farol-abc.firebaseio.com' }, atual).databaseUrl, DB);
  assert.equal(parseSyncConfig({ databaseUrl: 'http://192.168.0.10:9000' }, syncDefaults()).databaseUrl, '');
});

test('parseSyncConfig: databaseUrl vazia de propósito limpa o campo', () => {
  const atual = { ...syncDefaults(), databaseUrl: DB };
  assert.equal(parseSyncConfig({ databaseUrl: '' }, atual).databaseUrl, '');
  assert.equal(parseSyncConfig({ databaseUrl: '   ' }, atual).databaseUrl, '');
});

test('coordinationActive e consolidationActive exigem o interruptor geral E o próprio', () => {
  assert.equal(coordinationActive(VALIDO), true);
  assert.equal(consolidationActive(VALIDO), true);
  assert.equal(coordinationActive({ ...VALIDO, enabled: false }), false);
  assert.equal(consolidationActive({ ...VALIDO, enabled: false }), false);
  assert.equal(coordinationActive({ ...VALIDO, coordination: { enabled: false } }), false);
  assert.equal(consolidationActive({ ...VALIDO, consolidation: { enabled: 'true' } }), false);
  for (const v of [undefined, null, {}, 'x']) {
    assert.equal(coordinationActive(v), false);
    assert.equal(consolidationActive(v), false);
  }
});

test('settings: sync está na tabela, é editável e nasce com os defaults do módulo', () => {
  assert.ok(EDITAVEIS.has('sync'));
  assert.deepEqual(defaults().sync, syncDefaults());
});

test('settings: o saneador da tabela é o parseSyncConfig e recebe o sync atual', () => {
  const atual = { sync: { ...syncDefaults(), databaseUrl: DB } };
  const s = sanear('sync', { enabled: true, databaseUrl: 'https://evil.com' }, atual, { parseSyncConfig });
  assert.equal(s.enabled, true);
  assert.equal(s.databaseUrl, DB);
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(cfgMod.parseSyncConfig, parseSyncConfig);
  assert.equal(cfgMod.databaseUrlProblema, databaseUrlProblema);
  assert.equal(cfgMod.authUrlsFor, authUrlsFor);
});

test('authUrlsFor: banco de produção usa o Auth de produção', () => {
  const producao = { identityUrl: SYNC.IDENTITY_TOOLKIT_URL, tokenUrl: SYNC.SECURE_TOKEN_URL };
  assert.deepEqual(authUrlsFor(DB), producao);
  assert.deepEqual(authUrlsFor('https://x-default-rtdb.europe-west1.firebasedatabase.app'), producao);
});

test('authUrlsFor: banco do emulador (http local) usa o Auth do emulador', () => {
  const emulador = { identityUrl: SYNC.AUTH_EMULATOR_IDENTITY_URL, tokenUrl: SYNC.AUTH_EMULATOR_TOKEN_URL };
  assert.deepEqual(authUrlsFor('http://127.0.0.1:9000'), emulador);
  assert.deepEqual(authUrlsFor('http://localhost:9000'), emulador);
});

test('authUrlsFor: URL inválida ou http remoto nunca desvia o login', () => {
  const producao = { identityUrl: SYNC.IDENTITY_TOOLKIT_URL, tokenUrl: SYNC.SECURE_TOKEN_URL };
  for (const u of ['', null, 'http://exemplo.com:9000', 'lixo', 'http://127.0.0.1:9000/caminho']) {
    assert.deepEqual(authUrlsFor(u), producao, String(u));
  }
});

/* ---------- boot da Engine ---------- */

const { Engine } = await import('../server.js');
const CONFIG = path.join(HOME, 'config.json');

function comConfig(obj) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(obj));
  return new Engine();
}

test('boot: config.json sem sync inicia com a sincronização desligada', () => {
  const { config } = comConfig({ autoReview: false });
  assert.deepEqual(config.sync, syncDefaults());
  assert.equal(config.sync.enabled, false);
});

test('boot: sync lixo no config.json não liga nada', () => {
  for (const lixo of ['ligado', 1, true, [1, 2], { enabled: 'true', coordination: 1 }]) {
    const { config } = comConfig({ autoReview: false, sync: lixo });
    assert.equal(config.sync.enabled, false, JSON.stringify(lixo));
    assert.equal(config.sync.coordination.enabled, false);
    assert.equal(config.sync.consolidation.enabled, false);
  }
});

test('boot: databaseUrl editada à mão com host estranho é descartada', () => {
  const { config } = comConfig({ autoReview: false, sync: { ...VALIDO, databaseUrl: 'https://evil.com' } });
  assert.equal(config.sync.databaseUrl, '');
  assert.equal(config.sync.enabled, true, 'o resto do objeto válido fica');
});

test('updateSettings: sync passa pelo saneador e URL inválida mantém a anterior', () => {
  const engine = comConfig({ autoReview: false, sync: VALIDO });
  const r = engine.updateSettings({ sync: { ...VALIDO, databaseUrl: 'http://evil.com', apiKey: 'x' } });
  assert.deepEqual(r.ignoradas, []);
  assert.equal(engine.config.sync.databaseUrl, DB);
  assert.equal(engine.config.sync.apiKey, '');
});
