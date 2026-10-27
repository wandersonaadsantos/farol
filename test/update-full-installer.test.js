import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import cp from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-full-update-'));
process.env.FAROL_HOME = scratch;
const { installerAsset, verifyInstaller, extractMacInstaller, prepareFullUpdate, buildFullUpdateScript } = await import('../lib/update-installer.js');
const io = (await import('../lib/io.js')).default;
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const payload = Buffer.from('instalador sintetico; nunca executar');
const digest = 'sha256:' + createHash('sha256').update(payload).digest('hex');

test('seleciona o instalador da versão e arquitetura, recusando hash ausente e plataforma sem pacote', () => {
  const assets = ['Farol-Setup-v9.9.9.exe', 'Farol-Instalar-mac.command', 'Farol-Instalar-mac-x64.command']
    .map(name => ({ name, digest }));
  assert.equal(installerAsset(assets, '9.9.9', 'win32', 'x64').name, assets[0].name);
  assert.equal(installerAsset(assets, '9.9.9', 'darwin', 'arm64').name, assets[1].name);
  assert.equal(installerAsset(assets, '9.9.9', 'darwin', 'x64').name, assets[2].name);
  assert.throws(() => installerAsset([assets[1]], '9.9.9', 'darwin', 'x64'), /arquitetura/);
  assert.throws(() => installerAsset([{ name: assets[0].name }], '9.9.9', 'win32', 'x64'), /SHA-256/);
  assert.throws(() => installerAsset(assets, '../9.9.9', 'win32', 'x64'), /inválida/);
  assert.throws(() => installerAsset(assets, '9.9.9', 'linux', 'x64'), /indisponível/);
});

test('arquivo corrompido falha na verificação antes de poder ser usado', async () => {
  const file = path.join(scratch, 'corrupted.exe');
  fs.writeFileSync(file, payload);
  await verifyInstaller(file, digest);
  fs.appendFileSync(file, 'alteracao');
  await assert.rejects(verifyInstaller(file, digest), /não confere/);
});

test('baixa e verifica o instalador completo na mesma release, sem executar o arquivo', async () => {
  const calls = [];
  const run = async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (args[1] === 'view') return { ok: true, stdout: JSON.stringify({ assets: [{ name: 'Farol-Setup-v9.9.9.exe', digest }] }) };
    fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], 'Farol-Setup-v9.9.9.exe'), payload);
    return { ok: true };
  };
  const engine = { ghEnv: () => ({}), emit() {} };
  const result = await prepareFullUpdate(engine, { repo: 'owner/farol', version: '9.9.9' }, { run, platform: 'win32', arch: 'x64' });
  assert.deepEqual(fs.readFileSync(result.installer), payload);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.cmd, 'gh');
    assert.equal(call.args[2], 'v9.9.9');
    assert.equal(call.args[call.args.indexOf('--repo') + 1], 'owner/farol');
    assert.ok(call.options.timeout >= 600_000, 'download grande não usa o timeout curto de polling');
  }
});

test('metadados inválidos, download interrompido e checksum divergente recusam o pacote', async () => {
  const engine = { ghEnv: () => ({}), emit() {} };
  for (const failure of ['metadata', 'download', 'checksum']) {
    const run = async (_cmd, args) => {
      if (args[1] === 'view') return { ok: true, stdout: failure === 'metadata' ? '{}' : JSON.stringify({ assets: [{ name: 'Farol-Setup-v9.9.9.exe', digest }] }) };
      if (failure === 'download') return { ok: false };
      fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], 'Farol-Setup-v9.9.9.exe'), 'corrompido');
      return { ok: true };
    };
    await assert.rejects(prepareFullUpdate(engine, { repo: 'owner/farol', version: '9.9.9' }, { run, platform: 'win32' }));
  }
});

test('script Windows executa instalador silencioso, espera resultado e registra falha sem deixar marcador', () => {
  const script = buildFullUpdateScript("C:\\Users\\O'Brien\\Farol Setup.exe", 'C:\\state\\update.log', 'C:\\state\\reabrir.json');
  assert.match(script, /O''Brien/);
  assert.match(script, /-ArgumentList '\/S' -WindowStyle Hidden -Wait -PassThru/);
  assert.match(script, /ExitCode -ne 0/);
  assert.match(script, /Remove-Item -LiteralPath 'C:\\state\\reabrir.json'/);
  assert.match(script, /Out-File -LiteralPath 'C:\\state\\update.log'/);
});

test('macOS prepara o payload e valida runtime e arquitetura antes de autorizar o encerramento', {
  skip: process.platform === 'win32'
}, async () => {
  const base = fs.mkdtempSync(path.join(scratch, 'mac-'));
  const source = path.join(base, 'source');
  const electronZip = path.join(base, 'electron');
  const native = path.join(electronZip, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  fs.mkdirSync(path.dirname(native), { recursive: true });
  // Binário sintético só para provar a fronteira de preparação, sem abrir o app.
  fs.writeFileSync(native, '#!/bin/sh\nprintf "44.9.3:arm64"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(electronZip, 'version'), '44.9.3');
  fs.mkdirSync(path.join(source, 'installer'), { recursive: true });
  cp.execFileSync('/usr/bin/zip', ['-qr', path.join(source, 'installer', 'electron-darwin.zip'), '.'], { cwd: electronZip });
  fs.mkdirSync(path.join(source, 'node_modules', 'electron'), { recursive: true });
  fs.writeFileSync(path.join(source, 'node_modules', 'electron', 'package.json'), '{"version":"44.9.3"}');
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"farol","version":"9.9.9","dependencies":{"electron":"^44.9.3"}}');
  const archive = path.join(base, 'archive.tar.gz');
  cp.execFileSync('/usr/bin/tar', ['-czf', archive, '-C', source, '.']);
  const file = path.join(base, 'Farol.command');
  fs.writeFileSync(file, Buffer.concat([Buffer.from('#!/bin/bash\n__FAROL_ARCHIVE__\n'), fs.readFileSync(archive)]));
  const result = await extractMacInstaller(file, base, '9.9.9', 'arm64', io.run);
  assert.equal(fs.readFileSync(path.join(result.source, 'node_modules', 'electron', 'dist', 'version'), 'utf8'), '44.9.3');
  const wrongArch = fs.mkdtempSync(path.join(scratch, 'wrong-arch-'));
  await assert.rejects(extractMacInstaller(file, wrongArch, '9.9.9', 'x64', io.run), /arquitetura/);
  const wrongVersion = fs.mkdtempSync(path.join(scratch, 'wrong-version-'));
  await assert.rejects(extractMacInstaller(file, wrongVersion, '9.9.8', 'arm64', io.run), /outra versão/);
});
