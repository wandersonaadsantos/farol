// Electron 44 remove macOS 12, Windows ia32 e Linux armv7l. Executamos o
// preflight REAL de cada instalador: o marcador fica na fronteira que encerra
// processos/copia arquivos. Plataforma recusada nao pode atravessar a fronteira.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const temporarios = [];
after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-platform-'));
  temporarios.push(dir);
  fs.mkdirSync(path.join(dir, 'installer'));
  const antigo = path.join(dir, 'instalacao-anterior');
  fs.writeFileSync(antigo, 'preservar');
  return { dir, antigo };
}

function preflight(installer) {
  const texto = fs.readFileSync(path.join(RAIZ, installer), 'utf8');
  const limite = texto.indexOf('# --- runtime antes de alterar') >= 0
    ? texto.indexOf('# --- runtime antes de alterar') : texto.indexOf('# --- encerra instancias');
  assert.ok(limite > 0, 'fronteira de encerramento/copia deve continuar identificavel');
  return texto.slice(0, limite);
}

function bashPreflight(installer, { sistema, arch, version = '13.0' }) {
  const { dir, antigo } = sandbox();
  const file = path.join(dir, 'installer', 'install.sh');
  fs.writeFileSync(file, preflight(installer) + '\nprintf "PREPARACAO_ATINGIDA\\n"\n');
  const r = cp.spawnSync(BASH, ['-c', `
    uname() { if [ "$1" = '-s' ]; then printf '%s\\n' "$TEST_OS"; else printf '%s\\n' "$TEST_ARCH"; fi; }
    sw_vers() { printf '%s\\n' "$TEST_MAC_VERSION"; }
    export -f uname sw_vers
    source "$1"
  `, 'teste', file.replaceAll('\\', '/')], {
    env: { ...process.env, HOME: dir, TEST_OS: sistema, TEST_ARCH: arch, TEST_MAC_VERSION: version },
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(fs.readFileSync(antigo, 'utf8'), 'preservar');
  return { ...r, output: `${r.stdout || ''}${r.stderr || ''}` };
}

const semBash = fs.existsSync(BASH) ? false : 'bash indisponivel';
for (const version of ['11.7.10', '12.7.6', 'indisponivel', '']) {
  test(`macOS ${version || 'sem versao'}: recusa antes de tocar instalacao`, { skip: semBash }, () => {
    const r = bashPreflight('installer/install.sh', { sistema: 'Darwin', arch: 'arm64', version });
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /macOS 13/);
    assert.doesNotMatch(r.output, /PREPARACAO_ATINGIDA/);
  });
}

for (const arch of ['x86_64', 'arm64']) {
  test(`macOS 13 ${arch}: preflight permite instalacao`, { skip: semBash }, () => {
    const r = bashPreflight('installer/install.sh', { sistema: 'Darwin', arch });
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /PREPARACAO_ATINGIDA/);
  });
}

test('macOS com arquitetura desconhecida: recusa antes de preparar instalacao', { skip: semBash }, () => {
  const r = bashPreflight('installer/install.sh', { sistema: 'Darwin', arch: 'i386' });
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /Intel.*Apple Silicon/);
  assert.doesNotMatch(r.output, /PREPARACAO_ATINGIDA/);
});

for (const arch of ['armv7l', 'i686', 'desconhecida']) {
  test(`Linux ${arch}: recusa antes de parar processos ou baixar Electron`, { skip: semBash }, () => {
    const r = bashPreflight('installer/install-linux.sh', { sistema: 'Linux', arch });
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /64 bits.*x64.*arm64/);
    assert.doesNotMatch(r.output, /PREPARACAO_ATINGIDA/);
  });
}

for (const arch of ['x86_64', 'aarch64']) {
  test(`Linux ${arch}: preflight permite instalacao`, { skip: semBash }, () => {
    const r = bashPreflight('installer/install-linux.sh', { sistema: 'Linux', arch });
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /PREPARACAO_ATINGIDA/);
  });
}

for (const is64 of [false, true]) {
  test(`Windows ${is64 ? '64' : '32'} bits: valida sistema antes de preparar instalacao`,
    { skip: process.platform === 'win32' ? false : 'preflight PowerShell nativo do Windows' }, () => {
      const { dir, antigo } = sandbox();
      // Somente a leitura nativa de bitness e simulada. A decisao e sua posicao
      // antes do encerramento/copia continuam sendo as do instalador real.
      const script = preflight('installer/install.ps1')
        .replaceAll('[Environment]::Is64BitOperatingSystem', is64 ? '$true' : '$false');
      const file = path.join(dir, 'installer', 'install.ps1');
      fs.writeFileSync(file, script + '\nWrite-Output "PREPARACAO_ATINGIDA"\n');
      const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file,
        '-NoShortcuts', '-Root', path.join(dir, 'root')], { encoding: 'utf8', timeout: 15000 });
      const output = `${r.stdout || ''}${r.stderr || ''}`;
      assert.equal(r.status, is64 ? 0 : 1, output);
      assert.equal(fs.readFileSync(antigo, 'utf8'), 'preservar');
      if (is64) assert.match(output, /PREPARACAO_ATINGIDA/);
      else {
        assert.match(output, /Windows de 64 bits/);
        assert.doesNotMatch(output, /PREPARACAO_ATINGIDA/);
      }
    });
}

test('launcher macOS declara o minimo do Electron 44', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'installer/install.sh'), 'utf8');
  assert.match(texto, /<key>LSMinimumSystemVersion<\/key><string>13\.0<\/string>/);
});

for (const arch of ['armv7l', 'arm64', 'x64']) {
  test(`build offline macOS ARCH=${arch}: valida alvo antes de baixar`, { skip: semBash }, () => {
    const { dir } = sandbox();
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.mkdirSync(path.join(dir, 'node_modules/electron'), { recursive: true });
    const texto = fs.readFileSync(path.join(RAIZ, 'tools/make-offline-mac.sh'), 'utf8');
    const limite = texto.indexOf('BUILD=');
    assert.ok(limite > 0, 'limite anterior ao staging e ao download');
    const file = path.join(dir, 'tools/make-offline-mac.sh');
    fs.writeFileSync(file, texto.slice(0, limite) + '\nprintf "PREPARACAO_ATINGIDA\\n"\n');
    const r = cp.spawnSync(BASH, ['-c', 'node() { echo 44.1.0; }; export -f node; source "$1"',
      'teste', file.replaceAll('\\', '/')], { env: { ...process.env, ARCH: arch }, encoding: 'utf8', timeout: 15000 });
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    assert.equal(r.status, arch === 'armv7l' ? 1 : 0, output);
    if (arch === 'armv7l') {
      assert.match(output, /ARCH.*arm64.*x64/);
      assert.doesNotMatch(output, /PREPARACAO_ATINGIDA/);
    } else assert.match(output, /PREPARACAO_ATINGIDA/);
  });
}
