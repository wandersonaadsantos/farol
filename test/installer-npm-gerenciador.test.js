// O instalador POSIX precisa achar o npm que só existe dentro do profile do shell.
//
// Caso medido em 11/09/2026 (Mac real, nvm do Homebrew): o Farol instalado rodava
// Electron 43, a v2.58 passou a exigir Electron 44, o pacote de update não traz
// Electron de propósito, e o fallback de rede do `electron-runtime.sh` morreu em
// "npm nao foi encontrado". O npm EXISTIA, em
// /opt/homebrew/opt/nvm/versions/node/v24.14.1/bin, mas o nvm só o põe no PATH
// dentro do profile do shell, e o instalador chega pelo app, que o Finder abriu com
// PATH mínimo. O auto-update falhava a cada ciclo, preservando a versão velha.
//
// `incluir_npm_de_gerenciador` descobre o npm dos gerenciadores de versão (nvm,
// fnm, volta) e o prependa no PATH SÓ quando npm não está acessível. Este teste
// roda a função de verdade em bash, com HOME e NVM_DIR falsos (é onde os layouts
// se ancoram). Pula no Windows e sem bash, como os demais testes posix reais.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import cp from 'node:child_process';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const IS_WIN = process.platform === 'win32';
const RAIZ = path.join(import.meta.dirname, '..');
const RUNTIME_SH = path.join(RAIZ, 'installer', 'electron-runtime.sh');
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

// um `npm` executável de mentira no layout do nvm: <raiz>/versions/node/<versao>/bin/npm
function semeiaNvm(raiz, versoes) {
  for (const v of versoes) {
    const bin = path.join(raiz, 'versions', 'node', v, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho stub\n', { mode: 0o755 });
  }
}

// roda a função com o mesmo `set -euo pipefail` dos instaladores e imprime o PATH
// resultante e onde `npm` foi parar. `ok` é o helper que os instaladores definem
// antes do source; aqui é um stub.
function roda({ home, nvmDir = '', pathInicial = '/usr/bin:/bin' }) {
  const script = [
    'set -euo pipefail',
    'ok() { :; }',
    `source '${RUNTIME_SH}'`,
    'incluir_npm_de_gerenciador',
    'printf "%s\\n" "$PATH"',
    'command -v npm || echo SEM_NPM',
  ].join('\n');
  const r = cp.spawnSync('/bin/bash', ['-c', script], {
    encoding: 'utf8',
    // HOMEBREW_PREFIX falso: sem isso o nvm REAL de /opt/homebrew da máquina de quem
    // roda a suíte vazaria pros casos "vazio" e "volta"
    env: { HOME: home, NVM_DIR: nvmDir, PATH: pathInicial, HOMEBREW_PREFIX: path.join(home, 'sem-homebrew') },
  });
  assert.equal(r.status, 0, `bash saiu ${r.status}: ${r.stderr}`);
  const [pathFinal, npm] = r.stdout.trim().split('\n');
  return { pathFinal, npm };
}

test('nvm em ~/.nvm: escolhe a versao MAIS NOVA por sort -V, nao a lexicamente maior', { skip: !temBash }, () => {
  const home = tmpdir('farol-home-nvm-');
  // v9 é lexicamente maior que v24; sort -V tem que preferir v24
  semeiaNvm(path.join(home, '.nvm'), ['v9.1.0', 'v18.20.0', 'v24.14.1']);
  const { npm } = roda({ home });
  assert.equal(npm, path.join(home, '.nvm', 'versions', 'node', 'v24.14.1', 'bin', 'npm'));
});

test('NVM_DIR declarado vence o ~/.nvm padrao (e o caso do nvm do Homebrew)', { skip: !temBash }, () => {
  const home = tmpdir('farol-home-nvmdir-');
  const custom = path.join(home, 'homebrew-nvm');
  semeiaNvm(path.join(home, '.nvm'), ['v24.14.1']);
  semeiaNvm(custom, ['v20.11.1']);
  const { npm } = roda({ home, nvmDir: custom });
  assert.equal(npm, path.join(custom, 'versions', 'node', 'v20.11.1', 'bin', 'npm'));
});

test('npm ja acessivel: o PATH nao muda, mesmo com nvm instalado', { skip: !temBash }, () => {
  const home = tmpdir('farol-home-sistema-');
  semeiaNvm(path.join(home, '.nvm'), ['v24.14.1']);
  const sistema = path.join(home, 'sistema-bin');
  fs.mkdirSync(sistema);
  fs.writeFileSync(path.join(sistema, 'npm'), '#!/bin/sh\necho sistema\n', { mode: 0o755 });
  const inicial = `${sistema}:/usr/bin:/bin`;
  const { pathFinal, npm } = roda({ home, pathInicial: inicial });
  assert.equal(pathFinal, inicial, 'npm visível: a função não pode mexer no PATH');
  assert.equal(npm, path.join(sistema, 'npm'));
});

test('nenhum gerenciador: nao encontra, nao morre sob set -e e deixa o PATH como estava', { skip: !temBash }, () => {
  const home = tmpdir('farol-home-vazio-');
  const { pathFinal, npm } = roda({ home });
  assert.equal(pathFinal, '/usr/bin:/bin');
  assert.equal(npm, 'SEM_NPM');
});

test('volta e fnm (alias default) tambem sao descobertos quando nao ha nvm', { skip: !temBash }, () => {
  const home = tmpdir('farol-home-volta-');
  const volta = path.join(home, '.volta', 'bin');
  fs.mkdirSync(volta, { recursive: true });
  fs.writeFileSync(path.join(volta, 'npm'), '#!/bin/sh\necho volta\n', { mode: 0o755 });
  const { npm } = roda({ home });
  assert.equal(npm, path.join(volta, 'npm'));
});

test('os dois instaladores POSIX chamam a descoberta ANTES de preparar o runtime', () => {
  for (const nome of ['install.sh', 'install-linux.sh']) {
    const fonte = fs.readFileSync(path.join(RAIZ, 'installer', nome), 'utf8');
    const chamada = fonte.indexOf('\nincluir_npm_de_gerenciador\n');
    const runtime = fonte.indexOf('\npreparar_runtime ');
    assert.ok(chamada > 0, `${nome}: não chama incluir_npm_de_gerenciador`);
    assert.ok(runtime > 0, `${nome}: não chama preparar_runtime`);
    assert.ok(chamada < runtime, `${nome}: a descoberta do npm tem que vir antes do preparar_runtime, que é quem consulta npm`);
  }
});

test('nvm do Homebrew: a raiz vem de HOMEBREW_PREFIX (o caso medido em 11/09/2026)', { skip: !temBash }, () => {
  const home = tmpdir('farol-home-brew-');
  const prefix = path.join(home, 'brew');
  semeiaNvm(path.join(prefix, 'opt', 'nvm'), ['v24.14.1']);
  const script = [
    'set -euo pipefail', 'ok() { :; }', `source '${RUNTIME_SH}'`,
    'incluir_npm_de_gerenciador', 'command -v npm || echo SEM_NPM',
  ].join('\n');
  const r = cp.spawnSync('/bin/bash', ['-c', script], {
    encoding: 'utf8', env: { HOME: home, NVM_DIR: '', PATH: '/usr/bin:/bin', HOMEBREW_PREFIX: prefix },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join(prefix, 'opt', 'nvm', 'versions', 'node', 'v24.14.1', 'bin', 'npm'));
});
