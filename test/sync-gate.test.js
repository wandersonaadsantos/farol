// O gate da coordenação entre dispositivos mora em runClaudeStream (lib/engine/session.js),
// o estrangulamento por onde passa TODO provedor de IA. Este arquivo trava as duas
// metades do contrato: com a coordenação DESLIGADA a função é a de sempre (spawn no
// mesmo tick, que é o que test/session-checkpoint-capture.test.js captura); LIGADA, a
// admissão roda antes de qualquer stub, spawn ou ramo Codex, e tipo de operação ausente
// ou desconhecido é recusado alto (fail-closed).
//
// FAROL_HOME antes do import: session.js alcança lib/paths.js, então entra por await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-gate-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
let spawns = 0;
childProcess.spawn = function mockableSpawn(...args) {
  spawns++;
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const session = await import('../lib/engine/session.js');
const { runClaudeStream, runProvedor, parseEnvelope, OPERACOES } = session;

const stubAnterior = process.env.FAROL_HEADLESS_CMD;
after(() => {
  childProcess.spawn = realSpawn;
  if (stubAnterior === undefined) delete process.env.FAROL_HEADLESS_CMD;
  else process.env.FAROL_HEADLESS_CMD = stubAnterior;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

beforeEach(() => { spawns = 0; spawnImpl = null; });

function filho() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4343;
  return child;
}

// termina a sessão com um evento result (sucesso) ou com código != 0 (falha)
function encerrar(child, { ok = true } = {}) {
  if (ok) child.stdout.write(JSON.stringify({ type: 'result', result: 'feito', session_id: 's-gate' }) + '\n');
  child.stdout.once('end', () => child.emit('close', ok ? 0 : 1));
  child.stdout.end();
}

function motor({ ativa = false, admissao = null, auth = { kind: 'dir', id: '' } } = {}) {
  const e = {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    activeReviews: new Map(),
    killTree() { },
    recordUsage() { },
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
    authPedida: 0,
    admissoes: [],
  };
  e.resolveClaudeAuth = () => { e.authPedida++; return auth; };
  if (ativa !== null) e.syncCoordenacaoAtiva = () => ativa;
  e.syncAdmit = async (ctx) => { e.admissoes.push(ctx); return admissao; };
  return e;
}

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, abortos: 0, completos: 0 };
  h.onLost = () => { };
  h.complete = async () => { h.completos++; h.done = true; return { ok: true }; };
  h.abort = async () => { h.abortos++; h.done = true; };
  return h;
}

const COORD = { prKey: 'o/r#1', account: 'eu', materialVersion: 'abc123', headSha: 'abc123', contaRodada: false, manual: false, semCoordenacao: false, ignorarRecibo: false, pr: { key: 'o/r#1' } };

test('OPERACOES é a allowlist fechada: três tipos coordenam, chat e ferramenta passam por bypass', () => {
  assert.deepEqual({ ...OPERACOES }, { review: 'coordena', self: 'coordena', pushback: 'coordena', chat: 'bypass', tool: 'bypass' });
  assert.equal(Object.isFrozen(OPERACOES), true);
  assert.equal(typeof runProvedor, 'function', 'o corpo antigo segue exportado como runProvedor');
});

test('(a) coordenação desligada: o spawn acontece no MESMO tick, sem admissão', async () => {
  delete process.env.FAROL_HEADLESS_CMD;
  const child = filho();
  spawnImpl = () => child;
  const e = motor({ ativa: false });
  const p = runClaudeStream(e, 'prompt', { id: 'a1' });
  assert.equal(spawns, 1, 'spawn síncrono, antes de qualquer await');
  encerrar(child);
  const res = await p;
  assert.equal(res.text, 'feito');
  assert.equal(e.admissoes.length, 0);
  assert.equal('coordination' in res, false, 'desligada, o resultado é byte a byte o de antes');
});

test('(a) engine sem a fachada syncCoordenacaoAtiva também segue o caminho de sempre', async () => {
  const child = filho();
  spawnImpl = () => child;
  const e = motor({ ativa: null });
  const p = runClaudeStream(e, 'prompt', {});
  assert.equal(spawns, 1);
  encerrar(child);
  await p;
});

test('(b) ligada e operationKind ausente: recusa antes do stub, do spawn e do ramo Codex', async () => {
  process.env.FAROL_HEADLESS_CMD = 'node -e "process.exit(0)"';
  spawnImpl = () => filho();
  const e = motor({ ativa: true, auth: { kind: 'codex', id: 'cx' } });
  await assert.rejects(runClaudeStream(e, 'prompt', { id: 'a2', coordination: COORD }), /operationKind ausente ou desconhecido \(vazio\)/);
  assert.equal(spawns, 0, 'spawn nunca chamado');
  assert.equal(e.authPedida, 0, 'nem chegou a resolver o provedor (ramo Codex)');
  assert.equal(e.admissoes.length, 0);
  delete process.env.FAROL_HEADLESS_CMD;
});

test('(b) ligada e operationKind desconhecido também recusa, nomeando o tipo', async () => {
  const e = motor({ ativa: true });
  await assert.rejects(runClaudeStream(e, 'prompt', { operationKind: 'rev' }), /\(rev\)/);
  assert.equal(spawns, 0);
});

for (const kind of ['chat', 'tool']) {
  test(`(c) ligada, '${kind}' passa sem chamar syncAdmit`, async () => {
    const child = filho();
    spawnImpl = () => child;
    const e = motor({ ativa: true });
    const p = runClaudeStream(e, 'prompt', { operationKind: kind });
    await new Promise((r) => setImmediate(r));
    assert.equal(spawns, 1);
    encerrar(child);
    const res = await p;
    assert.equal(res.text, 'feito');
    assert.equal(res.coordination, null, 'bypass não tem handle');
    assert.equal(e.admissoes.length, 0);
  });
}

test('(d) ligada, review sem coordination: recusa antes do spawn', async () => {
  const e = motor({ ativa: true });
  await assert.rejects(runClaudeStream(e, 'prompt', { operationKind: 'review' }), /coordination ausente para review/);
  assert.equal(spawns, 0);
  assert.equal(e.admissoes.length, 0);
});

test('(e) admissão recusada resolve bloqueado, sem texto fabricado e sem spawn', async () => {
  const admissao = { admitted: false, reason: 'alheio', detail: { deviceName: 'notebook' } };
  const e = motor({ ativa: true, admissao });
  const res = await runClaudeStream(e, 'prompt', { id: 'a5', operationKind: 'review', coordination: COORD });
  assert.deepEqual(res, { blocked: true, coordination: admissao, text: '', sessionId: null });
  assert.equal(spawns, 0);
  assert.equal(e.admissoes.length, 1);
  assert.equal(e.admissoes[0].operationKind, 'review');
  assert.equal(e.admissoes[0].opId, 'a5', 'o id da sessão vai junto, pra perda de lease cancelar a sessão certa');
  assert.equal(e.admissoes[0].prKey, 'o/r#1');
});

test('(f) admitida: o resultado carrega o handle', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'self', coordination: COORD });
  await new Promise((r) => setImmediate(r));
  encerrar(child);
  const res = await p;
  assert.equal(res.coordination, h);
  assert.equal(h.abortos, 0, 'sucesso não aborta: quem grava o recibo é o chamador');
});

test('(f) erro do provedor aborta o handle e propaga o erro original', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD });
  await new Promise((r) => setImmediate(r));
  encerrar(child, { ok: false });
  const err = await p.then(() => null, (x) => x);
  assert.ok(err, 'rejeitou');
  assert.match(err.message, /claude saiu com código 1/);
  assert.equal(h.abortos, 1);
  assert.equal(err.coordenacao, undefined, 'lease não perdido: erro comum');
});

test('(f) erro com o lease perdido carimba err.coordenacao = perdido', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  h.lost = true;
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'pushback', coordination: COORD });
  await new Promise((r) => setImmediate(r));
  encerrar(child, { ok: false });
  const err = await p.then(() => null, (x) => x);
  assert.equal(err.coordenacao, 'perdido');
  assert.equal(h.abortos, 1);
});

// Fail-closed é do GATE, não do colaborador: qualquer resposta de syncAdmit que não seja
// a forma exata de uma admissão (admitted === true com handle) trava a sessão. null
// era também o valor do bypass, e decidir por ele deixava "admissão sem resposta" passar
// como se fosse chat/ferramenta.
const INVALIDAS = [
  ['undefined', undefined],
  ['null', null],
  ['objeto vazio', {}],
  ['admitted não booleano', { admitted: 'sim' }],
  ['admitida sem handle', { admitted: true }],
];
for (const [nome, admissao] of INVALIDAS) {
  test(`(g) ligada, admissão inválida (${nome}) bloqueia sem spawn`, async () => {
    spawnImpl = () => filho();
    const e = motor({ ativa: true, admissao });
    const res = await runClaudeStream(e, 'prompt', { id: 'a9', operationKind: 'review', coordination: COORD });
    assert.equal(spawns, 0, 'nenhuma sessão abre sem admissão comprovada');
    assert.equal(res.blocked, true);
    assert.equal(res.coordination.admitted, false);
    assert.equal(res.coordination.reason, 'indisponivel');
    assert.deepEqual(res.coordination.detail, { motivo: 'admissão inválida' });
    assert.equal(res.text, '');
    assert.equal(res.sessionId, null);
  });
}

// onAdmitted: o ponto entre a admissão e o spawn, em que o lease já é deste aparelho e
// nenhuma sessão abriu. É ali que a revisão põe a label pública de "revisando".
test('(h) admitida: onAdmitted roda antes do spawn e recebe o handle', async () => {
  const child = filho();
  spawnImpl = () => child;
  const h = handleFalso();
  const vistos = [];
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD, onAdmitted: async (x) => { vistos.push([x, spawns]); } });
  await new Promise((r) => setImmediate(r));
  encerrar(child);
  await p;
  assert.deepEqual(vistos, [[h, 0]], 'uma vez, com o handle, antes do spawn');
  assert.equal(spawns, 1);
});

test('(h) bloqueada: onAdmitted não roda', async () => {
  let chamou = false;
  const e = motor({ ativa: true, admissao: { admitted: false, reason: 'alheio', detail: {} } });
  const res = await runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD, onAdmitted: () => { chamou = true; } });
  assert.equal(res.blocked, true);
  assert.equal(chamou, false);
});

test('(h) desligada: onAdmitted não roda e o spawn segue no mesmo tick', async () => {
  const child = filho();
  spawnImpl = () => child;
  let chamou = false;
  const e = motor({ ativa: false });
  const p = runClaudeStream(e, 'prompt', { onAdmitted: () => { chamou = true; } });
  assert.equal(spawns, 1);
  encerrar(child);
  await p;
  assert.equal(chamou, false);
});

test('(h) onAdmitted que lança devolve o lease e não abre sessão', async () => {
  const h = handleFalso();
  const e = motor({ ativa: true, admissao: { admitted: true, handle: h } });
  const p = runClaudeStream(e, 'prompt', { operationKind: 'review', coordination: COORD, onAdmitted: () => { throw new Error('falhou antes do spawn'); } });
  await assert.rejects(p, /falhou antes do spawn/);
  assert.equal(spawns, 0);
  assert.equal(h.abortos, 1);
});
