'use strict';
// Cancelamento da autoanálise (Onda 3, contrato UI↔server). O bug de origem: o botão
// Cancelar da UI postava /api/cancel-op, rota que nunca existiu, e a sessão seguia
// rodando com a UI dizendo "Cancelado". O contrato novo cancela POR KEY, porque no
// momento do clique a sessão pode nem existir ainda (o item está na headlessQueue e o
// id s<seq> só nasce quando o escalonador puxa). Este arquivo trava o lado do engine.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-selfcancel-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('autoanálise ainda NA FILA: cancela removendo da headlessQueue, sem tocar em sessão', () => {
  const engine = new Engine();
  engine.headlessQueue.push({ kind: 'self', key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7' });
  const r = engine.cancelSelfAnalysis('acme/app#7');
  assert.equal(r.ok, true);
  assert.equal(engine.headlessQueue.length, 0, 'o item saiu da fila');
});

test('autoanálise RODANDO: delega pro cancelSession com o id da sessão certa', () => {
  const engine = new Engine();
  engine.activeReviews.set('s9', { id: 's9', keys: ['acme/app#8'], mode: 'self', startedAt: Date.now() });
  const chamados = [];
  engine.cancelSession = (id) => { chamados.push(id); return { ok: true }; };  // espião: nada de killTree
  const r = engine.cancelSelfAnalysis('acme/app#8');
  assert.equal(r.ok, true);
  assert.deepEqual(chamados, ['s9']);
});

test('NÃO confunde com sessão de revisão (mode auto) do mesmo key', () => {
  const engine = new Engine();
  engine.activeReviews.set('s1', { id: 's1', keys: ['acme/app#9'], mode: 'auto', startedAt: Date.now() });
  let cancelou = false;
  engine.cancelSession = () => { cancelou = true; return { ok: true }; };
  const r = engine.cancelSelfAnalysis('acme/app#9');
  assert.equal(r.ok, false);
  assert.equal(cancelou, false, 'a revisão headless de outrem não pode ser morta por engano');
});

test('key desconhecida (ou vazia) devolve erro honesto, sem lançar', () => {
  const engine = new Engine();
  assert.equal(engine.cancelSelfAnalysis('acme/app#404').ok, false);
  assert.equal(engine.cancelSelfAnalysis('').ok, false);
});
