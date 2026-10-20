// O stream do Antigravity CLI (lib/agy/stream.js), sem processo: os eventos medidos em
// docs/superpowers/specs/2026-10-20-agy-provedor.md entram pelo eventoAgy e o que sai é
// conferido. O resultado é o ÚLTIMO passo agent_response, nunca o result.response.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-agy-stream-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const st = await import('../lib/agy/stream.js');
const { parseHeadlessResult, parseEnvelope } = await import('../lib/engine/session.js');
const { classify } = await import('../lib/log-taxonomy.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const ENVELOPE = { decision: 'needs_decision', analysisStatus: 'complete', reportMarkdown: 'r', payloads: { comment: { body: 'ok' } }, protocolo: { prReviewer: 'dispensado', motivo: 'sem subagente' } };

function rodarEventos(eventos) {
  const estado = st.novoEstado();
  const checkpoints = [];
  const feed = [];
  const ctx = { onEvent: (e) => feed.push(e), aoCheckpoint: (j) => checkpoints.push(j), aoIniciar: () => { } };
  for (const ev of eventos) st.eventoAgy(ev, estado, ctx);
  return { estado, checkpoints, feed };
}

const passo = (i, extra) => ({ event: 'step_update', step_update: { step_index: i, ...extra } });

test('resultado é o último agent_response, com prosa e FAROL_CHECKPOINT antes do envelope no mesmo turno', () => {
  const json = JSON.stringify(ENVELOPE);
  const { estado, checkpoints } = rodarEventos([
    { event: 'init', conversation_id: 'c0ffee00-0000-4000-8000-000000000001' },
    passo(1, { state: 'DONE', step_type: 'agent_response', text_delta: 'I have launched the review.', usage: { input_tokens: 10 } }),
    passo(2, { state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'gh pr diff 1' } } }),
    passo(3, { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Conferi.\n\nFAROL_CHECKPOINT {' }),
    passo(3, { state: 'ACTIVE', step_type: 'agent_response', text_delta: '"claim":"c","file":"a.js","line":1,"verdict":"confirmado","evidence":"e"}\n' }),
    passo(3, { state: 'DONE', step_type: 'agent_response' }),
    passo(4, { state: 'ACTIVE', step_type: 'agent_response', text_delta: json.slice(0, 25) }),
    passo(4, { state: 'ACTIVE', step_type: 'agent_response', text_delta: json.slice(25) }),
    passo(4, { state: 'DONE', step_type: 'agent_response' }),
    { event: 'result', result: { status: 'SUCCESS', response: `I have launched the review.Conferi.\n\nFAROL_CHECKPOINT {"claim":"c"}\n${json}`, usage: { input_tokens: 30 } } },
  ]);
  const texto = st.textoFinal(estado);
  assert.equal(texto, json, 'só o envelope, sem a prosa e sem o marcador');
  assert.equal(checkpoints.length, 1, 'o marcador partido entre dois pedaços foi lido inteiro');
  assert.deepEqual(JSON.parse(checkpoints[0]), { claim: 'c', file: 'a.js', line: 1, verdict: 'confirmado', evidence: 'e' });
  // o result.response, que é o turno inteiro, seria recusado: o primeiro { é o do marcador
  assert.throws(() => parseHeadlessResult({ parseEnvelope: (raw) => parseEnvelope({}, raw) }, estado.resultado.response));
  const data = parseHeadlessResult({ parseEnvelope: (raw) => parseEnvelope({}, raw) }, texto);
  assert.equal(data.protocolo.prReviewer, 'dispensado');
});

test('marcador e envelope no MESMO passo: o marcador sai do resultado', () => {
  const json = JSON.stringify(ENVELOPE);
  const { estado, checkpoints } = rodarEventos([
    passo(5, { state: 'ACTIVE', step_type: 'agent_response', text_delta: `FAROL_CHECKPOINT: {"claim":"x"}\n${json}` }),
    passo(5, { state: 'DONE', step_type: 'agent_response' }),
  ]);
  assert.equal(st.textoFinal(estado), json);
  assert.equal(checkpoints.length, 1);
});

test('consumo: o usage do result é o total; os step_update não somam por cima', () => {
  const { estado } = rodarEventos([
    passo(1, { state: 'DONE', step_type: 'agent_response', text_delta: 'a', usage: { input_tokens: 100, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 50 } }),
    passo(3, { state: 'DONE', step_type: 'agent_response', text_delta: 'b', usage: { input_tokens: 200, output_tokens: 20, thinking_tokens: 10, cache_read_tokens: 100 } }),
    { event: 'result', result: { status: 'SUCCESS', usage: { input_tokens: 300, output_tokens: 30, thinking_tokens: 15, cache_read_tokens: 150 } } },
  ]);
  const ev = st.eventoDeUso(estado);
  assert.deepEqual(ev.usage, { input_tokens: 300, output_tokens: 30, thinking_tokens: 15, cache_read_input_tokens: 150, cache_creation_input_tokens: 0 });
  assert.equal(ev.farol_custo_desconhecido, true, 'sem custo em dólar, como o Codex');
  assert.equal(ev.total_cost_usd, 0);
  assert.equal(ev.farol_parcial, undefined);
});

test('consumo sem result (sessão morta): os passos valem, marcados como parciais', () => {
  const { estado } = rodarEventos([
    passo(1, { state: 'DONE', step_type: 'agent_response', text_delta: 'a', usage: { input_tokens: 100, output_tokens: 10 } }),
    passo(3, { state: 'DONE', step_type: 'agent_response', text_delta: 'b', usage: { input_tokens: 200, output_tokens: 20 } }),
  ]);
  const ev = st.eventoDeUso(estado);
  assert.equal(ev.usage.input_tokens, 300);
  assert.equal(ev.farol_parcial, true);
});

test('argumentos: flash-high por padrão, flash-low recusado, esforço só fora do Gemini', () => {
  const base = st.agyArgs({});
  assert.deepEqual(base, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--model', 'gemini-3.8-flash-high']);
  assert.ok(st.agyArgs({ agyReviewModel: 'gemini-3.8-flash-low' }).includes('gemini-3.8-flash-high'), 'flash-low cai no padrão');
  assert.ok(!st.agyArgs({ agyReviewEffort: 'low' }).includes('--effort'), 'no Gemini o nível está no slug');
  const sonnet = st.agyArgs({ agyReviewModel: 'claude-sonnet-4-6', agyReviewEffort: 'high' });
  assert.deepEqual(sonnet.slice(-4), ['--model', 'claude-sonnet-4-6', '--effort', 'high']);
  assert.ok(!st.agyArgs({ agyReviewEffort: 'max' }).includes('max'), 'max fica fora');
  assert.ok(!st.agyArgs({}, { somenteLeitura: true }).includes('--dangerously-skip-permissions'), 'leitura sem liberar comando');
  const retoma = st.agyArgs({}, { extraArgs: ['--resume', 'c0ffee00-0000-4000-8000-000000000001'] });
  assert.deepEqual(retoma.slice(-2), ['--conversation', 'c0ffee00-0000-4000-8000-000000000001']);
  assert.ok(!st.agyArgs({}, { extraArgs: ['--resume', 'x; rm -rf /'] }).includes('--conversation'), 'id fora da forma não entra');
});

test('o prompt vai como uma linha NDJSON na entrada padrão', () => {
  const l = st.linhaDoPrompt('oi\n"tudo"');
  assert.ok(l.endsWith('\n'));
  assert.deepEqual(JSON.parse(l), { event: 'user', message: { content: 'oi\n"tudo"' } });
});

test('retomada recusada: o init com outro id marca a sessão', () => {
  const estado = st.novoEstado('c0ffee00-0000-4000-8000-00000000000a');
  st.eventoAgy({ event: 'init', conversation_id: 'c0ffee00-0000-4000-8000-00000000000b' }, estado, { onEvent() { }, aoCheckpoint() { }, aoIniciar() { } });
  assert.equal(estado.recusada, true);
});

test('print timeout no stderr vira falha transitória, mesmo com SUCCESS', async () => {
  const estado = st.novoEstado();
  estado.resultado = { status: 'SUCCESS', response: '' };
  await assert.rejects(st.desfecho({}, {}, { cancelled: false }, estado, '[agy] print timeout after 1m40s with turn in progress; returning partial output\n', 0), (err) => {
    assert.equal(classify(err.message).id, 'agy-print-timeout');
    assert.equal(classify(err.message).kind, 'transitorio');
    return true;
  });
});

test('saída sem result é falha, mesmo com código 0', async () => {
  await assert.rejects(st.desfecho({}, {}, { cancelled: false }, st.novoEstado(), '', 0), /sem o evento result/);
  await assert.rejects(st.desfecho({}, {}, { cancelled: false }, st.novoEstado(), '', 2), (err) => classify(err.message).kind === 'transitorio');
});

test('a frase do reset é a que o resetAtFrom lê, no fuso da máquina', async () => {
  const { resetAtFrom } = await import('../lib/log-taxonomy.js');
  const ate = new Date(2026, 9, 27, 4, 45).getTime();
  const frase = st.fraseDoReset(ate);
  assert.equal(frase, 'resets Oct 27 at 4:45am');
  assert.equal(resetAtFrom(`agy: cota do plano atingida; ${frase}`, new Date(2026, 9, 20, 12, 0)).getTime(), ate);
  assert.equal(st.fraseDoReset(new Date(2026, 9, 27, 12, 5).getTime()), 'resets Oct 27 at 12:05pm');
});

test('AGY_ERROR do stderr vira o motivo da falha', () => {
  const estado = st.novoEstado();
  estado.resultado = { status: 'ERROR' };
  const m = st.motivoDoAgy(estado, 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","code":429,"message":"You have exhausted your quota on this model."}\n');
  assert.match(m, /RESOURCE_EXHAUSTED 429 You have exhausted your quota/);
  assert.equal(classify(`agy: ${m}`).kind, 'espera-reset');
});
