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
const { sanitizeModel, sanitizeEffort, effortForModel } = require('../parse');
const { logSpawn } = require('../spawnlog');

function buildSessionScript(engine, slash, account) {
  const stub = process.env.FAROL_REVIEW_CMD; // usado so em testes: substitui o claude
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} "${slash}"` : `claude${skip} "${slash}"`;
  const claudeDir = engine.resolveClaudeConfigDir(account);
  const cfgDir = claudeDir ? `set "CLAUDE_CONFIG_DIR=${claudeDir}"` : 'rem sem config dir proprio';
  return [
    '@echo off',
    'chcp 65001>nul',
    'title Farol - sessao do Claude',
    `cd /d "${WORKSPACE}"`,
    cfgDir,
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
function buildSessionScriptMac(engine, slash, id, user) {
  const stub = process.env.FAROL_REVIEW_CMD;
  const skip = engine.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeLine = stub ? `${stub} '${slash}'` : `claude${skip} '${slash}'`;
  const acc = user || engine.primaryUser();
  const userArg = acc ? ` --user '${acc}'` : '';
  const claudeDir = engine.resolveClaudeConfigDir(user);
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
    // aspa simples PODE aparecer legitimamente num path (raro, mas existe), então
    // escapa de verdade em vez de rejeitar (rejeição é a estratégia pro "/`\r\n,
    // ver sanitizeClaudeDir/lib/parse.js): fecha a aspa, insere uma aspa simples
    // escapada, reabre a aspa (escaping padrão de single-quote em bash). Sem isso,
    // um dir como "/tmp/x' ; rm -rf ~ #" escapava da atribuição e executava comando
    // arbitrário no .command gerado (achado de auditoria adversarial, Fix 2).
    claudeDir ? `export CLAUDE_CONFIG_DIR='${claudeDir.replace(/'/g, "'\\''")}'` : '# sem config dir proprio',
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
  const script = path.join(sessionsDir, `sessao-${Date.now()}.command`);
  fs.writeFileSync(script, engine.buildSessionScriptMac(slash, id, account), { mode: 0o755 });
  engine.activeReviews.set(id, { id, keys, label, mode: 'terminal', startedAt: Date.now() });
  const child = spawn('open', ['-a', 'Terminal', script], { stdio: 'ignore' });
  child.on('error', (err) => {
    try { fs.unlinkSync(script); } catch { }
    engine.activeReviews.delete(id);
    engine.log('ERROR', `falha ao abrir sessao "${label}" no Terminal: ${err.message}`);
    engine.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão: ${err.message}` });
    engine.pushState();
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
  const script = path.join(sessionsDir, `sessao-${Date.now()}.cmd`);
  fs.writeFileSync(script, engine.buildSessionScript(slash, account));
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
  const id = `t${++engine.sessionSeq}`;
  engine.activeReviews.set(id, { id, keys, label, mode: 'terminal', startedAt: Date.now() });
  const cleanup = () => { try { fs.unlinkSync(script); } catch { } };
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
    // mesmo escaping de aspa simples do buildSessionScriptMac (achado de auditoria
    // adversarial): um dir com aspa simples não pode escapar da atribuição.
    dir ? `export CLAUDE_CONFIG_DIR='${dir.replace(/'/g, "'\\''")}'` : '# sem config dir proprio',
    claudeLine,
    'echo',
    'echo " [Farol] Sessao encerrada. Pode fechar esta janela."'
  ].join('\n') + '\n';
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
    env: { ...process.env, GH_PAGER: 'cat', PAGER: 'cat' }, // sem GH_TOKEN: essa sessao nao mexe no gh
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
    const child = IS_WIN
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], {
        cwd: WORKSPACE,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: true
      })
      // -l pra carregar o PATH do perfil; detached = grupo próprio (killTree)
      : spawn('/bin/sh', ['-lc', cmdline], {
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
      run.cancelled = false; // timeout não é cancelamento do usuário
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
      if (run.cancelled) {
        return finish(Object.assign(new Error('cancelada por você'), { cancelled: true }));
      }
      if (resultEvent) {
        if (resultEvent.is_error) {
          const detail = String(resultEvent.result || (resultEvent.errors || []).join('; ') || errBuf.trim() || resultEvent.subtype);
          return finish(new Error(`sessão retornou erro: ${detail.slice(0, 300)}`));
        }
        // registra o consumo de tokens desta sessão (best-effort, não interfere no resultado)
        try { engine.recordUsage(opts.id, opts.account, resultEvent, usedModel); } catch { /* registro é opcional */ }
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
  return data;
}

module.exports = {
  buildSessionScript, buildSessionScriptMac, spawnConsoleMac, sessionExit, spawnConsole,
  handleSessionExit,
  buildLoginScript, buildLoginScriptMac, spawnLoginConsole, spawnLoginConsoleMac,
  setSessionModel, pushActivity, toolSummary, killTree, cancelSession,
  runClaudeStream, parseEnvelope, parseHeadlessResult, buildModelFlags,
};
