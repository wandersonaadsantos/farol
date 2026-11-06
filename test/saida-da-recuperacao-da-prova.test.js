// Saída da pendência de recuperação da prova (06/11/2026). Auditoria no motor 2.78.39: cinco
// pendências presas, 12 de 32 PRs do dia terminados em recuperação pausada e US$ 48 gastos
// sem nenhuma postagem. Cada caso daqui é um dos furos medidos:
//   B1  conta em "só põe na fila": a pendência pausada não tinha saída;
//   B3  a tentativa era contada no agendamento, antes de qualquer sessão;
//   B4  valor oculto de ambiente vinha DEPOIS do gate de prova e gastava duas sessões;
//   B5  lacuna dura recuperável não tinha teto;
//   B6  revisão manual sobre pendência pausada duplicava o card;
//   B7  a pausada ficava fora de "Precisa de você", do ícone e da projeção entre aparelhos.
import { criteriaFixture } from './helpers/criteria-fixture.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-saida-prova-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '1f18057f09f3cef5043ec47e5eebbc5e8c44eb9c';

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
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: gh.state, headRefOid: gh.head, author: { login: 'dev' } }) };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.state }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const esperaProva = (await import('../lib/engine/espera-prova.js')).default;
const busca = (await import('../lib/engine/busca-da-prova.js')).default;
const { shouldAutoApprove, textoDaRecusa } = await import('../lib/engine/approval-policy.js');
const { AUTOMACAO_DESLIGADA } = await import('../lib/engine/recuperacao-prova.js');
const pendencia = (await import('../lib/sync/pendencia.js')).default;
const fila = (await import('../lib/sync/fila.js')).default;
const { fatosDaFila } = await import('../lib/engine/sync-fila.js');
const { badgeDe } = await import('../lib/engine/avisos-nativos.js');
const { separarPendentes, staleCardMeta, reviewBoxHtml, reviewChip } = await import('../ui/pure/review.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  gh = { state: 'OPEN', head: HEAD };
});

// `politica` = [limpo, com ressalvas]
function motor(politica = ['wait', 'wait'], { automatica = true } = {}) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.approvePolicyFor = (_conta, limpo) => (limpo ? politica[0] : politica[1]);
  e.rejectPolicyFor = () => 'wait';
  e.autoReviewFor = () => automatica;
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.toasts = [];
  e.eventos = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  e.on('needs-decision', (p) => e.eventos.push(['needs-decision', p.item.key]));
  e.on('auto-approved', (p) => e.eventos.push(['auto-approved', p.result.key]));
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = { key: 'acme/app#1', repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', title: 'PR', author: 'dev', requested: true, account: 'eu' };
const CLIQUE = { ...PR, manual: true, requested: false };
const pendentes = (e) => e.decisions.pending.filter((x) => x.key === PR.key);
const pendente = (e) => pendentes(e)[0];
const textos = (d) => (d.reasons || []).map((r) => r.text || r);
const SEM_PROTOCOLO = { protocolo: { prReviewer: 'pulado' } };

async function revisado(e, extra, pr = PR) {
  sessao(e, extra);
  await e.runHeadlessReview({ ...pr });
  return pendente(e);
}

const AMBIENTE = { status: 'complete', reason: '', headSha: HEAD, baseSha: 'b'.repeat(40), changedFiles: 1,
  files: [{ path: '.env.example', representation: { kind: 'env-changes', hiddenValues: 1, redactions: [] } }] };

// B6: o teste que reproduz a duplicação, escrito antes da correção.
test('B6: revisão manual sobre a pendência pausada substitui o card, em vez de duplicar', async () => {
  const e = motor(['wait', 'wait'], { automatica: false });
  const antes = await revisado(e, SEM_PROTOCOLO);
  assert.ok(antes.esperaProva, 'a pendência nasce em recuperação');
  assert.equal(antes.esperaProva.impedimento, AUTOMACAO_DESLIGADA, 'pausada pela conta que só põe na fila');
  await revisado(e, SEM_PROTOCOLO, CLIQUE);
  assert.equal(pendentes(e).length, 1, 'um card por PR');
  assert.notEqual(pendente(e).id, antes.id, 'o card que fica é o da revisão nova');
  assert.ok(e.decisions.resolved.some((x) => x.id === antes.id && x.status === 'superseded'));
  assert.deepEqual(envios, []);
});

// B1 e B3: a tentativa é contada quando a sessão conclui, e a revisão mandada pelo dono conta.
test('B1: duas revisões suas no mesmo commit, com a conta em "só põe na fila", chegam à prova esgotada e à mesa', async () => {
  const e = motor(['wait', 'wait'], { automatica: false });
  const original = await revisado(e, SEM_PROTOCOLO);
  assert.equal(original.esperaProva.tentativas, 0, 'a revisão original não é busca');
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]], 'pausada avisa uma vez: precisa de você');
  const primeira = await revisado(e, SEM_PROTOCOLO, CLIQUE);
  assert.equal(primeira.esperaProva.tentativas, 1, 'a primeira revisão sua contou');
  assert.equal(primeira.provaEsgotada, false);
  const segunda = await revisado(e, SEM_PROTOCOLO, CLIQUE);
  assert.equal(segunda.provaEsgotada, true, 'a segunda nasce com o contador cheio');
  assert.equal(segunda.esperaProva, undefined, 'nada mais a recuperar: a lacuna virou ressalva');
  assert.ok(textos(segunda).some((t) => /faltou prova depois das minhas 2 tentativas/.test(t)), textos(segunda).join(' | '));
  assert.equal(pendentes(e).length, 1);
  assert.deepEqual(envios, [], 'a política em wait leva à mesa, sem postar');
  const meta = staleCardMeta(e.decisionForUi(segunda), null);
  assert.equal(meta.approveDisabled, false, 'o Aprovar fica ligado na mesa');
});

test('B3: rodada relançada e barrada antes da sessão, e sessão interrompida, não gastam tentativa', async () => {
  const e = motor(['approve', 'approve']);
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'relança no mesmo commit');
  assert.equal(d.esperaProva.tentativas, 0, 'o agendamento não conta');
  assert.equal(d.blockedKind, 'stale_head');
  assert.match(textos(d)[0], /tentativa 1/);
  // a sessão relançada morre antes do envelope: nada conta
  e.runClaudeStream = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(e.runHeadlessReview({ ...PR, knownHead: HEAD }));
  assert.equal(d.esperaProva.tentativas, 0, 'sessão interrompida não gasta tentativa');
  // a que conclui, conta
  const depois = await revisado(e, SEM_PROTOCOLO, { ...PR, knownHead: HEAD });
  assert.equal(depois.esperaProva.tentativas, 1);
  assert.equal(busca.blocoDaTentativa(e, PR).includes('tentativa 2 neste commit'), true);
});

test('B5: a lacuna dura recuperável tem teto por commit, e depois dele vai à mesa com o motivo dito', async () => {
  const e = motor(['approve', 'approve']);
  const d = await revisado(e, { analysisStatus: 'incomplete', decision: 'needs_decision' });
  assert.ok(d.esperaProva);
  d.esperaProva.tentativas = busca.MAX_TENTATIVAS_POR_HEAD - 1;
  const ultima = await revisado(e, { analysisStatus: 'incomplete', decision: 'needs_decision' }, { ...PR, knownHead: HEAD });
  assert.equal(ultima.esperaProva, undefined, 'não arma outra busca');
  assert.equal(ultima.tentativasDaProva, busca.MAX_TENTATIVAS_POR_HEAD, 'o contador sobrevive na pendência');
  assert.match(textos(ultima)[0], /revisões minhas neste commit/);
  assert.deepEqual(e.eventos.filter((x) => x[0] === 'needs-decision'), [['needs-decision', PR.key]]);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0, 'a varredura não rearma a pendência que bateu no teto');
  assert.equal(pendente(e).esperaProva, undefined);
  assert.deepEqual(envios, []);
});

test('B4: valor oculto de ambiente é decidido antes de armar a busca, com o motivo dito no card', () => {
  const e = motor();
  e.config.people = { dev: { papel: 'junior' } };
  const r = { headSha: HEAD, verdict: 'approve', analysisStatus: 'complete', ...criteriaFixture('approve'),
    payloads: { approve: { event: 'APPROVE', body: 'ok' } }, inventarioDiff: AMBIENTE,
    approvalEvidence: ['protocolo de revisão não comprovado'], technicalReview: { semDeclaracao: true } };
  assert.equal(shouldAutoApprove(e, PR, r).motivo, 'valor_oculto_de_ambiente', 'antes da prova incompleta');
  assert.equal(shouldAutoApprove(e, PR, { ...r, analysisStatus: 'incomplete' }).motivo, 'valor_oculto_de_ambiente', 'antes da análise incompleta');
  assert.match(textoDaRecusa(e, PR, 'valor_oculto_de_ambiente', r), /Tentar de novo não muda isso/);
  assert.equal(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', r, []), null, 'nenhuma rota de espera arma');
  assert.equal(esperaProva.armar(e, PR, 'analise_incompleta', { ...r, analysisStatus: 'incomplete' }, []), null);
  e.config.people = { dev: { papel: 'techlead' } };
  assert.ok(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', r, []), 'com o autor Tech Lead a busca segue');
});

test('B4: a varredura não rearma pendência com valor oculto de ambiente', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  delete d.esperaProva;
  d.inventarioDiff = AMBIENTE;
  d.reasons = [{ text: 'decisão da pessoa', kind: 'gate' }];
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(d.esperaProva, undefined);
});

// B7: a pausada é "precisa de você" em toda superfície, e o fato viaja como motivo.
test('B7: pendência pausada conta no contador, no ícone, no card e na projeção entre aparelhos', async () => {
  const e = motor(['wait', 'wait'], { automatica: false });
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.equal(d.esperaProva.pedeVoce, true);
  const tela = e.decisionForUi(d);
  assert.equal(tela.esperaProva.pedeVoce, true);
  const { precisam, esperandoCi } = separarPendentes([tela]);
  assert.equal(precisam.length, 1, 'dentro de Precisa de você');
  assert.equal(esperandoCi.length, 0);
  assert.deepEqual(badgeDe({ decisions: { pending: [tela] } }).contador, 1, 'o ícone conta');
  const meta = staleCardMeta(tela, null);
  assert.match(meta.statusHtml, /precisa de você/i);
  assert.match(meta.statusHtml, /revis(e|ão) de novo/i, 'diz o que destrava');
  assert.doesNotMatch(meta.statusHtml, /sem decisão manual|não exige decisão manual/);
  assert.equal(meta.cardClass, 'urgent');
  assert.doesNotMatch(reviewBoxHtml(tela), /sem decisão manual/);
  const chip = reviewChip({ key: PR.key }, e.reviewActions(), {});
  assert.doesNotMatch(chip, /não exige decisão manual/);
  assert.match(chip, /aguardando você/);
  // projeção: pendência comum com o impedimento como motivo, sem estado novo
  const p = pendencia.projetarPendencia(d, { kId: Buffer.alloc(32, 1) });
  assert.equal(p.espera, '', 'não é espera automática');
  assert.ok(p.motivos.some((m) => /desativada/.test(m.text)), 'o impedimento viaja como motivo');
  assert.equal(p.acoes.includes('approve'), false, 'aprovar segue bloqueado sem prova');
  assert.equal(pendencia.deveNotificar('x', { notificadas: new Set(), vistos: {}, espera: p.espera }), true);
  const f = fila.estadoDaFila(PR.key, fatosDaFila(e));
  assert.deepEqual([f.estado, f.motivo], ['decidir', ''], 'vocabulário fechado preservado: motivo vazio, não estado novo');
  // a que NÃO está pausada continua fora, como antes
  e.autoReviewFor = () => true;
  await esperaProva.reverQuandoAProvaMudar(e);
  assert.equal(d.esperaProva.pedeVoce, false);
  assert.equal(separarPendentes([e.decisionForUi(d)]).precisam.length, 0);
  assert.equal(pendencia.projetarPendencia(d, { kId: Buffer.alloc(32, 1) }).espera, 'prova');
});

test('B7: a pausa que chega depois avisa needs-decision uma vez, e a espera do CI no início não é "precisa de você"', async () => {
  const e = motor(['approve', 'approve']);
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(e.eventos, []);
  e.autoReviewFor = () => false;
  await esperaProva.reverQuandoAProvaMudar(e);
  await esperaProva.reverQuandoAProvaMudar(e);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]], 'uma vez só');
  e.autoReviewFor = () => true;
  await esperaProva.reverQuandoAProvaMudar(e);
  assert.equal(d.esperaProva.pedeVoce, false);
  // a pausa pelo CI obrigatório é automática: não pede ninguém
  const c = motor(['approve', 'approve']);
  const dc = await revisado(c, SEM_PROTOCOLO);
  c.config.aguardarCiParaRevisar = true;
  c.bloqueadoPorChecks = async () => ({ bloqueado: true, faltando: [{ nome: 'ci', estado: 'vermelho' }] });
  await esperaProva.reverQuandoAProvaMudar(c);
  assert.match(dc.esperaProva.impedimento, /checks/);
  assert.equal(dc.esperaProva.pedeVoce, false);
  assert.deepEqual(c.eventos, []);
  assert.equal(separarPendentes([c.decisionForUi(dc)]).precisam.length, 0);
});
