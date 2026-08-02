'use strict';
// A7: porta ocupada não pode deixar um SEGUNDO engine vivo no mesmo ~/.farol
// (polling dobrado, revisão dupla com dois posts no GitHub, writeFileSync
// concorrente em seen/inflight/usage/chats). O listen na porta é o lock de
// instância única: vale no Electron E no modo `node server.js` (o
// requestSingleInstanceLock do Electron não cobre o modo servidor).
// Idioma: FAROL_HOME temporário ANTES do require (test/boot.test.js) e porta
// efêmera pra nunca colidir com um Farol real (test/http.test.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const HOME = path.join(os.tmpdir(), 'farol-test-instance-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const farol = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

// autoReview false e updateRepo vazio: nem o caminho pré-correção (start síncrono)
// dispara revisão automática ou gh release view
function escreveConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, 'config.json'),
    JSON.stringify({ autoReview: false, updateRepo: '', ...cfg }));
}

test('porta ocupada: o engine NÃO agenda polling nem inicia o ciclo (A7)', async () => {
  const blocker = http.createServer(() => { });
  await new Promise(res => blocker.listen(0, '127.0.0.1', res));
  escreveConfig({ port: blocker.address().port });
  let engine, server;
  const err = await new Promise((resolve) => {
    ({ engine, server } = farol.start((url, e) => resolve(e)));
  });
  try {
    assert.ok(err, 'o listen falhou com a porta ocupada (EADDRINUSE)');
    assert.equal(engine.timer, null, 'nenhum polling agendado: schedule() não pode ter rodado');
    assert.equal(engine.nextCheckAt, null, 'nextCheckAt intocado: schedule() não rodou');
    assert.equal(engine.status, 'starting', 'status intocado: check("startup") não rodou');
  } finally {
    if (engine) clearTimeout(engine.timer);
    try { server && server.close(); } catch { /* ok */ }
    await new Promise(res => blocker.close(res));
  }
});

test('porta livre: o engine monitora DEPOIS do listen (comportamento preservado)', async () => {
  escreveConfig({ port: 0 });
  let engine, server;
  const pronto = new Promise((resolve, reject) => {
    ({ engine, server } = farol.start((url, e) => (e ? reject(e) : resolve(url))));
  });
  // stubs instalados de forma SÍNCRONA, antes do tick assíncrono do listen:
  // com a correção, schedule/start só rodam no callback, então usam os stubs
  // e a suite verde não faz rede nenhuma
  engine.check = async () => { engine.status = 'idle'; };
  engine.checkUpdate = async () => { };
  engine.doctor = async () => { };
  await pronto;
  await new Promise(res => setImmediate(res));
  try {
    assert.ok(engine.nextCheckAt, 'schedule() rodou depois do listen');
    assert.ok(engine.timer, 'timer de polling agendado');
    assert.equal(engine.status, 'idle', 'check("startup") rodou (o stub marcou idle)');
  } finally {
    clearTimeout(engine.timer);
    try { server.close(); } catch { /* ok */ }
  }
});
