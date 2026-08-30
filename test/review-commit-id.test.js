// G1 da auditoria 15/08/2026: payload sem commit_id faz o GitHub ancorar o
// review no head do momento do POST, não no head que a sessão leu. Estes
// testes travam: normalize aceita/valida o campo, e os três pontos de
// postagem (canAuto, canReject, decide) o propagam.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeReviewPayload } from '../lib/engine/public-review.js';

test('normalizeReviewPayload: commit_id sha válido é preservado', () => {
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [], commit_id: 'a'.repeat(40) });
  assert.equal(r.ok, true);
  assert.equal(r.value.commit_id, 'a'.repeat(40));
});

test('normalizeReviewPayload: commit_id ausente ou vazio fica de fora do payload', () => {
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [] });
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false);
});

test('normalizeReviewPayload: commit_id que não é sha é DESCARTADO (nunca vira erro)', () => {
  // descarta em vez de recusar: um sha torto não pode impedir a postagem de um
  // review válido, apenas volta ao comportamento antigo (GitHub decide o head)
  const r = normalizeReviewPayload({ event: 'APPROVE', body: 'ok', comments: [], commit_id: 'não-é-sha' });
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false);
});

import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-commitid-' + process.pid);

// Apagado no fim. O caminho e derivado do pid e nao de `mkdtemp`, entao ele se
// repete entre rodadas do mesmo processo, mas acumula uma pasta por processo:
// medido em centenas na maquina.
after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});
const { Engine } = await import('../server.js');

// C2 da revisão final da onda 2: o clique posta o payload que a SESSÃO escreveu, e esse
// texto descreve o código de item.headSha. Ancorar no head buscado na hora do clique faz
// o review sair carimbado num head que ninguém leu quando o autor empurrou commit entre a
// análise e o clique; pior, o staleForReview passa a ver o meu review no head novo e
// deixa de armar o round 2, justamente a proteção que o G1 existe pra dar. O head LIDO
// vence; o fresco só cobre pendência antiga, gravada antes de o campo existir.
function engineComPendencia(item) {
  const engine = new Engine();
  const capturado = { payload: null };
  engine.myReviewStates = async () => [];
  engine.postReview = async (pr, payload) => { capturado.payload = payload; return { ok: true }; };
  engine.saveDecisions = () => { };
  engine.writeMemory = () => { };
  engine.pushState = () => { };
  engine.decisions.pending.unshift(item);
  return { engine, capturado };
}

function pendenciaDeClique(extra) {
  return {
    id: 'd1', key: 'acme/repo#1', pr: { repo: 'acme/repo', number: 1, url: 'https://github.com/acme/repo/pull/1' },
    createdAt: Date.now(),
    payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } },
    ...extra
  };
}

test('decide(): o commit_id é o head que a SESSÃO leu', async () => {
  const LIDO = 'a'.repeat(40);
  const { engine, capturado } = engineComPendencia(pendenciaDeClique({ headSha: LIDO }));
  engine.headSha = async () => LIDO;
  const r = await engine.decide('d1', 'approve');
  assert.equal(r.ok, true);
  assert.equal(capturado.payload.commit_id, LIDO, 'a âncora é do head lido, não do que o GitHub escolher no POST');
});

// Atualizado na v2.51.2 (biud-esg#224): a regra "o head LIDO vence" continua de pé, o que
// mudou é o desfecho quando o autor empurrou commit entre a análise e o clique. Postar
// ancorado no head velho o GitHub recusa (422 genérico, e o clique repetia a recusa pra
// sempre); postar sem âncora carimbaria o review num código que ninguém leu. Então o
// clique não posta: fica na mesa, com o motivo escrito no card. Detalhe em
// test/post-422-ancora.test.js.
test('decide(): autor empurrou commit entre a análise e o clique, então nada é postado', async () => {
  const LIDO = 'a'.repeat(40);
  const { engine, capturado } = engineComPendencia(pendenciaDeClique({ headSha: LIDO }));
  engine.headSha = async () => 'b'.repeat(40);
  const r = await engine.decide('d1', 'approve');
  assert.equal(r.ok, false);
  assert.equal(capturado.payload, null, 'review de head velho não vai pro PR nem por clique');
  assert.equal(engine.decisions.pending.length, 1, 'a pendência fica na mesa');
});

test('decide(): pendência SEM headSha (gravada antes do campo) cai no head buscado no clique', async () => {
  const { engine, capturado } = engineComPendencia(pendenciaDeClique({}));
  engine.headSha = async () => 'f'.repeat(40);
  const r = await engine.decide('d1', 'approve');
  assert.equal(r.ok, true);
  assert.equal(capturado.payload.commit_id, 'f'.repeat(40), 'sem head lido, âncora nenhuma é pior que a fresca');
});

const { inlineFallbackPayload } = await import('../lib/engine/decision.js');

// O 422 do GitHub não distingue âncora de LINHA inválida de âncora de HEAD inválida. Se o
// retry reenviasse o mesmo commit_id, um 422 causado pelo próprio sha falharia idêntico e o
// review não sairia de jeito nenhum. O fallback larga a âncora de propósito: perde a
// precisão do head (o dedup do ciclo seguinte lê o review como do head novo) e mantém a
// entrega do conteúdo, que é o que ainda dá pra salvar nesse ponto.
test('fallback de inline: o payload regravado NÃO leva commit_id (o 422 pode ser do próprio sha)', () => {
  const fb = inlineFallbackPayload({
    event: 'REQUEST_CHANGES',
    body: 'o redirect não fechou',
    comments: [{ path: 'src/a.js', line: 4, side: 'RIGHT', body: 'aqui' }],
    commit_id: 'a'.repeat(40)
  });
  assert.equal('commit_id' in fb, false, 'reenviar o mesmo sha repetiria o 422');
  assert.deepEqual(fb.comments, [], 'os inlines recuam pro corpo');
  assert.match(fb.body, /src\/a\.js:4/, 'o achado não pode se perder no recuo');
});

test('fallback de inline: o payload normalizado do fallback sai sem âncora de head', () => {
  const fb = inlineFallbackPayload({
    event: 'REQUEST_CHANGES', body: 'x',
    comments: [{ path: 'a.js', line: 1, side: 'RIGHT', body: 'y' }],
    commit_id: 'a'.repeat(40)
  });
  const r = normalizeReviewPayload(fb);
  assert.equal(r.ok, true);
  assert.equal('commit_id' in r.value, false, 'é o value do normalize que vira o arquivo do --input');
});

/* ---------- G8: o head conhecido do relançamento cobre o flake do fetch ---------- */
// A re-revisão automática só arma com head conhecido, e o carrega no PR enfileirado
// (knownHead). Se o gh falhar no início da sessão, cair pro headSha vazio degradaria o
// dedup pro comportamento antigo e o round 2 morreria como already_reviewed, com a
// âncora do relançamento já gasta. O fallback também ancora o review postado.
const fanout = (await import('../lib/engine/fanout.js')).default;
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
after(() => { fanout.prMetrics = prMetricsOriginal; });

test('runHeadlessReview usa knownHead quando o fetch do headSha falha', async () => {
  const e = new Engine();
  const KNOWN = 'c'.repeat(40);
  const shasConsultados = [];
  const postados = [];
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => 'wait';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.headSha = async () => { throw new Error('rede'); };
  e.myReviewStates = async (pr, head) => { shasConsultados.push(head); return []; };
  e.postReview = async (pr, payload) => { postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      result: JSON.stringify({
        analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision',
        cardMet: true, reasons: ['o redirect não fechou'], reportMarkdown: 'relatório',
        payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'o redirect não fechou' } }
      })
    }), sessionId: 's1'
  });

  await e.runHeadlessReview({
    key: 'o/r#756', repo: 'o/r', number: 756, url: 'https://github.com/o/r/pull/756',
    requested: true, title: 'fix(auth): fecha o redirect', author: 'dev', knownHead: KNOWN
  });

  assert.deepEqual(shasConsultados, [KNOWN],
    'sem o fallback o dedup consultaria com sha vazio e o round anterior silenciaria este');
  assert.equal(postados.length, 1);
  assert.equal(postados[0].commit_id, KNOWN, 'o fallback também ancora o review postado');
});

// I2 da revisão final: o teste acima cobre o headSha LANÇANDO, e o caminho de produção é
// outro. `ghMod.headSha` passa por `run`, que NUNCA lança (invariante do lib/io.js): gh
// ausente, rede caída ou repo privado devolvem `{ok:false}` e a função entrega ''. Ou seja,
// o fallback real do G8 é o do valor VAZIO, e ele estava sem teste.
test('runHeadlessReview usa knownHead quando o headSha devolve vazio (o caminho real)', async () => {
  const e = new Engine();
  const KNOWN = 'c'.repeat(40);
  const shasConsultados = [];
  const postados = [];
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => 'wait';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.headSha = async () => '';   // run() não lança: falha vira string vazia
  e.myReviewStates = async (pr, head) => { shasConsultados.push(head); return []; };
  e.postReview = async (pr, payload) => { postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      result: JSON.stringify({
        analysisStatus: 'complete', verdict: 'request_changes', decision: 'needs_decision',
        cardMet: true, reasons: ['o redirect não fechou'], reportMarkdown: 'relatório',
        payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'o redirect não fechou' } }
      })
    }), sessionId: 's1'
  });

  await e.runHeadlessReview({
    key: 'o/r#757', repo: 'o/r', number: 757, url: 'https://github.com/o/r/pull/757',
    requested: true, title: 'fix(auth): fecha o redirect', author: 'dev', knownHead: KNOWN
  });

  assert.deepEqual(shasConsultados, [KNOWN],
    'head vazio é falha de leitura, não prova de que não há head: o knownHead vence');
  assert.equal(postados.length, 1);
  assert.equal(postados[0].commit_id, KNOWN);
});
