'use strict';
// Cobre o gate de ressalva do reviewActions() que o scan de pushback usa pra decidir
// alvo: pushback só vale pra bloqueio (request_changes) ou aprovação COM ressalva.
// Aprovação limpa (sem motivo e com card comprovado) NÃO marca caveats, então fica de
// fora do scan. Ressalva = mesmos pontos do attentionPoints (card não comprovado OU
// algum motivo/attention listado). Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-pushback-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function engineWith(resolved, pending = []) {
  const e = new Engine();
  e.decisions = { resolved, pending };
  return e;
}

// espelha o gate de scanPushbacks (elegível = bloqueio OU aprovação com ressalva)
function eligible(a) {
  return !!a && (a.kind === 'request_changes' || (a.kind === 'approve' && a.caveats));
}

test('aprovação limpa: sem caveats e fora do scan de pushback', () => {
  const e = engineWith([
    { key: 'o/r#1', status: 'auto_approved', action: 'approve', reasons: [], cardMet: true, resolvedAt: 1 },
  ]);
  const a = e.reviewActions()['o/r#1'];
  assert.equal(a.kind, 'approve');
  assert.equal(a.caveats, false);
  assert.equal(eligible(a), false, 'aprovação limpa não é alvo de pushback');
});

test('aprovação com ressalva (motivo, card não comprovado ou attention): vira alvo', () => {
  const e = engineWith([
    { key: 'o/r#2', status: 'auto_approved', action: 'approve', reasons: ['confira o edge X'], cardMet: true, resolvedAt: 1 },
    { key: 'o/r#3', status: 'posted', action: 'approve', reasons: [], cardMet: false, resolvedAt: 1 },
    { key: 'o/r#4', status: 'auto_approved', action: 'approve', attention: ['ponto de atenção'], resolvedAt: 1 },
  ]);
  const acts = e.reviewActions();
  assert.equal(acts['o/r#2'].caveats, true, 'motivo listado = ressalva');
  assert.equal(acts['o/r#3'].caveats, true, 'card não comprovado = ressalva');
  assert.equal(acts['o/r#4'].caveats, true, 'attention preenchido = ressalva');
  for (const k of ['o/r#2', 'o/r#3', 'o/r#4']) assert.equal(eligible(acts[k]), true, `${k} é alvo`);
});

test('bloqueio (request_changes) é sempre alvo, independente de caveats', () => {
  const e = engineWith([
    { key: 'o/r#5', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra o build'], resolvedAt: 1 },
  ]);
  const a = e.reviewActions()['o/r#5'];
  assert.equal(a.kind, 'request_changes');
  assert.equal(eligible(a), true, 'bloqueio é alvo de pushback');
});

test('pendente (ainda na sua mesa, nada postado) não é alvo', () => {
  const e = engineWith([], [{ key: 'o/r#6', createdAt: 1 }]);
  const a = e.reviewActions()['o/r#6'];
  assert.equal(a.kind, 'pending');
  assert.equal(eligible(a), false, 'sem review postado não há pushback');
});
