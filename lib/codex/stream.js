import cp from 'node:child_process';
import { sessionDeadline, fecharSaidaPresa } from '../session-deadline.js';
import { WORKSPACE, IS_WIN } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { sanitizeCodexModel, sanitizeCodexEffort } from '../parse.js';
import { modelLabel } from '../format.js';
import { logSpawn } from '../spawnlog.js';
import envMod from '../env.js';
import { usaPlanoChatGPT } from './auth.js';
import { erroDeSessao } from '../engine/falhas.js';
import { abrirTentativa, registrarParcial, fecharTentativa } from '../engine/usage-tentativas.js';
import { observeRestrictedCodex, beginRestrictedCodexObservation, finishRestrictedCodexObservation } from '../engine/restricted-codex.js';
import { protocoloCodex } from './protocolo.js';
import { checkpointCodex } from './checkpoint.js';

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
  const configurado = sanitizeCodexModel(config.codexReviewModel) || '';
  let model = sanitizeCodexModel(opts.model != null ? opts.model : configurado) ?? configurado;
  let effort = sanitizeCodexEffort(opts.effort != null ? opts.effort : config.codexReviewEffort) || '';
  // Auto é política do Farol: fora da revisão roteada não vira nome de modelo no CLI.
  if (model === 'auto') model = '';
  if (configurado === 'auto' && opts.effort == null) effort = '';
  if (opts.fast && configurado !== 'auto') effort = ['minimal', 'low'].includes(effort) ? effort : 'medium';
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
  // sessão de leitura (A3): o Codex recusa escrita e comando no próprio sandbox
  if (opts.somenteLeitura && !resumeId) args.push('--sandbox', 'read-only');
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
      // o plano não informa token nem custo da tentativa que falhou: o gasto existe e o
      // valor não se sabe (A1, item 2)
      farol_custo_desconhecido: true,
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
    const env = opts.restrictedCodex?.env || codexEnv(engine.ghEnv(opts.account));
    const command = opts.restrictedCodex?.command || 'codex';
    const args = opts.restrictedCodex ? ['--disable', 'hooks', 'login', 'status'] : ['login', 'status'];
    const child = cp.spawn(command, args, {
      cwd: opts.restrictedCodex?.cwd || WORKSPACE,
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

function spawnCodex(stub, args, env, restricted) {
  if (restricted) return cp.spawn(restricted.command, restricted.args, { cwd: restricted.cwd,
    env: restricted.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN });
  if (!stub) {
    return cp.spawn('codex', args, { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN });
  }
  const cmd = IS_WIN ? 'cmd.exe' : '/bin/sh';
  const shellArgs = IS_WIN ? ['/d', '/s', '/c', `"${stub}"`] : ['-lc', stub];
  return cp.spawn(cmd, shellArgs, { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN });
}

function registrarUsoCodex(engine, opts, run, resultEvent) {
  if (!resultEvent) return;
  const ev = run.cancelled ? { ...resultEvent, farol_cancelled: true } : { ...resultEvent };
  Object.assign(ev, { farol_provider: 'codex', farol_billing_kind: 'codex' });
  if (opts.attemptId) ev.farol_attempt = opts.attemptId;
  const modelo = modelLabel(run.model) || 'Codex (padrão)';
  try { engine.recordUsage(opts.id, opts.account, ev, modelo, opts.authProfileId || '', opts.ref); } catch { /* opcional */ }
}

function erroDeCotaCodex(resultEvent) {
  const cota = resultEvent && resultEvent.farol_codex_quota;
  if (!cota) return null;
  // "resets <hora>" é o formato que resetAtFrom (lib/log-taxonomy.js) lê; sem hora legível, a
  // cadeia de perfis aplica o prazo estimado
  const sufixo = cota.reset ? `; resets ${cota.reset}` : '';
  return new Error(`codex: cota do plano atingida${sufixo}`);
}

// Processo que morreu (ou foi cancelado) sem evento nenhum: a tentativa existiu e o
// provedor pode ter gastado, então ela vira linha com custo desconhecido. Saída 0 sem
// evento continua sendo o stub, que devolve envelope.
function falhaSemEventoCodex(estado, code) {
  if (code === 0) return null;
  return resultCodex(estado, { result: '', usage: {}, is_error: true, farol_custo_desconhecido: true });
}

function fecharCodex(engine, opts, run, estado, raw, errBuf, code) {
  let resultEvent = estado.resultEvent;
  if (!resultEvent && code === 0) resultEvent = resultCodex(estado, { result: engine.parseEnvelope(raw), usage: {} });
  const exitFailure = code !== 0 && !resultEvent?.is_error;
  const usageEvent = resultEvent || falhaSemEventoCodex(estado, code);
  registrarUsoCodex(engine, opts, run, exitFailure && usageEvent ? { ...usageEvent, is_error: true } : usageEvent);
  finishRestrictedCodexObservation(engine, opts, code, errBuf);
  // DEPOIS do registro, como no Claude (lib/engine/session.js)
  fecharTentativa(engine, opts.attemptId);
  if (run.cancelled) throw Object.assign(new Error('cancelada por você'), { cancelled: true });
  const cota = erroDeCotaCodex(resultEvent);
  if (cota) throw cota;
  if (exitFailure) throw erroDeSessao(`codex saiu com código ${code}: `, errBuf.trim() || 'sem saida');
  if (resultEvent?.is_error) throw erroDeSessao('sessão retornou erro: ', String(resultEvent.result || errBuf));
  if (resultEvent) return { text: String(resultEvent.result || ''), sessionId: resultEvent.session_id || estado.sessionId };
  return { text: engine.parseEnvelope(raw), sessionId: estado.sessionId };
}

function prepararLinhaCodex(line, estado, onEvent, progress, onSession, onRawEvent) {
  const texto = line.trim();
  if (!texto) return;
  let ev;
  try { ev = parseJson(texto); }
  catch { return; }
  onRawEvent?.(ev);
    const anterior = estado.sessionId;
    eventoCodex(ev, estado, onEvent);
    if (estado.sessionId && estado.sessionId !== anterior) onSession?.(estado.sessionId);
    if (['thread.started', 'turn.started', 'item.started', 'item.updated', 'item.completed', 'turn.completed'].includes(ev?.type)) progress();
}

// Abre a tentativa do diário e devolve os opts já com o attemptId. Mora aqui fora porque
// dentro do runCodexStream o literal ficaria no terceiro nível de aninhamento e passaria
// do teto de profundidade do gate; e o nome diz o que a linha de lá faz.
function comTentativa(engine, opts, run) {
  const meta = { sessionId: opts.id, account: opts.account, profileId: opts.authProfileId || '', model: run.model, ref: opts.ref, provedor: 'codex' };
  return { ...opts, attemptId: abrirTentativa(engine, meta) };
}

// O Codex só informa uso no fim do turno: cada turno fechado vai para o diário uma vez.
function anotarParcialCodex(engine, opts, estado) {
  const ev = estado.resultEvent;
  if (!opts.attemptId || !ev || estado.parcialGravado === ev) return;
  estado.parcialGravado = ev;
  registrarParcial(engine, opts.attemptId, { usage: ev.usage, fimDeTurno: true });
}

function ligarCodexChild(engine, opts, run, child, prompt, onEvent, finish) {
  run.child = child;
  let raw = '', errBuf = '', lineBuf = '';
  const estado = { text: '', sessionId: null, resultEvent: null };
  const deadline = sessionDeadline((error) => {
    if (run.cancelled) return;
    engine.killTree(child.pid);
    encerrar(error);
  }, () => run.cancelled, opts);
  const encerrar = (err, value) => {
    deadline.stop();
    if (err && estado.sessionId) err.sessionId = estado.sessionId;
    if (err && opts.attemptId) err.attemptId = opts.attemptId;
    if (opts.id) engine.running.delete(opts.id);
    finish(err, value);
  };
  const rawEvent = opts.selfIsolation ? event => observeRestrictedCodex(engine, opts, event) : event => checkpointCodex(engine, opts, event);
  const handleLine = (line) => {
    try { prepararLinhaCodex(line, estado, onEvent, deadline.progress, opts.onSession, rawEvent); anotarParcialCodex(engine, opts, estado); }
    catch (error) {
      try { engine.killTree(child.pid); } catch { /* A recusa continua mesmo sem confirmação do término. */ }
      encerrar(error);
    }
  };
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
  child.on('error', (e) => { fecharTentativa(engine, opts.attemptId); encerrar(e); });
  fecharSaidaPresa(child);
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
  const stub = opts.restrictedCodex ? '' : envMod.headlessCmdStub();
  const argOpts = { stub: !!stub, model: opts.model, effort: opts.effort, fast: !!opts.fast, extraArgs: opts.extraArgs, somenteLeitura: !!opts.somenteLeitura };
  const args = codexArgs(engine.config, argOpts);
  const onEvent = opts.onEvent || (() => {});
  let launch = stub ? [stub] : ['codex', ...args];
  if (opts.restrictedCodex) launch = [opts.restrictedCodex.command, ...opts.restrictedCodex.args];
  logSpawn('codex-session', launch);
  return new Promise((resolve, reject) => {
    const finish = encerrarUmaVez(resolve, reject);
    const run = { child: null, cancelled: false, stub: !!stub, model: codexSelection(engine.config, argOpts).model };
    if (opts.id) engine.running.set(opts.id, run);
    verificarPlanoCodex(engine, opts, run).then(() => {
      if (run.cancelled) throw Object.assign(new Error('cancelada por você'), { cancelled: true });
      const childEnv = codexEnv(engine.ghEnv(opts.account));
      if (opts.reviewCap) childEnv.FAROL_REVIEW_CAP = String(opts.reviewCap);
      // diário da tentativa imediatamente antes do provedor (A1, item 9); a checagem de
      // login acima não é o provedor e não abre tentativa
      const reviewPrompt = opts.selfIsolation ? prompt : protocoloCodex(prompt, opts.operationKind);
      const attemptOpts = comTentativa(engine, opts, run);
      const child = spawnCodex(stub, args, childEnv, opts.restrictedCodex);
      if (opts.restrictedCodex) beginRestrictedCodexObservation(engine, opts);
      ligarCodexChild(engine, attemptOpts, run, child, reviewPrompt, onEvent, finish);
    }).catch((err) => {
      if (opts.id) engine.running.delete(opts.id);
      finish(err);
    });
  });
}

export default { codexEnv, codexSelection, codexArgs, cotaCodex, eventoCodex, fecharCodex, verificarPlanoCodex, runCodexStream };
export { codexEnv, codexSelection, codexArgs, cotaCodex, eventoCodex, fecharCodex, verificarPlanoCodex, runCodexStream };
