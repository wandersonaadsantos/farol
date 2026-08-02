'use strict';
// Cobre o colaborador de update (lib/engine/update.js): cmpVersion puro,
// resolveUpdateSource e a delegação da Engine. Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-update-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const update = require('../lib/engine/update');
const { APP_ROOT } = require('../lib/paths');
const { Engine } = require('../server.js');

const scratch = path.join(os.tmpdir(), 'farol-test-update-src-' + process.pid);
after(() => {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('cmpVersion compara semver numericamente (não lexicograficamente)', () => {
  assert.equal(update.cmpVersion('1.2.0', '1.2.0'), 0);
  assert.ok(update.cmpVersion('1.3.0', '1.2.9') > 0);
  assert.ok(update.cmpVersion('1.2.0', '1.10.0') < 0, '10 > 2 numérico, não "1" < "2" textual');
  assert.ok(update.cmpVersion('2.0.0', '1.9.9') > 0);
  assert.equal(update.cmpVersion('1.2', '1.2.0'), 0, 'partes faltantes valem 0');
});

test('resolveUpdateSource: sem updateSource explícito devolve null', () => {
  assert.equal(update.resolveUpdateSource({ config: {} }), null);
  assert.equal(update.resolveUpdateSource({ config: { updateSource: '   ' } }), null);
});

test('resolveUpdateSource: apontar pra própria fonte (dev) devolve null', () => {
  assert.equal(update.resolveUpdateSource({ config: { updateSource: APP_ROOT } }), null);
});

test('resolveUpdateSource: pasta com package.json farol válido vira fonte', () => {
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'farol', version: '9.9.9' }));
  assert.deepEqual(update.resolveUpdateSource({ config: { updateSource: scratch } }), { path: scratch, version: '9.9.9' });
});

test('resolveUpdateSource: package.json de outro projeto é ignorado', () => {
  const other = path.join(scratch, 'other');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'outra-coisa', version: '1.0.0' }));
  assert.equal(update.resolveUpdateSource({ config: { updateSource: other } }), null);
});

test('Engine delega para o colaborador (fachada fina, mesmo comportamento)', () => {
  const engine = new Engine();
  assert.equal(typeof engine.cmpVersion, 'function');
  assert.ok(engine.cmpVersion('1.1.0', '1.0.0') > 0, 'delegação de cmpVersion');
  assert.equal(engine.resolveUpdateSource(), null, 'config default não tem updateSource');
});

test('buildUpdateLaunchCommand: caminho com espaço sai citado no -File (M14)', () => {
  // PS 5.1: Start-Process junta o -ArgumentList com espaço SEM citar cada item.
  // Perfil "C:\Users\Nome Sobrenome" partia o -File em dois argumentos e o
  // installer morria numa janela oculta DEPOIS do ok:true e do toast de sucesso.
  const script = 'C:\\Users\\Nome Sobrenome\\.farol\\sessions\\update-1.ps1';
  const cmd = update.buildUpdateLaunchCommand(script);
  assert.ok(cmd.startsWith('Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '),
    'forma geral do comando preservada');
  assert.ok(cmd.endsWith(`'-File','"` + script + `"'`),
    'aspas duplas embutidas sobrevivem à junção do -ArgumentList e chegam inteiras no filho');
});

test('buildUpdateLaunchCommand: apóstrofo no caminho é dobrado (string single-quoted do PS)', () => {
  const cmd = update.buildUpdateLaunchCommand("C:\\Users\\O'Brien\\.farol\\sessions\\update-2.ps1");
  assert.ok(cmd.includes("O''Brien"), 'apóstrofo dobrado, a string do -Command não quebra');
});

test('applyUpdate: sem update disponível devolve ok:false (baseline, sem rede)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  engine.config.updateSource = '';
  const r = await update.applyUpdate(engine, {});
  assert.deepEqual(r, { ok: false, error: 'nenhuma atualização disponível' });
});

test('applyUpdate: usa o checkUpdate injetado (costura de teste)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  let usado = false;
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => {
      usado = true;
      e.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: null, available: false, checkedAt: Date.now() };
    }
  });
  assert.equal(usado, true, 'o applyUpdate honrou deps.checkUpdate');
  assert.equal(r.ok, false);
});

// engine.update remoto com release disponível, como o checkUpdate real deixaria
function updateRemotoDisponivel(e) {
  e.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: '9.9.9', available: true, checkedAt: Date.now() };
}

test('applyUpdate: checkUpdate concorrente durante o download não órfã o source (M13)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm13-extracted');
  fs.mkdirSync(dir, { recursive: true }); // de propósito SEM installer/: o fluxo para ANTES de qualquer spawn
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async (e) => {
      // o ciclo de polling rodou checkUpdate no MEIO do download e reatribuiu engine.update
      updateRemotoDisponivel(e);
      return dir;
    }
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /installer não encontrado/, 'parou no installer ausente, não em path.join(null)');
  assert.equal(engine.update.source, dir, 'source gravado no objeto ATUAL de engine.update, não no órfão');
});

test('applyUpdate: revisão iniciada DURANTE o download barra o installer (M15)', async () => {
  const engine = new Engine();
  engine.config.updateRepo = '';
  const dir = path.join(scratch, 'm15-extracted');
  fs.mkdirSync(dir, { recursive: true }); // sem installer/: nem um fluxo quebrado chega ao spawn
  const r = await update.applyUpdate(engine, {
    checkUpdate: async (e) => updateRemotoDisponivel(e),
    downloadRemoteUpdate: async (e) => {
      // o polling iniciou uma revisão headless enquanto o download (minutos) rodava
      e.headlessQueue.push({ key: 'org/repo#1', url: 'https://github.com/org/repo/pull/1' });
      return dir;
    }
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /análise ou chat em andamento/,
    'a checagem de ocupado precisa RE-rodar depois do download, não só antes');
});
