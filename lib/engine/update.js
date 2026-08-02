'use strict';
// Concern de auto-update (Onda 2, módulo colaborador). Funções que recebem o
// `engine` como contexto explícito e operam sobre o estado dele; a Engine mantém
// métodos-fachada finos que delegam pra cá. Comportamento idêntico ao inline antigo.
// Ver docs/QUALITY.md e CLAUDE.md (seção Release: fonte de verdade = release do GitHub).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { APP_VERSION, APP_ROOT, HOME, STATE_DIR, IS_WIN } = require('../paths');
const { run, ensureDir } = require('../io');
const { logSpawn } = require('../spawnlog');

// A pasta local só é fonte de update quando updateSource é definido EXPLICITAMENTE
// no config. Sem isso (padrão), a fonte de verdade é a RELEASE do GitHub (git):
// o app instalado nunca "atualiza" pra código que ainda não foi mergeado/publicado,
// evitando duas fontes de verdade. O caminho local vira opt-in só pra testar build
// local durante o desenvolvimento.
function resolveUpdateSource(engine) {
  const cand = (engine.config.updateSource || '').trim();
  if (!cand) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cand, 'package.json'), 'utf8'));
    if (pkg.name !== 'farol' || !pkg.version) return null;
    // rodando direto da fonte (dev): não há o que atualizar
    if (path.resolve(cand).toLowerCase() === path.resolve(APP_ROOT).toLowerCase()) return null;
    return { path: cand, version: pkg.version };
  } catch { return null; }
}

// Compara versões semver "a.b.c" numericamente. >0 se a>b, <0 se a<b, 0 se iguais.
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// Local (pasta-fonte) tem precedência: é o fluxo do mantenedor e não gasta gh.
// Sem fonte local (cópias distribuídas), cai pro canal remoto (releases GitHub).
async function checkUpdate(engine) {
  const src = resolveUpdateSource(engine);
  if (src) {
    engine.update = {
      current: APP_VERSION, channel: 'local',
      source: src.path, sourceVersion: src.version,
      available: cmpVersion(src.version, APP_VERSION) > 0,
      checkedAt: Date.now()
    };
    engine.pushState();
    return engine.update;
  }
  const repo = (engine.config.updateRepo || '').trim();
  if (repo) { await checkUpdateRemote(engine, repo); }
  else {
    engine.update = { current: APP_VERSION, channel: 'none', source: null, sourceVersion: null, available: false, checkedAt: Date.now() };
  }
  engine.pushState();
  return engine.update;
}

// Lê a última release do repo via gh (o mesmo gh autenticado que o app já usa).
async function checkUpdateRemote(engine, repo) {
  const r = await run('gh', ['release', 'view', '--repo', repo, '--json', 'tagName,assets'], { env: engine.ghEnv() });
  const base = { current: APP_VERSION, channel: 'remote', repo, source: null, checkedAt: Date.now() };
  if (!r.ok) {
    // sem release ainda, sem acesso, ou rede: não é falha do app, só não há update
    engine.update = { ...base, sourceVersion: null, available: false, note: 'sem release acessível' };
    return;
  }
  let rel;
  try { rel = JSON.parse(r.stdout || '{}'); } catch { rel = {}; }
  const ver = String(rel.tagName || '').replace(/^v/, '');
  engine.update = {
    ...base,
    sourceVersion: ver || null,
    available: !!ver && cmpVersion(ver, APP_VERSION) > 0
  };
}

// Baixa e extrai o pacote leve (farol-vX.Y.Z.zip) da release; devolve a pasta
// extraída pra applyUpdate rodar o installer dali. O Electron NÃO viaja no
// update: a cópia instalada já tem, o installer preserva.
async function downloadRemoteUpdate(engine) {
  const repo = (engine.config.updateRepo || '').trim();
  const ver = engine.update && engine.update.sourceVersion;
  if (!repo || !ver) throw new Error('sem release remota pra baixar');
  const base = path.join(HOME, 'sessions', 'update-dl-' + Date.now());
  ensureDir(base);
  const dl = await run('gh', ['release', 'download', 'v' + ver, '--repo', repo,
    '--pattern', 'farol-v*.zip', '--dir', base, '--clobber'], { env: engine.ghEnv() });
  if (!dl.ok) throw new Error('falha ao baixar: ' + (dl.stderr || dl.stdout || '').trim().slice(0, 200));
  const zip = fs.readdirSync(base).find(f => /^farol-v.*\.zip$/i.test(f));
  if (!zip) throw new Error('release sem o pacote farol-v*.zip');
  const zipPath = path.join(base, zip);
  const outDir = path.join(base, 'extracted');
  ensureDir(outDir);
  if (IS_WIN) {
    const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`]);
    if (!r.ok) throw new Error('falha ao extrair: ' + (r.stderr || '').trim().slice(0, 200));
  } else {
    const r = await run('unzip', ['-o', zipPath, '-d', outDir]);
    // saida 1 do Info-ZIP e AVISO, nao erro (ex.: pacote antigo gravado com '\'
    // como separador): os arquivos saem certos e quem decide se o pacote presta
    // e a checagem do installer logo abaixo. Sai >1 e falha de verdade.
    if (!r.ok && r.code !== 1) throw new Error('falha ao extrair (unzip): ' + (r.stderr || '').trim().slice(0, 200));
  }
  const inst = IS_WIN ? path.join(outDir, 'installer', 'install.ps1') : path.join(outDir, 'installer', 'install.sh');
  if (!fs.existsSync(inst)) throw new Error('pacote baixado sem installer');
  return outDir;
}

// Linha que lança o script de update destacado. PURA e exportada pra teste: o
// Start-Process do PowerShell 5.1 junta os itens do -ArgumentList com espaço SEM
// citar cada um, então caminho com espaço (C:\Users\Nome Sobrenome\...) partia o
// -File em dois argumentos e o installer morria numa janela oculta DEPOIS do
// ok:true (M14). Aspas duplas embutidas sobrevivem à junção; apóstrofo é dobrado
// (regra de string single-quoted do PowerShell).
function buildUpdateLaunchCommand(scriptFile) {
  const quoted = `"${String(scriptFile)}"`.replace(/'/g, "''");
  return `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${quoted}'`;
}

// deps é injeção PRA TESTE: checkUpdate e downloadRemoteUpdate reais fazem rede
// via gh e o corpo chama o binding local (mock via exports não alcança). O default
// preserva a chamada de produção applyUpdate(engine) e mantém Function.length = 1,
// que o test/facades.test.js usa pra derivar a aridade esperada da fachada
// Engine.applyUpdate() (0 parâmetros). NÃO remova o `= {}`.
async function applyUpdate(engine, deps = {}) {
  const check = deps.checkUpdate || checkUpdate;
  const download = deps.downloadRemoteUpdate || downloadRemoteUpdate;
  await check(engine);
  if (!engine.update.available) return { ok: false, error: 'nenhuma atualização disponível' };
  if (engine.headlessBusyAccounts.size || engine.running.size || engine.headlessQueue.length) {
    return { ok: false, error: 'há análise ou chat em andamento; termine ou cancele antes de atualizar' };
  }
  // remoto: baixa e extrai a release; aponta a "fonte" pra pasta extraída.
  // Atribuição em DOIS tempos de propósito: `engine.update.source = await ...`
  // resolvia a referência de engine.update ANTES do download, e o checkUpdate do
  // ciclo de polling que reatribui engine.update no meio deixava o source num
  // objeto órfão (o engine.update atual ficava com source null e o path.join(null)
  // explodia em 500, update nunca aplicava) (M13).
  if (engine.update.channel === 'remote') {
    let dir;
    try { dir = await download(engine); }
    catch (e) {
      engine.emit('toast', { kind: 'error', text: 'Falha ao baixar a atualização: ' + e.message });
      return { ok: false, error: e.message };
    }
    engine.update.source = dir;
  }
  if (!IS_WIN) return applyUpdateMac(engine);
  const installer = path.join(engine.update.source, 'installer', 'install.ps1');
  if (!fs.existsSync(installer)) return { ok: false, error: `installer não encontrado em ${engine.update.source}\\installer` };
  const lnk = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Farol.lnk');
  // o script vive num .ps1 próprio e é lançado via Start-Process (ShellExecute)
  // pra sobreviver à morte deste processo (o installer mata o Farol no meio).
  // Não usar detached+windowsHide direto: as flags de console são incompatíveis.
  const dir = path.join(HOME, 'sessions');
  ensureDir(dir);
  const scriptFile = path.join(dir, `update-${Date.now()}.ps1`);
  fs.writeFileSync(scriptFile, [
    `& '${installer}' *> (Join-Path '${STATE_DIR}' 'update.log')`,
    'Start-Sleep -Seconds 1',
    `explorer.exe '${lnk}'`,
    `Remove-Item -LiteralPath '${scriptFile}' -Force -ErrorAction SilentlyContinue`
  ].join('\r\n'));
  const ps = buildUpdateLaunchCommand(scriptFile);
  logSpawn('applyUpdate', ['powershell.exe', scriptFile]);
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { stdio: 'ignore', windowsHide: true });
  // farol.log é só falha: uma atualização iniciada não é erro, então não loga.
  engine.emit('toast', { kind: 'info', text: 'Atualizando: o Farol vai fechar e reabrir sozinho em instantes.' });
  return { ok: true, from: APP_VERSION, to: engine.update.sourceVersion };
}

// macOS: mesmo contrato do Windows, com install.sh. O bash roda detached
// (grupo próprio) pra sobreviver quando o installer matar este processo.
function applyUpdateMac(engine) {
  const installer = path.join(engine.update.source, 'installer', 'install.sh');
  if (!fs.existsSync(installer)) return { ok: false, error: `installer não encontrado em ${engine.update.source}/installer` };
  const dir = path.join(HOME, 'sessions');
  ensureDir(dir);
  const scriptFile = path.join(dir, `update-${Date.now()}.sh`);
  fs.writeFileSync(scriptFile, [
    '#!/bin/bash',
    `bash '${installer}' > '${path.join(STATE_DIR, 'update.log')}' 2>&1`,
    'sleep 1',
    `open "$HOME/Applications/Farol.app" 2>/dev/null || open -a Farol 2>/dev/null`,
    'rm -f -- "$0"'
  ].join('\n') + '\n', { mode: 0o755 });
  spawn('/bin/bash', [scriptFile], { stdio: 'ignore', detached: true }).unref();
  // farol.log é só falha: uma atualização iniciada não é erro, então não loga.
  engine.emit('toast', { kind: 'info', text: 'Atualizando: o Farol vai fechar e reabrir sozinho em instantes.' });
  return { ok: true, from: APP_VERSION, to: engine.update.sourceVersion };
}

module.exports = {
  resolveUpdateSource, cmpVersion, checkUpdate, checkUpdateRemote,
  downloadRemoteUpdate, applyUpdate, applyUpdateMac, buildUpdateLaunchCommand,
};
