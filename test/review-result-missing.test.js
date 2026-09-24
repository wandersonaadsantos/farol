// A sessão que encerra em prosa não autoriza repetir uma VERIFICAÇÃO: pode haver
// ferramenta recusada/interrompida no contexto. O Farol mantém a decisão pendente
// de uma revisão válida, sem fabricar resultado.
//
// DECISÃO REVISTA EM 23/09/2026 (autorizada pelo dono, ver lib/engine/reparo-envelope.js).
// Até aqui este arquivo também proibia REABRIR a sessão, e as duas coisas eram uma só.
// Passaram a ser duas: continua proibido refazer verificação, e passou a ser permitido
// pedir UMA vez o envelope na mesma conversa, sem reler nada. O que mudou de lá pra cá:
//   - duas sessões reais de 10m17 e 14m56 foram inteiras pro lixo por causa da última
//     mensagem (state/falhas-sessao.json, 22 e 23/09/2026);
//   - o medo era o veredito fabricado, e quem protege disso não é a promessa do prompt
//     e sim o gate do engine: coverageGap compara os arquivos PROVADOS lidos com os do
//     diff, checkpointGap lê o checkpoint que só o engine escreve, e o auto-approve
//     ainda exige requested + approve + payload APPROVE. Envelope "completo" sem
//     leitura nenhuma não passa.
// Os casos de JSON malformado, falta de sessionId, auth, rede e cancelamento seguem
// intactos abaixo: nenhum deles ganha reparo.
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

// `res` é a resposta da sessão; `resReparo` é a da rodada de reparo (quando houver).
// Sem `resReparo`, o reparo devolve a MESMA prosa, que é o caso em que o desfecho tem
// que ser idêntico ao de antes desta decisão: falha de contrato e estacionamento.
function engineCom(res, resReparo) {
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
    assert.ok(e.chamadas.length <= 2, 'no máximo UM reparo: nunca vira laço nem reinicia do zero');
    const r = e.chamadas.length === 1 ? res : (resReparo || res);
    if (r instanceof Error) throw r;
    return r;
  };
  return e;
}

test('prosa final sem JSON, e reparo que também volta em prosa: mesma falha de antes', async () => {
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
  assert.equal(e.chamadas.length, 2, 'a sessão e UM reparo');
  assert.ok(e.chamadas[1].opts.extraArgs.includes('--resume'), 'o reparo é a mesma conversa, não uma revisão nova');
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.pending.length, 0, 'não fabrica veredito nem envelope incompleto');
  assert.equal(e.decisions.resolved.length, 0);
  assert.equal(e.activeReviews.size, 0, 'a sessão encerra pelo finally existente');
});

test('resultado ausente estaciona no caminho real do worker e não arma retry de rede', async () => {
  const e = engineCom(resposta(PROGRESSO));
  await e.runOneHeadless({ ...PR }, 'conta');
  assert.equal(e.chamadas.length, 2, 'tentou o reparo uma vez e parou');
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.equal(e.retryAfterNet.has(PR.key), false);
  assert.equal(e.queue.some(pr => pr.key === PR.key), true, 'o card continua disponível para ação manual');
  assert.equal(e.postados.length, 0);
  const detalhes = e.parkedMotivos[PR.key];
  assert.match(detalhes.motivo, /revisão não concluída/);
});

test('envelope REPARADO passa pelos mesmos gates: incompleto não vira aprovação', async () => {
  // é o ponto da decisão revista. O reparo devolve o envelope mais perigoso possível
  // (veredito approve com payload APPROVE) declarando que a verificação não fechou, que
  // é justamente o que uma sessão morta no meio deveria responder. O gate segura.
  const e = engineCom(resposta(PROGRESSO), resposta(JSON.stringify({ ...ENVELOPE,
    analysisStatus: 'incomplete', payloads: { approve: { event: 'APPROVE', body: 'ok' } } })));
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas.length, 2);
  assert.equal(e.postados.length, 0, 'reparo não é atalho: análise incompleta não posta');
  assert.equal(e.decisions.pending.length, 1, 'vira pendência de verdade em vez de sessão perdida');
  assert.equal(e.decisions.pending[0].analysisStatus, 'incomplete');
  assert.equal(e.decisions.pending[0].sessionId, SID);
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
