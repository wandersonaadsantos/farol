import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-update-runtime-'));
process.env.FAROL_HOME = path.join(scratch, 'installed');
const launches = [];
const originalSpawn = cp.spawn;
cp.spawn = (...args) => { launches.push(args); return { unref() {} }; };
syncBuiltinESMExports();
const update = (await import('../lib/engine/update.js')).default;
const session = (await import('../lib/engine/session.js')).default;
const chat = (await import('../lib/engine/chat.js')).default;
const review = (await import('../lib/engine/review.js')).default;
after(() => {
  cp.spawn = originalSpawn;
  syncBuiltinESMExports();
  fs.rmSync(scratch, { recursive: true, force: true });
});
beforeEach(() => {
  launches.length = 0;
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});

function fixture(range = '^44.1.0') {
  const source = fs.mkdtempSync(path.join(scratch, 'source-'));
  fs.mkdirSync(path.join(source, 'installer'));
  for (const file of ['install.ps1', 'install.sh', 'install-linux.sh']) fs.writeFileSync(path.join(source, 'installer', file), 'stub');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'farol', version: '9.9.9', dependencies: { electron: range } }));
  const oldApp = path.join(process.env.FAROL_HOME, 'app', 'package.json');
  fs.mkdirSync(path.dirname(oldApp), { recursive: true });
  fs.writeFileSync(oldApp, 'versão atual preservada');
  fs.mkdirSync(path.dirname(update.REABRIR_SILENCIOSO), { recursive: true });
  const engine = { config: {}, activeReviews: new Map(), headlessBusyAccounts: new Map(), running: new Map(), headlessQueue: [],
    emit() {}, pushState() {} };
  const deps = { checkUpdate: async e => { e.update = { channel: 'remote', available: true, sourceVersion: '9.9.9' }; },
    downloadRemoteUpdate: async () => source };
  return { source, oldApp, engine, deps };
}

test('update leve recusa runtime antigo antes de script, marcador, instalador ou alteração da instalação', async () => {
  const { engine, deps, oldApp } = fixture();
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '43.1.0' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Electron 43\.1\.0 incompatível com \^44\.1\.0/);
  assert.match(result.error, /instalador completo/);
  assert.equal(launches.length, 0);
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
  assert.equal(fs.existsSync(path.join(process.env.FAROL_HOME, 'sessions')), false);
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'versão atual preservada');
  assert.equal(engine.updateApplying, false);
});

test('runtime compatível libera o lançamento existente e preserva o estado até o instalador executar', async () => {
  const { engine, deps, oldApp } = fixture();
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '44.1.0' });
  assert.equal(result.ok, true);
  assert.equal(launches.length, 1, 'spawn interceptado; nenhum instalador real executado');
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), true);
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'versão atual preservada');
});

test('manifesto sem requisito verificável e runtime desconhecido falham antes do instalador', async () => {
  for (const [range, electronVersion] of [[undefined, '44.1.0'], ['latest', '44.1.0'], ['^44.1.0', '']]) {
    const { engine, deps, source } = fixture(range);
    if (range === undefined) fs.writeFileSync(path.join(source, 'package.json'), '{}');
    const result = await update.applyUpdate(engine, { ...deps, electronVersion });
    assert.equal(result.ok, false);
    assert.match(result.error, /instalador completo/);
    assert.equal(launches.length, 0);
    assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
  }
});

test('botão usa o pacote completo da mesma release quando o Electron instalado é incompatível', async () => {
  const { engine, deps, source, oldApp } = fixture();
  engine.config.updateRepo = 'owner/farol';
  let calls = 0;
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '43.1.0',
    waitFullInstaller: async command => {
      assert.equal(engine.updateInstalling, true);
      launches.push(['powershell.exe', [command]]);
      return { ok: true };
    },
    prepareFullUpdate: async (_engine, release) => {
      calls++;
      assert.deepEqual(release, { repo: 'owner/farol', version: '9.9.9' });
      _engine.update.sourceVersion = '10.0.0'; // polling concorrente não troca a release em preparação
      if (process.platform === 'win32') return { installer: path.join(source, 'Farol-Setup.exe') };
      const dist = path.join(source, 'node_modules', 'electron', 'dist');
      const native = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
      fs.mkdirSync(path.dirname(path.join(dist, native)), { recursive: true });
      fs.writeFileSync(path.join(dist, native), 'runtime sintetico');
      fs.writeFileSync(path.join(dist, 'version'), '44.1.0');
      fs.writeFileSync(path.join(source, 'node_modules', 'electron', 'package.json'), '{"version":"44.1.0"}');
      return { source };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.to, '9.9.9');
  assert.equal(launches.length, 1, 'somente o processo externo é substituído; nenhum instalador executado');
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'versão atual preservada');
  if (process.platform === 'win32') {
    const scriptFile = launches[0][1].at(-1).match(/-File','"(.+)"'/)[1];
    assert.match(fs.readFileSync(scriptFile, 'utf8'), /Farol-Setup.exe/);
  }
});

test('instalação fecha a admissão de review, chat, stream e terminais, liberando após falha do instalador', {
  skip: process.platform !== 'win32'
}, async () => {
  const { engine, deps } = fixture();
  engine.config.updateRepo = 'owner/farol';
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '43.1.0',
    prepareFullUpdate: async () => ({ installer: 'sintetico.exe' }),
    waitFullInstaller: async () => {
      assert.equal(engine.updateInstalling, true);
      for (const method of ['spawnConsole', 'spawnLoginConsole', 'spawnCodexLoginConsole']) {
        const blocked = session[method](engine);
        assert.equal(blocked.ok, false);
        assert.match(blocked.error, /instalando/);
      }
      assert.equal((await review.launchReview(engine, ['https://github.com/owner/repo/pull/1'])).ok, false);
      assert.equal((await chat.chatSend(engine, 'owner/repo#1', '', 'oi')).ok, false);
      await assert.rejects(session.runClaudeStream(engine, 'oi'), /instalando/);
      return { ok: false };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(engine.updateInstalling, false);
  assert.equal(engine.updateApplying, false);
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
  assert.equal(launches.length, 0);
});

test('admissão assíncrona ainda sem processo e chat aguardando autenticação impedem atualizar', async () => {
  const { engine } = fixture();
  let release;
  engine.syncCoordenacaoAtiva = () => true;
  engine.syncAdmit = () => new Promise(resolve => { release = resolve; });
  const stream = session.runClaudeStream(engine, 'oi', { operationKind: 'review', coordination: {} });
  assert.equal(engine.pendingUpdateSessions, 1);
  assert.equal(update.sessionsBusy(engine), true);
  release({ admitted: false, reason: 'teste' });
  await stream;
  assert.equal(engine.pendingUpdateSessions, 0);
  assert.equal(update.sessionsBusy(engine), false);
  engine.chats = { pr: { status: 'running' } };
  assert.equal(update.sessionsBusy(engine), true);
});

test('pedido de revisão aguardando token já segura o update antes de alterar fila ou abrir sessão', async () => {
  const { engine, deps } = fixture();
  let rejectToken;
  engine.refreshTokens = () => new Promise((_resolve, reject) => { rejectToken = reject; });
  const pending = review.launchReview(engine, ['https://github.com/owner/repo/pull/1']);
  assert.equal(update.sessionsBusy(engine), true);
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '43.1.0' });
  assert.equal(result.queued, true);
  assert.equal(launches.length, 0);
  rejectToken(new Error('token indisponível'));
  await assert.rejects(pending, /token indisponível/);
  assert.equal(engine.pendingUpdateSessions, 0);
});

test('sessão iniciada durante o download completo agenda o update sem fechar o Farol', async () => {
  const { engine, deps, oldApp } = fixture();
  engine.config.updateRepo = 'owner/farol';
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '43.1.0',
    prepareFullUpdate: async () => {
      engine.running.set('chat', { startedAt: Date.now() });
      return { installer: 'nao-executar.exe' };
    }
  });
  assert.equal(result.queued, true);
  assert.equal(launches.length, 0);
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'versão atual preservada');
});

test('falha do pacote completo preserva instalação, libera nova tentativa e não lança instalador', async () => {
  const { engine, deps, oldApp } = fixture();
  engine.config.updateRepo = 'owner/farol';
  const result = await update.applyUpdate(engine, { ...deps, electronVersion: '43.1.0',
    prepareFullUpdate: async () => { throw new Error('download interrompido'); }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /interrompido/);
  assert.equal(engine.updateApplying, false);
  assert.equal(launches.length, 0);
  assert.equal(fs.existsSync(update.REABRIR_SILENCIOSO), false);
  assert.equal(fs.readFileSync(oldApp, 'utf8'), 'versão atual preservada');
});
