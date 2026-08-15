'use strict';
// G2 da auditoria 15/08/2026: decide() capturava o índice antes de 3 awaits e
// fazia splice com o índice velho. Uma pendência nova criada durante o await
// (unshift do recordDecision) deslocava a lista e o splice removia a pendência
// ERRADA, que sumia das duas listas. reconcilePending já re-acha o índice
// depois do await (decision.js, comentário "a lista pode ter mudado"); este
// teste trava a mesma defesa no decide().
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-decide-conc-' + process.pid);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

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
