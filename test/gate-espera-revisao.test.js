// A aprovação automática ESPERA com CI em andamento ou dependência em aberto, na revisão de
// verdade (27/09/2026). O gate puro tem os testes dele (ci-vermelho-gate.test.js); aqui se
// prova a FIAÇÃO: o runHeadlessReview lê o estado dos checks, o gate segura, nada vai para o
// GitHub, e o card diz por quê.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-gate-espera-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// o gh é a fronteira de rede: registra envio de review e responde vazio ao resto
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
io.run = async (cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) { envios.push(sub); return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' }; }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: '{"state":"OPEN"}', stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { envios = []; });

function motor(checks) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.autoApproveAll = true;
  e.approvePolicyFor = () => 'approve';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.bloqueadoPorChecks = async () => ({ faltando: checks });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = (n) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', requested: true });

test('check obrigatório ainda rodando: nada é postado e o card diz qual check', async () => {
  const e = motor([{ nome: 'test', estado: 'rodando' }]);
  sessao(e);
  await e.runHeadlessReview(PR(1));
  assert.deepEqual(envios, [], 'nenhum APPROVE foi enviado');
  const d = e.decisions.pending.find((x) => x.key === 'acme/app#1');
  assert.ok(d, 'virou pendência na mesa');
  assert.ok(d.reasons.some((r) => /ainda sem resultado no head \(test\)/.test(r.text || r)), JSON.stringify(d.reasons));
});

test('dependência em aberto declarada pela revisão: nada é postado e o card nomeia a dependência', async () => {
  const e = motor([]);
  sessao(e, { dependenciasAbertas: ['acme/infra#189 ainda aberto'] });
  await e.runHeadlessReview(PR(2));
  assert.deepEqual(envios, []);
  const d = e.decisions.pending.find((x) => x.key === 'acme/app#2');
  assert.ok(d.reasons.some((r) => /acme\/infra#189 ainda aberto/.test(r.text || r)), JSON.stringify(d.reasons));
});

test('sem check pendente e sem dependência, a aprovação automática segue saindo', async () => {
  const e = motor([]);
  sessao(e);
  await e.runHeadlessReview(PR(3));
  assert.equal(envios.length, 1);
  assert.equal(e.decisions.pending.find((x) => x.key === 'acme/app#3'), undefined);
});
