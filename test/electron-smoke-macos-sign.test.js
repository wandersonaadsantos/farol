// Comandos de assinatura sao sinteticos; o wrapper, guardas e cleanup rodam em bash.
// A prova da assinatura/notificacao nativa pertence ao job Electron no macOS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { IS_WIN } from '../lib/paths.js';

const bash = IS_WIN ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const script = new URL('../tools/electron-smoke-macos-sign.sh', import.meta.url);
const dirs = [];
after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const slash = value => value.replaceAll('\\', '/');
const skip = !fs.existsSync(bash);

function runFixture(mode = '', extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sign-test-'));
  dirs.push(dir);
  const root = path.join(dir, 'checkout'), temp = path.join(dir, 'temp');
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/electron/dist/Electron.app'), { recursive: true });
  fs.mkdirSync(temp);
  fs.copyFileSync(script, path.join(root, 'tools/electron-smoke-macos-sign.sh'));
  const preload = path.join(dir, 'commands.sh');
  fs.writeFileSync(preload, `
    uname() { echo Darwin; }
    openssl() {
      case "$1" in
        rand) echo synthetic-secret ;;
        x509) echo 'SHA1 Fingerprint=AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA' ;;
        req) : ;;
      esac
    }
    security() {
      if [ "$1 \${2:-} \${3:-}" = 'list-keychains -d user' ] && [ "$#" = 3 ]; then
        printf '    "/Users/runner/Library/Keychains/login.keychain-db"\\n    "/Users/runner/keychains/with spaces.keychain-db"\\n'
      elif [ "$1" = find-identity ]; then
        [ "$TEST_MODE" = no-identity ] || echo '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "fixture"'
      elif [ "$1" = list-keychains ] && [ "$#" = 6 ]; then
        [ "$5" = '/Users/runner/Library/Keychains/login.keychain-db' ] || return 30
        [ "$6" = '/Users/runner/keychains/with spaces.keychain-db' ] || return 31
        echo restored >> "$TEST_LOG"
      elif [ "$1" = delete-keychain ]; then
        case "$2" in */farol-smoke-sign.*/test.keychain-db) :;; *) return 33;; esac
        echo deleted >> "$TEST_LOG"
      elif [ "$1" = create-keychain ]; then
        echo created >> "$TEST_LOG"
      elif [ "$1" = unlock-keychain ] && [ "$TEST_MODE" = unlock-fail ]; then
        return 34
      fi
    }
    codesign() {
      if [ "$1" = --verify ]; then
        echo verified >> "$TEST_LOG"
        [ "$TEST_MODE" != verify-fail ] || return 32
      else echo signed >> "$TEST_LOG"; fi
    }
    function /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister() {
      echo registered >> "$TEST_LOG"
    }
    node() {
      if [ "$1" = --test ]; then echo mcp >> "$TEST_LOG"; else echo smoke >> "$TEST_LOG"; fi
      [ "$TEST_MODE" != child-fail ] || return 23
    }
  `);
  const result = spawnSync(bash, [slash(path.join(root, 'tools/electron-smoke-macos-sign.sh'))], {
    env: { ...process.env, BASH_ENV: slash(preload), CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS',
      GITHUB_WORKSPACE: slash(root), RUNNER_TEMP: slash(temp), TEST_MODE: mode,
      TEST_LOG: slash(path.join(dir, 'calls.log')), ...extraEnv },
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  const calls = fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : [];
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret/);
  assert.deepEqual(fs.readdirSync(temp), [], 'o wrapper deve remover apenas o seu temporario');
  return { ...result, calls };
}

test('assinatura de teste exige CI macOS antes de qualquer efeito', { skip }, () => {
  for (const env of [{ CI: '' }, { GITHUB_ACTIONS: '' }, { RUNNER_OS: 'Windows' }, { GITHUB_WORKSPACE: '' }]) {
    const result = runFixture('', env);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  }
});

test('assinatura valida executa MCP e smoke, restaura lista com espacos e apaga apenas keychain criado', { skip }, () => {
  const result = runFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['created', 'signed', 'verified', 'registered', 'mcp', 'smoke', 'restored', 'deleted']);
});

test('falha apos criar keychain, identidade ausente ou assinatura recusada impedem smoke e sempre limpam', { skip }, () => {
  for (const mode of ['unlock-fail', 'no-identity', 'verify-fail']) {
    const result = runFixture(mode);
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.includes('mcp') && !result.calls.includes('smoke'));
    assert.deepEqual(result.calls.slice(-2), ['restored', 'deleted']);
  }
});

test('falha do processo preserva seu exit code e executa cleanup', { skip }, () => {
  const result = runFixture('child-fail');
  assert.equal(result.status, 23, result.stderr);
  assert.ok(!result.calls.includes('smoke'));
  assert.deepEqual(result.calls.slice(-2), ['restored', 'deleted']);
});
