'use strict';
// Concern de sessão/stream (Onda 2, colaborador): sessões interativas no terminal
// (scripts .cmd/.command por SO) e sessões headless via claude -p stream-json, com o
// feed de atividade ao vivo, cancelamento (killTree) e parsing do envelope/resultado.
// Ramo de plataforma concentrado aqui via IS_WIN. Funções recebem o engine como ctx;
// a Engine mantém fachadas finas que delegam. Ver docs/QUALITY.md e CLAUDE.md.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { WORKSPACE, HOME, IS_WIN } = require('../paths');
const { ensureDir } = require('../io');
const { modelLabel } = require('../format');
const { sanitizeModel, sanitizeEffort, effortForModel, claudeAuthShellLines, claudeAuthPosixPrefix, applyClaudeAuthEnv } = require('../parse');
const { logSpawn } = require('../spawnlog');
const { checkpointPath, appendCheckpointEntry } = require('./verification-checkpoint');

const CHECKPOINT_MARKER = /^FAROL_CHECKPOINT:\s*(.+)$/s;

function createSessionReviewCap(engine, keys, account, id) {
  return typeof engine.createReviewPostCapability === 'function'
    ? engine.createReviewPostCapability(keys, account, 'terminal', id)
    : '';
}

function revokeSessionReviewCaps(engine, id) {
  if (typeof engine.revokeReviewPostCapabilitiesByOwner === 'function') {
    engine.revokeReviewPostCapabilitiesByOwner(id);
  }
}

function buildSessionScript(engine, slash, account, reviewCap = '') {
  const stub = process.env.FAROL_REVIEW_CMD; // usado so em testes: substitui o claude
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} "${slash}"` : `claude${skip} "${slash}"`;
  const authLines = claudeAuthShellLines(engine.resolveClaudeAuth(account), true).join('\r\n');
  return [
    '@echo off',
    'chcp 65001>nul',
    'title Farol - sessao do Claude',
    `cd /d "${WORKSPACE}"`,
    `set "FAROL_PORT=${String(engine.config.port || 47170)}"`,
    `set "FAROL_REVIEW_CAP=${String(reviewCap || '')}"`,
    authLines,
    claudeLine,
    'echo.',
    'echo  [Farol] Sessao encerrada. Pressione qualquer tecla para fechar esta janela.',
    'pause>nul'
  ].join('\r\n') + '\r\n';
}

// macOS: a sessao interativa abre no Terminal.app via arquivo .command.
// O "open" retorna na hora (nao da pra acompanhar o processo), entao o
// proprio script avisa o app quando termina (trap EXIT -> /api/session-exit)
// e se apaga. O GH_TOKEN e obtido DENTRO do script (nada de token em disco).
function buildSessionScriptMac(engine, slash, id, user, reviewCap = '') {
  const stub = process.env.FAROL_REVIEW_CMD;
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} '${slash}'` : `claude${skip} '${slash}'`;
  const acc = user || engine.primaryUser();
  const userArg = acc ? ` --user '${acc}'` : '';
  const authLines = claudeAuthShellLines(engine.resolveClaudeAuth(user), false).join('\n');
  return [
    '#!/bin/bash',
    '# Farol: sessao interativa do Claude. Este arquivo se apaga ao terminar.',
    `cd '${WORKSPACE}' || exit 1`,
    'notify() {',
    `  curl -fsS -m 5 -X POST -H 'x-farol: 1' -H 'Content-Type: application/json' \\`,
    `    --data '{"id":"${id}"}' 'http://127.0.0.1:${engine.config.port}/api/session-exit' >/dev/null 2>&1`,
    '  rm -f -- "$0"',
    '}',
    'trap notify EXIT',
    'export GH_PAGER=cat PAGER=cat',
    `export FAROL_PORT='${String(engine.config.port || 47170)}'`,
    `export FAROL_REVIEW_CAP='${String(reviewCap || '')}'`,
    authLines,
    `GH_TOKEN="$(gh auth token${userArg} 2>/dev/null)" && export GH_TOKEN`,
    claudeLine,
    'echo',
    'echo " [Farol] Sessao encerrada. Pode fechar esta janela."'
  ].join('\n') + '\n';
}

function spawnConsoleMac(engine, slash, label, keys = [], account) {
  const sessionsDir = path.join(HOME, 'sessions');
  ensureDir(sessionsDir);
  const id = `t${++engine.sessionSeq}`;
  const reviewCap = createSessionReviewCap(engine, keys, account, id);
  const script = path.join(sessionsDir, `sessao-${Date.now()}.command`);
  fs.writeFileSync(script, engine.buildSessionScriptMac(slash, id, account, reviewCap), { mode: 0o700 });
  engine.activeReviews.set(id, { id, keys, label, mode: 'terminal', startedAt: Date.now() });
  const child = spawn('open', ['-a', 'Terminal', script], { stdio: 'ignore' });
  child.on('error', (err) => {
    try { fs.unlinkSync(script); } catch { }
    revokeSessionReviewCaps(engine, id);
    engine.activeReviews.delete(id);
    engine.log('ERROR', `falha ao abrir sessao "${label}" no Terminal: ${err.message}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão: ${err.message}` });
    engine.pushState();
  });
  // open retorna na hora: exit 0 = Terminal lançado (o fim REAL da sessão chega
  // depois, pelo trap EXIT do .command via /api/session-exit). Exit != 0 = o Terminal
  // nunca abriu (permissão de automação negada, MDM): sem isto o pill ficava preso e
  // as keys vistas pra sempre, PR sumido da fila (M5). O delete devolve false se o
  // handler de error já limpou (open pode disparar error E exit pro mesmo filho).
  child.on('exit', (code) => {
    if (!code) return;
    try { fs.unlinkSync(script); } catch { }
    revokeSessionReviewCaps(engine, id);
    if (!engine.activeReviews.delete(id)) return;
    for (const k of keys) engine.unsee(k);
    engine.log('ERROR', `falha ao abrir sessao "${label}" no Terminal: open saiu com codigo ${code}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão no Terminal (código ${code}).` });
    engine.pushState();
    if (keys.length) engine.checkNow();
  });
  engine.pushState();
}

// Lógica compartilhada de "sessão de terminal terminou": desfaz o "visto" de TODAS as
// keys da sessão incondicionalmente, sem saber se a revisão foi de fato postada. É
// seguro (ver server.js:576, mineList.filter(p => !this.seen.has(p.key)): se a revisão
// foi postada de verdade, o GitHub já não lista mais o PR como pendente, então não
// reaparece à toa). Sem isso, fechar a janela do terminal antes do /pr-review rodar até
// o fim (ex.: você só usou o terminal pra `claude login` e fechou) deixava o PR escondido
// da fila pra sempre — mesmo risco que recoverInflight (server.js) cobre pro caso de
// crash/restart, mas que nada cobria pro caso de fechar a janela manualmente (achado de
// bug real). Compartilhada entre spawnConsole (Windows, via child.on('exit', ...)) e
// sessionExit (mac, chamado pelo próprio script .command via trap EXIT).
function handleSessionExit(engine, { keys = [], label, id, code } = {}) {
  revokeSessionReviewCaps(engine, id);
  engine.activeReviews.delete(id);
  if (code !== 0 && code !== null && code !== undefined) engine.log('WARN', `sessao "${label}" saiu com codigo ${code}`);
  for (const k of keys) engine.unsee(k);
  engine.emit('toast', { kind: 'ok', text: `${label}: sessão encerrada. De volta ao monitoramento.` });
  engine.pushState();
  if (keys.length) engine.checkNow();
}

// chamado pelo script .command do macOS quando a sessao interativa termina
function sessionExit(engine, id) {
  const s = engine.activeReviews.get(String(id || ''));
  if (!s) return { ok: true };
  handleSessionExit(engine, { keys: s.keys || [], label: s.label, id: s.id, code: 0 });
  return { ok: true };
}

function spawnConsole(engine, slash, label, keys = [], account) {
  if (!IS_WIN) return engine.spawnConsoleMac(slash, label, keys, account);
  const sessionsDir = path.join(HOME, 'sessions');
  ensureDir(sessionsDir);
  const id = `t${++engine.sessionSeq}`;
  const reviewCap = createSessionReviewCap(engine, keys, account, id);
  const script = path.join(sessionsDir, `sessao-${Date.now()}.cmd`);
  fs.writeFileSync(script, engine.buildSessionScript(slash, account, reviewCap));
  const ps = `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','"${script}"' ` +
    `-WorkingDirectory '${WORKSPACE}' -PassThru -Wait; exit $p.ExitCode`;
  // sem "detached": DETACHED_PROCESS + CREATE_NO_WINDOW sao flags de console
  // incompativeis e o powershell morre na hora. O console do claude nasce via
  // ShellExecute (Start-Process) e nao depende deste wrapper para viver.
  // o GH_TOKEN vem do env do wrapper (a sessao Windows herda), por isso o token
  // da conta certa e injetado aqui.
  logSpawn('spawnConsole(terminal-visivel)', ['cmd.exe', script]);
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    cwd: WORKSPACE,
    env: engine.ghEnv(account),
    stdio: 'ignore',
    windowsHide: true
  });
  engine.activeReviews.set(id, { id, keys, label, mode: 'terminal', startedAt: Date.now() });
  const cleanup = () => {
    try { fs.unlinkSync(script); } catch { }
    revokeSessionReviewCaps(engine, id);
  };
  child.on('exit', (code) => {
    cleanup();
    engine.handleSessionExit({ keys, label, id, code });
  });
  child.on('error', (err) => {
    cleanup();
    engine.activeReviews.delete(id);
    engine.log('ERROR', `falha ao abrir sessao "${label}": ${err.message}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão: ${err.message}` });
    engine.pushState();
  });
  engine.pushState();
}

// Sessão de terminal SÓ pra `claude login` (ou qualquer coisa manual do usuário), sem
// nenhum PR/fila envolvido: sem slash command, sem keys (então o handler de saída não
// mexe em "visto"/checkNow nenhum), sem token do gh no env (essa sessão não faz nada no
// GitHub). Existe pra não precisar mais "sequestrar" um PR de review só pra logar numa
// assinatura Claude (achado de bug real: abrir uma sessão de review só pra logar e
// fechar sem revisar fazia o PR sumir da fila, ver Fix 1 acima e resolveConfigDirForLogin
// em server.js).
function buildLoginScript(engine, dir) {
  const stub = process.env.FAROL_REVIEW_CMD;
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub || `claude${skip}`;
  const cfgDir = dir ? `set "CLAUDE_CONFIG_DIR=${dir}"` : 'rem sem config dir proprio';
  return [
    '@echo off',
    'chcp 65001>nul',
    'title Farol - login do Claude',
    `cd /d "${WORKSPACE}"`,
    cfgDir,
    claudeLine,
    'echo.',
    'echo  [Farol] Sessao encerrada. Pressione qualquer tecla para fechar esta janela.',
    'pause>nul'
  ].join('\r\n') + '\r\n';
}

function buildLoginScriptMac(engine, dir, id) {
  const stub = process.env.FAROL_REVIEW_CMD;
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub || `claude${skip}`;
  return [
    '#!/bin/bash',
    '# Farol: sessao SO de login do Claude. Este arquivo se apaga ao terminar.',
    `cd '${WORKSPACE}' || exit 1`,
    'notify() {',
    `  curl -fsS -m 5 -X POST -H 'x-farol: 1' -H 'Content-Type: application/json' \\`,
    `    --data '{"id":"${id}"}' 'http://127.0.0.1:${engine.config.port}/api/session-exit' >/dev/null 2>&1`,
    '  rm -f -- "$0"',
    '}',
    'trap notify EXIT',
    // passa pelo MESMO montador das sessões de fila, que traz de graça o escaping de aspa
    // simples (achado de auditoria adversarial: um dir com aspa simples não pode escapar da
    // atribuição) e o unset das vars de auth da máquina.
    // o unset tem que vir DEPOIS do sourcing (o Terminal.app abre um login shell antes de
    // executar este .command) e ANTES do claude: sem ele, um ANTHROPIC_API_KEY exportado no
    // ~/.profile venceria o login OAuth e a sessão de login gravaria/usaria a conta errada,
    // calada. Mesma razão do claudeAuthShellLines nas sessões de fila (G21).
    ...claudeAuthShellLines({ kind: 'dir', dir }, false),
    claudeLine,
    'echo',
    'echo " [Farol] Sessao encerrada. Pode fechar esta janela."'
  ].join('\n') + '\n';
}

// Env do console de LOGIN. Existe separado (e exportado) por ser a única sessão do Farol
// que não passa por ghEnv, e por isso era a única cujo env herdava process.env CRU: com
// ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN no ambiente da máquina, a precedência oficial do
// claude CLI põe a chave acima do login OAuth, então a sessão aberta justamente pra logar
// numa assinatura rodava na chave da máquina, sem erro nenhum aparecer (G21). Sem GH_TOKEN
// de propósito: essa sessão não mexe no gh. Recebe o dir JÁ resolvido pelo login
// (resolveAuthForLogin em server.js barra perfil de chave antes de chegar aqui).
function loginConsoleEnv(dir) {
  const env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat' };
  // "sem GH_TOKEN" era promessa do comentário e do teste, mas quem cumpria era o ambiente:
  // não injetar o token de uma conta (o que ghEnv faz) não impedia HERDAR o da máquina, se o
  // usuário tiver a var exportada. Com o delete, a promessa passa a valer sempre. O gh não
  // fica sem auth por causa disso, ele cai no login do próprio keyring.
  delete env.GH_TOKEN;
  applyClaudeAuthEnv(env, { kind: 'dir', dir: dir || '' });
  return env;
}

function spawnLoginConsole(engine, dir) {
  if (!IS_WIN) return engine.spawnLoginConsoleMac(dir);
  const sessionsDir = path.join(HOME, 'sessions');
  ensureDir(sessionsDir);
  const script = path.join(sessionsDir, `login-${Date.now()}.cmd`);
  fs.writeFileSync(script, engine.buildLoginScript(dir));
  const label = 'Login do Claude';
  const ps = `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','"${script}"' ` +
    `-WorkingDirectory '${WORKSPACE}' -PassThru -Wait; exit $p.ExitCode`;
  logSpawn('spawnLoginConsole(terminal-visivel)', ['cmd.exe', script]);
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    cwd: WORKSPACE,
    env: loginConsoleEnv(dir), // sem GH_TOKEN e sem a auth do Claude herdada da maquina
    stdio: 'ignore',
    windowsHide: true
  });
  const id = `t${++engine.sessionSeq}`;
  engine.activeReviews.set(id, { id, keys: [], label, mode: 'terminal', startedAt: Date.now() });
  const cleanup = () => { try { fs.unlinkSync(script); } catch { } };
  child.on('exit', (code) => {
    cleanup();
    engine.activeReviews.delete(id);
    if (code !== 0 && code !== null) engine.log('WARN', `sessao "${label}" saiu com codigo ${code}`);
    engine.emit('toast', { kind: 'ok', text: `${label}: sessão encerrada.` });
    engine.pushState();
  });
  child.on('error', (err) => {
    cleanup();
    engine.activeReviews.delete(id);
    engine.log('ERROR', `falha ao abrir sessao "${label}": ${err.message}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão: ${err.message}` });
    engine.pushState();
  });
  engine.pushState();
}

function spawnLoginConsoleMac(engine, dir) {
  const sessionsDir = path.join(HOME, 'sessions');
  ensureDir(sessionsDir);
  const id = `t${++engine.sessionSeq}`;
  const script = path.join(sessionsDir, `login-${Date.now()}.command`);
  fs.writeFileSync(script, engine.buildLoginScriptMac(dir, id), { mode: 0o755 });
  const label = 'Login do Claude';
  engine.activeReviews.set(id, { id, keys: [], label, mode: 'terminal', startedAt: Date.now() });
  const child = spawn('open', ['-a', 'Terminal', script], { stdio: 'ignore' });
  child.on('error', (err) => {
    try { fs.unlinkSync(script); } catch { }
    engine.activeReviews.delete(id);
    engine.log('ERROR', `falha ao abrir sessao "${label}" no Terminal: ${err.message}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão: ${err.message}` });
    engine.pushState();
  });
  // mesma correção do M5 de spawnConsoleMac (regra R13 do plano mestre): exit != 0 do
  // open = o Terminal nunca abriu; sem tratar, o pill de login ficava preso pra sempre
  // e o script órfão nunca era apagado (o trap EXIT dele jamais roda). Sem keys aqui,
  // não há visto pra desfazer nem fila pra rechecar.
  child.on('exit', (code) => {
    if (!code) return;
    try { fs.unlinkSync(script); } catch { }
    if (!engine.activeReviews.delete(id)) return;
    engine.log('ERROR', `falha ao abrir sessao "${label}" no Terminal: open saiu com codigo ${code}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão no Terminal (código ${code}).` });
    engine.pushState();
  });
  engine.pushState();
}

function setSessionModel(engine, id, rawModel) {
  const sess = engine.activeReviews.get(id);
  if (!sess) return;
  sess.model = modelLabel(rawModel);
  sess.modelRaw = rawModel;
  engine.pushState();
}

// --- feed de atividade ao vivo (streaming das sessões headless) ------------
function pushActivity(engine, id, kind, text) {
  const list = engine.activity.get(id);
  if (!list) return;
  const item = { t: Date.now(), k: kind, text: String(text || '').slice(0, 400) };
  list.push(item);
  if (list.length > 120) list.splice(0, list.length - 120);
  engine.emit('activity', { id, item });
}

function toolSummary(engine, name, input) {
  input = input || {};
  if (name === 'Bash') return input.description || String(input.command || '').slice(0, 160);
  if (name === 'Task') return input.description || String(input.prompt || '').slice(0, 160);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return input.file_path || '';
  if (name === 'Grep' || name === 'Glob') return input.pattern || '';
  if (name === 'WebFetch') return input.url || '';
  return input.description || input.file_path || input.url || '';
}

function killTree(engine, pid) {
  // mata a árvore inteira: o child é o shell (cmd.exe/sh), o claude vive embaixo
  if (IS_WIN) {
    logSpawn('killTree', ['taskkill', '/pid', String(pid)]);
    try { execFile('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, () => { }); } catch { }
  } else {
    // sessões posix nascem com detached:true = grupo de processo próprio
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { } }
  }
}

function cancelSession(engine, id) {
  const run = engine.running.get(id);
  if (!run) return { ok: false, error: 'sessão não encontrada (já terminou?)' };
  run.cancelled = true;
  engine.killTree(run.child.pid);
  return { ok: true };
}

// Monta os flags de modelo e esforço da linha headless. PURA: recebe o config, devolve
// string. É o ÚNICO ponto onde valor de configuração entra na linha de comando que vai
// pro shell (cmd.exe no Windows, /bin/sh -lc no mac), então re-saneia aqui mesmo, mesmo
// com o server.js já saneando no boot e no updateSettings: defesa em profundidade num
// lugar onde o custo é uma chamada de função.
// Com o stub (FAROL_HEADLESS_CMD) não anexa nada: o stub é um binário falso que não
// conhece --model nem --effort, e toda a bateria de testes stubada depende disso.
function buildModelFlags(config, opts = {}) {
  if (opts.stub) return '';
  const cfg = config || {};
  const model = sanitizeModel(cfg.reviewModel) || '';
  const effort = effortForModel(model, sanitizeEffort(cfg.reviewEffort) || '');
  return (model ? ` --model ${model}` : '') + (effort ? ` --effort ${effort}` : '');
}

// Roda o claude headless com --output-format stream-json: cada evento NDJSON
// vira uma linha do feed de atividade (onEvent) e o resultado final é extraído
// do evento "result". Compatível com o stub FAROL_HEADLESS_CMD, que imprime um
// envelope JSON simples (fallback no close).
function runClaudeStream(engine, prompt, opts = {}) {
  const stub = process.env.FAROL_HEADLESS_CMD;
  const base = (stub || 'claude -p --output-format stream-json --verbose --dangerously-skip-permissions')
    + buildModelFlags(engine.config, { stub: !!stub });
  const extra = (opts.extraArgs || []).join(' ');
  const cmdline = extra ? `${base} ${extra}` : base;
  const onEvent = opts.onEvent || (() => { });
  logSpawn('claude-session', [cmdline]);
  return new Promise((resolve, reject) => {
    const env = engine.ghEnv(opts.account);
    if (opts.reviewCap) env.FAROL_REVIEW_CAP = String(opts.reviewCap);
    // resolvido uma vez só: qual perfil de chave de API atende esta conta (vazio se a
    // conta usa assinatura/dir, pra sessões dir/legado nunca poluírem o orçamento por perfil)
    const auth = engine.resolveClaudeAuth(opts.account);
    const authProfileId = auth.kind === 'apikey' ? auth.id : '';
    const child = IS_WIN
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], {
        cwd: WORKSPACE,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: true
      })
      // -l pra carregar o PATH do perfil; detached = grupo próprio (killTree).
      // O mesmo -l sourceia o profile do usuário DEPOIS do env que o ghEnv já limpou, então
      // o unset do prefixo é o que impede um ANTHROPIC_API_KEY perdido no ~/.profile de
      // anular o perfil de assinatura resolvido (G21; ver claudeAuthPosixPrefix).
      : spawn('/bin/sh', ['-lc', claudeAuthPosixPrefix(auth) + cmdline], {
        cwd: WORKSPACE,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true
      });
    const run = { child, cancelled: false };
    if (opts.id) engine.running.set(opts.id, run);

    let raw = '', errBuf = '', lineBuf = '';
    let sessionId = null, resultEvent = null, usedModel = null;
    const timeout = setTimeout(() => {
      // cancelamento do usuário em andamento: o killTree dele já foi disparado e o
      // close vai reportar 'cancelada por você'. Sobrescrever a flag aqui fazia o
      // cancelamento virar "falha por tempo esgotado" (B3).
      if (run.cancelled) return;
      engine.killTree(child.pid);
      finish(new Error('tempo esgotado (30min) na sessão autônoma'));
    }, 30 * 60 * 1000);

    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (opts.id) engine.running.delete(opts.id);
      if (err) reject(err); else resolve(value);
    };

    const handleEvent = (ev) => {
      if (!ev || typeof ev !== 'object') return;
      if (ev.session_id && !sessionId) sessionId = ev.session_id;
      if (ev.type === 'system' && ev.subtype === 'init') {
        if (ev.model) usedModel = ev.model; // guarda pro registro de consumo
        if (ev.model && opts.onModel) opts.onModel(ev.model);
        const lvl = ev.model ? modelLabel(ev.model) : '';
        onEvent({ kind: 'info', text: `sessão do Claude iniciada${lvl ? ` (${lvl})` : ''}` });
      } else if (ev.type === 'system' && ev.subtype === 'api_retry') {
        onEvent({ kind: 'warn', text: `instabilidade na conexão, tentando de novo (${ev.attempt}/${ev.max_retries})` });
      } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const block of ev.message.content) {
          if (block.type === 'text' && String(block.text || '').trim()) {
            onEvent({ kind: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            const sum = engine.toolSummary(block.name, block.input);
            onEvent({ kind: 'tool', text: sum ? `${block.name} · ${sum}` : block.name });
            // captura passiva do checkpoint de verificação: a sessão NUNCA escreve em state/
            // (regra 2 do prompt), ela só sinaliza via este campo estruturado; quem grava é
            // o engine, aqui. Ver docs/superpowers/specs/2026-08-05-checkpoint-verificacao-design.md.
            if (block.name === 'Bash') {
              const desc = String((block.input && block.input.description) || '');
              const m = desc.match(CHECKPOINT_MARKER);
              if (m) {
                try {
                  const parsed = JSON.parse(m[1]);
                  const review = engine.activeReviews && engine.activeReviews.get(opts.id);
                  const prKey = review && review.pr && review.pr.key;
                  const prUrl = review && review.pr && review.pr.url;
                  if (prKey && review.mode === 'auto' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    appendCheckpointEntry(checkpointPath(prKey), prKey, prUrl || '', {
                      claim: String(parsed.claim || ''),
                      file: String(parsed.file || ''),
                      line: Number(parsed.line) || 0,
                      verdict: String(parsed.verdict || ''),
                      evidence: String(parsed.evidence || ''),
                      sessionId: opts.id,
                      headSha: (review && review.headSha) || '',
                      at: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T'),
                    });
                  }
                } catch { /* marcador mal formado: ignora, não derruba a sessão */ }
              }
            }
          }
        }
      } else if (ev.type === 'result') {
        resultEvent = ev;
      }
    };

    const handleLine = (line) => {
      line = line.trim();
      if (!line) return;
      try { handleEvent(JSON.parse(line)); } catch { /* linha não-JSON (stub/ruído) */ }
    };

    // chunk pode cortar caractere multibyte no meio (o evento result é a linha mais
    // longa, a mais provável de atravessar o limite de 64KB): setEncoding liga o
    // StringDecoder do stream, que remonta o caractere entre chunks. String(c) por
    // Buffer isolado virava U+FFFD dentro do texto, até em review postado (M4).
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      c = String(c);
      if (raw.length < 32 * 1024 * 1024) raw += c;
      lineBuf += c;
      let nl;
      while ((nl = lineBuf.indexOf('\n')) >= 0) {
        handleLine(lineBuf.slice(0, nl));
        lineBuf = lineBuf.slice(nl + 1);
      }
    });
    child.stderr.on('data', c => { if (errBuf.length < 1024 * 1024) errBuf += c; });
    child.on('error', e => finish(e));
    child.on('close', (code) => {
      if (lineBuf.trim()) handleLine(lineBuf);
      // registra o consumo desta sessão SEMPRE que o evento final existir, mesmo em
      // erro OU cancelamento: uma sessão que falhou no passo final (ou levou kill
      // depois do result já emitido) gastou de verdade nos passos anteriores (achado
      // real, 04/08/2026: retry de ~4h que custou dinheiro em sessões que erraram no
      // fim; auditoria de 10/08: o registro vinha DEPOIS do branch de cancelled e o
      // kill na janela entre o result e o close descartava consumo já em mãos).
      // recordUsage ignora sessão sem token e sem custo (early-return interno).
      // farol_cancelled marca a linha do log como 'cancelada' (não 'ok'): a sessão
      // gastou de verdade, mas o desfecho não foi uma conclusão.
      if (resultEvent) {
        const ev = run.cancelled ? { ...resultEvent, farol_cancelled: true } : resultEvent;
        try { engine.recordUsage(opts.id, opts.account, ev, usedModel, authProfileId, opts.ref); } catch { /* registro é opcional */ }
      }
      if (run.cancelled) {
        return finish(Object.assign(new Error('cancelada por você'), { cancelled: true }));
      }
      if (resultEvent) {
        if (resultEvent.is_error) {
          const detail = String(resultEvent.result || (resultEvent.errors || []).join('; ') || errBuf.trim() || resultEvent.subtype);
          return finish(new Error(`sessão retornou erro: ${detail.slice(0, 300)}`));
        }
        return finish(null, { text: String(resultEvent.result ?? ''), sessionId: resultEvent.session_id || sessionId });
      }
      // sem evento result: stub de teste ou CLI antigo, parseia o envelope inteiro.
      // Exit != 0 NUNCA vira sucesso: claude que morreu no meio deixa NDJSON parcial
      // no raw, e esse cru não é resposta (virava "texto" no chat e SyntaxError
      // genérico no review). O detalhe real sai do stderr (M3).
      if (code !== 0) {
        const detail = errBuf.trim() || (raw.trim() ? 'stream interrompido antes do evento result' : 'sem saida');
        return finish(new Error(`claude saiu com código ${code}: ${detail.slice(0, 300)}`));
      }
      try { finish(null, { text: engine.parseEnvelope(raw), sessionId }); }
      catch (e) { finish(e); }
    });
    // EPIPE assíncrono de um filho que morreu antes de ler o prompt inteiro (>64KB no
    // pipe) não pode virar uncaughtException: sem handler, derruba o engine (B4). Só
    // absorve; a causa real da morte é reportada pelo close.
    child.stdin.on('error', () => { });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// envelope do --output-format json: { type, subtype, result, is_error, ... }
function parseEnvelope(engine, raw) {
  let text = String(raw).trim();
  try {
    const env = JSON.parse(text);
    if (env && typeof env === 'object' && 'result' in env) {
      if (env.is_error) throw new Error(`sessão retornou erro: ${String(env.result).slice(0, 300)}`);
      text = String(env.result);
    }
  } catch (e) { if (/sessão retornou erro/.test(e.message)) throw e; }
  return text;
}

function parseHeadlessResult(engine, raw) {
  const text = engine.parseEnvelope(raw);
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('a sessão não devolveu JSON');
  const data = JSON.parse(text.slice(a, b + 1));
  if (!data.decision || !data.payloads || !data.reportMarkdown) throw new Error('JSON da sessão fora do contrato');
  if (data.analysisStatus !== 'complete' && data.analysisStatus !== 'incomplete') {
    throw new Error('JSON da sessão com analysisStatus ausente ou inválido');
  }
  return data;
}

module.exports = {
  buildSessionScript, buildSessionScriptMac, spawnConsoleMac, sessionExit, spawnConsole,
  handleSessionExit,
  buildLoginScript, buildLoginScriptMac, loginConsoleEnv, spawnLoginConsole, spawnLoginConsoleMac,
  setSessionModel, pushActivity, toolSummary, killTree, cancelSession,
  runClaudeStream, parseEnvelope, parseHeadlessResult, buildModelFlags,
};
