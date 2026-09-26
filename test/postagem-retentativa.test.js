// Retentativa da postagem da revisão automática (18/09/2026).
//
// Caso real: com a coordenação ligada, a revisão automática gravava a intenção de postar
// antes de existir o recibo do head, a regra do banco recusava, e o PR caía em "falha
// técnica ao postar" sem nenhuma retentativa: a mensagem não era classificada como
// passageira, então o reenvio dos ciclos seguintes (retryFailedPosts) nem armava. O clique
// depois passava, porque o recibo já estava lá.
//
// Duas camadas: até 3 retentativas com 2 s entre elas dentro da própria sessão, e, se
// ainda assim não sair, o reenvio dos ciclos seguintes armado. Só para recusa que NÃO
// chegou à rede; incerto, posse e commit novo nunca repetem.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-retentativa-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const io = (await import('../lib/io.js')).default;
const arbitragem = (await import('../lib/engine/postagem-arbitragem.js')).default;
const { TEMPOS } = await import('../lib/constants.js');

const esperas = [];
const esperarOriginal = arbitragem.retentativa.esperar;
arbitragem.retentativa.esperar = async (ms) => { esperas.push(ms); };

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
const runOriginal = io.run;
io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
after(() => {
  fanout.prMetrics = prMetricsOriginal;
  arbitragem.retentativa.esperar = esperarOriginal;
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const prDe = (key) => ({ key, repo: key.split('#')[0], number: Number(key.split('#')[1]), url: `https://github.com/${key.replace('#', '/pull/')}`, author: 'dev', requested: true, account: 'eu' });

function envelope(tipo) {
  if (tipo === 'approve') {
    return { analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [], reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.' } } };
  }
  return { analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, verdict: 'request_changes', decision: 'needs_decision', cardMet: true, reasons: ['bloqueio real'], reportMarkdown: 'relatório', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } } };
}

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, completos: [] };
  h.valido = () => true;
  h.validoPor = () => true;
  h.onLost = () => { };
  h.complete = async (op) => { h.completos.push(op); h.done = true; return { ok: true }; };
  h.abort = async () => { h.done = true; };
  return h;
}

function motor(post, handle, tipo) {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokenFor = () => 'tok-eu';
  e.isMuted = () => false;
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.prState = async () => 'OPEN';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => null;
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = () => { };
  e.myReviewsWithTime = async () => [];
  e.chamadas = [];
  // lista = uma resposta por chamada, e a última se repete; objeto = sempre a mesma
  const fila = Array.isArray(post) ? [...post] : [post];
  e.postReview = async (pr, payload, opcoes) => {
    e.chamadas.push({ payload, opcoes });
    if (fila.length > 1) return fila.shift();
    return fila[0];
  };
  e.runClaudeStream = async (prompt, opts) => {
    if (typeof opts.onAdmitted === 'function') await opts.onAdmitted(null);
    return { text: JSON.stringify({ result: JSON.stringify(envelope(tipo)) }), sessionId: 's1', coordination: handle };
  };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  return e;
}


const REGISTRO = { ok: false, estado: 'nao_enviada', motivo: 'registro-indisponivel', attempted: false, reviewId: '', error: 'não deu para gravar a intenção de postar no banco compartilhado, então nada foi postado' };
const INCERTA = { ok: false, estado: 'enviando', motivo: 'resultado-incerto', attempted: true, reviewId: '', error: 'uma postagem deste commit pode ter chegado ao GitHub e ainda não foi conferida; não posto de novo até conferir (gh: HTTP 502)' };
const ALHEIA = { ok: false, estado: 'nao_enviada', motivo: 'posse-alheia', attempted: false, reviewId: '', error: 'outro aparelho está com este PR agora, então nada foi postado' };
const HEAD_MUDOU = { ok: false, estado: 'nao_enviada', motivo: 'head-mudou', attempted: false, reviewId: '', error: 'chegou commit novo depois da decisão, então nada foi postado para o commit novo' };
const OK = { ok: true, estado: 'confirmada' };

for (const tipo of ['approve', 'request_changes']) {
  test(`${tipo}: registro indisponível duas vezes e depois sai; espera 2 s entre as tentativas`, async () => {
    esperas.length = 0;
    const e = motor([REGISTRO, REGISTRO, OK], handleFalso(), tipo);
    await e.runHeadlessReview(prDe('o/r#10'));
    assert.equal(e.chamadas.length, 3);
    assert.deepEqual(esperas, [TEMPOS.POSTAGEM_RETENTATIVA_MS, TEMPOS.POSTAGEM_RETENTATIVA_MS]);
    assert.equal(TEMPOS.POSTAGEM_RETENTATIVA_MS, 2000);
    assert.equal(e.decisions.pending.some((d) => d.key === 'o/r#10'), false, 'saiu, então não sobra pendência');
  });

  test(`${tipo}: no máximo 3 retentativas; depois vira pendência com o reenvio dos ciclos armado`, async () => {
    esperas.length = 0;
    const e = motor(REGISTRO, handleFalso(), tipo);
    await e.runHeadlessReview(prDe('o/r#11'));
    assert.equal(e.chamadas.length, 4, 'a primeira e mais 3');
    assert.equal(esperas.length, 3);
    const item = e.decisions.pending.find((d) => d.key === 'o/r#11');
    assert.ok(item);
    assert.equal(item.postRetry && item.postRetry.event, tipo, 'o retryFailedPosts reenvia nos próximos ciclos');
  });
}

test('resultado incerto nunca repete: pode ter chegado ao GitHub', async () => {
  esperas.length = 0;
  const e = motor(INCERTA, handleFalso(), 'approve');
  await e.runHeadlessReview(prDe('o/r#12'));
  assert.equal(e.chamadas.length, 1);
  assert.equal(esperas.length, 0);
});

test('posse de outro aparelho e commit novo não repetem nem armam reenvio', async () => {
  for (const [n, falha] of [[13, ALHEIA], [14, HEAD_MUDOU]]) {
    esperas.length = 0;
    const e = motor(falha, handleFalso(), 'request_changes');
    await e.runHeadlessReview(prDe(`o/r#${n}`));
    assert.equal(e.chamadas.length, 1, falha.motivo);
    assert.equal(esperas.length, 0, falha.motivo);
    const item = e.decisions.pending.find((d) => d.key === `o/r#${n}`);
    assert.equal(item && item.postRetry, null, falha.motivo);
  }
});

test('falhaPassageira: só recusa que não chegou à rede e cuja causa passa sozinha', () => {
  assert.equal(arbitragem.falhaPassageira(REGISTRO), true);
  assert.equal(arbitragem.falhaPassageira({ ...REGISTRO, motivo: 'estado-desconhecido' }), true);
  assert.equal(arbitragem.falhaPassageira({ ...REGISTRO, attempted: true }), false);
  assert.equal(arbitragem.falhaPassageira(INCERTA), false);
  assert.equal(arbitragem.falhaPassageira(ALHEIA), false);
  assert.equal(arbitragem.falhaPassageira(HEAD_MUDOU), false);
  assert.equal(arbitragem.falhaPassageira(OK), false);
  assert.equal(arbitragem.falhaPassageira(null), false);
});

test('lease que vence entre as tentativas encerra como perda de coordenação, sem postar de novo', async () => {
  esperas.length = 0;
  const h = handleFalso();
  const e = motor(REGISTRO, h, 'approve');
  const postar = e.postReview;
  e.postReview = async (...args) => {
    const r = await postar(...args);
    h.valido = () => false; // venceu durante a espera de 2 s
    return r;
  };
  await assert.rejects(e.runHeadlessReview(prDe('o/r#15')), (err) => err.coordenacao === 'perdido');
  assert.equal(e.chamadas.length, 1, 'sem lease, a segunda tentativa não sai');
});
