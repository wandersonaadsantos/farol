// A sessão que encerra em prosa não autoriza repetir uma verificação: pode haver
// ferramenta recusada/interrompida no contexto. O Farol mantém a decisão pendente
// de uma revisão válida, sem fabricar resultado nem reabrir a sessão sozinho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-result-missing-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const metricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
after(() => {
  fanout.prMetrics = metricsOriginal;
  fs.rmSync(FAROL_HOME, { recursive: true, force: true });
});

const SID = '12345678-abcd-1234-abcd-123456789012';
const HEAD = 'a'.repeat(40);
const PROGRESSO = 'Still waiting on the lint provenance check to close out the CI picture.';
const PR = { key: 'acme/app#971', repo: 'acme/app', number: 971,
  url: 'https://github.com/acme/app/pull/971', author: 'dev', requested: true };
const ENVELOPE = { analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision',
  cardMet: true, reasons: [], reportMarkdown: 'Análise concluída.', payloads: {} };
const resposta = (text, sessionId = SID) => ({ text, sessionId });

function engineCom(res) {
  const e = new Engine();
  e.decisions = { pending: [], resolved: [] };
  e.config = { ...e.config, jiraSites: [], reReviewResume: false };
  e.accountForPr = () => 'conta';
  e.tokenFor = () => ''; // não escreve label nem consulta GitHub
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => [];
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  e.myReviewStates = async () => [];
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = () => {};
  e.writeInflight = () => {};
  e.saveDecisions = () => {};
  e.pushState = () => {};
  e.processHeadless = () => {};
  e.log = () => {};
  e.chamadas = [];
  e.postados = [];
  e.postReview = async (pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async (prompt, opts) => {
    e.chamadas.push({ prompt, opts });
    assert.equal(e.chamadas.length, 1, 'não pode retomar nem reiniciar automaticamente');
    if (res instanceof Error) throw res;
    return res;
  };
  return e;
}

test('prosa final sem JSON falha com motivo claro e sessionId, sem retomar nem postar', async () => {
  const e = engineCom(resposta(PROGRESSO));
  await assert.rejects(e.runHeadlessReview({ ...PR }), err => {
    assert.equal(err.code, 'FAROL_RESULT_MISSING');
    assert.equal(err.sessionId, SID, 'o identificador permanece como metadado da falha');
    assert.match(err.message, /^revisão não concluída: a sessão terminou sem entregar o resultado estruturado/);
    assert.match(err.message, /71 caracteres/);
    assert.doesNotMatch(err.message, /Still waiting|lint provenance|12345678-abcd/,
      'o diagnóstico não copia prosa da sessão nem o identificador');
    return true;
  });
  assert.equal(e.chamadas.length, 1);
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.pending.length, 0, 'não fabrica veredito nem envelope incompleto');
  assert.equal(e.decisions.resolved.length, 0);
  assert.equal(e.activeReviews.size, 0, 'a sessão encerra pelo finally existente');
});

test('resultado ausente estaciona no caminho real do worker e não arma retry de rede', async () => {
  const e = engineCom(resposta(PROGRESSO));
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.chamadas.length, 1);
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.equal(e.retryAfterNet.has(PR.key), false);
  assert.equal(e.queue.some(pr => pr.key === PR.key), true, 'o card continua disponível para ação manual');
  assert.equal(e.postados.length, 0);
  const detalhes = e.parkedMotivos[PR.key];
  assert.match(detalhes.motivo, /revisão não concluída/);
});

test('resultado ausente sem sessionId preserva erro acionável sem inventar identificador', async () => {
  const e = engineCom(resposta(PROGRESSO, null));
  await assert.rejects(e.runHeadlessReview({ ...PR }), err => {
    assert.equal(err.code, 'FAROL_RESULT_MISSING');
    assert.equal(err.sessionId, undefined);
    assert.match(err.message, /^revisão não concluída:/);
    return true;
  });
  assert.equal(e.chamadas.length, 1);
});

test('JSON malformado, ambíguo ou fora do contrato não é convertido em resultado ausente', async () => {
  const textos = ['{"decision":', '{"decision":"needs_decision"}',
    JSON.stringify({ ...ENVELOPE, analysisStatus: 'parcial' }),
    '```json\n' + JSON.stringify(ENVELOPE) + '\n```\n```json\n' + JSON.stringify(ENVELOPE) + '\n```'];
  for (const text of textos) {
    const e = engineCom(resposta(text));
    await assert.rejects(e.runHeadlessReview({ ...PR }), err => {
      assert.notEqual(err.code, 'FAROL_RESULT_MISSING');
      assert.doesNotMatch(err.message, /^revisão não concluída:/);
      return true;
    });
    assert.equal(e.chamadas.length, 1);
    assert.equal(e.postados.length, 0);
  }
});

test('autenticação, rede e cancelamento mantêm o erro original sem abrir outra sessão', async () => {
  const falhas = [new Error('API Error: 401 OAuth access token has expired.'),
    new Error('fetch failed'), Object.assign(new Error('cancelada'), { cancelled: true })];
  for (const err of falhas) {
    const e = engineCom(err);
    await assert.rejects(e.runHeadlessReview({ ...PR }), recebido => recebido === err);
    assert.equal(e.chamadas.length, 1);
    assert.equal(e.postados.length, 0);
  }
});

test('JSON incompleto válido continua no gate e nunca publica aprovação', async () => {
  const e = engineCom(resposta(JSON.stringify({ ...ENVELOPE, analysisStatus: 'incomplete',
    payloads: { approve: { event: 'APPROVE', body: 'O tratamento da entrada está consistente.' } } })));
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas.length, 1);
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.pending[0].analysisStatus, 'incomplete');
});

test('JSON válido já encerrado mantém o fluxo de decisão existente', async () => {
  const e = engineCom(resposta(JSON.stringify(ENVELOPE)));
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas.length, 1);
  assert.equal(e.decisions.pending.length, 1);
  assert.equal(e.decisions.pending[0].sessionId, SID);
});
