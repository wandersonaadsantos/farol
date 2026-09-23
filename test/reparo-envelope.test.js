// Sessao que trabalha 10 a 15 minutos e termina em PROSA ganha UMA rodada de reparo.
//
// Caso medido no aparelho do Wanderson (state/falhas-sessao.json, 22 e 23/09/2026):
//   biudtech/biud-frontend#1123, sessao de 10m17, devolveu 166 caracteres de texto;
//   biudtech/tenant-company#126, sessao de 14m56, devolveu 97 caracteres.
// As duas passaram por todas as etapas (preparo, leitura, card, verificacao,
// raciocinio) e nao entregaram o envelope. O Farol descartava a sessao inteira e
// estacionava o PR: 25 minutos de sessao paga jogados fora e dois PRs parados.
//
// O reparo pede SO o envelope, na MESMA sessao (--resume), uma unica vez. Ele nao
// revisa de novo e nao pode inventar veredito: o prompt manda responder incomplete /
// needs_decision quando a verificacao nao fechou. Falhou o reparo, estaciona como
// antes, que e o comportamento que protege o gate de postagem.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-reparo-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const reparo = (await import('../lib/engine/reparo-envelope.js')).default;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
after(() => {
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const HEAD = '2187af82d4e9';
const PR = {
  key: 'o/r#1123', repo: 'o/r', number: 1123, url: 'https://github.com/o/r/pull/1123',
  requested: true, title: 'fix: alguma coisa', author: 'alguem'
};
// o texto real da falha de 22/09: prosa curta, sem uma chave sequer
const PROSA = 'Concluí a análise do PR. O diff está correto e não encontrei problemas bloqueantes.';

function envelope() {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'ok' } }
  };
}
const saida = (obj) => JSON.stringify({ result: typeof obj === 'string' ? obj : JSON.stringify(obj) });

function engineCom(respostas) {
  const e = new Engine();
  const chamadas = [];
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => 'wait';
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.log = () => { };
  e.headSha = async () => HEAD;
  e.myReviewsWithTime = async () => [];
  e.postReview = async () => ({ ok: true });
  e.runClaudeStream = async (prompt, opts) => {
    chamadas.push({ prompt, args: (opts && opts.extraArgs) || [] });
    const r = respostas[chamadas.length - 1];
    if (!r) throw new Error('sessão a mais: o reparo não pode virar laço');
    if (r.erro) throw new Error(r.erro);
    return { text: saida(r.texto !== undefined ? r.texto : envelope()), sessionId: 'sid' in r ? r.sid : 's1', blocked: r.blocked };
  };
  e.chamadas = chamadas;
  return e;
}

test('prosa depois da sessão inteira: UM reparo na mesma sessão salva a revisão', async () => {
  const e = engineCom([{ texto: PROSA, sid: 's1' }, { sid: 's1' }]);
  e.approvePolicyFor = () => 'approve';
  await e.runHeadlessReview(PR);
  assert.equal(e.chamadas.length, 2, 'uma sessão de trabalho e um reparo, nada além');
  assert.ok(e.chamadas[1].args.includes('--resume'), 'o reparo continua a MESMA conversa');
  assert.equal(e.chamadas[1].args[e.chamadas[1].args.indexOf('--resume') + 1], 's1');
  const h = e.decisions.resolved[0];
  assert.ok(h, 'a revisão vira decisão em vez de virar falha');
  assert.equal(h.verdict, 'approve');
});

test('o reparo pede SÓ o envelope, e proíbe concluir o que não foi verificado', async () => {
  const p = reparo.PROMPT_REPARO;
  assert.match(p, /apenas o envelope|só o envelope/i);
  assert.match(p, /incomplete/, 'verificação que não fechou tem que sair como incompleta');
  assert.match(p, /needs_decision/, 'e sem veredito automático');
  assert.match(p, /não .*(invente|conclua)/i, 'o reparo não é uma revisão nova');
});

test('reparo que também volta em prosa estaciona, como antes', async () => {
  const e = engineCom([{ texto: PROSA, sid: 's1' }, { texto: 'de novo prosa', sid: 's1' }]);
  await e.runOneHeadless(PR, 'trabalho');
  assert.equal(e.chamadas.length, 2, 'uma tentativa de reparo, nunca duas');
  assert.equal(e.autoReviewParked.has(PR.key), true, 'sem envelope não existe revisão');
  assert.match(e.parkedMotivos[PR.key].motivo, /resultado estruturado/);
});

test('sem sessionId não há o que retomar: nem tenta', async () => {
  const e = engineCom([{ texto: PROSA, sid: null }]);
  await e.runOneHeadless(PR, 'trabalho');
  assert.equal(e.chamadas.length, 1, 'reparo sem sessão seria uma revisão nova disfarçada');
  assert.equal(e.autoReviewParked.has(PR.key), true);
});

test('JSON quebrado ou fora do contrato NÃO ganha reparo (reparar seria fabricar veredito)', async () => {
  const e = engineCom([{ texto: '{"verdict": "approve"', sid: 's1' }]);
  await e.runOneHeadless(PR, 'trabalho');
  assert.equal(e.chamadas.length, 1, 'só a ausência total de envelope é reparável');
  assert.equal(e.autoReviewParked.has(PR.key), true);
});

test('reparo que morre não apaga a falha original: o PR estaciona pelo motivo certo', async () => {
  const e = engineCom([{ texto: PROSA, sid: 's1' }, { erro: 'sessão retornou erro: API Error: 529 Overloaded' }]);
  await e.runOneHeadless(PR, 'trabalho');
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.match(e.parkedMotivos[PR.key].motivo, /resultado estruturado/,
    'quem manda no desfecho é a falha de contrato, não o erro do reparo');
});
