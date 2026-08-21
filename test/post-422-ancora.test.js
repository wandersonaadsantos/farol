// O 422 opaco do biud-esg#224 (21/08/2026): a revisão terminou, decidiu aprovar, o gate
// liberou, e o APPROVE morreu num "gh: Unprocessable Entity (HTTP 422)". Oito palavras que
// não dizem NADA, no log e na tela, e o clique em Aprovar repetia a mesma recusa pra sempre
// (o payload guardado reenvia a mesma âncora).
//
// Duas coisas estavam erradas, e este arquivo trava as duas:
//
// 1. A MENSAGEM. O `gh api` escreve o corpo JSON inteiro no STDOUT (é lá que mora o
//    `errors[]`, a única parte que diz QUAL campo o GitHub recusou) e só a linha curta no
//    stderr. O postReview fazia `r.stderr || r.stdout`, ou seja, o stderr sempre vencia e o
//    detalhe ia pro lixo. Sem ele não dá pra diagnosticar 422 nenhum.
//
// 2. A ÂNCORA. O autor empurrou b8722a3 dois minutos antes do POST, e o review saiu
//    ancorado (G1) no head que a sessão tinha lido, 3cf42b3. Postar um review sobre um head
//    que já andou é escolher entre duas coisas erradas: com a âncora o GitHub recusa, e sem
//    ela o texto sai carimbado num código que ninguém leu (e ainda convence o staleForReview
//    de que o head novo foi revisado, matando o round 2 — o buraco do #742). A saída é não
//    postar e dizer isso em português, nos DOIS caminhos (automático e clique).
//
// Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-422-ancora-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// espião no lugar do run, instalado antes do primeiro require de decision
// (mesma técnica do decision-envelope.test.js: a desestruturação captura a referência no load)
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  io.run = runReal;
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

const HEAD_LIDO = '3cf42b3ea27dbc554d76672efcd56d06fa98d669';
const HEAD_NOVO = 'b8722a34da5fadb9fda260565f166c977eb5d992';

const PR = {
  key: 'biudtech/biud-esg#224', repo: 'biudtech/biud-esg', number: 224,
  url: 'https://github.com/biudtech/biud-esg/pull/224',
  requested: true, title: 'feat(reports): separa leitura e escrita', author: 'thiago'
};

const APPROVE = { event: 'APPROVE', body: 'A matriz de permissões fecha.', comments: [] };

// resposta real do GitHub pro endpoint de review: a mensagem genérica no stderr, o
// motivo de verdade no corpo que sai pelo stdout
function recusa422(detalhe) {
  return {
    ok: false, code: 1,
    stdout: JSON.stringify({ message: 'Unprocessable Entity', errors: [detalhe], documentation_url: 'https://docs.github.com/rest' }),
    stderr: 'gh: Unprocessable Entity (HTTP 422)'
  };
}

function enginePostador() {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'trabalho';
  e.tokenFor = () => 'token-falso';
  e.refreshTokens = async () => { };
  e.token = 'token-falso';
  e.ghEnv = () => ({});
  return e;
}

// o payload tem que ser lido NA HORA da chamada: o postReview apaga o arquivo temporário
// no finally, e as duas tentativas reusam o mesmo caminho
function payloadEntregue(args) {
  const file = args[args.indexOf('--input') + 1];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* ---------- 1. a mensagem: o detalhe do GitHub não pode ir pro lixo ---------- */

test('erro do gh carrega o errors[] do corpo, não só a linha curta do stderr', async () => {
  const e = enginePostador();
  runImpl = async () => recusa422('Variable commitOID of type GitObjectID was provided invalid value');
  const r = await e.postReview(PR, { ...APPROVE, commit_id: HEAD_LIDO });
  assert.equal(r.ok, false);
  assert.match(r.error, /HTTP 422/, 'a linha curta continua lá');
  assert.match(r.error, /commitOID/, 'e o motivo de verdade, que só existe no stdout, entra junto');
});

test('errors[] em objeto (o formato de validação do GitHub) vira texto legível', async () => {
  const e = enginePostador();
  runImpl = async () => ({
    ok: false, code: 1,
    stdout: JSON.stringify({
      message: 'Unprocessable Entity',
      errors: [{ resource: 'PullRequestReview', field: 'user_id', code: 'custom', message: 'Can not approve your own pull request' }]
    }),
    stderr: 'gh: Unprocessable Entity (HTTP 422)'
  });
  const r = await e.postReview(PR, APPROVE);
  assert.match(r.error, /Can not approve your own pull request/, 'quem lê o log precisa saber que o problema é o autor');
  assert.match(r.error, /user_id/, 'e qual campo o GitHub apontou');
});

test('corpo sem JSON (rede, gateway) não quebra nem inventa detalhe', async () => {
  const e = enginePostador();
  runImpl = async () => ({ ok: false, code: 1, stdout: '<html>502</html>', stderr: 'gh: alguma coisa (HTTP 502)' });
  const r = await e.postReview(PR, APPROVE);
  assert.equal(r.error, 'gh: alguma coisa (HTTP 502)', 'sem errors[] a mensagem fica exatamente a de antes');
});

/* ---------- 2. o recuo da âncora quando o 422 chega sem comentário inline ---------- */

test('422 num review SEM inline recua a âncora e reposta uma vez', async () => {
  const e = enginePostador();
  const enviados = [];
  runImpl = async (cmd, args) => {
    enviados.push(payloadEntregue(args));
    return enviados.length === 1
      ? recusa422('Variable commitOID of type GitObjectID was provided invalid value')
      : { ok: true, code: 0, stdout: '{}', stderr: '' };
  };
  const r = await e.postReview(PR, { ...APPROVE, commit_id: HEAD_LIDO });
  assert.equal(r.ok, true, 'o review não pode morrer por causa da âncora');
  assert.equal(enviados.length, 2, 'exatamente uma retentativa');
  assert.equal(enviados[0].commit_id, HEAD_LIDO, '1ª tentativa vai ancorada, como manda o G1');
  assert.equal(enviados[1].commit_id, undefined, 'a 2ª larga a âncora, que é a única precisão que dá pra recuar aqui');
  assert.equal(enviados[1].body, APPROVE.body, 'e o texto que você leu vai intacto');
});

test('422 sem âncora e sem inline NÃO retenta (não existe degrau pra recuar)', async () => {
  const e = enginePostador();
  let n = 0;
  runImpl = async () => { n++; return recusa422('alguma outra coisa'); };
  const r = await e.postReview(PR, APPROVE);
  assert.equal(r.ok, false);
  assert.equal(n, 1, 'insistir no mesmo payload só duplicaria a recusa');
});

test('erro que não é 422 nunca vira retentativa', async () => {
  const e = enginePostador();
  let n = 0;
  runImpl = async () => { n++; return { ok: false, code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }; };
  const r = await e.postReview(PR, { ...APPROVE, commit_id: HEAD_LIDO });
  assert.equal(r.ok, false);
  assert.equal(n, 1);
});

/* ---------- 3. head que andou durante a sessão: os dois caminhos recusam ---------- */

function engineDeRevisao({ heads, policyApprove = 'approve' }) {
  const e = new Engine();
  const postados = [];
  const fila = [...heads];
  e.log = () => { };
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => policyApprove;
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.headSha = async () => (fila.length > 1 ? fila.shift() : fila[0]);
  e.myReviewsWithTime = async () => [];
  e.postReview = async (pr, payload) => { postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      result: JSON.stringify({
        analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
        reportMarkdown: 'relatório',
        payloads: { approve: { event: 'APPROVE', body: 'A matriz de permissões fecha.' } }
      })
    }), sessionId: 's1'
  });
  e.postados = postados;
  return e;
}

test('automático: commit novo durante a sessão segura a postagem e diz por quê', async () => {
  const e = engineDeRevisao({ heads: [HEAD_LIDO, HEAD_NOVO] });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 0, 'review sobre o head anterior não vai pro PR sozinho');
  const item = e.decisions.pending[0];
  assert.ok(item, 'o achado não some: vira pendência');
  assert.match(item.reasons.map(r => r.text).join(' '), /commit novo/i, 'e a tela diz o motivo em português');
  assert.equal(item.reasons.find(r => /commit novo/i.test(r.text)).kind, 'gate', 'é regra do app segurando, não falha técnica');
});

test('automático: head parado continua postando (a trava não pode virar freio de mão)', async () => {
  const e = engineDeRevisao({ heads: [HEAD_LIDO, HEAD_LIDO] });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 1, 'o caminho feliz segue igual');
  assert.equal(e.postados[0].commit_id, HEAD_LIDO, 'ancorado no head da sessão, como o G1 manda');
});

test('automático: head desconhecido (rede, token) degrada pro comportamento antigo', async () => {
  const e = engineDeRevisao({ heads: [HEAD_LIDO, ''] });
  await e.runHeadlessReview(PR);
  assert.equal(e.postados.length, 1, 'falta de dado não pode ser lida como "head novo"');
});

test('clique: Aprovar num card cujo PR já andou recusa com saída, em vez de repetir o 422', async () => {
  const e = engineDeRevisao({ heads: [HEAD_NOVO] });
  e.decisions = {
    pending: [{
      id: 'd1', createdAt: Date.now(), status: 'pending', verdict: 'approve',
      key: PR.key, pr: { ...PR }, headSha: HEAD_LIDO,
      payloads: { approve: { event: 'APPROVE', body: 'A matriz de permissões fecha.' } }
    }],
    resolved: []
  };
  const r = await e.decide('d1', 'approve');
  assert.equal(r.ok, false, 'o clique não posta review sobre código que ninguém leu');
  assert.equal(e.postados.length, 0);
  assert.equal(e.decisions.pending.length, 1, 'a pendência fica na mesa, não some sem decisão');
  assert.match(e.decisions.pending[0].blockedReason || '', /commit novo/i, 'e o card passa a explicar o bloqueio');
});

test('clique: head igual ao da sessão continua postando ancorado', async () => {
  const e = engineDeRevisao({ heads: [HEAD_LIDO] });
  e.decisions = {
    pending: [{
      id: 'd1', createdAt: Date.now(), status: 'pending', verdict: 'approve',
      key: PR.key, pr: { ...PR }, headSha: HEAD_LIDO,
      payloads: { approve: { event: 'APPROVE', body: 'A matriz de permissões fecha.' } }
    }],
    resolved: []
  };
  const r = await e.decide('d1', 'approve');
  assert.equal(r.ok, true);
  assert.equal(e.postados.length, 1);
  assert.equal(e.postados[0].commit_id, HEAD_LIDO);
});
