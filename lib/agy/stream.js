// A sessão headless do Antigravity CLI (`agy` 1.4.3), no molde do lib/codex/stream.js.
//
// Comando (spec, "Comando"), sem shell, com o prompt na entrada padrão em NDJSON (o prompt da
// revisão tem 22 KB e a linha de comando do Windows tem teto de 32 KB):
//   agy --input-format stream-json --output-format stream-json --dangerously-skip-permissions
//       --model <slug> [--effort <nível>] [--conversation <id>]
// A sessão de leitura (diagnóstico A3) sai sem `--dangerously-skip-permissions`: no modo
// padrão o `agy` lê o workspace e nega comando e escrita (medido).
//
// O stream tem três eventos: `init` (o `conversation_id`, que é o sid), `step_update` (passos
// de resposta, ferramenta e subagente) e `result`. As armadilhas medidas, cada uma tratada aqui:
//   1. O RESULTADO é o texto do ÚLTIMO passo `agent_response` (os `text_delta` dele juntos),
//      NUNCA o `result.response`, que é o turno inteiro: com prosa e `FAROL_CHECKPOINT {...}`
//      antes do envelope, o primeiro `{` deixa de ser o envelope (seção 8).
//   2. `[agy] print timeout ...` no stderr devolve SUCCESS com resposta vazia: é falha
//      transitória, nunca resultado. Saída sem `result` também é falha.
//   3. Cota: `AGY_ERROR: {...}` com saída 3 (ou o `error` do result) com as frases de cota
//      vira limite, CONFIRMADO pelo `/usage` para ter a hora do reset (lib/agy/cota.js).
//   4. Retomada de id inexistente NÃO falha: o `agy` abre conversa nova com outro id. O id do
//      `init` diferente do pedido é retomada recusada, e a sessão para ali, antes do modelo.
//   5. O `usage` do `result` é o total do turno do principal (sem subagente); somá-lo ao dos
//      `step_update` contaria duas vezes. Os passos só valem quando o `result` não chega.
//   6. Não há custo em dólar: a linha de consumo leva os tokens e custo `desconhecido`.
import { WORKSPACE } from '../paths.js';
import { sessionDeadline } from '../session-deadline.js';
import { sanitizeAgyModel, sanitizeAgyEffort, agyEffortForModel, AGY_MODELO_PADRAO } from '../parse.js';
import { safeStringify, parseJson } from '../io.js';
import { classify } from '../log-taxonomy.js';
import { erroDeSessao } from '../engine/falhas.js';
import { abrirTentativa, registrarParcial, fecharTentativa } from '../engine/usage-tentativas.js';
import { registrarCheckpoint } from '../engine/checkpoint-da-sessao.js';
import { spawnAgy, encerrarArvore } from './processo.js';
import { agyEnv } from './ambiente.js';
import { garantirPasta, gitconfigReal, limparSessao, conversasDoChat, ID_DE_CONVERSA } from './home.js';
import { lerCota, aplicarLeitura } from './cota.js';

// a linha do marcador: com ou sem os dois pontos (o modelo escreveu das duas formas na medição)
const LINHA_DE_CHECKPOINT = /^\s*FAROL_CHECKPOINT:?\s*(\{.*\})\s*$/;
const PRINT_TIMEOUT = /\[agy\] print timeout[^\n]*/;
const LINHA_AGY_ERROR = /^AGY_ERROR:\s*(.*)$/m;
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- PURO -----------------------------------------------------------------------------------

function agySelecao(config = {}) {
  const modelo = sanitizeAgyModel(config.agyReviewModel) || AGY_MODELO_PADRAO;
  return { modelo, esforco: agyEffortForModel(modelo, sanitizeAgyEffort(config.agyReviewEffort) || '') };
}

// `--resume <id>` é como o chat e a retomada pedem continuação (é a forma do Claude); aqui ela
// vira `--conversation`, só com id na forma de conversa do `agy`
function conversaPedida(extraArgs) {
  const args = Array.isArray(extraArgs) ? extraArgs : [];
  const i = args.indexOf('--resume');
  const id = i >= 0 ? String(args[i + 1] || '') : '';
  return ID_DE_CONVERSA.test(id) ? id : '';
}

function agyArgs(config = {}, opts = {}) {
  const { modelo, esforco } = agySelecao(config);
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json'];
  if (!opts.somenteLeitura) args.push('--dangerously-skip-permissions');
  args.push('--model', modelo);
  if (esforco) args.push('--effort', esforco);
  const conversa = conversaPedida(opts.extraArgs);
  if (conversa) args.push('--conversation', conversa);
  return args;
}

// a mensagem do turno, uma linha NDJSON na entrada padrão
function linhaDoPrompt(prompt) {
  return safeStringify({ event: 'user', message: { content: String(prompt || '') } }, '') + '\n';
}

function novoEstado(pedida = '') {
  return { conversa: null, pedida, recusada: false, passos: new Map(), resultado: null, parcial: null };
}

function passo(estado, indice) {
  const k = Number(indice) || 0;
  if (!estado.passos.has(k)) estado.passos.set(k, { indice: k, texto: '', linha: '', avisado: false });
  return estado.passos.get(k);
}

function semCheckpoint(texto) {
  return String(texto || '').split('\n').filter((l) => !LINHA_DE_CHECKPOINT.test(l)).join('\n').trim();
}

/** O resultado da sessão: o texto do último passo `agent_response` que diz alguma coisa. */
function textoFinal(estado) {
  const ordem = [...estado.passos.values()].sort((a, b) => b.indice - a.indice);
  for (const p of ordem) {
    const t = semCheckpoint(p.texto);
    if (t) return t;
  }
  return '';
}

// Linhas completas do passo vão ao checkpoint; o resto espera o próximo pedaço (o marcador
// chega partido entre `text_delta`, medido).
function linhasProntas(p, pedaco, aoCheckpoint, fim = false) {
  p.linha += pedaco;
  const partes = p.linha.split('\n');
  p.linha = fim ? '' : partes.pop();
  for (const l of partes) {
    const m = l.match(LINHA_DE_CHECKPOINT);
    if (m) aoCheckpoint(m[1]);
  }
}

function somarUso(acc, u) {
  const out = acc || { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0 };
  for (const k of Object.keys(out)) out[k] += Number(u?.[k]) || 0;
  return out;
}

function resumoDaFerramenta(su) {
  const params = su.tool_info?.parameters || {};
  const alvo = params.CommandLine || params.Path || params.AbsolutePath || params.Url || params.Query || '';
  return `${su.tool_name || 'ferramenta'}${alvo ? ' · ' + String(alvo).slice(0, 160) : ''}`;
}

function passoDeResposta(su, estado, ctx) {
  const p = passo(estado, su.step_index);
  if (typeof su.text_delta === 'string') {
    p.texto += su.text_delta;
    linhasProntas(p, su.text_delta, ctx.aoCheckpoint);
  } else if (typeof su.text === 'string' && !p.texto) {
    p.texto = su.text;
    linhasProntas(p, su.text, ctx.aoCheckpoint);
  }
  if (su.state !== 'DONE' && su.state !== 'ERROR') return;
  linhasProntas(p, '', ctx.aoCheckpoint, true);
  // o diário da tentativa (A1) guarda o acumulado: se o Farol morrer, o boot registra o gasto
  if (su.usage) { estado.parcial = somarUso(estado.parcial, su.usage); ctx.aoParcial?.(); }
  const t = semCheckpoint(p.texto);
  if (t && !p.avisado) { p.avisado = true; ctx.onEvent({ kind: 'text', text: t }); }
}

function eventoAgy(ev, estado, ctx) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.event === 'init') {
    estado.conversa = String(ev.conversation_id || '') || null;
    if (estado.pedida && estado.conversa !== estado.pedida) estado.recusada = true;
    ctx.aoIniciar(estado);
    return;
  }
  if (ev.event === 'result') { estado.resultado = ev.result || {}; return; }
  const su = ev.event === 'step_update' ? ev.step_update : null;
  if (!su) return;
  if (su.step_type === 'agent_response') return passoDeResposta(su, estado, ctx);
  if (su.step_type === 'tool' && su.state === 'ACTIVE') ctx.onEvent({ kind: 'tool', text: resumoDaFerramenta(su) });
  if (su.step_type === 'tool' && su.state === 'ERROR') ctx.onEvent({ kind: 'warn', text: `${resumoDaFerramenta(su)} falhou` });
  if (su.step_type === 'subagent' && su.state === 'ACTIVE') ctx.onEvent({ kind: 'tool', text: 'subagente' });
}

// O uso do turno do principal, no formato do registro de consumo. Só o `result`: os passos
// entram apenas quando ele não chegou (sessão morta no meio), marcados como parcial.
function eventoDeUso(estado, { cancelada = false, falhou = false } = {}) {
  const u = estado.resultado?.usage || estado.parcial;
  const ev = {
    usage: {
      input_tokens: Number(u?.input_tokens) || 0,
      output_tokens: Number(u?.output_tokens) || 0,
      thinking_tokens: Number(u?.thinking_tokens) || 0,
      cache_read_input_tokens: Number(u?.cache_read_tokens) || 0,
      cache_creation_input_tokens: 0,
    },
    total_cost_usd: 0,
    farol_custo_desconhecido: true,
    session_id: estado.conversa,
  };
  if (!estado.resultado && estado.parcial) ev.farol_parcial = true;
  // sem result, com status de erro, ou com o SUCCESS vazio do teto de tempo: a linha é de erro
  if (falhou || !estado.resultado || estado.resultado.status !== 'SUCCESS') ev.is_error = true;
  if (cancelada) ev.farol_cancelled = true;
  return ev;
}

// O motivo da falha que o `agy` deu: o `error` do result ou a linha AGY_ERROR do stderr
function motivoDoAgy(estado, errBuf) {
  const linha = String(errBuf || '').match(LINHA_AGY_ERROR);
  let doStderr = '';
  if (linha) {
    const j = parseJson(linha[1], null);
    doStderr = j && typeof j === 'object' ? [j.status, j.code, j.message, j.short_error].filter(Boolean).join(' ') : linha[1];
  }
  return [estado.resultado?.error, doStderr].filter(Boolean).join('; ') || String(errBuf || '').trim().slice(0, 300);
}

// "resets Oct 27 at 4:45am", no fuso da máquina: o formato que o resetAtFrom de
// lib/log-taxonomy.js lê (ele interpreta no fuso local)
function fraseDoReset(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `resets ${MESES[d.getMonth()]} ${d.getDate()} at ${h12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

// --- IO ------------------------------------------------------------------------------------

function registrarUso(engine, opts, run, estado, errBuf) {
  const ev = eventoDeUso(estado, { cancelada: run.cancelled, falhou: estado.recusada || PRINT_TIMEOUT.test(String(errBuf || '')) });
  if (opts.attemptId) ev.farol_attempt = opts.attemptId;
  if (opts.resumeOutcome) ev.farol_resume_outcome = opts.resumeOutcome;
  try { engine.recordUsage(opts.id, opts.account, ev, run.modelo, opts.authProfileId || '', opts.ref); } catch { /* registro opcional */ }
}

// Falha por cota: o `/usage` confirma e dá a hora. Sem confirmação, a mensagem segue como
// veio e a cadeia aplica o prazo estimado.
async function erroDeCota(engine, opts, motivo) {
  const leitura = await lerCota(engine, opts.authProfileId, { forcar: true });
  const r = aplicarLeitura(engine, opts.auth || { kind: 'agy', id: opts.authProfileId }, leitura);
  if (!r.esgotado) return erroDeSessao('agy: ', motivo);
  const err = erroDeSessao(`agy: cota do plano atingida (grupo ${r.grupo}); ${fraseDoReset(r.ate)}; `, motivo);
  err.limitePlano = { ate: r.ate, grupo: r.grupo, fonte: 'usage' };
  return err;
}

async function desfecho(engine, opts, run, estado, errBuf, code) {
  if (run.cancelled) throw Object.assign(new Error('cancelada por você'), { cancelled: true });
  if (estado.recusada) throw erroDeSessao('agy: ', `no conversation ${estado.pedida} to resume (retomada recusada: o agy abriu outra conversa)`);
  const timeout = String(errBuf || '').match(PRINT_TIMEOUT);
  if (timeout) throw erroDeSessao('agy: ', timeout[0]);
  if (!estado.resultado) throw erroDeSessao(`agy saiu com código ${code} sem o evento result: `, String(errBuf || '').trim() || 'sem saída');
  if (estado.resultado.status !== 'SUCCESS') {
    const motivo = motivoDoAgy(estado, errBuf) || `status ${estado.resultado.status}`;
    if (classify(`agy: ${motivo}`).kind === 'espera-reset') throw await erroDeCota(engine, opts, motivo);
    throw erroDeSessao('agy: ', motivo);
  }
  return { text: textoFinal(estado), sessionId: estado.conversa };
}

// Conversa que nada retoma (pushback, ferramenta) sai já; a de chat e a de revisão ficam
// para o chat do PR e para a retomada, e a varredura leva as de mais de um dia.
function limpar(engine, opts, estado) {
  const imediata = opts.operationKind === 'tool' || opts.operationKind === 'pushback';
  const preservar = conversasDoChat(engine);
  if (!imediata && estado.conversa) preservar.add(estado.conversa);
  try { limparSessao(opts.authProfileId, estado.conversa || '', preservar); } catch { /* limpeza nunca derruba a sessão */ }
}

// O `init`: retomada recusada para a sessão antes do modelo; senão a conversa vira o sid
function aoIniciar(opts, run, child, onEvent, e) {
  if (e.recusada) return encerrarArvore(child);
  onEvent({ kind: 'info', text: `sessão do Antigravity iniciada (${run.modelo})` });
  if (e.conversa && opts.onSession) opts.onSession(e.conversa);
}

function ligarFilho(engine, opts, run, child, prompt, finish) {
  const estado = novoEstado(conversaPedida(opts.extraArgs));
  const onEvent = opts.onEvent || (() => { /* sem feed */ });
  const ctx = {
    onEvent,
    aoCheckpoint: (json) => registrarCheckpoint(engine, opts, json),
    aoIniciar: (e) => aoIniciar(opts, run, child, onEvent, e),
    aoParcial: () => registrarParcial(engine, opts.attemptId, { usage: eventoDeUso(estado).usage, model: run.modelo }),
  };
  let errBuf = '', linhaBuf = '';
  const deadline = sessionDeadline((error) => {
    if (run.cancelled) return;
    encerrarArvore(child);
    finish(Object.assign(error, { attemptId: opts.attemptId, sessionId: estado.conversa || '' }));
  }, () => run.cancelled);
  const linha = (l) => {
    const ev = parseJson(l.trim(), null);
    eventoAgy(ev, estado, ctx);
    if (['init', 'result'].includes(ev?.event) || (ev?.event === 'step_update' && ev.step_update)) deadline.progress();
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    linhaBuf += c;
    let nl;
    while ((nl = linhaBuf.indexOf('\n')) >= 0) { linha(linhaBuf.slice(0, nl)); linhaBuf = linhaBuf.slice(nl + 1); }
  });
  child.stderr.on('data', (c) => { if (errBuf.length < 1024 * 1024) errBuf += String(c); });
  child.on('error', (e) => { deadline.stop(); fecharTentativa(engine, opts.attemptId); finish(Object.assign(e, { attemptId: opts.attemptId })); });
  child.on('close', (code) => {
    deadline.stop();
    if (linhaBuf.trim()) linha(linhaBuf);
    registrarUso(engine, opts, run, estado, errBuf);
    // DEPOIS do registro, como no Claude e no Codex
    fecharTentativa(engine, opts.attemptId);
    limpar(engine, opts, estado);
    desfecho(engine, opts, run, estado, errBuf, code).then((v) => finish(null, v), (err) => {
      if (estado.conversa && !err.sessionId) err.sessionId = estado.conversa;
      finish(Object.assign(err, { attemptId: err.attemptId || opts.attemptId }));
    });
  });
  child.stdin.on('error', () => { /* o close diz por que o filho morreu */ });
  child.stdin.write(linhaDoPrompt(prompt));
  child.stdin.end();
}

// O fim da sessão, uma vez só (erro do spawn, teto de tempo e close podem chegar juntos)
function umaVez(engine, opts, resolve, reject) {
  let feito = false;
  return (err, valor) => {
    if (feito) return;
    feito = true;
    if (opts.id) engine.running.delete(opts.id);
    if (!err) return resolve(valor);
    if (opts.resumeOutcome && !err.resumeOutcome) err.resumeOutcome = opts.resumeOutcome;
    reject(err);
  };
}

/**
 * Roda a sessão no perfil `opts.authProfileId` (a pasta dele). Quem decide o perfil e confere
 * login, conta e cota antes é o lib/agy/sessao.js.
 */
function runAgyStream(engine, prompt, opts = {}) {
  const args = agyArgs(engine.config, opts);
  const { modelo } = agySelecao(engine.config);
  return new Promise((resolve, reject) => {
    const run = { child: null, cancelled: false, modelo };
    const finish = umaVez(engine, opts, resolve, reject);
    if (opts.id) engine.running.set(opts.id, run);
    const pasta = garantirPasta(opts.authProfileId);
    const env = agyEnv(engine.ghEnv(opts.account), pasta, { gitconfigReal: gitconfigReal() });
    if (opts.reviewCap) env.FAROL_REVIEW_CAP = String(opts.reviewCap);
    if (opts.onModel) opts.onModel(modelo);
    const meta = { sessionId: opts.id, account: opts.account, profileId: opts.authProfileId || '', model: modelo, ref: opts.ref, provedor: 'agy' };
    const comTentativa = { ...opts, attemptId: abrirTentativa(engine, meta) };
    try {
      run.child = spawnAgy(args, { env, cwd: WORKSPACE, rotulo: 'agy-session' });
    } catch (err) {
      fecharTentativa(engine, comTentativa.attemptId);
      finish(err);
      return;
    }
    ligarFilho(engine, comTentativa, run, run.child, prompt, finish);
  });
}

export default {
  agySelecao, conversaPedida, agyArgs, linhaDoPrompt, novoEstado, eventoAgy, textoFinal, eventoDeUso, motivoDoAgy, fraseDoReset, desfecho, runAgyStream,
};
export {
  agySelecao, conversaPedida, agyArgs, linhaDoPrompt, novoEstado, eventoAgy, textoFinal, eventoDeUso, motivoDoAgy, fraseDoReset, desfecho, runAgyStream,
};
