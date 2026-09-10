// Helpers puros do smoke real do Electron. Nenhum deles importa o runtime nativo.
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';

function installedElectronBinary(root) {
  const electronDir = path.join(root, 'node_modules', 'electron');
  const dist = path.join(electronDir, 'dist');
  let relative;
  try { relative = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim(); }
  catch { throw new Error('Binário Electron ausente. Instale-o explicitamente antes do smoke: node node_modules/electron/install.js'); }
  const bin = path.resolve(dist, relative);
  if (!relative || !bin.startsWith(dist + path.sep) || !fs.statSync(bin).isFile()) {
    throw new Error('Caminho do binário Electron inválido ou fora da distribuição instalada.');
  }
  return bin;
}

function smokeEnv(original, dirs, configFile) {
  const env = { ...original };
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)) delete env[key];
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_OVERRIDE_DIST_PATH', 'NODE_OPTIONS', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) delete env[key];
  return { ...env, FAROL_HOME: dirs.farol, FAROL_ELECTRON_SMOKE_CONFIG: configFile,
    HOME: dirs.home, USERPROFILE: dirs.home, APPDATA: dirs.appData, LOCALAPPDATA: dirs.localData,
    XDG_CONFIG_HOME: dirs.appData, XDG_CACHE_HOME: dirs.localData,
    GH_CONFIG_DIR: path.join(dirs.home, 'gh'), GIT_CONFIG_GLOBAL: path.join(dirs.home, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
}

function localRequest(url, origin) {
  try { return new URL(url).origin === origin || String(url).startsWith('data:'); }
  catch { return false; }
}

function validateSmokeReport(report, expected) {
  if (!report || report.probeId !== expected.name) throw new Error('Relatório ausente ou pertencente a outra execução do smoke.');
  if (report.status !== 'passed') throw new Error('O processo encerrou sem prova completa do smoke.');
  if (report.versions?.electron !== expected.expectedElectron || report.expectedApp !== expected.expectedApp) {
    throw new Error('Relatório não comprova o runtime e a versão do app desta execução.');
  }
  return report;
}

function validateWindowEvidence(httpStatus, snapshot, dom, expected) {
  assert.equal(httpStatus, 200, 'snapshot HTTP deve responder 200');
  assert.deepEqual(snapshot?.app, { name: 'Farol', version: expected.expectedApp, platform: expected.platform }, 'snapshot identifica o app real');
  assert.equal(dom.title, 'Farol');
  assert.equal(dom.brand, 'Farol');
  assert.equal(dom.version, `v${snapshot.app.version}`, 'versão renderizada deve corresponder ao snapshot HTTP');
  assert.deepEqual(dom.navigation?.map(item => item.tab), ['consumo', 'radar'], 'navegação deve executar ida e volta');
  for (const item of dom.navigation) {
    assert.equal(item.selected, true, 'botão real deve selecionar a aba');
    assert.equal(item.visible, true, 'painel da aba deve ficar visível');
    assert.equal(item.activePanels, 1, 'só um painel deve ficar ativo');
    assert.equal(item.bodyTab, item.tab, 'handler real atualiza a aba no body');
  }
}

function validateLoginItem(settings, expected, enabled) {
  const own = settings.launchItems.filter(item => item.name === expected.name);
  assert.equal(own.length, enabled ? 1 : 0, 'entrada isolada deve existir só enquanto habilitada');
  if (!enabled) return;
  assert.equal(own[0].enabled, true, 'entrada isolada deve estar habilitada');
  assert.equal(own[0].scope, 'user', 'entrada isolada deve pertencer ao usuário');
  assert.equal(path.win32.normalize(own[0].path).toLowerCase(), path.win32.normalize(expected.path).toLowerCase());
  assert.deepEqual(own[0].args, expected.args, 'argumentos devem corresponder ao probe isolado');
}

export { installedElectronBinary, smokeEnv, localRequest, validateSmokeReport, validateWindowEvidence, validateLoginItem };
