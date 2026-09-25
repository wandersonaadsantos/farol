// Review decisivo não sai em PR que já foi mergeado ou fechado (25/09/2026).
//
// A revisão conferia o estado do PR só antes de COMEÇAR (review.js), e a sessão dura
// minutos. Medido na auditoria de qualidade: biud-esg#338 recebeu REQUEST_CHANGES 1min50s
// depois do merge, e infra-k8s#145 2min23s depois. O pedido de mudanças num PR já mergeado
// não muda nada e fica no histórico do PR como ruído assinado pela conta. A conferência agora
// é a última coisa antes do envio, para toda via (revisão, clique, fila, chat).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-pr-fechado-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// o gh é a fronteira de rede: o estado do PR vem do duble, e o envio fica registrado
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let estado = { ok: true, stdout: '{"state":"OPEN"}' };
let envios = [];
io.run = async (cmd, args) => {
  const sub = (args || []).join(' ');
  if (sub.includes('--json state')) return { code: 0, stderr: '', ...estado };
  if (/pulls\/\d+\/reviews --input/.test(sub)) { envios.push(sub); return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' }; }
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { envios = []; estado = { ok: true, stdout: '{"state":"OPEN"}' }; });

function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.updateSettings({ accounts: [{ user: 'eu', owners: ['acme'] }] });
  e.tokens = { eu: 'tok' };
  e.token = 'tok';
  return e;
}

const PR = { key: 'acme/app#7', repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/pull/7' };
const APROVAR = { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' };
const PEDIR = { event: 'REQUEST_CHANGES', body: 'O teste novo não cobre o caso vazio.' };

test('PR mergeado: nem APPROVE nem REQUEST_CHANGES saem, e o motivo é dito', async () => {
  estado = { ok: true, stdout: '{"state":"MERGED"}' };
  for (const payload of [APROVAR, PEDIR]) {
    const r = await motor().postReview(PR, payload);
    assert.equal(r.ok, false);
    assert.equal(r.blocked, 'pr_fechado');
    assert.match(r.error, /mergeado/);
  }
  assert.deepEqual(envios, [], 'nenhum review foi enviado ao GitHub');
});

test('PR fechado sem merge: o review decisivo também não sai', async () => {
  estado = { ok: true, stdout: '{"state":"CLOSED"}' };
  const r = await motor().postReview(PR, PEDIR);
  assert.equal(r.blocked, 'pr_fechado');
  assert.match(r.error, /fechado/);
  assert.deepEqual(envios, []);
});

test('PR aberto posta normalmente', async () => {
  const r = await motor().postReview(PR, APROVAR);
  assert.equal(r.ok, true);
  assert.equal(envios.length, 1);
});

test('sem resposta sobre o estado, posta: falta de prova não cancela', async () => {
  estado = { ok: false, stdout: '', stderr: 'rede' };
  const r = await motor().postReview(PR, APROVAR);
  assert.equal(r.ok, true);
  assert.equal(envios.length, 1);
});

test('COMMENT num PR mergeado continua saindo: comentar depois do merge pode ser o pedido', async () => {
  estado = { ok: true, stdout: '{"state":"MERGED"}' };
  const r = await motor().postReview(PR, { event: 'COMMENT', body: 'Registro do ponto conversado.' });
  assert.equal(r.ok, true);
  assert.equal(envios.length, 1);
});
