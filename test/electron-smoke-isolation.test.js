import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installedElectronBinary, smokeEnv, localRequest, validateSmokeReport, validateWindowEvidence, validateLoginItem } from '../tools/electron-smoke-lib.js';

test('autostart isolado usa launchItems por nome e nunca o openAtLogin da identidade real', () => {
  const expected = { name: 'FarolElectronSmoke-único', path: 'C:\\Farol\\electron.exe', args: ['C:\\Farol', 'probe'] };
  const own = { ...expected, enabled: true, scope: 'user' };
  const other = { ...own, name: 'Farol' };
  assert.doesNotThrow(() => validateLoginItem({ openAtLogin: false, launchItems: [other, own] }, expected, true));
  assert.doesNotThrow(() => validateLoginItem({ openAtLogin: true, launchItems: [other] }, expected, false));
  assert.throws(() => validateLoginItem({ openAtLogin: true, launchItems: [other] }, expected, true), /entrada isolada/);
  assert.throws(() => validateLoginItem({ launchItems: [own] }, expected, false), /entrada isolada/);
  assert.throws(() => validateLoginItem({ launchItems: [{ ...own, enabled: false }] }, expected, true), /habilitada/);
  assert.throws(() => validateLoginItem({ launchItems: [{ ...own, args: ['outro'] }] }, expected, true), /argumentos/);
  assert.throws(() => validateLoginItem({ launchItems: [{ ...own, scope: 'machine' }] }, expected, true), /usuário/);
});

test('UI iniciando comprova snapshot HTTP e navegação sem inventar uma checagem externa', () => {
  const expected = { expectedApp: '2.57.5', platform: 'win32' };
  const snapshot = { app: { name: 'Farol', version: '2.57.5', platform: 'win32' }, status: 'starting', lastCheckAt: null };
  const dom = { title: 'Farol', brand: 'Farol', version: 'v2.57.5', status: 'iniciando…',
    navigation: ['consumo', 'radar'].map(tab => ({ tab, selected: true, visible: true, activePanels: 1, bodyTab: tab })) };
  assert.doesNotThrow(() => validateWindowEvidence(200, snapshot, dom, expected));
  assert.throws(() => validateWindowEvidence(503, snapshot, dom, expected), /HTTP/);
  assert.throws(() => validateWindowEvidence(200, { ...snapshot, app: undefined }, dom, expected), /snapshot/);
  assert.throws(() => validateWindowEvidence(200, snapshot, { ...dom, version: 'v2.57.50' }, expected), /versão renderizada/);
  assert.throws(() => validateWindowEvidence(200, snapshot, { ...dom, navigation: [] }, expected), /navegação/);
  const brokenNavigation = dom.navigation.map(item => ({ ...item, visible: false }));
  assert.throws(() => validateWindowEvidence(200, snapshot, { ...dom, navigation: brokenNavigation }, expected), /painel/);
});

test('exit zero não aceita relatório antigo nem runtime/app diferentes em diretório reutilizado', () => {
  const expected = { name: 'probe-atual', expectedElectron: '44.1.0', expectedApp: '2.57.5' };
  const report = { probeId: expected.name, status: 'passed', versions: { electron: '44.1.0' }, expectedApp: '2.57.5' };
  assert.equal(validateSmokeReport(report, expected), report);
  assert.throws(() => validateSmokeReport({ ...report, probeId: 'probe-anterior' }, expected), /outra execução/);
  assert.throws(() => validateSmokeReport(null, expected), /ausente/);
  assert.throws(() => validateSmokeReport({ ...report, versions: { electron: '43.1.0' } }, expected), /runtime/);
  assert.throws(() => validateSmokeReport({ ...report, expectedApp: '2.57.4' }, expected), /versão/);
  assert.throws(() => validateSmokeReport({ ...report, status: 'running' }, expected), /prova completa/);
});

test('resolver do binário não importa o pacote nem dispara seu download preguiçoso', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-smoke-bin-'));
  try {
    const electronDir = path.join(root, 'node_modules', 'electron');
    const dist = path.join(electronDir, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(electronDir, 'index.js'), 'throw new Error("não deve executar o instalador");');
    assert.throws(() => installedElectronBinary(root), /Instale-o explicitamente/);
    fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');
    fs.writeFileSync(path.join(dist, 'electron.exe'), 'binário sintético, não executado');
    assert.equal(installedElectronBinary(root), path.join(dist, 'electron.exe'));
    fs.writeFileSync(path.join(electronDir, 'path.txt'), '../../fora.exe');
    assert.throws(() => installedElectronBinary(root), /fora da distribuição/);
  } finally {
    assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('smoke não herda credenciais, perfil real ou ELECTRON_RUN_AS_NODE', () => {
  const original = { PATH: '/bin', DISPLAY: ':99', GH_TOKEN: 'segredo', OPENAI_API_KEY: 'segredo',
    CLAUDE_CODE_OAUTH_TOKEN: 'segredo', NODE_OPTIONS: '--require coisa', ELECTRON_RUN_AS_NODE: '1',
    HOME: '/real', CLAUDE_CONFIG_DIR: '/real/claude', CODEX_HOME: '/real/codex' };
  const dirs = { home: '/isolado', farol: '/isolado/farol', appData: '/isolado/app', localData: '/isolado/cache' };
  const env = smokeEnv(original, dirs, '/isolado/probe.json');
  for (const key of ['GH_TOKEN', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_OPTIONS',
    'ELECTRON_RUN_AS_NODE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) assert.equal(key in env, false, key);
  assert.equal(env.HOME, '/isolado');
  assert.equal(env.USERPROFILE, '/isolado');
  assert.equal(env.FAROL_HOME, '/isolado/farol');
  assert.equal(env.PATH, original.PATH);
  assert.equal(env.DISPLAY, ':99');
  assert.equal(original.HOME, '/real', 'não altera o ambiente do chamador');
});

test('rede do renderer só acessa a origem HTTP isolada, sem bypass por prefixo', () => {
  const origin = 'http://127.0.0.1:51234';
  assert.equal(localRequest(origin + '/api/state', origin), true);
  assert.equal(localRequest('data:image/png;base64,AA==', origin), true);
  for (const url of ['https://github.com', 'http://127.0.0.1:51235', 'http://127.0.0.1.evil:51234',
    'http://127.0.0.1:51234@evil/', 'file:///etc/passwd', 'invalido']) {
    assert.equal(localRequest(url, origin), false, url);
  }
});
