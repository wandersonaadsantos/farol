'use strict';
// Reasons do runHeadlessReview: o bloco de transparência só pode atribuir à POLÍTICA
// da conta o que veio de fato da política. Antes ele disparava sempre que o gate
// recusava um PR aprovável e pedido a mim, então contestação e cobertura apareciam
// pra você como "a política da conta manda aguardar", que era mentira (M7).
// Harness: engine real com FAROL_HOME temporário, sessão Claude stubada e a medição
// de fan-out neutralizada (prMetrics null = passe único). Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-review-reasons-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');
const fanout = require('../lib/engine/fanout.js');

// runHeadlessReview chama fanoutMod.prMetrics por acesso de propriedade em tempo de
// chamada, então trocar a propriedade exportada vale pro require de dentro do review.js.
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { }
});

const PR = {
  key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1',
  requested: true, title: 't', author: 'alice'
};

function envelope(extra) {
  return {
    verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

// engine com a sessão stubada devolvendo o envelope dado; nada toca rede nem posta.
// postReview LANÇA de propósito: se algum gate deixar postar, o teste explode.
function engineComEnvelope(data, { policy = 'approve' } = {}) {
  const e = new Engine();
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta Trabalho';
  e.myReviewStates = async () => null;
  e.postReview = async () => { throw new Error('não era pra postar neste teste'); };
  e.runClaudeStream = async () => ({ text: JSON.stringify({ result: JSON.stringify(data) }), sessionId: 's1' });
  return e;
}

test('recusa por política da conta lidera as reasons com a explicação da política', async () => {
  const e = engineComEnvelope(envelope(), { policy: 'wait' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'caiu na sua mesa (needs decision)');
  assert.match(item.reasons[0], /política da conta Conta Trabalho/, 'a recusa é da política, e diz isso');
});

test('recusa por contestação NÃO é atribuída à política da conta (M7)', async () => {
  const e = engineComEnvelope(envelope({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'contestação sempre cai na sua mesa');
  assert.match(item.reasons[0], /discordância/, 'o motivo que lidera é a contestação');
  for (const r of item.reasons) assert.doesNotMatch(r, /política da conta/, 'nenhuma reason culpa a política');
});

test('recusa por cobertura incompleta NÃO é atribuída à política da conta (M7)', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'lacuna de leitura sempre cai na sua mesa');
  assert.match(item.reasons[0], /não cobriu/, 'o motivo que lidera é a cobertura');
  for (const r of item.reasons) assert.doesNotMatch(r, /política da conta/, 'nenhuma reason culpa a política');
});
