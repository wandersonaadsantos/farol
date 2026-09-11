// Os outros chamadores de runClaudeStream com a coordenação entre aparelhos ligada
// (seção "Contratos dos chamadores" do contrato da sincronização):
//   - autoanálise ('self'): bloqueio vira toast e NÃO grava registro; desfecho grava o
//     recibo not_applicable depois de salvar; análise descartada (head andou) e sessão
//     sem desfecho devolvem o lease;
//   - pushback ('pushback'): o marcador é a versão material; recibo de outro aparelho
//     vira { deduped } e o scan avança o marcador sem gastar sessão;
//   - chat e ferramenta declaram o tipo ('chat'/'tool'), que o gate deixa passar sem
//     coordenar (allowlist fechada: sem o tipo, a sessão seria recusada).
//
// Engine real com FAROL_HOME temporário (server.js alcança lib/paths.js, então await
// import); gh roteado por io.run e sessão stubada na instância, como em
// test/self-analysis-evidencia.test.js e test/reentrancy.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-callers-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let heads = [];
io.run = async (cmd, args) => {
  const sub = (args || []).join(' ');
  if (sub.includes('headRefOid')) return { ok: true, stdout: heads.length > 1 ? heads.shift() : (heads[0] || ''), stderr: '' };
  if (sub.includes('/files')) return { ok: true, stdout: '[]', stderr: '' };
  return { ok: true, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { textoBloqueio } = await import('../lib/format.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const SHA = 'a'.repeat(40);
const OUTRO = 'b'.repeat(40);
beforeEach(() => { heads = [SHA]; });

const PR = { key: 'acme/app#42', repo: 'acme/app', number: 42, url: 'https://github.com/acme/app/pull/42', title: 'PR meu', author: 'eu', headSha: SHA };
const ENVELOPE = JSON.stringify({
  verdict: 'approvable', approvable: true, cardMet: true,
  blockers: [], tips: [], coverageLimitations: [], reportMarkdown: '# ok', summary: 'ok',
});

function handleFalso() {
  const h = { noop: false, leaseId: 'L1', attemptId: '', lost: false, done: false, completos: [], abortos: 0 };
  h.onLost = () => { };
  h.complete = async (op) => { h.completos.push(op); h.done = true; return { ok: true }; };
  h.abort = async () => { h.abortos++; h.done = true; };
  return h;
}

function motor(resposta) {
  const e = new Engine();
  e.token = 'x';
  e.tokens = { eu: 'x' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.salvos = 0;
  e.saveSelfAnalyses = () => { e.salvos++; };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  e.opts = [];
  e.runClaudeStream = async (prompt, opts) => { e.opts.push(opts); return typeof resposta === 'function' ? resposta(opts) : resposta; };
  return e;
}

const bloqueio = (reason, detail = {}) => ({ blocked: true, coordination: { admitted: false, reason, detail }, text: '', sessionId: null });

/* ---------- autoanálise ---------- */

test('autoanálise manda operationKind self e o head lido como versão material', async () => {
  const e = motor(bloqueio('alheio'));
  await e.runSelfAnalysis({ ...PR });
  const op = e.opts[0];
  assert.equal(op.operationKind, 'self');
  assert.deepEqual(op.coordination, {
    prKey: PR.key, account: 'eu', materialVersion: SHA, headSha: SHA, contaRodada: false, manual: true,
    semCoordenacao: false, ignorarRecibo: false,
    pr: { key: PR.key, url: PR.url, repo: PR.repo, number: PR.number, author: PR.author, account: 'eu' },
  });
});

test('autoanálise bloqueada: toast com o motivo e nenhum registro gravado', async () => {
  const adm = { admitted: false, reason: 'recibo', detail: { deviceName: 'notebook' } };
  const e = motor({ blocked: true, coordination: adm, text: '', sessionId: null });
  await e.runSelfAnalysis({ ...PR });
  assert.equal(e.selfAnalyses[PR.key], undefined, 'bloqueio não vira análise');
  assert.equal(e.salvos, 0);
  assert.ok(e.toasts.some((t) => t.kind === 'info' && t.text === textoBloqueio(PR.key, adm)));
  assert.equal(e.activeReviews.size, 0, 'a sessão some da tela');
});

test('autoanálise concluída grava o recibo not_applicable depois de salvar o registro', async () => {
  const h = handleFalso();
  const e = motor({ text: ENVELOPE, sessionId: 's1', coordination: h });
  const ordem = [];
  e.saveSelfAnalyses = () => { ordem.push('salvou'); };
  const complete = h.complete;
  h.complete = async (op) => { ordem.push('recibo'); return complete(op); };
  await e.runSelfAnalysis({ ...PR });
  assert.ok(e.selfAnalyses[PR.key], 'registro gravado');
  assert.deepEqual(h.completos, [{ publicationState: 'not_applicable' }]);
  assert.deepEqual(ordem, ['salvou', 'recibo']);
  assert.equal(h.abortos, 0);
});

test('autoanálise descartada (head andou) devolve o lease sem recibo', async () => {
  heads = [SHA, OUTRO];
  const h = handleFalso();
  const e = motor({ text: ENVELOPE, sessionId: 's1', coordination: h });
  await e.runSelfAnalysis({ ...PR });
  assert.equal(e.selfAnalyses[PR.key], undefined);
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

test('autoanálise sem envelope válido devolve o lease no finally', async () => {
  const h = handleFalso();
  const e = motor({ text: 'prosa sem objeto nenhum', sessionId: 's1', coordination: h });
  await assert.rejects(e.runSelfAnalysis({ ...PR }));
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

/* ---------- pushback ---------- */

const PB_OK = JSON.stringify({ isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' });

test('classifyPushback manda operationKind pushback com o marcador como versão material', async () => {
  const h = handleFalso();
  const e = motor({ text: PB_OK, sessionId: 's1', coordination: h });
  const pr = { key: 'o/r#2', repo: 'o/r', number: 2, url: 'https://github.com/o/r/pull/2', author: 'alice', account: 'eu' };
  const cls = await e.classifyPushback(pr, '2026-09-01T10:00:00Z');
  assert.equal(cls.outcome, 'we_right');
  const op = e.opts[0];
  assert.equal(op.operationKind, 'pushback');
  assert.equal(op.coordination.materialVersion, '2026-09-01T10:00:00Z');
  assert.equal(op.coordination.headSha, '');
  assert.equal(op.coordination.manual, false);
  assert.equal(op.coordination.contaRodada, false);
  assert.equal(op.coordination.prKey, 'o/r#2');
  // D14: o recibo não sai aqui. A classificação devolve o handle e quem o fecha é o
  // scanPushbacks, depois de gravar o marcador e o pushback no disco deste aparelho.
  assert.deepEqual(h.completos, [], 'o recibo é a última escrita, não a primeira');
  assert.equal(cls.coord, h, 'o handle volta para quem persiste o estado local');
});

// D14 na ordem completa: sem ela, um processo morto entre o recibo e o save local
// deixava o recibo de pé e o registro ausente, e o ciclo seguinte via a classificação
// deduplicada, avançava o marcador e perdia o pushback para sempre.
test('scanPushbacks grava o recibo do pushback DEPOIS do marcador e do registro local', async () => {
  const e = motor(null);
  e.decisions = { pending: [], resolved: [{ key: 'o/r#5', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra'], resolvedAt: 1 }] };
  e.panorama = [{ key: 'o/r#5', updatedAt: '2026-09-01T12:00:00Z', author: 'alice' }];
  e.pushbackScanned = {};
  e.pushbacks = {};
  e.config.autoPushback = true;
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  const ordem = [];
  const h = handleFalso();
  const completeReal = h.complete.bind(h);
  h.complete = async (o) => { ordem.push('recibo'); return completeReal(o); };
  e.savePushbackScanned = () => ordem.push('marcador');
  e.savePushbacks = () => ordem.push('pushback');
  e.detectAuthorPushback = async () => ({ marker: '2026-09-01T11:00:00Z', hadActivity: true });
  e.classifyPushback = async () => ({ isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x', coord: h });
  await e.scanPushbacks();
  assert.deepEqual(ordem, ['marcador', 'pushback', 'recibo'], 'o recibo é a ÚLTIMA escrita');
  assert.deepEqual(h.completos, [{ publicationState: 'not_applicable' }]);
  assert.equal(e.pushbacks['o/r#5'].outcome, 'we_right');
});

test('classifyPushback: recibo de outro aparelho vira deduped; outro bloqueio vira null', async () => {
  const pr = { key: 'o/r#3', url: 'https://github.com/o/r/pull/3', author: 'alice' };
  assert.deepEqual(await motor(bloqueio('recibo')).classifyPushback(pr, 'm'), { deduped: true });
  assert.equal(await motor(bloqueio('alheio')).classifyPushback(pr, 'm'), null);
  assert.equal(await motor(bloqueio('indisponivel')).classifyPushback(pr, 'm'), null);
});

test('classifyPushback sem JSON devolve null e o lease', async () => {
  const h = handleFalso();
  const e = motor({ text: 'nada aqui', sessionId: 's1', coordination: h });
  assert.equal(await e.classifyPushback({ key: 'o/r#4', url: 'u', author: 'a' }, 'm'), null);
  assert.equal(h.completos.length, 0);
  assert.equal(h.abortos, 1);
});

test('scanPushbacks: classificação deduplicada avança o marcador sem gravar pushback', async () => {
  const e = motor(null);
  e.decisions = { pending: [], resolved: [{ key: 'o/r#2', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra'], resolvedAt: 1 }] };
  e.panorama = [{ key: 'o/r#2', updatedAt: '2026-09-01T12:00:00Z', author: 'alice' }];
  e.pushbackScanned = {};
  e.pushbacks = {};
  e.config.autoPushback = true;
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  let salvosMarcador = 0;
  e.savePushbackScanned = () => { salvosMarcador++; };
  e.savePushbacks = () => { throw new Error('deduplicado não grava pushback'); };
  e.detectAuthorPushback = async () => ({ marker: '2026-09-01T11:00:00Z', hadActivity: true });
  const chamadas = [];
  e.classifyPushback = async (pr, marker) => { chamadas.push([pr.key, marker]); return { deduped: true }; };
  await e.scanPushbacks();
  assert.deepEqual(chamadas, [['o/r#2', '2026-09-01T11:00:00Z']], 'o marcador chega à classificação');
  assert.equal(e.pushbackScanned['o/r#2'], '2026-09-01T11:00:00Z');
  assert.equal(salvosMarcador, 1);
  assert.deepEqual(e.pushbacks, {});
});

/* ---------- chat e ferramenta ---------- */

function esperar(cond, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

test('chat declara operationKind chat', async () => {
  const e = motor({ text: 'oi', sessionId: 's1' });
  e.saveChats = () => { };
  const r = await e.chatSend(PR.key, PR.url, 'olá');
  assert.equal(r.ok, true);
  await esperar(() => e.chats[PR.key].status === 'idle');
  assert.equal(e.opts[0].operationKind, 'chat');
});

test('ferramenta declara operationKind tool', async () => {
  const e = motor({ text: 'resultado', sessionId: 's1' });
  e.toolPrompt = () => 'prompt de teste';
  const r = await e.launchTool('health');
  assert.equal(r.ok, true);
  await esperar(() => { const run = e.toolRunGet('health'); return run && run.status !== 'running'; });
  assert.equal(e.opts[0].operationKind, 'tool');
});
