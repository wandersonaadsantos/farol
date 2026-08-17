// G2 da auditoria 15/08/2026: decide() capturava o índice antes de 3 awaits e
// fazia splice com o índice velho. Uma pendência nova criada durante o await
// (unshift do recordDecision) deslocava a lista e o splice removia a pendência
// ERRADA, que sumia das duas listas. reconcilePending já re-acha o índice
// depois do await (decision.js, comentário "a lista pode ter mudado"); este
// teste trava a mesma defesa no decide().
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-decide-conc-' + process.pid);
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');

function pendencia(id, key) {
  return {
    id, key, pr: { repo: key.split('#')[0], number: parseInt(key.split('#')[1], 10), url: `https://github.com/${key.split('#')[0]}/pull/${key.split('#')[1]}` },
    createdAt: Date.now(),
    payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } }
  };
}

test('decide(): pendência criada DURANTE o post não é engolida pelo splice', async () => {
  const engine = new Engine();
  engine.headSha = async () => '';
  engine.myReviewStates = async () => [];
  engine.saveDecisions = () => { };
  engine.writeMemory = () => { };
  engine.pushState = () => { };
  engine.decisions.pending = [pendencia('alvo', 'acme/repo#2')];
  engine.postReview = async () => {
    // simula: revisão headless de OUTRO PR termina no meio do await e cria
    // pendência nova no índice 0 (o unshift real do recordDecision)
    engine.decisions.pending.unshift(pendencia('nova', 'acme/outro#9'));
    return { ok: true };
  };
  const r = await engine.decide('alvo', 'approve');
  assert.equal(r.ok, true);
  const ids = engine.decisions.pending.map(d => d.id);
  assert.deepEqual(ids, ['nova'], 'a pendência nova sobrevive; a decidida sai');
  assert.equal(engine.decisions.resolved.some(d => d.id === 'alvo' && d.status === 'posted'), true);
  assert.equal(engine.decisions.resolved.some(d => d.id === 'nova'), false, 'a nova não foi resolvida por engano');
});

test('decide(): ramo dedup com a pendência já resolvida por fora não duplica o histórico', async () => {
  const engine = new Engine();
  engine.headSha = async () => 'abc123';
  engine.saveDecisions = () => { };
  engine.writeMemory = () => { };
  engine.pushState = () => { };
  const alvo = pendencia('alvo', 'acme/repo#2');
  engine.decisions.pending = [alvo];
  engine.postReview = async () => { throw new Error('não deveria postar: o dedup pega antes'); };
  engine.myReviewStates = async () => {
    // simula o reconcilePending achando o mesmo review no GitHub e resolvendo a
    // pendência durante este await, e uma pendência nova entrando no índice 0
    const i = engine.decisions.pending.findIndex(d => d.id === 'alvo');
    engine.decisions.pending.splice(i, 1);
    engine.resolveIntoHistory({ ...alvo, status: 'already_reviewed', action: 'approve' });
    engine.decisions.pending.unshift(pendencia('nova', 'acme/outro#9'));
    return ['APPROVED'];
  };
  const r = await engine.decide('alvo', 'approve');
  assert.equal(r.ok, true);
  assert.deepEqual(engine.decisions.pending.map(d => d.id), ['nova'], 'a pendência nova sobrevive ao dedup');
  assert.equal(engine.decisions.resolved.filter(d => d.id === 'alvo').length, 1, 'uma única entrada de alvo no histórico');
});

test('decide(): bloqueio internal_language grava blockedReason persistente na pendência', async () => {
  const engine = new Engine();
  engine.headSha = async () => 'abc123';
  engine.myReviewStates = async () => [];
  let saved = 0, pushed = 0;
  engine.saveDecisions = () => { saved++; };
  engine.writeMemory = () => { };
  engine.pushState = () => { pushed++; };
  const alvo = pendencia('alvo', 'acme/repo#2');
  engine.decisions.pending = [alvo];
  engine.postReview = async () => ({ ok: false, blocked: 'internal_language', error: 'a redação do review precisa ser ajustada antes de publicar' });
  const r = await engine.decide('alvo', 'approve');
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'internal_language');
  assert.deepEqual(engine.decisions.pending.map(d => d.id), ['alvo'], 'a pendência continua na lista, nada foi engolido');
  const item = engine.decisions.pending.find(d => d.id === 'alvo');
  assert.equal(typeof item.blockedReason, 'string');
  assert.ok(item.blockedReason.length > 0, 'blockedReason contém a orientação');
  assert.ok(saved > 0, 'saveDecisions foi chamado pra persistir o motivo');
  assert.ok(pushed > 0, 'pushState foi chamado pra a UI refletir o motivo');
});
