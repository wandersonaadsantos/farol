// Reasons do runHeadlessReview: o bloco de transparência só pode atribuir à POLÍTICA
// da conta o que veio de fato da política. Antes ele disparava sempre que o gate
// recusava um PR aprovável e pedido a mim, então contestação e cobertura apareciam
// pra você como "a política da conta manda aguardar", que era mentira (M7).
// Desde a v2.48.0 cada reason é { text, kind }: 'gate' (regra do app), 'content'
// (a revisão apontou) ou 'infra' (a postagem em si falhou). Os testes aqui checam
// os dois lados, texto E etiqueta, porque é a etiqueta que faz a tela distinguir
// "a IA achou algo" de "a rede caiu" (era o print do biud-frontend#774).
// Harness: engine real com FAROL_HOME temporário, sessão Claude stubada e a medição
// de fan-out neutralizada (prMetrics null = passe único). Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-review-reasons-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;

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

const texto = r => (r && typeof r === 'object') ? r.text : r;
const textos = rs => (rs || []).map(texto);

function envelope(extra) {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
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
  assert.match(texto(item.reasons[0]), /política da conta Conta Trabalho/, 'a recusa é da política, e diz isso');
  assert.equal(item.reasons[0].kind, 'gate', 'política é regra do app, não achado da revisão');
});

test('recusa por contestação NÃO é atribuída à política da conta (M7)', async () => {
  const e = engineComEnvelope(envelope({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'contestação sempre cai na sua mesa');
  assert.match(texto(item.reasons[0]), /discordância/, 'o motivo que lidera é a contestação');
  assert.equal(item.reasons[0].kind, 'gate', 'contestação segura por regra, não é achado sobre o código');
  for (const r of textos(item.reasons)) assert.doesNotMatch(r, /política da conta/, 'nenhuma reason culpa a política');
});

test('recusa por cobertura incompleta NÃO é atribuída à política da conta (M7)', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'lacuna de leitura sempre cai na sua mesa');
  assert.match(texto(item.reasons[0]), /não cobriu/, 'o motivo que lidera é a cobertura');
  assert.equal(item.reasons[0].kind, 'gate', 'cobertura incompleta é gate, não ressalva de conteúdo');
  for (const r of textos(item.reasons)) assert.doesNotMatch(r, /política da conta/, 'nenhuma reason culpa a política');
});

test('lacuna de cobertura entra UMA vez nas reasons, com a amostra dos arquivos (B5)', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }), { policy: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  const deCobertura = textos(item.reasons).filter(r => /não cobriu/.test(r));
  assert.equal(deCobertura.length, 1, `cobertura virou ${deCobertura.length} motivo(s): ${deCobertura.join(' | ')}`);
  assert.match(deCobertura[0], /b\.ts/, 'a redação que fica é a que mostra a amostra');
  assert.match(deCobertura[0], /não posto sozinho/, 'e a que explica a consequência');
});

/* ---------- falha de postagem: infra, não julgamento (biud-frontend#774) ----------
   O incidente: a revisão decidiu approve, o gate LIBEROU e a postagem em si morreu
   num 503 durante um outage do GitHub. A falha entrava na mesma lista plana das
   ressalvas de conteúdo, então a tela dizia "7 motivos de ter vindo pra você" sem
   distinguir "a IA achou algo" de "a rede caiu", e nada tentava de novo: a pendência
   ficava presa esperando clique humano pra sempre. */

// engine cujo postReview FALHA com a mensagem dada (o resto igual ao harness acima)
function engineComPostQuebrado(erro, data = envelope()) {
  const e = engineComEnvelope(data, { policy: 'approve' });
  e.postReview = async () => ({ ok: false, attempted: true, error: erro });
  return e;
}

const ERRO_503 = 'gh: No server is currently available to service your request. Sorry about that. (HTTP 503)';

test('falha transitória ao postar vira reason de INFRA e marca o retry automático', async () => {
  const e = engineComPostQuebrado(ERRO_503);
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'a pendência é criada, o review não sumiu');
  const infra = item.reasons.filter(r => r.kind === 'infra');
  assert.equal(infra.length, 1, 'a falha de postagem é UM motivo, e é de infra');
  assert.match(infra[0].text, /falha ao postar o APPROVE/);
  assert.ok(item.postRetry, 'ficou marcado pra tentar de novo sozinho');
  assert.equal(item.postRetry.event, 'approve');
  assert.equal(item.postRetry.attempts, 0);
});

test('falha PERMANENTE ao postar não marca retry (tentar de novo não resolveria)', async () => {
  // credencial recusada não passa sozinha: reenviar em loop só gasta chamada e
  // esconde de você o único problema que exige ação humana de verdade.
  const e = engineComPostQuebrado('sessão retornou erro: Invalid API key · Fix external API key');
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item);
  assert.equal(item.reasons.filter(r => r.kind === 'infra').length, 1, 'continua sendo falha de infra pra tela');
  assert.equal(item.postRetry, null, 'mas NÃO entra no sweep de retry');
});

test('reason vinda da sessão (achado da IA) fica como content, não vira gate nem infra', async () => {
  const e = engineComPostQuebrado(ERRO_503, envelope({
    reasons: ['a validação de CPF aceita string vazia'],
  }));
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  const content = item.reasons.filter(r => r.kind === 'content');
  assert.equal(content.length, 1, 'o achado da revisão continua um motivo só');
  assert.match(content[0].text, /validação de CPF/);
  // é ESTA separação que o print do #774 não tinha: os dois eixos convivem no
  // mesmo PR e a tela precisa saber qual é qual
  assert.equal(item.reasons.filter(r => r.kind === 'infra').length, 1);
});
