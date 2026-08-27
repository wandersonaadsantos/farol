// Update no macOS: o installer NÃO pode destruir o Electron já instalado.
//
// O pacote leve de update (farol-vX.Y.Z.zip) não traz node_modules de propósito ("O
// Electron NÃO viaja no update: a cópia instalada já tem, o installer preserva", em
// lib/engine/update.js). O install.ps1 do Windows honra isso: só copia node_modules
// quando a FONTE tem Electron, senão preserva o que está instalado. O install.sh do
// macOS fazia `rm -rf "$APP/node_modules"` seguido de `cp -R "$SRC/node_modules"` sem
// nenhuma guarda, então rodar o installer a partir de um pacote de update apagava o
// Electron e morria no cp (set -e), deixando ~/.farol/app sem como abrir. Reproduzido
// num Mac real em 17/08/2026 com o zip publicado da v2.47.0.
//
// A regressão é grave porque desde a v2.46.0 o autoUpdate é ligado por padrão
// (maybeAutoUpdate aplica sozinho quando o app está ocioso): sem esta guarda, toda
// instalação de macOS se quebraria na primeira release seguinte, sem clique nenhum.
//
// O teste roda o install.sh DE VERDADE, com HOME falso (o script ancora tudo em
// $HOME/.farol e $HOME/Applications, então HOME é o sandbox) e com um `pkill` neutro
// em $HOME/.local/bin, que o próprio script prependa no PATH: sem isso o `pkill -f
// '\.farol/app'` do installer mataria o Farol de verdade da máquina de quem roda a
// suíte. Pula no Windows e sem bash, como os demais testes posix reais.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import cp from 'node:child_process';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const IS_WIN = process.platform === 'win32';
const RAIZ = path.join(import.meta.dirname, '..');
const INSTALL_SH = path.join(RAIZ, 'installer', 'install.sh');
const temBash = !IS_WIN && fs.existsSync('/bin/bash');

const temporarios = [];
after(() => {
  for (const d of temporarios) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

function tmpdir(prefixo) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  temporarios.push(d);
  return d;
}

// fonte no formato do PACOTE DE UPDATE: as pastas do app, SEM node_modules
function montaPacoteDeUpdate() {
  const src = tmpdir('farol-src-update-');
  for (const d of ['lib', 'ui', 'assets', 'installer', 'workspace-template/.claude', 'workspace-template/prompts']) {
    fs.mkdirSync(path.join(src, d), { recursive: true });
  }
  fs.writeFileSync(path.join(src, 'workspace-template', 'CLAUDE.md'), '# protocolo de review\n');
  fs.writeFileSync(path.join(src, 'workspace-template', 'prompts', 'pr-review-auto.md'), 'prompt\n');
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'farol', version: '9.9.9', type: 'module' }, null, 2) + '\n');
  fs.writeFileSync(path.join(src, 'main.js'), '// shell\n');
  fs.writeFileSync(path.join(src, 'server.js'), '// engine\n');
  fs.copyFileSync(INSTALL_SH, path.join(src, 'installer', 'install.sh'));
  assert.equal(fs.existsSync(path.join(src, 'node_modules')), false, 'a fonte simula o zip de update: sem node_modules');
  return src;
}

// instalação já existente, com o Electron que o update precisa PRESERVAR
function montaInstalacaoExistente() {
  const home = tmpdir('farol-home-update-');
  const macos = path.join(home, '.farol', 'app', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(path.join(home, '.farol', 'app', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Electron</string>
  <key>CFBundleDisplayName</key><string>Electron</string>
  <key>CFBundleIdentifier</key><string>com.github.Electron</string>
  <key>CFBundleExecutable</key><string>Electron</string>
</dict>
</plist>
`);
  const nativo = path.join(macos, 'Electron');
  fs.writeFileSync(nativo, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(nativo, 0o755);
  fs.mkdirSync(path.join(home, '.farol', 'app', 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.farol', 'app', 'node_modules', '.bin', 'electron'), '');
  // pkill neutro: o installer prependa $HOME/.local/bin no PATH, então este vence o
  // /usr/bin/pkill e o `pkill -f '\.farol/app'` do script não mata o Farol real
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const falso = path.join(bin, 'pkill');
  fs.writeFileSync(falso, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(falso, 0o755);
  return { home, nativo };
}

test('install.sh a partir do pacote de update PRESERVA o Electron instalado', { skip: temBash ? false : 'só roda em POSIX com bash' }, () => {
  const src = montaPacoteDeUpdate();
  const { home, nativo } = montaInstalacaoExistente();

  const r = cp.spawnSync('/bin/bash', [path.join(src, 'installer', 'install.sh')], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });

  assert.equal(r.status, 0, `installer falhou (status ${r.status}): ${(r.stdout || '') + (r.stderr || '')}`);
  assert.ok(fs.existsSync(nativo), 'o binário nativo do Electron continua lá: sem ele o lançador não abre nada');
  assert.ok(fs.statSync(nativo).mode & 0o111, 'o binário nativo continua executável');
});

test('install.sh ajusta a identidade visível do Electron preservado', { skip: temBash ? false : 'só roda em POSIX com bash' }, () => {
  const src = montaPacoteDeUpdate();
  const { home } = montaInstalacaoExistente();

  const r = cp.spawnSync('/bin/bash', [path.join(src, 'installer', 'install.sh')], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });

  assert.equal(r.status, 0, `installer falhou: ${(r.stdout || '') + (r.stderr || '')}`);
  const plist = fs.readFileSync(path.join(home, '.farol', 'app', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, /<key>CFBundleName<\/key><string>Farol<\/string>/, 'menu/Cmd-Tab nao podem herdar Electron como nome');
  assert.match(plist, /<key>CFBundleDisplayName<\/key><string>Farol<\/string>/, 'nome visivel do bundle interno vira Farol');
  assert.match(plist, /<key>CFBundleIdentifier<\/key><string>com\.biud\.farol\.electron<\/string>/, 'bundle interno deixa de usar o identificador generico do Electron');
  assert.match(plist, /<key>CFBundleExecutable<\/key><string>Electron<\/string>/, 'executavel nativo continua sendo o binario real do Electron');
});

test('install.sh a partir do pacote de update ainda recria o lançador e o app', { skip: temBash ? false : 'só roda em POSIX com bash' }, () => {
  const src = montaPacoteDeUpdate();
  const { home } = montaInstalacaoExistente();

  const r = cp.spawnSync('/bin/bash', [path.join(src, 'installer', 'install.sh')], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });

  assert.equal(r.status, 0, `installer falhou: ${(r.stdout || '') + (r.stderr || '')}`);
  const lancador = path.join(home, 'Applications', 'Farol.app', 'Contents', 'MacOS', 'Farol');
  assert.ok(fs.existsSync(lancador), 'lançador recriado');
  assert.ok(fs.existsSync(path.join(home, '.farol', 'app', 'server.js')), 'código novo copiado');
  const plist = fs.readFileSync(path.join(home, 'Applications', 'Farol.app', 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, /9\.9\.9/, 'a versão do pacote entra no Info.plist (sed do package.json, sem node)');
});

test('install.sh com fonte COMPLETA (primeira instalação) continua copiando node_modules', { skip: temBash ? false : 'só roda em POSIX com bash' }, () => {
  const src = montaPacoteDeUpdate();
  // agora a fonte TEM node_modules, como o pacote offline/repo: tem que ser copiado
  const macos = path.join(src, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(path.join(macos, 'Electron'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(macos, 'Electron'), 0o755);
  fs.writeFileSync(path.join(src, 'node_modules', 'MARCADOR-DA-FONTE'), 'veio da fonte\n');

  const { home } = montaInstalacaoExistente();
  const r = cp.spawnSync('/bin/bash', [path.join(src, 'installer', 'install.sh')], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });

  assert.equal(r.status, 0, `installer falhou: ${(r.stdout || '') + (r.stderr || '')}`);
  assert.ok(fs.existsSync(path.join(home, '.farol', 'app', 'node_modules', 'MARCADOR-DA-FONTE')),
    'fonte com node_modules ainda sobrescreve o instalado (caminho da primeira instalação)');
});
