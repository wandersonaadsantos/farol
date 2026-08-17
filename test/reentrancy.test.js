// Guardas de reentrância checadas ANTES de um await (padrão P4 do relatório de gaps):
// chatSend (B1) e launchTool (B2) liam o status, davam await no refreshToken e SÓ ENTÃO
// marcavam 'running'. Duas chamadas na mesma janela passavam as duas pela guarda: duas
// gerações concorrentes no mesmo chat, duas sessões da mesma ferramenta (custo em dobro,
// resultado sobrescrito). A correção marca 'running' de forma síncrona e move o
// refreshToken pra dentro do bloco async (falha vira mensagem; o finally restaura).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-reentrancy-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function esperar(cond, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

// Engine real com os pontos de rede/sessão substituídos NA INSTÂNCIA: chat.js e tools.js
// chamam engine.refreshToken/engine.runClaudeStream/engine.toolPrompt via contexto (late
// binding), então o stub na instância vale. O refreshToken lento (30ms) segura aberta a
// janela da corrida antiga; pushState é stubado porque snapshot() completo não interessa
// aqui e toolPrompt leria um arquivo do workspace que não existe sem boot.
function engineStubado() {
  const e = new Engine();
  e.token = null; // força o caminho do await do refreshToken
  e.refreshToken = () => new Promise(r => setTimeout(() => { e.token = 'tok'; r(true); }, 30));
  e.pushState = () => { };
  e._geracoes = 0;
  e.runClaudeStream = async () => { e._geracoes++; return { text: 'resposta', sessionId: 's1' }; };
  return e;
}

test('chatSend: segunda mensagem na janela do refreshToken é recusada (B1)', async () => {
  const e = engineStubado();
  const p1 = e.chatSend('acme/app#1', 'https://github.com/acme/app/pull/1', 'primeira');
  const p2 = e.chatSend('acme/app#1', 'https://github.com/acme/app/pull/1', 'segunda');
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false, 'as duas passaram pela guarda: corrida aberta');
  assert.match(r2.error, /aguarde/);
  await esperar(() => e.chats['acme/app#1'].status === 'idle');
  assert.equal(e._geracoes, 1, 'uma única sessão do Claude por mensagem');
  const doUsuario = e.chats['acme/app#1'].messages.filter(m => m.role === 'user');
  assert.equal(doUsuario.length, 1, 'a mensagem recusada não entra no histórico');
});

test('launchTool: segundo clique na janela do refreshToken é recusado (B2)', async () => {
  const e = engineStubado();
  e.toolPrompt = () => 'prompt de teste';
  const p1 = e.launchTool('health');
  const p2 = e.launchTool('health');
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false, 'as duas passaram pela guarda: sessão headless dobrada');
  assert.match(r2.error, /já está rodando/);
  await esperar(() => { const run = e.toolRunGet('health'); return run && run.status !== 'running'; });
  assert.equal(e.toolRunGet('health').status, 'done');
  assert.equal(e._geracoes, 1, 'uma única sessão da ferramenta, não custo em dobro');
});
