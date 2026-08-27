// Utilitários de IO/processo (fs + child_process), isolados da lógica do engine.
// Ramo de plataforma concentrado aqui (runShell) via IS_WIN. Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import spawnlog from './spawnlog.js';
import { TEMPOS } from './constants.js';
// fonte ÚNICA do branch de plataforma é o paths.js; redeclarar aqui era uma
// segunda fonte de verdade dormindo (achado da auditoria cross-platform de 16/08/2026)
import { IS_WIN } from './paths.js';
const { logSpawn } = spawnlog;

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// Fallback SÓ é silencioso quando o arquivo não existe (primeiro boot). Corrupção
// (JSON truncado por queda de energia, por exemplo) loga via `log` (opcional) e
// preserva o conteúdo em <arquivo>.bad pra perícia, sem sobrescrever um .bad
// anterior (COPYFILE_EXCL: a primeira evidência vence). Assim corrupção nunca
// vira reset silencioso a DEFAULTS.
function readJson(file, fallback, log) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err.code !== 'ENOENT' && log) log(`ler ${path.basename(file)}: ${err.message}`);
    return fallback;
  }
  try { return JSON.parse(raw); }
  catch (err) {
    try { fs.copyFileSync(file, file + '.bad', fs.constants.COPYFILE_EXCL); } catch { /* .bad anterior preservado */ }
    if (log) log(`${path.basename(file)} corrompido (${err.message}); usei o padrão e preservei ${path.basename(file)}.bad`);
    return fallback;
  }
}

// Grava JSON de forma atômica: escreve num .tmp ao lado e renomeia por cima do
// destino. rename no MESMO diretório troca o arquivo de uma vez (queda de energia
// deixa o antigo OU o novo, nunca truncado). No Windows o renameSync substitui
// destino existente (MoveFileEx com replace), mas pode dar EPERM transitório com
// antivírus/indexador segurando o arquivo: cai no copy+unlink, que não é atômico
// mas nunca é pior que o writeFileSync direto que existia antes.
// parse tolerante de JSON vindo de fora (stdout de gh, payload de sessão):
// devolve o fallback em vez de lançar. Mora aqui pelo mesmo motivo do readJson:
// JSON cru tem UM endereço (contrato engineering-standards).
function parseJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

// Espelho de saída do parseJson: JSON.stringify LANÇA em referência circular, e
// este arquivo é o único santuário do gate pra JSON cru. Quem serializa resposta
// de MCP não pode morrer por causa de um objeto mal formado.
function safeStringify(value, fallback = 'null') {
  try { return JSON.stringify(value); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try { fs.renameSync(tmp, file); }
  catch {
    fs.copyFileSync(tmp, file);
    try { fs.unlinkSync(tmp); } catch { /* sobrar .tmp é melhor que perder o estado */ }
  }
}

// Igual ao writeJsonAtomic, para texto plano (G6: seen.txt era o único estado
// gravado com writeFileSync direto; truncamento por queda de energia virava
// rajada de re-revisões pagas no boot seguinte).
function writeTextAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); }
  catch {
    fs.copyFileSync(tmp, file);
    try { fs.unlinkSync(tmp); } catch { /* sobrar .tmp é melhor que perder o estado */ }
  }
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
  logSpawn(cmd, args);
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: TEMPOS.GH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// gh e claude no Windows podem ser shims .cmd: resolve via cmd.exe quando preciso.
// No macOS/Linux o equivalente e /bin/sh -lc (login shell, pra carregar o PATH
// do perfil quando o app foi aberto pelo Finder).
function runShell(commandLine, opts = {}) {
  let cmd = '/bin/sh';
  let args = ['-lc', commandLine];
  if (IS_WIN) {
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ${commandLine}`];
  }
  logSpawn(cmd, args);
  return new Promise((resolve) => {
    execFile(cmd, args,
      { windowsHide: true, timeout: TEMPOS.GH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsVerbatimArguments: false, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// Monta o PATH do boot posix (app aberto pelo Finder herda PATH minimo, sem
// /opt/homebrew/bin). PURA e exportada pra ter teste nos dois SOs: e o codigo
// que decide se gh e claude existem quando o app abre pelo Dock, e falha aqui
// era silencio total (auditoria 16/08). Devolve o PATH novo, ou null se nada
// falta (o chamador nao mexe no env a toa).
function prependPathDirs(currentPath, candidates, exists) {
  const sep = String(currentPath || '').includes(';') ? ';' : ':';
  const current = String(currentPath || '').split(sep);
  const missing = (candidates || []).filter(d => d && !current.includes(d) && exists(d));
  if (!missing.length) return null;
  return missing.concat(currentPath || '').join(sep);
}

// PONTO CRÍTICO (regra 8 da receita ESM, CLAUDE.md/brief da migração): os testes
// fazem monkey-patch de `io.run`/`io.runShell` (test/account-identity.test.js,
// test/credits.test.js, test/decision-envelope.test.js, test/gh-queries-capped.test.js,
// test/merge-gates.test.js, test/public-review-language.test.js, test/pushback.test.js,
// test/selfpr-consistency.test.js). Namespace de ESM (`import * as io`) é CONGELADO, então
// o default tem que ser um objeto MUTÁVEL, e todo consumidor interno do repo importa esse
// default (nunca named import de run/runShell), pra o patch de propriedade em teste
// continuar valendo pro consumidor, igual CommonJS.
const io = { ensureDir, readJson, parseJson, safeStringify, writeJsonAtomic, writeTextAtomic, copyRecursive, detectGitBash, run, runShell, prependPathDirs };
export default io;
export { ensureDir, readJson, parseJson, safeStringify, writeJsonAtomic, writeTextAtomic, copyRecursive, detectGitBash, prependPathDirs };
