// Lança o main.js e a UI reais com Electron instalado pelo chamador/CI.
// Uso: node tools/electron-smoke.js --output artifacts/electron-smoke
// Fora da CI exige --allow-desktop; o registro de autostart exige também
// --allow-autostart-probe. Nunca usa dados, contas ou login do Farol instalado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { installedElectronBinary, smokeEnv, validateSmokeReport } from './electron-smoke-lib.js';
import { requiredElectronVersion } from '../lib/electron-runtime.js';
import { readJson, writeJsonAtomic } from '../lib/io.js';
import { semAsVariaveis } from '../lib/env.js';

const root = path.dirname(import.meta.dirname);
const PROCESS_TIMEOUT_MS = 5000;
const argv = process.argv.slice(2);
const ambient = semAsVariaveis([]);
const outputIndex = argv.indexOf('--output');
if (outputIndex < 0 || !argv[outputIndex + 1]) throw new Error('Informe --output <diretório dos artefatos>.');
if (ambient.CI !== 'true' && !argv.includes('--allow-desktop')) {
  throw new Error('O smoke abre janela e notificação nativas. Fora da CI, use --allow-desktop para executar.');
}
const output = path.resolve(argv[outputIndex + 1]);
fs.mkdirSync(output, { recursive: true });

function portaLivre() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => err ? reject(err) : resolve(port));
    });
  });
}

function valorDeAutostartExiste(key, name) {
  try {
    execFileSync('reg.exe', ['query', key, '/v', name], { windowsHide: true, timeout: PROCESS_TIMEOUT_MS, stdio: 'pipe' });
    return true;
  } catch (err) {
    const message = String(err.stderr || '') + String(err.stdout || '');
    if (err.status === 1 && /unable to find|n.o.*encontr|n.o.*localiz/i.test(message)) return false;
    throw new Error(`Não foi possível verificar a entrada isolada de autostart: ${name}.`);
  }
}

function limparAutostart(name) {
  if (process.platform !== 'win32') return;
  // Nome aleatório do probe: nunca apaga a entrada Farol nem enumera valores reais.
  for (const key of ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run']) {
    if (!valorDeAutostartExiste(key, name)) continue;
    execFileSync('reg.exe', ['delete', key, '/v', name, '/f'], { windowsHide: true, timeout: PROCESS_TIMEOUT_MS, stdio: 'pipe' });
    if (valorDeAutostartExiste(key, name)) throw new Error(`Entrada isolada de autostart permaneceu: ${name}.`);
  }
}

function encerrarArvore(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: PROCESS_TIMEOUT_MS, stdio: 'pipe' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch (err) { if (child.exitCode === null) throw new Error(`Não consegui encerrar a árvore isolada PID ${child.pid}: ${err.message}`); }
}

function executar(bin, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: root, env, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const out = fs.createWriteStream(path.join(output, 'electron.stdout.log'));
    const err = fs.createWriteStream(path.join(output, 'electron.stderr.log'));
    child.stdout.pipe(out); child.stderr.pipe(err);
    const timeout = setTimeout(() => {
      try { encerrarArvore(child); reject(new Error('Electron smoke excedeu 60 segundos.')); }
      catch (error) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); reject(error); }
    }, 60000);
    child.once('error', error => { clearTimeout(timeout); out.end(); err.end(); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timeout); out.end(); err.end();
      if (code !== 0) reject(new Error(`Electron smoke encerrou com code=${code}, signal=${signal || 'nenhum'}.`));
      else resolve();
    });
  });
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-electron-smoke-'));
const name = 'FarolElectronSmoke-' + randomUUID();
const autostart = ambient.CI === 'true' || argv.includes('--allow-autostart-probe');
try {
  const pkg = readJson(path.join(root, 'package.json'), null);
  const expectedElectron = requiredElectronVersion(pkg.dependencies.electron);
  const dirs = { home: path.join(base, 'home'), farol: path.join(base, 'farol'),
    appData: path.join(base, 'appData'), localData: path.join(base, 'localData'),
    userData: path.join(base, 'userData'), sessionData: path.join(base, 'sessionData') };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  const port = await portaLivre();
  writeJsonAtomic(path.join(dirs.farol, 'config.json'), { port, accounts: [],
    autoReview: false, autoApproveAll: false, autoPushback: false, autoUpdate: false,
    autostart: false, updateRepo: '', jiraSites: [], claudeProfiles: [] });
  const configFile = path.join(base, 'probe.json');
  writeJsonAtomic(configFile, { dirs, root, output, port, name, autostart,
    expectedElectron, expectedApp: pkg.version });
  const bin = installedElectronBinary(root);
  await executar(bin, [path.join(import.meta.dirname, 'electron-smoke-main.js')], smokeEnv(ambient, dirs, configFile));
  const result = validateSmokeReport(readJson(path.join(output, 'result.json'), null), { name, expectedElectron, expectedApp: pkg.version });
  console.log(`Electron ${result.versions.electron} / ${process.platform}: smoke real passou. Artefatos: ${output}`);
} catch (err) {
  writeJsonAtomic(path.join(output, 'driver-error.json'), { status: 'failed', error: err.message });
  console.error(err.message);
  process.exitCode = 1;
} finally {
  const errors = [];
  try { if (autostart) limparAutostart(name); } catch (err) { errors.push(err.message); }
  try {
    // base vem de mkdtemp e não de argumento do usuário: só remove o sandbox criado aqui.
    if (!path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Sandbox fora do diretório temporário.');
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) { errors.push(err.message); }
  writeJsonAtomic(path.join(output, 'cleanup.json'), { status: errors.length ? 'failed' : 'passed',
    sandboxRemoved: !fs.existsSync(base), autostartChecked: process.platform === 'win32' && autostart, errors });
  if (errors.length) { process.exitCode = 1; console.error(errors.join('\n')); }
}
