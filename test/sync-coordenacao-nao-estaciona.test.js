// D11 do contrato da sincronização: falha de coordenação entre dispositivos nunca
// estaciona e nunca entra no retryAfterNet. A classe 'coordenacao-indisponivel' da
// taxonomia é 'transitorio' (é o que o Diagnóstico precisa ler), e esse kind, no
// runOneHeadless, levaria ao retry com teto e depois ao estacionamento. A garantia
// mora no próprio runOneHeadless, que reconhece a classe antes de decidir retry.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-sync-coord-nao-estaciona-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const MSG_COORDENACAO = 'coordenação entre dispositivos indisponível: fetch failed';

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokens = { eu: 'tok-eu' };
  e.log = () => { };
  e.prState = async () => 'OPEN';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  return e;
}
const prDe = (key) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

test('runOneHeadless: coordenação indisponível volta pra fila sem retry e sem estacionar, mesmo passando do teto', async () => {
  const e = engineBase();
  const toasts = [];
  e.on('toast', (t) => toasts.push(t));
  const pr = prDe('o/r#1');
  e.runHeadlessReview = async () => { throw new Error(MSG_COORDENACAO); };
  // cinco quedas seguidas: o teto do ramo transitório é 3, então a quarta estacionaria
  for (let i = 0; i < 5; i++) await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false, 'nunca entra no retryAfterNet');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'nunca estaciona');
  assert.equal(e.seen.has(pr.key), false, 'unsee: o PR volta a ser elegível');
  assert.equal(e.queue.filter((p) => p.key === pr.key).length, 1, 'volta VISÍVEL pra fila, uma vez só');
  assert.ok(toasts.every((t) => t.kind !== 'error'), 'segurar não é falhar: nenhum toast vermelho');
});

test('runOneHeadless: a mesma mensagem sem acento também não estaciona', async () => {
  const e = engineBase();
  const pr = prDe('o/r#2');
  e.runHeadlessReview = async () => { throw new Error('Coordenacao entre dispositivos indisponivel: timeout'); };
  for (let i = 0; i < 4; i++) await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.has(pr.key), false);
  assert.equal(e.autoReviewParked.has(pr.key), false);
});

test('runOneHeadless: rede comum continua no retry de sempre (a exceção é só da coordenação)', async () => {
  const e = engineBase();
  const pr = prDe('o/r#3');
  e.runHeadlessReview = async () => { throw new Error('fetch failed'); };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.get(pr.key).tries, 1);
});
