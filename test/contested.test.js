'use strict';
// Cobre a discordância de review de terceiro (campo `contested`): normalização com
// descarte do que não tem prova, e o gate de que contestação NUNCA auto-posta
// (nem approve nem request_changes), mesmo com a política da conta liberada.
// Regra do Wanderson: só falamos quando temos certeza, e quem publica é ele.
// Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-contested-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true };

function approvableResult(extra) {
  return {
    verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

function engineWithPolicy(policy) {
  const e = new Engine();
  // política mais permissiva possível: se o gate deixar passar, é bug
  e.config.autoApproveAll = true;
  e.config.accounts = [];
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'request_changes';
  e.accountForPr = () => 'alguem';
  return e;
}

test('contestação com prova bloqueia o auto-approve mesmo com política liberada', () => {
  const e = engineWithPolicy('approve');
  const semContest = approvableResult();
  assert.equal(e.shouldAutoApprove(PR, semContest).ok, true, 'sem contestação segue aprovando sozinho');

  const comContest = approvableResult({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  });
  assert.equal(e.shouldAutoApprove(PR, comContest).ok, false, 'com contestação, passa pelo humano');
});

test('contestação também bloqueia o auto-reject (opt-in de reprovar sozinho)', () => {
  const e = engineWithPolicy('approve');
  const rej = {
    verdict: 'request_changes', decision: 'needs_decision', reasons: ['blocker'],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } }
  };
  assert.equal(e.shouldAutoReject(PR, rej), true, 'sem contestação, a conta opt-in reprova sozinha');

  rej.contested = [{ source: 'Sonar', claim: 'y', label: 'pre_existente', evidence: 'diff vazio em services/' }];
  assert.equal(e.shouldAutoReject(PR, rej), false, 'com contestação, passa pelo humano');
});

test('contestação SEM prova é descartada (não vale como contestação, não bloqueia)', () => {
  const e = engineWithPolicy('approve');
  const semProva = approvableResult({
    contested: [
      { source: 'Acrity', claim: 'discordo', label: 'falso_positivo', evidence: '' },      // sem prova
      { source: 'Acrity', claim: 'discordo', label: 'falso_positivo' },                     // sem campo
      { source: 'Acrity', claim: 'discordo', label: 'acho_que_nao', evidence: 'algo' },     // rótulo inválido
      'texto solto'                                                                          // formato inválido
    ]
  });
  assert.deepEqual(e.contestations(semProva), [], 'nada disso conta como contestação');
  assert.equal(e.shouldAutoApprove(PR, semProva).ok, true, 'sem contestação válida, o fluxo normal segue');
});

test('os 4 rótulos válidos são aceitos quando têm prova', () => {
  const e = engineWithPolicy('approve');
  const labels = ['falso_positivo', 'fora_de_escopo', 'pre_existente', 'criterio_nao_vigente'];
  for (const label of labels) {
    const r = approvableResult({ contested: [{ source: 'X', claim: 'c', label, evidence: 'prova' }] });
    assert.equal(e.contestations(r).length, 1, `rótulo ${label} é válido`);
    assert.equal(e.shouldAutoApprove(PR, r).ok, false, `rótulo ${label} exige decisão humana`);
  }
});

test('contestação entra nos pontos de atenção com rótulo em português e a prova', () => {
  const e = engineWithPolicy('wait');
  const r = approvableResult({
    contested: [{ source: 'Acrity', claim: 'upload sem validar tipo', label: 'fora_de_escopo', evidence: 'PR declara BAIXA fora de escopo' }]
  });
  const pts = e.attentionPoints(r);
  assert.equal(pts.length, 1);
  assert.match(pts[0], /fora do escopo pactuado/, 'traduz o rótulo pra tela');
  assert.match(pts[0], /upload sem validar tipo/, 'mostra o apontamento');
  assert.match(pts[0], /PR declara BAIXA fora de escopo/, 'mostra a prova');
});

test('sem o campo contested, nada muda no comportamento antigo', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult();
  assert.deepEqual(e.contestations(r), []);
  assert.deepEqual(e.attentionPoints(r), [], 'aprovação limpa segue limpa');
  assert.equal(e.shouldAutoApprove(PR, r).ok, true);
});

test('o protocolo de terceiros é injetado no prompt headless, com a barra e o silêncio', () => {
  const e = new Engine();
  const block = e.thirdPartyReviewBlock();
  assert.match(block, /INDEPENDENTE/, 'manda revisar independente primeiro');
  assert.match(block, /ADOTE/, 'manda adotar o achado real que passou por nós');
  assert.match(block, /FIQUE CALADO/, 'manda calar na dúvida');
  for (const label of ['falso_positivo', 'fora_de_escopo', 'pre_existente', 'criterio_nao_vigente']) {
    assert.ok(block.includes(label), `documenta o rótulo ${label}`);
  }
  assert.match(block, /NUNCA conteste/, 'lista o que nunca se contesta');
});

/* ---------- retorno estruturado: o MOTIVO da recusa (Onda 7, M7) ----------
   O gate devolvia só um boolean e o bloco de transparência do runHeadlessReview
   tinha que ADIVINHAR por que a aprovação automática não saiu, e adivinhava sempre
   "política da conta", mesmo quando o bloqueio veio de contestação ou cobertura.
   Contrato novo: { ok, motivo }, com o motivo nomeado. */

test('shouldAutoApprove expõe o motivo da recusa: contestação', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({
    contested: [{ source: 'Acrity', claim: 'x', label: 'falso_positivo', evidence: 'Arquivo.tsx:10' }]
  });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'contestacao' });
});

test('shouldAutoApprove expõe o motivo da recusa: cobertura', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] } });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'cobertura' });
});

test('shouldAutoApprove expõe o motivo da recusa: política da conta', () => {
  const e = engineWithPolicy('wait');
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult()), { ok: false, motivo: 'politica' });
});

test('shouldAutoApprove expõe o motivo da recusa: clique no panorama e não-aprovável', () => {
  const e = engineWithPolicy('approve');
  assert.deepEqual(e.shouldAutoApprove({ ...PR, requested: false }, approvableResult()),
    { ok: false, motivo: 'clique' });
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult({ verdict: 'request_changes' })),
    { ok: false, motivo: 'nao_aprovavel' });
});

test('shouldAutoApprove aprovando devolve ok true e motivo nulo', () => {
  const e = engineWithPolicy('approve');
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult()), { ok: true, motivo: null });
});
