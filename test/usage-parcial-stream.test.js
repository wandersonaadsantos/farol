// O gasto de uma sessão que morre no meio não pode sumir.
//
// DEFEITO QUE ORIGINOU (31/08/2026): o registro de consumo só acontecia quando o evento
// final da sessão chegava. Sessão morta antes disso (kill do cancelamento, timeout) não
// gerava registro nenhum, e os tokens já queimados ficavam fora da aba Consumo E fora
// do teto de orçamento. O caso virou rotina no dia em que a autoanálise passou a ser
// cancelada ao entrar commit novo: o conserto de um lugar abriu o buraco no outro.
//
// Este arquivo prova o caminho de VERDADE (runClaudeStream com filho falso e stream
// real), e não só a função pura: o furo não estava na aritmética, estava na fiação.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-parcial-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { runClaudeStream, parseEnvelope, acumularParcial } = await import('../lib/engine/session.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  return child;
}

function engineFalso(registros) {
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    killTree() { },
    recordUsage(id, account, ev, model) { registros.push({ id, account, ev, model }); },
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    pushActivity() { },
    setSessionModel() { },
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

const mensagem = (usage) => JSON.stringify({
  type: 'assistant', message: { content: [{ type: 'text', text: 'oi' }], usage },
}) + '\n';

/* ---------- a soma por mensagem (PURA) ---------- */

test('acumularParcial soma os quatro campos de token', () => {
  const acc = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.equal(acumularParcial(acc, { input_tokens: 3, output_tokens: 5 }), true);
  assert.equal(acumularParcial(acc, { output_tokens: 2, cache_read_input_tokens: 100 }), true);
  assert.deepEqual(acc, { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 });
});

test('mensagem sem usage não soma nem zera o que já foi contado', () => {
  const acc = { input_tokens: 9, output_tokens: 9, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.equal(acumularParcial(acc, undefined), false);
  assert.equal(acumularParcial(acc, {}), false);
  assert.equal(acc.input_tokens, 9);
});

/* ---------- a fiação, que é onde o furo estava ---------- */

test('sessão que morre SEM evento final registra o parcial acumulado', async () => {
  const registros = [];
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(registros), 'prompt', { id: 's7', account: 'alguem', ref: 'o/r#1' });
  spawnImpl = null;

  child.stdout.write(mensagem({ input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 900 }));
  child.stdout.write(mensagem({ output_tokens: 50 }));
  child.stdout.once('end', () => child.emit('close', 1));
  child.stdout.end();
  await p.catch(() => { });   // morrer sem envelope rejeita, e é isso mesmo

  assert.equal(registros.length, 1, 'o gasto tem que ser registrado mesmo sem evento final');
  const { ev, id } = registros[0];
  assert.equal(id, 's7');
  assert.equal(ev.farol_parcial, true, 'marcado como parcial: o custo vai ter que ser estimado');
  assert.equal(ev.usage.output_tokens, 150, 'soma das mensagens');
  assert.equal(ev.usage.cache_read_input_tokens, 900);
});

test('com evento final, registra ELE e não o acumulado: senão conta duas vezes', async () => {
  const registros = [];
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(registros), 'prompt', { id: 's8', account: 'alguem' });
  spawnImpl = null;

  child.stdout.write(mensagem({ output_tokens: 100 }));
  child.stdout.write(JSON.stringify({ type: 'result', result: 'ok', usage: { output_tokens: 100 }, total_cost_usd: 2 }) + '\n');
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.end();
  await p;

  assert.equal(registros.length, 1, 'um registro só');
  assert.equal(registros[0].ev.farol_parcial, undefined, 'o evento final não é parcial');
  assert.equal(registros[0].ev.total_cost_usd, 2, 'custo MEDIDO, não estimado');
});

test('sessão que morre sem gastar nada não inventa registro', async () => {
  const registros = [];
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engineFalso(registros), 'prompt', { id: 's9', account: 'alguem' });
  spawnImpl = null;

  child.stdout.once('end', () => child.emit('close', 1));
  child.stdout.end();
  await p.catch(() => { });

  assert.equal(registros.length, 0, 'sem token gasto não há o que registrar');
});
