// Dedup de postagem TEM que ser por ROUND, não por "alguma vez".
//
// Bug real (biudtech/biud-frontend#742, 11/08/2026): o Farol postou CHANGES_REQUESTED às
// 12:27 no commit 7af663e (open redirect). O autor empurrou a correção às 15:18, head
// virou 2187af8. Às 15:38 o Farol revisou de novo, achou que a correção NÃO fechou o
// buraco (dois bypasses novos, `/\evil.com` e `/%09/evil.com`) e não postou nada: o dedup
// perguntava `states.includes('CHANGES_REQUESTED')`, viu o review do round ANTERIOR e
// resolveu como already_reviewed. O achado novo morreu dentro do app enquanto o PR
// seguia com um APPROVE de terceiro em cima do head vulnerável.
//
// A pergunta certa não é "eu já pedi mudanças neste PR?", é "eu já pedi mudanças PARA
// ESTE head?". O sinal é o commit_id que a API de reviews do GitHub já devolve, comparado
// com o headRefOid do PR. O mesmo idioma já existia dois eixos ao lado: o checkpoint de
// verificação carimba headSha e descarta entrada de head antigo (review.js), e o
// reconcilePending já compara horário antes de dar uma pendência por atendida.
//
// Harness igual ao do review-reasons.test.js: engine real com FAROL_HOME temporário,
// sessão Claude stubada, fan-out neutralizado. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-dedup-round-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const HEAD_ANTIGO = '7af663eb1c0a';
const HEAD_NOVO = '2187af82d4e9';

const PR = {
  key: 'o/r#742', repo: 'o/r', number: 742, url: 'https://github.com/o/r/pull/742',
  requested: true, title: 'fix(shell): preserva permissões', author: 'thiago'
};

function envelopeReject() {
  return {
    analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision', cardMet: true,
    reasons: ['Open redirect ainda ativo no head novo'],
    reportMarkdown: 'relatório',
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'o redirect não fechou' } }
  };
}

function envelopeApprove() {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório',
    payloads: { approve: { event: 'APPROVE', body: 'ok' } }
  };
}

// engine com sessão stubada; postReview vira espião em vez de lançar, porque aqui o
// ponto do teste é justamente saber SE postou.
function engineCom(envelope, { meusReviews, head, policyReject = 'wait', policyApprove = 'wait' } = {}) {
  const e = new Engine();
  const postados = [];
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => policyApprove;
  e.rejectPolicyFor = () => policyReject;
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.headSha = async () => head;
  e.myReviewsWithTime = async () => meusReviews;
  e.postReview = async (pr, payload) => { postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async () => ({ text: JSON.stringify({ result: JSON.stringify(envelope) }), sessionId: 's1' });
  e.postados = postados;
  return e;
}

const revisao = (state, commit) => [{ state, at: Date.parse('2026-08-11T15:27:45Z'), commit }];

/* ---------- a unidade: myReviewStates filtra por head ---------- */

test('myReviewStates: review meu num commit ANTIGO não conta pro dedup do head atual', async () => {
  const e = engineCom(envelopeReject(), { meusReviews: revisao('CHANGES_REQUESTED', HEAD_ANTIGO), head: HEAD_NOVO });
  const states = await e.myReviewStates(PR, HEAD_NOVO);
  assert.deepEqual(states, [], 'round anterior não pode silenciar o round atual');
});

test('myReviewStates: review meu no MESMO commit continua contando (o dedup do #215 segue de pé)', async () => {
  const e = engineCom(envelopeReject(), { meusReviews: revisao('CHANGES_REQUESTED', HEAD_NOVO), head: HEAD_NOVO });
  const states = await e.myReviewStates(PR, HEAD_NOVO);
  assert.deepEqual(states, ['CHANGES_REQUESTED'], 'mesmo head, mesma rodada: não reposta');
});

test('myReviewStates sem head conhecido degrada pro comportamento antigo (nunca perde o dedup por falha de rede)', async () => {
  const e = engineCom(envelopeReject(), { meusReviews: revisao('CHANGES_REQUESTED', HEAD_ANTIGO), head: '' });
  const states = await e.myReviewStates(PR, '');
  assert.deepEqual(states, ['CHANGES_REQUESTED'], 'sem sha não dá pra separar rodada: mantém o dedup conservador');
});

test('myReviewStates: sem prova de review nenhum segue devolvendo null', async () => {
  const e = engineCom(envelopeReject(), { meusReviews: null, head: HEAD_NOVO });
  assert.equal(await e.myReviewStates(PR, HEAD_NOVO), null, 'null = não deu pra confirmar, contrato preservado');
});

/* ---------- o caminho automático: reprovação de 2º round ---------- */

test('REGRESSÃO #742: 2º round com achado novo em head novo POSTA, mesmo já tendo pedido mudanças antes', async () => {
  const e = engineCom(envelopeReject(), {
    meusReviews: revisao('CHANGES_REQUESTED', HEAD_ANTIGO), head: HEAD_NOVO, policyReject: 'request_changes'
  });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 1, 'o achado do round novo chega no PR');
  assert.equal(e.postados[0].event, 'REQUEST_CHANGES');
  const h = e.decisions.resolved[0];
  assert.equal(h.status, 'auto_rejected', 'histórico registra postagem de verdade, não already_reviewed');
});

test('mesmo head: segue sem repostar (não regride o dedup que existe por motivo real)', async () => {
  const e = engineCom(envelopeReject(), {
    meusReviews: revisao('CHANGES_REQUESTED', HEAD_NOVO), head: HEAD_NOVO, policyReject: 'request_changes'
  });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 0, 'a mesma rodada não vira review duplicado');
  assert.equal(e.decisions.resolved[0].status, 'already_reviewed');
});

/* ---------- o caminho automático: aprovação de 2º round ---------- */

test('APPROVE de 2º round em head novo POSTA, mesmo com aprovação minha no head anterior', async () => {
  const e = engineCom(envelopeApprove(), {
    meusReviews: revisao('APPROVED', HEAD_ANTIGO), head: HEAD_NOVO, policyApprove: 'approve'
  });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 1, 'aprovação nova precisa alcançar o head novo');
  assert.equal(e.postados[0].event, 'APPROVE');
  assert.equal(e.decisions.resolved[0].status, 'auto_approved');
});

/* ---------- o caminho do clique: decide() ---------- */

test('decide(): clique em REQUEST CHANGES com review meu só no head anterior POSTA', async () => {
  const e = engineCom(envelopeReject(), { meusReviews: revisao('CHANGES_REQUESTED', HEAD_ANTIGO), head: HEAD_NOVO });
  e.saveDecisions = () => { };
  e.decisions = {
    pending: [{
      id: 'd1', createdAt: Date.now(), status: 'pending', verdict: 'request_changes',
      key: PR.key, pr: { ...PR },
      payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'o redirect não fechou' } }
    }],
    resolved: []
  };
  const r = await e.decide('d1', 'request_changes');
  assert.equal(r.ok, true);
  assert.equal(e.postados.length, 1, 'clique explícito nunca pode ser engolido por review de rodada antiga');
  assert.equal(e.decisions.resolved[0].status, 'posted');
});

test('decide(): clique com review meu JÁ no head atual continua deduplicando', async () => {
  const e = engineCom(envelopeReject(), { meusReviews: revisao('CHANGES_REQUESTED', HEAD_NOVO), head: HEAD_NOVO });
  e.saveDecisions = () => { };
  e.decisions = {
    pending: [{
      id: 'd1', createdAt: Date.now(), status: 'pending', verdict: 'request_changes',
      key: PR.key, pr: { ...PR },
      payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } }
    }],
    resolved: []
  };
  await e.decide('d1', 'request_changes');
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.resolved[0].status, 'already_reviewed');
});

/* ---------- G1: o review postado carrega o head que ESTA sessão leu ---------- */
// Mesma regra do dedup: os três pontos de postagem andam juntos. O `decide()` do clique
// está travado em review-commit-id.test.js; estes cobrem os ramos AUTOMÁTICOS, que são os
// que postam sem ninguém olhando. Sem eles, tirar o commit_id do spread deixava a suíte
// verde e o review voltava a ser ancorado no head do momento do POST.

test('G1 canReject: o REQUEST_CHANGES automático vai ancorado no head da sessão', async () => {
  const e = engineCom(envelopeReject(), {
    meusReviews: revisao('CHANGES_REQUESTED', HEAD_ANTIGO), head: HEAD_NOVO, policyReject: 'request_changes'
  });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 1);
  assert.equal(e.postados[0].commit_id, HEAD_NOVO, 'o sha postado é o que a sessão leu, não o que o GitHub escolher no POST');
});

test('G1 canAuto: o APPROVE automático vai ancorado no head da sessão', async () => {
  const e = engineCom(envelopeApprove(), {
    meusReviews: revisao('APPROVED', HEAD_ANTIGO), head: HEAD_NOVO, policyApprove: 'approve'
  });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 1);
  assert.equal(e.postados[0].commit_id, HEAD_NOVO, 'o sha postado é o que a sessão leu, não o que o GitHub escolher no POST');
});

test('G1: sem head conhecido o commit_id sai vazio e o normalize descarta (degrada, não inventa sha)', async () => {
  const e = engineCom(envelopeReject(), { meusReviews: null, head: '', policyReject: 'request_changes' });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 1, 'falta de sha nunca pode impedir a postagem');
  assert.equal(e.postados[0].commit_id, '', 'sem prova do head, volta ao comportamento antigo');
});
