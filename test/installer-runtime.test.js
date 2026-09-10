// Prova do staging POSIX: um download falho ou runtime recusado nao muda o
// Electron antigo. Os executaveis/npm sao sinteticos; a orquestracao e real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const temporarios = [];
after(() => { for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true }); });
const slash = s => s.replaceAll('\\', '/');

function runtimeFixture(aceita, npmMode, bundled = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-runtime-test-'));
  temporarios.push(dir);
  const src = path.join(dir, 'source'), app = path.join(dir, 'installed');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'package.json'), '{"dependencies":{"electron":"^44.1.0"}}');
  const stub = status => `#!/bin/bash\n[ "$ELECTRON_RUN_AS_NODE" = 1 ] || exit 8\n[ "$2" = check-running ] || exit 9\nexit ${status}\n`;
  const writeNative = (base, status) => {
    const file = path.join(base, 'node_modules/electron/dist/electron');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, stub(status)); fs.chmodSync(file, 0o755);
    return file;
  };
  const previous = writeNative(app, aceita ? 0 : 1);
  const good = writeNative(path.join(dir, 'good'), npmMode === 'invalid' ? 1 : 0);
  if (bundled) writeNative(src, 1);
  fs.writeFileSync(path.join(app, 'server.js'), 'codigo anterior');
  const script = `
    SRC="$TEST_SRC"; APP="$TEST_APP"; TARGET_ARCH=x64
    die() { echo "$1"; exit 1; }; step() { :; }; ok() { :; }
    npm() {
      echo chamado >> "$TEST_NPM_LOG"
      [ "$TEST_NPM_MODE" != fail ] || return 23
      mkdir -p node_modules/electron/dist
      cp "$TEST_GOOD" node_modules/electron/dist/electron
    }
    source "$TEST_HELPER"
    preparar_runtime 'electron/dist/electron'
    printf 'RUNTIME_VALIDADO\\n'
    [ "$(cat "$APP/server.js")" = 'codigo anterior' ] || exit 24
    [ "$TEST_INSTALL" != yes ] || instalar_runtime
  `;
  const run = install => cp.spawnSync(BASH, ['-c', script], {
    env: { ...process.env, TEST_SRC: slash(src), TEST_APP: slash(app), TEST_NPM_MODE: npmMode,
      TEST_GOOD: slash(good), TEST_NPM_LOG: slash(path.join(dir, 'npm.log')), TEST_INSTALL: install ? 'yes' : 'no',
      TEST_HELPER: slash(path.join(RAIZ, 'installer/electron-runtime.sh')) },
    encoding: 'utf8', timeout: 30000,
  });
  return { dir, app, previous, before: fs.readFileSync(previous, 'utf8'), run };
}

const skip = fs.existsSync(BASH) ? false : 'bash indisponivel';
test('runtime compativel instalado: preserva sem chamar npm', { skip }, () => {
  const f = runtimeFixture(true, 'fail');
  const r = f.run(true);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(f.previous, 'utf8'), f.before);
  assert.equal(fs.existsSync(path.join(f.dir, 'npm.log')), false);
});

for (const mode of ['fail', 'invalid']) {
  test(`runtime antigo com preparo ${mode}: falha preservando o app anterior`, { skip }, () => {
    const f = runtimeFixture(false, mode);
    const r = f.run(true);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /instalacao existente foi preservada/);
    assert.doesNotMatch(r.stdout, /RUNTIME_VALIDADO/);
    assert.equal(fs.readFileSync(f.previous, 'utf8'), f.before);
    assert.equal(fs.readFileSync(path.join(f.app, 'server.js'), 'utf8'), 'codigo anterior');
  });
}

test('runtime novo validado em staging: so entao substitui o antigo', { skip }, () => {
  const f = runtimeFixture(false, 'ok');
  const r = f.run(true);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.notEqual(fs.readFileSync(f.previous, 'utf8'), f.before);
  assert.match(r.stdout, /RUNTIME_VALIDADO/);
});

test('runtime incompatível no pacote offline: falha sem download ou alteracao', { skip }, () => {
  const f = runtimeFixture(true, 'ok', true);
  const r = f.run(true);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(fs.existsSync(path.join(f.dir, 'npm.log')), false);
  assert.equal(fs.readFileSync(f.previous, 'utf8'), f.before);
});

test('todos instaladores validam runtime antes de encerrar processos e copiar codigo', () => {
  for (const name of ['install.sh', 'install-linux.sh', 'install.ps1']) {
    const s = fs.readFileSync(path.join(RAIZ, 'installer', name), 'utf8');
    const prepare = name.endsWith('.ps1') ? s.indexOf('$Runtime = Prepare-ElectronRuntime') : s.indexOf('preparar_runtime ');
    assert.ok(prepare > 0 && prepare < s.indexOf('# --- encerra instancias'), name);
    assert.ok(prepare < s.indexOf('# --- copia do app'), name);
  }
});

for (const fail of [true, false]) {
  test(`Windows: npm sem dist, install.js ${fail ? 'falha sem tocar app' : 'prepara antes de copiar'}`,
    { skip: process.platform === 'win32' ? false : 'PowerShell nativo Windows' }, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-runtime-win-test-'));
      temporarios.push(dir);
      const src = path.join(dir, 'source'), app = path.join(dir, 'installed');
      fs.mkdirSync(src);
      fs.mkdirSync(path.join(app, 'node_modules/electron/dist'), { recursive: true });
      fs.writeFileSync(path.join(src, 'package.json'), '{"dependencies":{"electron":"^44.1.0"}}');
      const previous = path.join(app, 'node_modules/electron/dist/electron.exe');
      fs.writeFileSync(previous, '43.1.0');
      const script = `
        $ErrorActionPreference = 'Stop'
        $Src=$env:TEST_SRC; $App=$env:TEST_APP
        function Die($msg) { Write-Output $msg; Write-Output $Error[0].Exception.Message; exit 1 }; function Step($msg) {}; function Ok($msg) {}
        . $env:TEST_HELPER
        # Executavel e npm sinteticos; staging, fallback e cleanup sao os reais.
        function Test-ElectronRuntime($Candidate) {
          return (Test-Path -LiteralPath $Candidate) -and ((Get-Content -LiteralPath $Candidate -Raw) -eq '44.1.0')
        }
        function npm {
          New-Item -ItemType Directory -Force 'node_modules/electron' | Out-Null
          Set-Content 'node_modules/electron/install.js' 'stub'
          $global:LASTEXITCODE=0
        }
        function node {
          Set-Content -LiteralPath $env:TEST_MARKER 'install.js chamado'
          if ($env:TEST_FAIL -eq 'yes') { $global:LASTEXITCODE=17; return }
          New-Item -ItemType Directory -Force 'node_modules/electron/dist' | Out-Null
          Set-Content -NoNewline -LiteralPath 'node_modules/electron/dist/electron.exe' -Value '44.1.0'
          $global:LASTEXITCODE=0
        }
        $runtime=Prepare-ElectronRuntime
        if ((Get-Content -LiteralPath (Join-Path $App 'node_modules/electron/dist/electron.exe') -Raw) -ne '43.1.0') { exit 8 }
        Write-Output RUNTIME_VALIDADO
        Clear-ElectronRuntimeStage $runtime.Stage
        if (Test-Path -LiteralPath $runtime.Stage) { exit 9 }
      `;
      const file = path.join(dir, 'test.ps1');
      fs.writeFileSync(file, script);
      const marker = path.join(dir, 'node.log');
      const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
        env: { ...process.env, TEST_SRC: src, TEST_APP: app, TEST_HELPER: path.join(RAIZ, 'installer/electron-runtime.ps1'),
          TEST_MARKER: marker, TEST_FAIL: fail ? 'yes' : 'no' }, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(r.status, fail ? 1 : 0, r.stdout + r.stderr);
      assert.equal(fs.readFileSync(previous, 'utf8'), '43.1.0');
      assert.match(fs.readFileSync(marker, 'utf8'), /install.js chamado/);
      assert.equal(r.stdout.includes('RUNTIME_VALIDADO'), !fail);
    });
}

test('Windows: recria Farol.exe quando o hardlink ainda aponta pro Electron antigo',
  { skip: process.platform === 'win32' ? false : 'hardlink NTFS/PowerShell' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-hardlink-test-'));
    temporarios.push(dir);
    const installer = fs.readFileSync(path.join(RAIZ, 'installer/install.ps1'), 'utf8');
    const start = installer.indexOf('$farolExe =');
    const end = installer.indexOf('# --- workspace', start);
    assert.ok(start > 0 && end > start);
    const script = `
      $ErrorActionPreference='Stop'
      $electronExe=Join-Path $env:TEST_DIR 'electron.exe'
      $old=Join-Path $env:TEST_DIR 'old.exe'
      Set-Content -NoNewline -LiteralPath $old '43.1.0'
      Set-Content -NoNewline -LiteralPath $electronExe '44.1.0'
      New-Item -ItemType HardLink -Path (Join-Path $env:TEST_DIR 'Farol.exe') -Target $old | Out-Null
      ${installer.slice(start, end)}
      Get-Content -LiteralPath $farolExe -Raw
    `;
    const file = path.join(dir, 'test.ps1');
    fs.writeFileSync(file, script);
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
      env: { ...process.env, TEST_DIR: dir }, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /44\.1\.0/);
    assert.equal(fs.readFileSync(path.join(dir, 'Farol.exe'), 'utf8'), '44.1.0');
    assert.equal(fs.readFileSync(path.join(dir, 'old.exe'), 'utf8'), '43.1.0');
  });

test('Windows: cleanup recusa caminho fora do staging permitido e preserva seus arquivos',
  { skip: process.platform === 'win32' ? false : 'PowerShell nativo Windows' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-cleanup-test-'));
    temporarios.push(dir);
    fs.writeFileSync(path.join(dir, 'preservar'), 'evidencia');
    const file = path.join(dir, 'test.ps1');
    fs.writeFileSync(file, `
      $ErrorActionPreference='Stop'
      . $env:TEST_HELPER
      try { Clear-ElectronRuntimeStage $env:TEST_DIR; exit 9 }
      catch { Write-Output $_.Exception.Message; exit 0 }
    `);
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
      env: { ...process.env, TEST_DIR: dir, TEST_HELPER: path.join(RAIZ, 'installer/electron-runtime.ps1') },
      encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /fora do diretorio permitido/);
    assert.equal(fs.readFileSync(path.join(dir, 'preservar'), 'utf8'), 'evidencia');
  });
