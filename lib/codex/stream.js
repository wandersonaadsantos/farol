import cp from 'node:child_process';
import { WORKSPACE, IS_WIN } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { sanitizeCodexModel, sanitizeCodexEffort } from '../parse.js';
import { modelLabel } from '../format.js';
import { logSpawn } from '../spawnlog.js';
import envMod from '../env.js';
import { usaPlanoChatGPT } from './auth.js';

const RE_CHAVE_API = /^(?:OPENAI_API_KEY|CODEX_API_KEY)$/i;
const RE_RESUME_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const { parse: parseJson } = JSON;

function codexEnv(base = {}) {
  const out = { ...base };
  for (const k of Object.keys(out)) {
    if (RE_CHAVE_API.test(k)) delete out[k];
  }
  return out;
}

function codexSelection(config = {}, opts = {}) {
  const model = sanitizeCodexModel(config.codexReviewModel) || '';
  let effort = sanitizeCodexEffort(config.codexReviewEffort) || '';
  if (opts.fast) effort = ['minimal', 'low'].includes(effort) ? effort : 'medium';
  return { model, effort };
}

function codexResumeId(extraArgs) {
  const args = Array.isArray(extraArgs) ? extraArgs : [];
  const i = args.indexOf('--resume');
  const id = i >= 0 ? String(args[i + 1] || '') : '';
  return RE_RESUME_ID.test(id) ? id : '';
}

function codexArgs(config = {}, opts = {}) {
  if (opts.stub) return [];
  const resumeId = codexResumeId(opts.extraArgs);
  const args = ['-a', 'never', 'exec'];
  if (resumeId) args.push('resume');
  args.push('--json', '--skip-git-repo-check');
  if (!resumeId) args.push('--color', 'never');
  const { model, effort } = codexSelection(config, opts);
  if (model) args.push('--model', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  args.push('-c', 'forced_login_method="chatgpt"');
  if (resumeId) args.push(resumeId);
  args.push('-');
  return args;
}

function cotaCodex(msg) {
  const texto = String(msg || '');
  if (!/usage limit|rate limit|quota/i.test(texto)) return null;
  const m = texto.match(/(?:try again|reset(?:s)?(?: at)?|libera|volta)(?:\s+at)?\s+([^.;\n]+)/i);
  const reset = m ? m[1].trim() : null;
  return { reset };
}

function usageCodex(usage) {
  return {
    input_tokens: Number(usage?.input_tokens) || 0,
    output_tokens: Number(usage?.output_tokens) || 0,
    cache_read_input_tokens: Number(usage?.cached_input_tokens) || 0,
    cache_creation_input_tokens: 0,
  };
}

function resultCodex(estado, props = {}) {
  const ev = { type: 'result', result: estado.text || '', total_cost_usd: 0, session_id: estado.sessionId || null };
  return Object.assign(ev, props);
}

function eventoCodex(ev, estado, onEvent) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'thread.started' && ev.thread_id) estado.sessionId = ev.thread_id;
  if (ev.type === 'turn.started') onEvent({ kind: 'info', text: 'sessao do Codex iniciada' });
  if (ev.type === 'item.started' && ev.item?.type === 'command_execution') {
    onEvent({ kind: 'tool', text: String(ev.item.command || 'comando').slice(0, 180) });
  }
  if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
    estado.text = String(ev.item.text || '');
  }
  if (ev.type === 'turn.completed') {
    estado.resultEvent = resultCodex(estado, { usage: usageCodex(ev.usage) });
  }
  if (ev.type === 'turn.failed') {
    const detail = String(ev.error?.message || ev.message || 'falha no Codex');
    estado.resultEvent = resultCodex(estado, {
      result: detail,
      usage: {},
      is_error: true,
      farol_codex_quota: cotaCodex(detail),
    });
  }
}

function encerrarUmaVez(resolve, reject) {
  let done = false;
  return (err, value) => {
    if (done) return false;
    done = true;
    err ? reject(err) : resolve(value);
    return true;
  };
}

function verificarPlanoCodex(engine, opts, run) {
  if (run.stub) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const finish = encerrarUmaVez(resolve, reject);
    const env = codexEnv(engine.ghEnv(opts.account));
    const child = cp.spawn('codex', ['login', 'status'], {
      cwd: WORKSPACE,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '', err = '';
    const timer = setTimeout(() => {
      engine.killTree(child.pid);
      finish(new Error('codex: timeout ao confirmar login ChatGPT'));
    }, Math.min(TEMPOS.SESSAO_HEADLESS_MS, 15000));
    child.stdout.on('data', c => { out += String(c); });
    child.stderr.on('data', c => { err += String(c); });
    child.on('error', (e) => {
      clearTimeout(timer);
      finish(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const detail = `${out}\n${err}`;
      if (code !== 0) return finish(new Error('codex: plano ChatGPT nao autenticado; execute codex login'));
      if (!usaPlanoChatGPT(detail)) return finish(new Error('codex: login ativo nao usa o plano ChatGPT; execute codex logout e codex login'));
      finish(null, true);
    });
  });
}

function spawnCodex(stub, args, env) {
  if (!stub) {
    return cp.spawn('codex', args, { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN });
  }
  const cmd = IS_WIN ? 'cmd.exe' : '/bin/sh';
  const shellArgs = IS_WIN ? ['/d', '/s', '/c', `"${stub}"`] : ['-lc', stub];
  return cp.spawn(cmd, shellArgs, { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN });
}

function registrarUsoCodex(engine, opts, run, resultEvent) {
  if (!resultEvent) return;
  const ev = run.cancelled ? { ...resultEvent, farol_cancelled: true } : resultEvent;
  const modelo = modelLabel(run.model) || 'Codex (padrão)';
  try { engine.recordUsage(opts.id, opts.account, ev, modelo, opts.authProfileId || '', opts.ref); } catch { /* opcional */ }
}

function erroDeCotaCodex(resultEvent) {
  const cota = resultEvent && resultEvent.farol_codex_quota;
  if (!cota) return null;
  const sufixo = cota.reset ? ` até ${cota.reset}` : '';
  return new Error(`codex: cota do plano atingida${sufixo}`);
}

function fecharCodex(engine, opts, run, estado, raw, errBuf, code) {
  let resultEvent = estado.resultEvent;
  if (!resultEvent && code === 0) resultEvent = resultCodex(estado, { result: engine.parseEnvelope(raw), usage: {} });
  registrarUsoCodex(engine, opts, run, resultEvent);
  if (run.cancelled) throw Object.assign(new Error('cancelada por você'), { cancelled: true });
  const cota = erroDeCotaCodex(resultEvent);
  if (cota) throw cota;
  if (resultEvent?.is_error) throw new Error(`sessão retornou erro: ${String(resultEvent.result || errBuf).slice(0, 300)}`);
  if (resultEvent) return { text: String(resultEvent.result || ''), sessionId: resultEvent.session_id || estado.sessionId };
  if (code !== 0) throw new Error(`codex saiu com código ${code}: ${(errBuf.trim() || 'sem saida').slice(0, 300)}`);
  return { text: engine.parseEnvelope(raw), sessionId: estado.sessionId };
}

function prepararLinhaCodex(line, estado, onEvent) {
  const texto = line.trim();
  if (!texto) return;
  try { eventoCodex(parseJson(texto), estado, onEvent); } catch { /* ruido textual */ }
}

function ligarCodexChild(engine, opts, run, child, prompt, onEvent, finish) {
  run.child = child;
  let raw = '', errBuf = '', lineBuf = '';
  const estado = { text: '', sessionId: null, resultEvent: null };
  const timeout = setTimeout(() => {
    if (run.cancelled) return;
    engine.killTree(child.pid);
    finish(new Error('tempo esgotado (30min) na sessão autônoma'));
  }, TEMPOS.SESSAO_HEADLESS_MS);
  const encerrar = (err, value) => {
    clearTimeout(timeout);
    if (opts.id) engine.running.delete(opts.id);
    finish(err, value);
  };
  const handleLine = (line) => prepararLinhaCodex(line, estado, onEvent);
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
  child.stderr.on('data', c => { if (errBuf.length < 1024 * 1024) errBuf += String(c); });
  child.on('error', e => encerrar(e));
  child.on('close', (code) => {
    try {
      if (lineBuf.trim()) handleLine(lineBuf);
      encerrar(null, fecharCodex(engine, opts, run, estado, raw, errBuf, code));
    } catch (err) {
      encerrar(err);
    }
  });
  child.stdin.on('error', () => {});
  child.stdin.write(prompt);
  child.stdin.end();
}

function runCodexStream(engine, prompt, opts = {}) {
  const stub = envMod.headlessCmdStub();
  const argOpts = { stub: !!stub, fast: !!opts.fast, extraArgs: opts.extraArgs };
  const args = codexArgs(engine.config, argOpts);
  const onEvent = opts.onEvent || (() => {});
  logSpawn('codex-session', stub ? [stub] : ['codex', ...args]);
  return new Promise((resolve, reject) => {
    const finish = encerrarUmaVez(resolve, reject);
    const run = { child: null, cancelled: false, stub: !!stub, model: codexSelection(engine.config, argOpts).model };
    if (opts.id) engine.running.set(opts.id, run);
    verificarPlanoCodex(engine, opts, run).then(() => {
      if (run.cancelled) throw Object.assign(new Error('cancelada por você'), { cancelled: true });
      const childEnv = codexEnv(engine.ghEnv(opts.account));
      if (opts.reviewCap) childEnv.FAROL_REVIEW_CAP = String(opts.reviewCap);
      ligarCodexChild(engine, opts, run, spawnCodex(stub, args, childEnv), prompt, onEvent, finish);
    }).catch((err) => {
      if (opts.id) engine.running.delete(opts.id);
      finish(err);
    });
  });
}

export default { codexEnv, codexSelection, codexArgs, cotaCodex, eventoCodex, verificarPlanoCodex, runCodexStream };
export { codexEnv, codexSelection, codexArgs, cotaCodex, eventoCodex, verificarPlanoCodex, runCodexStream };
