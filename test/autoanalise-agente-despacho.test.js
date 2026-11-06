// Pedido de agente enfileirado atrás de conta ocupada: o freio de gasto que valeu ao pedir
// precisa valer de novo na vez do item, senão a fila abre sessão paga acima do orçamento.
// O clique humano no botão Analisar segue como sempre: não passa por esse freio.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-autoanalise-despacho-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* temporário */ } });

const prDe = (n) => ({ key: `acme/app#${n}`, url: `https://github.com/acme/app/pull/${n}`, repo: 'acme/app', number: n, author: 'dona', headSha: 'a'.repeat(40) });

function engineOcupado() {
  const engine = new Engine();
  const sessoes = [], toasts = [];
  let estourou = false;
  engine.myPRs = [prDe(1), prDe(2), prDe(3)];
  engine.accountForPr = () => 'dona';
  engine.tokenFor = () => 'tok';
  engine.budgetBlockedFor = () => (estourou ? { id: 'p1', label: 'Pessoal' } : null);
  engine.emit = (tipo, dado) => { if (tipo === 'toast') toasts.push(dado.text); };
  // cada sessão gasta o que restava do orçamento
  engine.runSelfAnalysis = async (pr) => { sessoes.push(pr.key); estourou = true; };
  return { engine, sessoes, toasts };
}

const esperarFila = async (engine) => { for (let i = 0; i < 20 && (engine.headlessQueue.length || engine.headlessBusyAccounts.get('dona')); i++) await new Promise(r => setImmediate(r)); };

test('dois pedidos de agente atrás de conta ocupada: o 1º esgota o orçamento e o 2º não abre sessão', async () => {
  const { engine, sessoes, toasts } = engineOcupado();
  assert.equal((await engine.launchSelfAnalysis('https://github.com/acme/app/pull/1', 'restricted-read', undefined, true)).ok, true);
  assert.equal((await engine.launchSelfAnalysis('https://github.com/acme/app/pull/2', 'restricted-read', undefined, true)).ok, true);
  await esperarFila(engine);
  assert.deepEqual(sessoes, ['acme/app#1']);
  assert.equal(engine.headlessQueue.length, 0, 'o recusado sai da fila');
  assert.ok(toasts.some(t => /acme\/app#2/.test(t) && /orçamento do perfil "Pessoal" estourou/.test(t)), toasts.join(' | '));
});

test('lançamento humano pelo botão continua rodando com o orçamento estourado', async () => {
  const { engine, sessoes } = engineOcupado();
  assert.equal((await engine.launchSelfAnalysis('https://github.com/acme/app/pull/1', 'restricted-read')).ok, true);
  assert.equal((await engine.launchSelfAnalysis('https://github.com/acme/app/pull/2', 'restricted-read')).ok, true);
  await esperarFila(engine);
  assert.deepEqual(sessoes, ['acme/app#1', 'acme/app#2']);
});
