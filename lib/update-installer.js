// Pacote completo usado quando o update leve não pode preservar o Electron.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import io, { ensureDir } from './io.js';
import { HOME } from './paths.js';
import { TEMPOS } from './constants.js';
import { semAsVariaveis } from './env.js';
import { checkElectronPackage, assertElectronRuntime } from './electron-runtime.js';

function installerAsset(assets, version, platform, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versão de atualização inválida.');
  let names;
  if (platform === 'win32') names = [`Farol-Setup-v${version}.exe`];
  else if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) {
    names = [`Farol-Instalar-mac-${arch}.command`];
    // Nome histórico: o publicador sempre gerou Apple Silicon por padrão.
    if (arch === 'arm64') names.push('Farol-Instalar-mac.command');
  } else throw new Error('Instalador completo indisponível para este sistema.');
  const asset = names.map(name => assets.find(item => item.name === name)).find(Boolean);
  if (!asset) throw new Error('A release ainda não tem instalador completo para este sistema e arquitetura.');
  if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) throw new Error('Instalador sem SHA-256 verificável na release.');
  return asset;
}

async function verifyInstaller(file, digest) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (`sha256:${hash.digest('hex')}` !== digest.toLowerCase()) {
    throw new Error('O instalador baixado não confere com o SHA-256 da release. A instalação atual foi preservada.');
  }
}

async function releaseRun(run, args, env) {
  const result = await run('gh', args, { env, timeout: TEMPOS.ATUALIZACAO_DOWNLOAD_MS });
  if (!result.ok) throw new Error('Não foi possível obter o instalador completo da release. Tente novamente.');
  return result;
}

async function extractMacInstaller(file, base, version, arch, run) {
  // Só lê o cabeçalho do autoextraível; o payload pode ter centenas de MB.
  const header = Buffer.alloc(8192);
  const fd = fs.openSync(file, 'r');
  let length;
  try { length = fs.readSync(fd, header, 0, header.length, 0); }
  finally { fs.closeSync(fd); }
  const marker = Buffer.from('\n__FAROL_ARCHIVE__\n');
  const index = header.subarray(0, length).indexOf(marker);
  if (index < 0) throw new Error('Instalador do macOS sem payload reconhecido.');
  const archive = path.join(base, 'payload.tar.gz');
  await pipeline(fs.createReadStream(file, { start: index + marker.length }), fs.createWriteStream(archive));
  const source = path.join(base, 'full');
  ensureDir(source);
  let result = await run('/usr/bin/tar', ['-xzf', archive, '-C', source], { timeout: TEMPOS.ATUALIZACAO_DOWNLOAD_MS });
  if (!result.ok) throw new Error('Não foi possível extrair o instalador completo.');
  const manifest = io.readJson(path.join(source, 'package.json'), {});
  if (manifest.name !== 'farol' || manifest.version !== version) throw new Error('Instalador completo de outra versão.');
  const dist = path.join(source, 'node_modules', 'electron', 'dist');
  ensureDir(dist);
  result = await run('/usr/bin/unzip', ['-oq', path.join(source, 'installer', 'electron-darwin.zip'), '-d', dist], { timeout: TEMPOS.ATUALIZACAO_DOWNLOAD_MS });
  if (!result.ok) throw new Error('Não foi possível preparar o Electron do instalador.');
  fs.writeFileSync(path.join(source, 'node_modules', 'electron', 'path.txt'), 'Electron.app/Contents/MacOS/Electron');
  checkElectronPackage(source, true);
  const native = path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  result = await run(native, ['-p', 'process.versions.electron + ":" + process.arch'], {
    env: { ...semAsVariaveis([]), ELECTRON_RUN_AS_NODE: '1' }
  });
  const [electron, actualArch] = result.stdout.trim().split(':');
  if (!result.ok || actualArch !== arch) throw new Error('O Electron do instalador não executa nesta arquitetura. A instalação atual foi preservada.');
  assertElectronRuntime(electron, manifest.dependencies?.electron);
  return { source };
}

async function prepareFullUpdate(engine, release, deps = {}) {
  const { repo, version } = release;
  const platform = deps.platform || process.platform;
  const arch = deps.arch || process.arch;
  const run = deps.run || io.run;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Repositório de atualização inválido.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versão de atualização inválida.');
  const env = engine.ghEnv();
  const metadata = await releaseRun(run, ['release', 'view', `v${version}`, '--repo', repo, '--json', 'assets'], env);
  const assets = io.parseJson(metadata.stdout, {})?.assets;
  if (!Array.isArray(assets)) throw new Error('Metadados da release inválidos.');
  const asset = installerAsset(assets, version, platform, arch);
  const sessions = path.join(HOME, 'sessions');
  ensureDir(sessions);
  const base = fs.mkdtempSync(path.join(sessions, 'update-dl-full-'));
  engine.emit('toast', { kind: 'info', text: 'Esta atualização inclui um novo Electron. Baixando e verificando o instalador completo…' });
  await releaseRun(run, ['release', 'download', `v${version}`, '--repo', repo, '--pattern', asset.name, '--dir', base], env);
  const file = path.join(base, asset.name);
  await verifyInstaller(file, asset.digest);
  if (platform === 'darwin') return extractMacInstaller(file, base, version, arch, run);
  return { installer: file };
}

function buildFullUpdateScript(installer, logFile, marker) {
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $install = Start-Process -FilePath ${quote(installer)} -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru`,
    "  if ($install.ExitCode -ne 0) { throw ('Instalador completo falhou: codigo ' + $install.ExitCode) }",
    `  'Instalador completo concluido.' | Out-File -LiteralPath ${quote(logFile)} -Encoding utf8`,
    '} catch {',
    `  $_ | Out-File -LiteralPath ${quote(logFile)} -Encoding utf8`,
    `  Remove-Item -LiteralPath ${quote(marker)} -Force -ErrorAction SilentlyContinue`,
    '} finally { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue }'
  ].join('\r\n');
}

export { installerAsset, verifyInstaller, extractMacInstaller, prepareFullUpdate, buildFullUpdateScript };
