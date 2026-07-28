'use strict';
// Utilitários de IO/processo (fs + child_process), isolados da lógica do engine.
// Ramo de plataforma concentrado aqui (runShell) via IS_WIN. Ver docs/QUALITY.md.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    ensureDir(dst);
    for (const item of fs.readdirSync(src)) copyRecursive(path.join(src, item), path.join(dst, item));
  } else {
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

function detectGitBash() {
  if (!IS_WIN) return null; // so faz sentido no Windows (CLAUDE_CODE_GIT_BASH_PATH)
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')
  ];
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// gh e claude no Windows podem ser shims .cmd: resolve via cmd.exe quando preciso.
// No macOS/Linux o equivalente e /bin/sh -lc (login shell, pra carregar o PATH
// do perfil quando o app foi aberto pelo Finder).
function runShell(commandLine, opts = {}) {
  const [cmd, args] = IS_WIN
    ? ['cmd.exe', ['/d', '/s', '/c', commandLine]]
    : ['/bin/sh', ['-lc', commandLine]];
  return new Promise((resolve) => {
    execFile(cmd, args,
      { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsVerbatimArguments: false, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

module.exports = { ensureDir, readJson, copyRecursive, detectGitBash, run, runShell };
