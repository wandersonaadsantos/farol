// Concern de auto-update (Onda 2, módulo colaborador). Funções que recebem o
// `engine` como contexto explícito e operam sobre o estado dele; a Engine mantém
// métodos-fachada finos que delegam pra cá. Comportamento idêntico ao inline antigo.
// Ver docs/QUALITY.md e CLAUDE.md (seção Release: fonte de verdade = release do GitHub).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { APP_VERSION, APP_ROOT, HOME, STATE_DIR, IS_WIN, IS_MAC } from '../paths.js';
import io from '../io.js';
import { ensureDir, writeJsonAtomic } from '../io.js';
import { logSpawn } from '../spawnlog.js';
import { shEsc } from '../parse.js';
// I1: o teto de idade da sessão de terminal mora em decision.js (fonte única do
// julgamento de "terminal fantasma", ver G17). Import de módulo irmão já existente,
// zero dependência nova e sem ciclo (decision.js não conhece o update).
import { TERMINAL_SESSION_MAX_MS } from './decision.js';
import { TEMPOS } from '../constants.js';

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
    // rodando direto da fonte (dev): não há o que atualizar. Case-insensitive
    // SÓ no Windows (NTFS); APFS pode ser case-sensitive e dois caminhos que
    // diferem em caixa são diretórios distintos de verdade lá
    const a = path.resolve(cand), b = path.resolve(APP_ROOT);
    if (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b) return null;
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
      checkedAt: Date.now(),
      queued: !!engine.updateQueued // a UI mostra "agendado" no banner
    };
    engine.pushState();
    return engine.update;
  }
  const repo = (engine.config.updateRepo || '').trim();
  if (repo) { await checkUpdateRemote(engine, repo); }
  else {
    engine.update = { current: APP_VERSION, channel: 'none', source: null, sourceVersion: null, available: false, checkedAt: Date.now(), queued: false };
  }
  engine.pushState();
  return engine.update;
}

// Lê a última release do repo via gh (o mesmo gh autenticado que o app já usa).
async function checkUpdateRemote(engine, repo) {
  const r = await io.run('gh', ['release', 'view', '--repo', repo, '--json', 'tagName,assets'], { env: engine.ghEnv() });
  const base = { current: APP_VERSION, channel: 'remote', repo, source: null, checkedAt: Date.now(), queued: !!engine.updateQueued };
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

// G20: cada tentativa criava sessions/update-dl-<ts> e nada apagava; meses de
// uso acumulavam dezenas de cópias do pacote. Poda best-effort na entrada.
function pruneOldDownloads(sessionsDir) {
  const DIA = 24 * 60 * 60 * 1000;
  let dirs = [];
  try { dirs = fs.readdirSync(sessionsDir).filter(d => d.startsWith('update-dl-')); } catch { return; }
  for (const d of dirs) {
    const full = path.join(sessionsDir, d);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > DIA) fs.rmSync(full, { recursive: true, force: true });
    } catch { /* best-effort: lixo que não saiu hoje sai amanhã */ }
  }
}

// Baixa e extrai o pacote leve (farol-vX.Y.Z.zip) da release; devolve a pasta
// extraída pra applyUpdate rodar o installer dali. O Electron NÃO viaja no
// update: a cópia instalada já tem, o installer preserva.
async function downloadRemoteUpdate(engine) {
  const repo = (engine.config.updateRepo || '').trim();
  const ver = engine.update && engine.update.sourceVersion;
  if (!repo || !ver) throw new Error('sem release remota pra baixar');
  const sessionsDir = path.join(HOME, 'sessions');
  pruneOldDownloads(sessionsDir);
  const base = path.join(sessionsDir, 'update-dl-' + Date.now());
  ensureDir(base);
  const dl = await io.run('gh', ['release', 'download', 'v' + ver, '--repo', repo,
    '--pattern', 'farol-v*.zip', '--dir', base, '--clobber'], { env: engine.ghEnv() });
  if (!dl.ok) throw new Error('falha ao baixar: ' + (dl.stderr || dl.stdout || '').trim().slice(0, 200));
  const zip = fs.readdirSync(base).find(f => /^farol-v.*\.zip$/i.test(f));
  if (!zip) throw new Error('release sem o pacote farol-v*.zip');
  const zipPath = path.join(base, zip);
  const outDir = path.join(base, 'extracted');
  ensureDir(outDir);
  if (IS_WIN) {
    const r = await io.run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`]);
    if (!r.ok) throw new Error('falha ao extrair: ' + (r.stderr || '').trim().slice(0, 200));
  } else {
    const r = await io.run('unzip', ['-o', zipPath, '-d', outDir]);
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

/* ---------- reabertura silenciosa (v2.51.0, pedido do Wanderson) ----------
   O ciclo do auto-update fecha e reabre o app, e reabrir criava a janela VISÍVEL,
   roubando o foco de quem estava trabalhando. Como o update é automático e ligado
   por padrão desde a v2.46.0, isso acontecia sozinho, no meio do dia, sem ninguém
   ter pedido nada.

   O sinal é um arquivo, e não um argumento de linha de comando, porque no Windows
   quem reabre é `explorer.exe <atalho>`: os argumentos vêm do .lnk e não dá pra
   acrescentar um na hora. O marcador é gravado ANTES de disparar o installer e
   consumido (e apagado) pelo main.js no boot seguinte.

   TEM PRAZO de propósito: se o update falhar e o app nunca reiniciar, o marcador
   ficaria no disco e a PRÓXIMA abertura manual sairia sem janela, o que pareceria
   app quebrado. Fora da janela de validade ele é ignorado e apagado. */
const REABRIR_SILENCIOSO = path.join(STATE_DIR, 'reabrir-silencioso.json');

// PURA: o marcador ainda vale? Só dentro da janela, e só com carimbo confiável.
function reaberturaEhRecente(dados, agora = Date.now()) {
  const at = Number(dados && dados.at);
  if (!Number.isFinite(at)) return false;
  const idade = agora - at;
  return idade >= 0 && idade <= TEMPOS.REABERTURA_SILENCIOSA_MS;
}

// Best-effort dos dois lados: falhar aqui só faz o app reabrir visível, que é o
// comportamento de sempre. Nunca derruba o update por causa disso.
function marcarReaberturaSilenciosa(versao) {
  try { writeJsonAtomic(REABRIR_SILENCIOSO, { at: Date.now(), to: String(versao || '') }); }
  catch { /* reabrir visível é degradação aceitável */ }
}

// Lido pelo main.js no boot. SEMPRE apaga o arquivo, mesmo quando vencido: o
// marcador é de uso único por construção.
function consumirReaberturaSilenciosa(agora = Date.now()) {
  let bruto = null;
  try { bruto = fs.readFileSync(REABRIR_SILENCIOSO, 'utf8'); }
  catch { return null; }
  const dados = io.parseJson(bruto, null);
  try { fs.unlinkSync(REABRIR_SILENCIOSO); } catch { /* some no próximo boot */ }
  return reaberturaEhRecente(dados, agora) ? dados : null;
}

// O installer mata o Farol: sessão headless ou chat vivos morreriam no meio,
// possivelmente entre o APPROVE postado e a gravação do estado local. A MESMA
// checagem roda antes do download (fail-fast, não gasta banda) e DEPOIS dele
// (gate de verdade: o download dura minutos e o polling pode iniciar revisão).
const BUSY_ERROR = 'há análise, chat ou sessão de terminal em andamento; termine ou cancele antes de atualizar';
function sessionsBusy(engine) {
  // G14: o installer mata o processo; sessão de TERMINAL viva perderia o
  // handler de exit (PRs ficariam "vistos" pra sempre) e a capability de
  // postagem (que é memória). Terminal ocupado também barra o update.
  //
  // I1: "viva" pelo MESMO critério do G17 (a constante vem de decision.js, fonte
  // única). A entrada de terminal só some quando o aviso de saída do script chega
  // (trap EXIT), e esse aviso é pendência conhecida do macOS: janela morta cujo
  // trap não rodou deixa entrada fantasma até o processo reiniciar. Sem teto, esse
  // fantasma travava o update PRA SEMPRE, com o botão devolvendo sempre o mesmo
  // erro e nenhuma sessão pra cancelar na tela. Acima de 12h a entrada não conta
  // mais. Sessão sem startedAt confiável CONTINUA segurando (falha fechado): sem
  // idade provada não dá pra afirmar fantasma, e matar sessão viva é pior.
  const agora = Date.now();
  const terminalVivo = [...engine.activeReviews.values()].some(s =>
    s && s.mode === 'terminal' &&
    (!Number.isFinite(s.startedAt) || agora - s.startedAt <= TERMINAL_SESSION_MAX_MS));
  return !!(engine.headlessBusyAccounts.size || engine.running.size || engine.headlessQueue.length || terminalVivo);
}

// deps é injeção PRA TESTE: checkUpdate e downloadRemoteUpdate reais fazem rede
// via gh e o corpo chama o binding local (mock via exports não alcança). O default
// preserva a chamada de produção applyUpdate(engine) e mantém Function.length = 1,
// que o test/facades.test.js usa pra derivar a aridade esperada da fachada
// Engine.applyUpdate() (0 parâmetros). NÃO remova o `= {}`.
async function applyUpdate(engine, deps = {}) {
  // Clique duplo em "Atualizar agora" (sem feedback visual durante o download)
  // disparava dois downloads e dois installers copiando por cima de ~/.farol/app
  // ao mesmo tempo (M16). A guarda liga ANTES do primeiro await (o padrão do bug
  // era checar-antes-do-await e marcar depois). Depois de ok:true ela fica LIGADA
  // de propósito: o installer vai matar o processo; se algo impedir, o próximo
  // boot zera (o flag vive só em memória, nunca persiste).
  if (engine.updateApplying) return { ok: false, error: 'atualização já em andamento' };
  engine.updateApplying = true;
  let r;
  try { r = await applyUpdateInner(engine, deps); }
  catch (err) { engine.updateApplying = false; throw err; }
  if (!r.ok) engine.updateApplying = false;
  // Ocupado não é erro seco (v2.46.1): o clique do usuário vira AGENDAMENTO. O
  // maybeAutoUpdate do próximo ciclo aplica sozinho quando as sessões terminarem,
  // mesmo com o toggle autoUpdate desligado (pedido explícito, one-shot). As duas
  // checagens de busy (antes e depois do download) caem aqui igualmente.
  if (!r.ok && r.error === BUSY_ERROR) {
    engine.updateQueued = true;
    if (engine.update) engine.update.queued = true; // snapshot atual, sem esperar o próximo checkUpdate
    engine.pushState();
    return { ok: false, queued: true, error: BUSY_ERROR };
  }
  return r;
}

// Aplica sozinho o update pendente quando ninguém está usando o app, sem clique
// (v2.46.0). É chamada no fim de cada ciclo de polling (30s), depois do checkUpdate.
// Cada gate devolve { ok:false, skipped:'<motivo>' } SEM efeito colateral: skip é o
// caminho normal (canal local em dev, ninguém ocioso ainda), não é falha.
async function maybeAutoUpdate(engine, deps = {}) {
  // default LIGADO: só bloqueia se o campo estiver estritamente false. Campo ausente
  // (config antigo, ou usuário que nunca mexeu) mantém o comportamento novo.
  // clique explícito em "Atualizar agora" com sessão ativa (updateQueued) vence o
  // toggle desligado: é pedido direto do usuário, one-shot.
  if (engine.config.autoUpdate === false && !engine.updateQueued) return { ok: false, skipped: 'desligado' };
  // canal local é o fluxo de dev do mantenedor (pasta-fonte apontada em updateSource);
  // nunca auto-aplica, fica só no botão.
  if (!engine.update || !engine.update.available || engine.update.channel !== 'remote') {
    return { ok: false, skipped: 'nada' };
  }
  if (engine.updateApplying) return { ok: false, skipped: 'em-andamento' };
  if (sessionsBusy(engine)) return { ok: false, skipped: 'ocupado' };
  const backoffMs = TEMPOS.AUTO_UPDATE_BACKOFF_MS;
  if (engine.autoUpdateFailedAt && Date.now() - engine.autoUpdateFailedAt < backoffMs) {
    return { ok: false, skipped: 'backoff' };
  }
  engine.updateApplying = true;
  // consome o agendamento ANTES do apply: se falhar, a falha entra no backoff
  // normal e o queued não re-arma sozinho (o clique valia por UMA tentativa).
  const eraQueued = !!engine.updateQueued;
  engine.updateQueued = false;
  if (engine.update) engine.update.queued = false;
  let r;
  try {
    // NÃO delega pro applyUpdate público: ele tem o MESMO guard de updateApplying
    // (clique duplo, M16) e essa função já acabou de ligar a guarda acima, então
    // chamar o público de novo devolveria sempre "já em andamento" em produção.
    // applyUpdateInner é o núcleo sem esse guard redundante; deps.applyUpdate
    // (só em teste) substitui a chamada inteira, sem esse problema.
    r = await (deps.applyUpdate || applyUpdateInner)(engine, deps);
    if (!r.ok && r.error !== BUSY_ERROR) {
      engine.autoUpdateFailedAt = Date.now();
      engine.log('ERROR', `auto-update falhou: ${r.error}`);
    }
    // BUSY depois de consumir o queued é CORRIDA pré-tentativa (sessão nasceu na
    // janela do download; nada destrutivo aconteceu), não uma tentativa real. O
    // contrato "falha não re-arma" vale pra falha de tentativa REAL; aqui o pedido
    // explícito do usuário é re-armado pro próximo ciclo, senão morreria em silêncio
    // com o toggle autoUpdate desligado.
    if (eraQueued && !r.ok && r.error === BUSY_ERROR) {
      engine.updateQueued = true;
      if (engine.update) engine.update.queued = true;
    }
    return r;
  } finally {
    // simetria com o applyUpdate público: SUCESSO mantém a flag true de propósito
    // (o installer vai matar o processo; se não matar, o próximo boot zera). Zerar
    // aqui reabriria a porta pra um segundo auto-apply num spawn que falhou calado.
    // Falha e exceção zeram, pro próximo ciclo poder tentar de novo.
    if (!r || !r.ok) engine.updateApplying = false;
  }
}

async function applyUpdateInner(engine, deps) {
  const check = deps.checkUpdate || checkUpdate;
  const download = deps.downloadRemoteUpdate || downloadRemoteUpdate;
  await check(engine);
  if (!engine.update.available) return { ok: false, error: 'nenhuma atualização disponível' };
  if (sessionsBusy(engine)) return { ok: false, error: BUSY_ERROR };
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
  // re-checa DEPOIS do download: revisão iniciada nesse meio tempo seria morta
  // pelo installer no meio da sessão (M15)
  if (sessionsBusy(engine)) return { ok: false, error: BUSY_ERROR };
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
  marcarReaberturaSilenciosa(engine.update.sourceVersion);
  const ps = buildUpdateLaunchCommand(scriptFile);
  logSpawn('applyUpdate', ['powershell.exe', scriptFile]);
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { stdio: 'ignore', windowsHide: true });
  // farol.log é só falha: uma atualização iniciada não é erro, então não loga.
  engine.emit('toast', { kind: 'info', text: 'Atualizando em segundo plano: o Farol reabre sozinho na bandeja, sem tomar a tela.' });
  return { ok: true, from: APP_VERSION, to: engine.update.sourceVersion };
}

// Conteúdo do script de update do macOS, PURO e exportado pelo mesmo motivo do
// buildUpdateLaunchCommand do Windows (M14: caminho com espaço/apóstrofo só é
// testável com a montagem fora do spawn). shEsc cobre apóstrofo em nome de
// usuário (ex.: O'Brien), que a interpolação crua quebrava.
// O `pid` é o do PRÓPRIO Farol, e ele não é luxo: o `pkill -f` do install.sh NUNCA
// alcança o app neste caminho. `man pkill` no macOS: "the current pgrep or pkill
// process and all of its ANCESTORS are excluded" por padrão, e este script é
// spawnado PELO app, então o installer é descendente dele. Medido num Mac real em
// 17/08/2026: o pkill do installer derrubava só os processos auxiliares do Electron,
// o principal seguia vivo, os arquivos novos chegavam ao disco e o app continuava
// rodando o código VELHO; o `open` seguinte só focava a janela já aberta. O toast
// prometia "vai fechar e reabrir sozinho" e o usuário não via nada acontecer.
// kill por PID não tem a regra de ancestral, então é ele quem fecha o app. Sem pid
// conhecido, degrada pro comportamento antigo em vez de chutar um alvo.
function buildUpdateScriptMac(installer, logFile, pid) {
  const fecharApp = Number.isInteger(pid) && pid > 0 ? [
    `kill ${pid} 2>/dev/null || true`,
    // espera a saída em vez de supor: o installer sobrescreve os arquivos que o app
    // em execução usa, e 4s cobrem a parada normal do Electron sem travar o update
    `for _ in $(seq 1 20); do kill -0 ${pid} 2>/dev/null || break; sleep 0.2; done`,
  ] : [];
  return [
    '#!/bin/bash',
    ...fecharApp,
    `bash '${shEsc(installer)}' > '${shEsc(logFile)}' 2>&1`,
    'sleep 1',
    `open "$HOME/Applications/Farol.app" 2>/dev/null || open -a Farol 2>/dev/null`,
    'rm -f -- "$0"'
  ].join('\n') + '\n';
}

// Instalador do ramo posix, PURO: mac e linux têm scripts distintos.
function posixInstallerName(isMac) { return isMac ? 'install.sh' : 'install-linux.sh'; }

// Irmão linux do buildUpdateScriptMac (mesmo escaping testado): roda o
// install-linux.sh e reabre pelo lançador que ele cria; setsid desprende o
// Farol novo do grupo que o installer está prestes a matar.
function buildUpdateScriptLinux(installer, logFile) {
  return [
    '#!/bin/bash',
    `bash '${shEsc(installer)}' > '${shEsc(logFile)}' 2>&1`,
    'sleep 1',
    'setsid "$HOME/.farol/bin/farol" >/dev/null 2>&1 &',
    'rm -f -- "$0"'
  ].join('\n') + '\n';
}

// posix (macOS e Linux): mesmo contrato do Windows, com o install*.sh do SO.
// O bash roda detached (grupo próprio) pra sobreviver quando o installer matar
// este processo.
function applyUpdateMac(engine) {
  const installer = path.join(engine.update.source, 'installer', posixInstallerName(IS_MAC));
  if (!fs.existsSync(installer)) return { ok: false, error: `installer não encontrado em ${engine.update.source}/installer` };
  const dir = path.join(HOME, 'sessions');
  ensureDir(dir);
  const scriptFile = path.join(dir, `update-${Date.now()}.sh`);
  marcarReaberturaSilenciosa(engine.update.sourceVersion);
  const builder = IS_MAC ? buildUpdateScriptMac : buildUpdateScriptLinux;
  // o pid só muda o ramo mac: o pgrep do Linux (procps) não exclui ancestral, então
  // lá o pkill do install-linux.sh continua fechando o app como sempre fez. O
  // builder do Linux ignora o argumento a mais de propósito, e não foi tocado
  // porque o ramo é experimental e não há Mac/Linux real pra revalidar os dois.
  fs.writeFileSync(scriptFile, builder(installer, path.join(STATE_DIR, 'update.log'), process.pid), { mode: 0o700 });
  logSpawn('applyUpdatePosix', ['/bin/bash', scriptFile]);
  spawn('/bin/bash', [scriptFile], { stdio: 'ignore', detached: true }).unref();
  // farol.log é só falha: uma atualização iniciada não é erro, então não loga.
  engine.emit('toast', { kind: 'info', text: 'Atualizando em segundo plano: o Farol reabre sozinho na bandeja, sem tomar a tela.' });
  return { ok: true, from: APP_VERSION, to: engine.update.sourceVersion };
}

const updateMod = {
  resolveUpdateSource, cmpVersion, checkUpdate, checkUpdateRemote,
  downloadRemoteUpdate, applyUpdate, applyUpdateMac, buildUpdateLaunchCommand, buildUpdateScriptMac, buildUpdateScriptLinux, posixInstallerName,
  reaberturaEhRecente, marcarReaberturaSilenciosa, consumirReaberturaSilenciosa, REABRIR_SILENCIOSO,
  sessionsBusy, pruneOldDownloads, BUSY_ERROR, maybeAutoUpdate,
};
export default updateMod;
export {
  resolveUpdateSource, cmpVersion, checkUpdate, checkUpdateRemote,
  downloadRemoteUpdate, applyUpdate, applyUpdateMac, buildUpdateLaunchCommand, buildUpdateScriptMac, buildUpdateScriptLinux, posixInstallerName,
  reaberturaEhRecente, marcarReaberturaSilenciosa, consumirReaberturaSilenciosa, REABRIR_SILENCIOSO,
  sessionsBusy, pruneOldDownloads, BUSY_ERROR, maybeAutoUpdate,
};

