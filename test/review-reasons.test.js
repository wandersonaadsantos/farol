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
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-review-reasons-'));

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
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

// engine com a sessão stubada devolvendo o envelope dado; nada toca rede nem posta.
// postReview LANÇA de propósito: se algum gate deixar postar, o teste explode.
// `ressalvas` é a política para aprovável COM ressalvas; por padrão segue a mesma do limpo
function engineComEnvelope(data, { policy = 'approve', ressalvas = policy } = {}) {
  const e = new Engine();
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = (_conta, limpo) => (limpo ? policy : ressalvas);
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

// Até 30/09/2026 estes três testes afirmavam o contrário: contestação e cobertura SEMPRE caíam
// na mesa, com motivo próprio e sem culpar a política (M7), porque eram gate. Viraram
// ressalva: quem segura agora É a política, o card diz isso, e a ressalva vem junto.
test('contestação com a conta esperando nas ressalvas: a recusa é da política e a discordância aparece no card', async () => {
  const e = engineComEnvelope(envelope({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  }), { policy: 'approve', ressalvas: 'wait' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'a conta mandou esperar nas ressalvas');
  assert.match(texto(item.reasons[0]), /aprovável com ressalvas, e a política da conta .+ é aguardar você/, 'quem segurou foi a política de ressalvas');
  const discordancia = item.reasons.filter(r => /Discordância de outro review \(falso positivo\)/.test(texto(r)));
  assert.equal(discordancia.length, 1, 'a ressalva aparece uma vez, com rótulo e prova');
  assert.equal(discordancia[0].kind, 'gate');
});

test('contestação com a conta aprovando com ressalvas: o APPROVE sai e a discordância fica só no app', async () => {
  const e = engineComEnvelope(envelope({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  }), { policy: 'approve' });
  const postados = [];
  e.myReviewStates = async () => [];
  e.postReview = async (_pr, payload) => { postados.push(payload); return { ok: true }; };
  e.writeMemory = () => { };
  const naMesaAntes = e.decisions.pending.length;
  await e.runHeadlessReview(PR);
  assert.equal(e.decisions.pending.length, naMesaAntes, 'nada novo na mesa');
  assert.equal(postados.length, 1);
  assert.doesNotMatch(JSON.stringify(postados[0]), /Acrity|Discordância|falso positivo/i, 'a discordância não entra no texto do PR');
  const item = e.decisions.resolved[0];
  assert.equal(item.status, 'auto_approved');
  assert.equal(item.attention.length, 1);
  assert.match(texto(item.attention[0]), /Discordância de outro review \(falso positivo\): ref não é setado/);
});

test('lacuna de cobertura entra UMA vez nas reasons, como ressalva, com a amostra dos arquivos (B5)', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }), { policy: 'approve', ressalvas: 'wait' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.match(texto(item.reasons[0]), /aprovável com ressalvas, e a política da conta .+ é aguardar você/, 'quem segurou foi a política de ressalvas');
  const deCobertura = textos(item.reasons).filter(r => /cobertura da leitura/.test(r));
  assert.equal(deCobertura.length, 1, `cobertura virou ${deCobertura.length} motivo(s): ${deCobertura.join(' | ')}`);
  assert.match(deCobertura[0], /b\.ts/, 'a redação que fica é a que mostra a amostra');
  assert.doesNotMatch(deCobertura[0], /não posto sozinho/, 'ressalva não promete recusa: quem decide é a política');
});

// A lacuna continua explicando a recusa onde o resultado NÃO chega à política: revisão
// iniciada por clique e pedido de mudanças (o shouldAutoReject segue recusando).
test('fora da política (clique), a lacuna de cobertura segue explicando por que nada saiu sozinho', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }), { policy: 'approve' });
  await e.runHeadlessReview({ ...PR, requested: false });
  const item = e.decisions.pending[0];
  const deCobertura = textos(item.reasons).filter(r => /cobertura da leitura/.test(r));
  assert.equal(deCobertura.length, 1);
  assert.match(deCobertura[0], /não posto sozinho/);
  assert.ok(textos(item.reasons).some(r => /revisão iniciada por você/.test(r)));
});

// A classe escondida: zero ponto de atenção com `decision` diferente de auto_approve caía em
// "com ressalvas" sem mostrar nada no card. Agora o rebaixamento tem ressalva própria.
test('sessão que não decidiu auto_approve e não escreveu motivo: o card mostra a ressalva que rebaixou', async () => {
  const e = engineComEnvelope(envelope({ decision: 'needs_decision', cardMet: null }), { policy: 'approve', ressalvas: 'wait' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.match(texto(item.reasons[0]), /aprovável com ressalvas/);
  assert.equal(item.reasons.length, 2, 'política + a ressalva que explica a classe');
  assert.match(texto(item.reasons[1]), /não marcou o PR como aprovável sem ressalvas nem escreveu o motivo/);
});

test('card não comprovado: o card mostra a ressalva do card ao lado da política', async () => {
  const e = engineComEnvelope(envelope({ decision: 'needs_decision', cardMet: false }), { policy: 'approve', ressalvas: 'wait' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.match(texto(item.reasons[0]), /aprovável com ressalvas/);
  assert.ok(textos(item.reasons).some(r => /card não foi totalmente comprovado/.test(r)), JSON.stringify(item.reasons));
});

test('zero ponto de atenção é limpo: a política do limpo decide, e a recusa diz "sem ressalvas"', async () => {
  const e = engineComEnvelope(envelope(), { policy: 'wait', ressalvas: 'approve' });
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.match(texto(item.reasons[0]), /aprovável sem ressalvas/);
  assert.equal(item.reasons.length, 1, 'limpo não tem ressalva a mostrar');
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
