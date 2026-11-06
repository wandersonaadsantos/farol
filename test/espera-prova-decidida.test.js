import { criteriaFixture } from './helpers/criteria-fixture.js';
// Decisão de gente no head enquanto o Farol concluía a análise (06/11/2026).
//
// Medido em biudtech/biud-frontend#1841: a pendência com `esperaProva` foi relançada no mesmo
// head (stale_head), a rodada relançada foi segurada pela aprovação de uma pessoa naquele head
// (bloqueiaAutomatico, skip-review.js) e a pendência ficou sete horas com o cartão "Recuperando
// a análise" até o merge, sem nada a fazer. A recuperação segurada por decisão de gente no MESMO
// head da espera agora resolve a pendência sem postar e sem mesa, no molde da espera do CI
// (espera-ci.js, dispensar): `approval_not_needed`, `skip`, aviso uma vez, recibo publicado.
// A exceção do meu pedido automático aberto (`pedidoMeuAberto`) continua: lá a rodada roda.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-espera-prova-decidida-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '1f18057f09f3cef5043ec47e5eebbc5e8c44eb9c';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: gh.head, author: { login: 'dev' } }) };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const esperaProva = (await import('../lib/engine/espera-prova.js')).default;

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { envios = []; gh = { head: HEAD }; });

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  // política da conta gravada por extenso e lida pelos métodos reais do motor (contas-config.js)
  e.config.accounts = [{ user: 'eu', owners: ['acme'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'wait' }];
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.logs = [];
  e.log = (nivel, texto) => e.logs.push([nivel, texto]);
  e.toasts = [];
  e.eventos = [];
  e.recibos = [];
  e.syncAtualizarPublicacao = async (r) => { e.recibos.push(r); return { ok: true }; };
  e.on('toast', (t) => e.toasts.push(t.text));
  e.on('needs-decision', (p) => e.eventos.push(['needs-decision', p.item.key]));
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.processHeadless = () => { };
  return e;
}

const PR = { key: 'acme/app#1841', repo: 'acme/app', number: 1841, url: 'https://github.com/acme/app/pull/1841', title: 'PR', author: 'dev', requested: true, account: 'eu' };
const pendente = (e) => e.decisions.pending.find((x) => x.key === PR.key);
const resolvida = (e) => e.decisions.resolved.find((x) => x.key === PR.key);

// leva o PR até o estado medido: espera da prova relançada no mesmo head (stale_head)
async function recuperacaoRelancada(e) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'incomplete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] }, payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } }, reportMarkdown: '# ok',
    }),
    sessionId: 's1',
  });
  await e.runHeadlessReview({ ...PR });
  assert.ok(pendente(e).esperaProva, 'a análise incompleta arma a recuperação');
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(pendente(e).blockedKind, 'stale_head');
  assert.equal(pendente(e).blockedHead, HEAD);
  e.toasts = [];
}

function historico(e, hist) {
  e.consultasDoHistorico = 0;
  e.bloqueadoPorHistorico = async () => { e.consultasDoHistorico++; return hist; };
}

const APROVOU = { decidido: true, bloqueado: true, head: HEAD, quem: ['ana'], decisivos: [{ quem: 'ana', state: 'APPROVED' }] };
const MOTIVO = 'outra pessoa já decidiu este commit (@ana) enquanto eu concluía a análise: a revisão automática não é necessária, nada foi publicado';

test('biud-frontend#1841: recuperação segurada por aprovação de gente no mesmo head resolve sem postar e sem mesa', async () => {
  const e = motor();
  await recuperacaoRelancada(e);
  historico(e, APROVOU);
  await e.launchReReviews();
  assert.equal(e.headlessQueue.length, 0, 'a rodada não é enfileirada');
  assert.equal(pendente(e), undefined, 'o cartão "Recuperando a análise" sai');
  const r = resolvida(e);
  assert.equal(r.status, 'approval_not_needed');
  assert.equal(r.action, 'skip');
  assert.equal(r.esperaProva, null);
  assert.equal(r.reasons[0].text, MOTIVO);
  assert.equal(r.reasons.some((x) => x && x.espera === true), false, 'o motivo da espera sai');
  assert.deepEqual(envios, [], 'nada foi publicado');
  assert.deepEqual(e.eventos, [], 'sem mesa');
  assert.equal(e.consultasDoHistorico, 1, 'uma consulta só ao histórico');
  assert.deepEqual(e.recibos.map((x) => [x.prKey, x.headSha, x.publicationState]), [[PR.key, HEAD, 'published']]);
  assert.ok(e.logs.some(([nivel, t]) => nivel === 'INFO' && t.includes(PR.key) && t.includes('ana')), JSON.stringify(e.logs));
  assert.equal(e.toasts.length, 1, e.toasts.join(' | '));
  assert.match(e.toasts[0], /@ana/);
  // os ciclos seguintes não repetem o aviso nem relançam
  await e.launchReReviews();
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(e.toasts.length, 1, 'aviso uma vez');
  assert.deepEqual(envios, []);
});

test('pedido de mudanças de gente no mesmo head também resolve a recuperação, sem postar', async () => {
  const e = motor();
  await recuperacaoRelancada(e);
  historico(e, { decidido: true, bloqueado: true, head: HEAD, quem: ['bia'], decisivos: [{ quem: 'bia', state: 'CHANGES_REQUESTED' }], pediramMudancas: ['bia'] });
  await e.launchReReviews();
  assert.equal(pendente(e), undefined);
  assert.equal(resolvida(e).status, 'approval_not_needed');
  assert.match(resolvida(e).reasons[0].text, /\(@bia\)/);
  assert.deepEqual(envios, []);
});

test('meu pedido automático aberto (pedidoMeuAberto): decidido mas não bloqueado, a rodada roda e a recuperação segue', async () => {
  const e = motor();
  await recuperacaoRelancada(e);
  historico(e, { ...APROVOU, bloqueado: false });
  await e.launchReReviews();
  assert.equal(e.headlessQueue.length, 1, 'a rodada segue para retirar o pedido');
  assert.ok(pendente(e).esperaProva, 'a recuperação continua');
  assert.equal(e.decisions.resolved.some((x) => x.key === PR.key && x.status === 'approval_not_needed'), false);
});

test('decisão de gente em outro head não resolve a recuperação deste', async () => {
  const e = motor();
  await recuperacaoRelancada(e);
  historico(e, { ...APROVOU, head: HEAD_NOVO });
  await e.launchReReviews();
  assert.ok(pendente(e).esperaProva, 'a espera continua: o commit novo tem caminho próprio');
  assert.equal(e.decisions.resolved.some((x) => x.key === PR.key && x.status === 'approval_not_needed'), false);
  assert.deepEqual(envios, []);
});

test('o aviso marcado para este head apaga a marca de head antigo do mesmo PR, como o aviso do bloqueio', async () => {
  const e = motor();
  await recuperacaoRelancada(e);
  e.historicoAvisado = new Set([`${PR.key}@${HEAD_NOVO}`, 'acme/outro#1@abc']);
  historico(e, APROVOU);
  await e.launchReReviews();
  assert.deepEqual([...e.historicoAvisado].sort(), ['acme/outro#1@abc', `${PR.key}@${HEAD}`].sort());
});
