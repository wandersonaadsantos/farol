// A revisão automática com a arbitragem de postagem: passa o handle da sessão ao funil,
// trata posse perdida como perda de coordenação e não como falha de rede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-auto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const io = (await import('../lib/io.js')).default;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
const runOriginal = io.run;
io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
after(() => {
  fanout.prMetrics = prMetricsOriginal;
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const prDe = (key) => ({ key, repo: key.split('#')[0], number: Number(key.split('#')[1]), url: `https://github.com/${key.replace('#', '/pull/')}`, author: 'dev', requested: true, account: 'eu' });

function envelope(tipo) {
  if (tipo === 'approve') {
    return { analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [], reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.' } } };
  }
  return { analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'request_changes', decision: 'needs_decision', cardMet: true, reasons: ['bloqueio real'], reportMarkdown: 'relatório', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } } };
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
  e.postReview = async (pr, payload, opcoes) => { e.chamadas.push({ payload, opcoes }); return post; };
  e.runClaudeStream = async (prompt, opts) => {
    if (typeof opts.onAdmitted === 'function') await opts.onAdmitted(null);
    return { text: JSON.stringify({ result: JSON.stringify(envelope(tipo)) }), sessionId: 's1', coordination: handle };
  };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  return e;
}

const POSSE_PERDIDA = { ok: false, estado: 'nao_enviada', motivo: 'posse-perdida', attempted: false, reviewId: '', error: 'a posse deste PR venceu antes do envio, então nada foi postado' };
const INCERTA = { ok: false, estado: 'enviando', motivo: 'resultado-incerto', attempted: true, reviewId: '', error: 'uma postagem deste commit pode ter chegado ao GitHub e ainda não foi conferida; não posto de novo até conferir (gh: HTTP 502)' };

for (const tipo of ['approve', 'request_changes']) {
  test(`${tipo}: o funil recebe via revisao e o handle da sessão`, async () => {
    const h = handleFalso();
    const e = motor({ ok: true, estado: 'confirmada' }, h, tipo);
    await e.runHeadlessReview(prDe('o/r#1'));
    assert.equal(e.chamadas.length, 1);
    assert.equal(e.chamadas[0].opcoes.via, 'revisao');
    assert.equal(e.chamadas[0].opcoes.handle, h);
  });

  test(`${tipo}: posse perdida no funil sobe como perda de coordenação`, async () => {
    const e = motor(POSSE_PERDIDA, handleFalso(), tipo);
    await assert.rejects(e.runHeadlessReview(prDe('o/r#2')), (err) => err.coordenacao === 'perdido');
    assert.equal(e.decisions.pending.some((d) => d.key === 'o/r#2'), false);
  });
}

test('postagem incerta: vira pendência com o motivo, sem lançar', async () => {
  const e = motor(INCERTA, handleFalso(), 'approve');
  await e.runHeadlessReview(prDe('o/r#3'));
  const item = e.decisions.pending.find((d) => d.key === 'o/r#3');
  assert.ok(item);
  assert.ok((item.reasons || []).some((r) => r.kind === 'infra' && /pode ter chegado ao GitHub/.test(r.text)));
});

// Desde 01/10/2026 lacuna de cobertura e contestação não seguram a reprovação automática: o
// bloqueio é postado e o card registra o que a leitura não cobriu (nada disso vai ao PR).
test('request_changes com lacuna de cobertura e contestação: posta, e o card registra as duas', async () => {
  const e = motor({ ok: true, estado: 'confirmada' }, handleFalso(), 'request_changes');
  const base = envelope('request_changes');
  const comLacuna = {
    ...base,
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] },
    contested: [{ source: 'Sonar', claim: 'y', label: 'pre_existente', evidence: 'diff vazio em services/' }],
  };
  e.runClaudeStream = async (prompt, opts) => {
    if (typeof opts.onAdmitted === 'function') await opts.onAdmitted(null);
    return { text: JSON.stringify({ result: JSON.stringify(comLacuna) }), sessionId: 's1', coordination: handleFalso() };
  };
  await e.runHeadlessReview(prDe('o/r#7'));
  assert.equal(e.chamadas.length, 1, 'o REQUEST_CHANGES foi postado');
  assert.equal(e.chamadas[0].payload.event, 'REQUEST_CHANGES');
  assert.equal(e.decisions.pending.some((d) => d.key === 'o/r#7'), false, 'não foi para a mesa');
  const item = e.decisions.resolved.find((d) => d.key === 'o/r#7');
  assert.equal(item.status, 'auto_rejected');
  const textos = (item.reasons || []).map((r) => r.text).join(' | ');
  assert.match(textos, /a reprovação sai com a cobertura da leitura incompleta/);
  assert.match(textos, /a reprovação sai com 1 contestação/);
  assert.ok(!/então não posto sozinho/.test(textos), 'não diz que deixou de postar o que postou');
  assert.ok(!/cobertura/.test(e.chamadas[0].payload.body), 'a lacuna não vai para o corpo público');
});
