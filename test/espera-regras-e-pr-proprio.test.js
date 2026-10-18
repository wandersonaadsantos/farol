// Dois defeitos medidos no celular (v2.72.5, 17/10/2026), corrigidos na v2.72.6.
//
// 1. Espera armada por uma versão anterior nunca era reavaliada depois de uma mudança de regra:
//    biudtech/biud-messaging-waba#52 seguia mostrando lacunas que as regras de hoje não
//    produzem mais, e a varredura só relançava quando o PR mudava. Agora a marca carrega a
//    versão das regras do gate (VERSAO_DAS_REGRAS, evidence.js) e, quando ela é anterior, a
//    varredura relança UMA revisão pelo caminho de sempre e carimba a versão nova.
// 2. PR da própria conta que revisa esperava para sempre: biudtech/biud-frontend#1479 era da
//    conta que revisava, e o GitHub não aceita APPROVE (nem pedido de mudanças) do autor.
//    Nenhuma prova destrava isso: a espera não arma, a que já existia é largada, e o card vai
//    para a mesa dizendo que outra pessoa precisa aprovar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-espera-regras-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '1f18057f09f3cef5043ec47e5eebbc5e8c44eb9c';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let leiturasDoPr = 0;
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (sub.includes('--json state,headRefOid,updatedAt,reviewDecision,reviews')) {
    leiturasDoPr++;
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, updatedAt: '', reviewDecision: '', reviews: [], author: { login: gh.autor } }) };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const esperaProva = (await import('../lib/engine/espera-prova.js')).default;
const { VERSAO_DAS_REGRAS } = await import('../lib/technical-review/evidence.js');
const { shouldAutoApprove, shouldAutoReject } = await import('../lib/engine/approval-policy.js');
const { separarPendentes } = await import('../ui/pure/review.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { envios = []; leiturasDoPr = 0; gh = { autor: 'dev' }; });

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.autoReviewFor = () => true;
  e.decisions = { pending: [], resolved: [] };
  e.salvas = 0;
  e.saveDecisions = () => { e.salvas++; };
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
  e.on('auto-rejected', (p) => e.eventos.push(['auto-rejected', p.result.key]));
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = { key: 'acme/app#1', repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', title: 'PR', author: 'dev', requested: true, account: 'eu' };
const PROPRIO = { ...PR, author: 'Eu' };
const pendente = (e) => e.decisions.pending.find((x) => x.key === PR.key);
const textos = (d) => (d.reasons || []).map((r) => r.text || r);
const SEM_PROTOCOLO = { protocolo: { prReviewer: 'pulado' } };
const REPROVA = {
  verdict: 'request_changes', decision: 'auto_request_changes',
  payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Falta tratar o erro de rede.' } },
};
const TEXTO_PROPRIO = 'o PR é da própria conta que revisa (@eu); o GitHub não aceita APPROVE do autor, então outra pessoa precisa aprovar';

async function revisado(e, pr, extra) {
  sessao(e, extra);
  await e.runHeadlessReview({ ...pr });
  return pendente(e);
}

// ---------------------------------------------------------------- defeito 1: regras mudaram

test('a marca nasce com a versão das regras do gate vigente', async () => {
  const e = motor();
  const d = await revisado(e, PR, SEM_PROTOCOLO);
  assert.ok(Number.isInteger(VERSAO_DAS_REGRAS) && VERSAO_DAS_REGRAS >= 1);
  assert.equal(d.esperaProva.regras, VERSAO_DAS_REGRAS);
});

for (const [nome, regras] of [['sem carimbo (armada antes da v2.72.6)', undefined], ['com carimbo anterior', VERSAO_DAS_REGRAS - 1]]) {
  test(`espera ${nome}: relança UMA revisão no mesmo head, carimba e não entra em laço`, async () => {
    const e = motor();
    await revisado(e, PR, SEM_PROTOCOLO);
    const marca = pendente(e).esperaProva;
    // como o celular mostrou: lacuna de estado de uma regra que saiu, contador de envelope esgotado
    Object.assign(marca, { regras, soEnvelope: false, tentativas: esperaProva.MAX_TENTATIVAS, lacunas: ['critérios necessários do card não comprovados'] });
    if (regras === undefined) delete marca.regras;
    e.reReviewLaunched[PR.key] = { head: HEAD, dia: '', rodadas: 1, at: Date.now() };
    // o PR não mudou nada: só a regra
    assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
    const d = pendente(e);
    assert.ok(d.esperaProva.assinatura, 'o estado lido fica gravado para a comparação seguinte');
    assert.equal(d.blockedKind, 'stale_head', 'o round automático de sempre relança');
    assert.equal(d.blockedHead, HEAD, 'no MESMO head');
    assert.equal(d.esperaProva.regras, VERSAO_DAS_REGRAS, 'carimbada: não relança de novo pela regra');
    assert.equal(d.esperaProva.tentativas, esperaProva.MAX_TENTATIVAS, 'o contador do envelope não é tocado');
    assert.equal(e.reReviewLaunched[PR.key].head, '', 'a âncora do head foi liberada');
    assert.match(textos(d)[0], /regras/);
    assert.deepEqual(envios, []);
    assert.deepEqual(e.eventos, []);
  });
}

test('rodada da regra concluída com a mesma lacuna: espera calada, sem novo relançamento', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  const marca = pendente(e).esperaProva;
  delete marca.regras;
  marca.tentativas = esperaProva.MAX_TENTATIVAS;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'relança pela regra');
  // a revisão relançada volta com a lacuna de sempre, herda a marca e é carimbada de novo
  const d = await revisado(e, PR, SEM_PROTOCOLO);
  assert.equal(d.esperaProva.regras, VERSAO_DAS_REGRAS);
  assert.equal(d.blockedKind, undefined);
  await esperaProva.reverQuandoAProvaMudar(e);
  e.salvas = 0;
  for (let ciclo = 0; ciclo < 3; ciclo++) assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(e.salvas, 0, 'carimbo atual e PR parado: nada gravado');
  assert.equal(pendente(e).blockedKind, undefined);
  assert.deepEqual(envios, []);
});

test('carimbo atual e nada mudou: calado, como antes', async () => {
  const e = motor();
  await revisado(e, PR, { card: 'CARD-1', cardMet: false, cardParteDestePr: false });
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0, 'primeiro ciclo registra o estado');
  e.salvas = 0;
  for (let ciclo = 0; ciclo < 3; ciclo++) assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(e.salvas, 0);
  assert.equal(pendente(e).blockedKind, undefined);
});

test('relançamento pela regra respeita o recibo de outro aparelho: não relança nem carimba', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  const marca = pendente(e).esperaProva;
  delete marca.regras;
  marca.tentativas = esperaProva.MAX_TENTATIVAS;
  e.config.sync = { enabled: true, coordination: { enabled: true } };
  e.syncCoordenacaoAtiva = () => true;
  e.sync = {
    status: 'conectado', uid: 'u1', deviceId: 'este', recibosVistos: {}, agora: () => Date.now(),
    client: { get: async () => ({ ok: true, data: { outcome: 'completed', publicationState: 'pending', deviceId: 'outro', expiresAt: Date.now() + 1e9 }, etag: 'e1' }), del: async () => ({ ok: true }) },
  };
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  const d = pendente(e);
  assert.equal(d.blockedKind, undefined);
  assert.equal(d.esperaProva.regras, undefined, 'sem relançar, o carimbo não muda: tenta de novo no próximo ciclo');
});

// ---------------------------------------------------------------- defeito 2: PR da própria conta

test('gate: PR da própria conta nunca é aprovado nem reprovado sozinho (caixa ignorada)', () => {
  const e = motor();
  const resultado = { analysisStatus: 'complete', verdict: 'approve', payloads: { approve: { event: 'APPROVE', body: 'ok' } } };
  assert.deepEqual(shouldAutoApprove(e, PROPRIO, resultado), { ok: false, motivo: 'pr_proprio' });
  assert.notEqual(shouldAutoApprove(e, PR, resultado).motivo, 'pr_proprio');
  const rc = { analysisStatus: 'complete', verdict: 'request_changes', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } } };
  assert.equal(shouldAutoReject(e, PROPRIO, rc), false);
  assert.equal(shouldAutoReject(e, PR, rc), true);
  assert.equal(esperaProva.armarEspera(e, PROPRIO, 'pr_proprio', { headSha: HEAD, approvalEvidence: ['protocolo de revisão não comprovado'], reasons: [] }, []), null);
});

test('PR da própria conta com prova incompleta: nenhuma espera, mesa com o motivo', async () => {
  const e = motor();
  const d = await revisado(e, PROPRIO, SEM_PROTOCOLO);
  assert.equal(d.esperaProva, undefined);
  assert.equal(d.esperaCi, undefined);
  assert.ok(textos(d).includes(TEXTO_PROPRIO), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
  assert.deepEqual(envios, []);
  assert.equal(separarPendentes([e.decisionForUi(d)]).precisam.length, 1, 'em Precisa de você, nunca em Aprova sozinho');
});

test('PR da própria conta aprovável e limpo: não posta, mesa com o motivo', async () => {
  const e = motor();
  const d = await revisado(e, PROPRIO, {});
  assert.deepEqual(envios, [], 'o GitHub recusaria o APPROVE do autor');
  assert.equal(d.esperaCi, undefined);
  assert.equal(d.esperaProva, undefined);
  assert.ok(textos(d).includes(TEXTO_PROPRIO), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('PR da própria conta com reprovação: o REQUEST_CHANGES não é postado', async () => {
  const e = motor();
  const d = await revisado(e, PROPRIO, REPROVA);
  assert.deepEqual(envios, []);
  assert.ok(textos(d).some((t) => /própria conta que revisa \(@eu\).*pedido de mudanças/.test(t)), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('controle: PR de outra pessoa segue aprovando e reprovando sozinho', async () => {
  const e = motor();
  await revisado(e, PR, {});
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE');
  const e2 = motor();
  envios = [];
  await revisado(e2, PR, REPROVA);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'REQUEST_CHANGES');
});

test('espera da prova que já existia em PR da própria conta: a varredura larga, mesa com o motivo, aviso uma vez', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  pendente(e).pr.author = 'EU';
  assert.equal(await esperaProva.varrerEsperas(e), 1);
  const d = pendente(e);
  assert.equal(d.esperaProva, null);
  assert.equal(d.reasons.some((r) => r && r.espera === true), false, 'o motivo da espera sai');
  assert.equal(textos(d)[0], TEXTO_PROPRIO);
  assert.equal(leiturasDoPr, 0, 'autor gravado basta, sem leitura gh');
  for (let ciclo = 0; ciclo < 2; ciclo++) assert.equal(await esperaProva.varrerEsperas(e), 0);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]], 'needs-decision uma vez só');
  assert.equal(separarPendentes([e.decisionForUi(d)]).precisam.length, 1);
});

test('espera sem autor gravado: o autor lido do GitHub na varredura também larga', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  pendente(e).pr.author = '';
  gh.autor = 'eu';
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(pendente(e).esperaProva, null);
  assert.equal(textos(pendente(e))[0], TEXTO_PROPRIO);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('espera do CI que já existia em PR da própria conta também é largada', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  const d = pendente(e);
  d.esperaProva = null;
  d.esperaCi = { desde: 1, checks: [], pontos: [] };
  d.pr.author = 'eu';
  assert.equal(await esperaProva.varrerEsperas(e), 1);
  assert.equal(pendente(e).esperaCi, null);
  assert.equal(textos(pendente(e))[0], TEXTO_PROPRIO);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});
