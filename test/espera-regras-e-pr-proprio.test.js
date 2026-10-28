import { criteriaFixture } from './helpers/criteria-fixture.js';
// Dois defeitos medidos no celular (v2.72.5, 17/10/2026), corrigidos na v2.72.6.
//
// 1. Espera armada por uma versão anterior nunca era reavaliada depois de uma mudança de regra:
//    biudtech/biud-messaging-waba#52 seguia mostrando lacunas que as regras de hoje não
//    produzem mais, e a varredura só relançava quando o PR mudava. Agora a marca carrega a
//    versão das regras do gate (VERSAO_DAS_REGRAS, evidence.js) e, quando ela é anterior, a
//    varredura relança UMA revisão pelo caminho de sempre e carimba a versão nova.
// 2. PR da própria conta que revisa esperava para sempre: biudtech/biud-frontend#1479 era da
//    conta que revisava, e o GitHub não aceita APPROVE (nem pedido de mudanças) do autor.
//    Nenhuma prova destrava isso: a espera não arma e a que já existia é largada.
//    Desde 18/10/2026 (a decisão sem mesa), com a política da classe automática a revisão sai
//    como COMMENT (que o GitHub aceita do autor) e a pendência é resolvida como
//    `commented_own_pr`; a mesa sobra para a conta que espera você.
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
  if (sub.includes('--json state,headRefOid,author')) {
    leiturasDoPr++;
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, author: { login: gh.autor } }) };
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
const { separarPendentes, staleCardMeta } = await import('../ui/pure/review.js');
const reviewMod = (await import('../lib/engine/review.js')).default;

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
  e.on('auto-commented', (p) => e.eventos.push(['auto-commented', p.result.key]));
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture(extra?.verdict || 'approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
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
const resolvida = (e) => e.decisions.resolved.find((x) => x.key === PR.key);
// a conta que espera você: a mesa é escolha dela, e o PR próprio vai para lá com o motivo
const esperaVoce = (e) => { e.approvePolicyFor = () => 'wait'; e.rejectPolicyFor = () => 'wait'; return e; };
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
  test(`espera ${nome}: relança no mesmo head sem gastar tentativa e sai carimbada`, async () => {
    const e = motor();
    await revisado(e, PR, SEM_PROTOCOLO);
    const marca = pendente(e).esperaProva;
    Object.assign(marca, { regras, tentativas: 1, lacunas: ['critérios necessários do card não comprovados'] });
    if (regras === undefined) delete marca.regras;
    e.reReviewLaunched[PR.key] = { head: HEAD, dia: '', rodadas: 1, at: Date.now() };
    assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
    const d = pendente(e);
    assert.equal(d.blockedKind, 'stale_head', 'o round automático de sempre relança');
    assert.equal(d.blockedHead, HEAD, 'no MESMO head');
    assert.equal(d.esperaProva.regras, VERSAO_DAS_REGRAS, 'carimbada: não relança de novo pela regra');
    assert.equal(d.esperaProva.tentativas, 1, 'a troca de regra não gasta tentativa');
    assert.equal(e.reReviewLaunched[PR.key].head, '', 'a âncora do head foi liberada');
    assert.match(textos(d)[0], /regras do gate mudaram/);
    assert.deepEqual(envios, []);
    assert.deepEqual(e.eventos, []);
  });
}

test('espera do celular (biud-messaging-waba#52): sem carimbo e com as tentativas gastas, a rodada nova fecha o caso sem laço', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  const marca = pendente(e).esperaProva;
  delete marca.regras;
  Object.assign(marca, { tentativas: esperaProva.MAX_TENTATIVAS, lacunas: ['dependência necessária ainda aberta'] });
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'relança pela regra');
  assert.equal(pendente(e).esperaProva.tentativas, esperaProva.MAX_TENTATIVAS);
  // a rodada relançada é a da prova esgotada: a lacuna que sobrou vira ressalva e a política aprova
  await revisado(e, PR, SEM_PROTOCOLO);
  assert.equal(envios.length, 1, 'aprovou com ressalvas');
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(pendente(e), undefined, 'nada mais esperando');
  for (let ciclo = 0; ciclo < 2; ciclo++) assert.equal(await esperaProva.varrerEsperas(e), 0);
});

test('carimbo atual: a busca gasta tentativa normalmente', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  assert.equal(pendente(e).esperaProva.regras, VERSAO_DAS_REGRAS);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(pendente(e).esperaProva.tentativas, 1);
  assert.doesNotMatch(textos(pendente(e))[0], /regras do gate/);
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
  const resultado = { ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', payloads: { approve: { event: 'APPROVE', body: 'ok' } } };
  assert.deepEqual(shouldAutoApprove(e, PROPRIO, resultado), { ok: false, motivo: 'pr_proprio' });
  assert.notEqual(shouldAutoApprove(e, PR, resultado).motivo, 'pr_proprio');
  const rc = { ...criteriaFixture('request_changes'), analysisStatus: 'complete', verdict: 'request_changes', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } } };
  assert.equal(shouldAutoReject(e, PROPRIO, rc), false);
  assert.equal(shouldAutoReject(e, PR, rc), true);
  assert.equal(esperaProva.armarEspera(e, PROPRIO, 'pr_proprio', { headSha: HEAD, approvalEvidence: ['protocolo de revisão não comprovado'], reasons: [] }, []), null);
});

test('PR da própria conta com a conta esperando você: nenhuma espera, mesa com o motivo', async () => {
  const e = esperaVoce(motor());
  const d = await revisado(e, PROPRIO, SEM_PROTOCOLO);
  assert.equal(d.esperaProva, undefined);
  assert.equal(d.esperaCi, undefined);
  assert.ok(textos(d).includes(TEXTO_PROPRIO), textos(d).join(' | '));
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
  assert.deepEqual(envios, []);
  assert.equal(separarPendentes([e.decisionForUi(d)]).precisam.length, 1, 'em Precisa de você, nunca em Aprova sozinho');
});

test('PR da própria conta aprovável, conta aprovando sozinha: sai como COMMENT e resolve, sem mesa', async () => {
  const e = motor();
  const d = await revisado(e, PROPRIO, {});
  assert.equal(d, undefined, 'nada fica pendente');
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'COMMENT', 'o GitHub recusaria o APPROVE do autor');
  assert.equal(envios[0].body, 'Leitura completa, sem bloqueios.');
  assert.equal(envios[0].commit_id, HEAD, 'ancorado no commit lido');
  assert.equal(resolvida(e).status, 'commented_own_pr');
  assert.deepEqual(e.eventos, [['auto-commented', PR.key]]);
});

test('PR da própria conta com prova incompleta: o comentário sai mesmo assim (COMMENT não é aprovação)', async () => {
  const e = motor();
  await revisado(e, PROPRIO, SEM_PROTOCOLO);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'COMMENT');
  assert.equal(resolvida(e).status, 'commented_own_pr');
});

test('PR da própria conta com reprovação, conta reprovando sozinha: o pedido sai como COMMENT', async () => {
  const e = motor();
  await revisado(e, PROPRIO, REPROVA);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'COMMENT');
  assert.equal(envios[0].body, 'Falta tratar o erro de rede.');
  assert.deepEqual(e.eventos, [['auto-commented', PR.key]]);
});

test('PR da própria conta com reprovação e a conta esperando você: nada é postado, mesa com o motivo', async () => {
  const e = esperaVoce(motor());
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

test('espera da prova que já existia em PR da própria conta, conta aprovando sozinha: a varredura comenta e resolve', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  pendente(e).pr.author = 'EU';
  assert.equal(await esperaProva.varrerEsperas(e), 1);
  assert.equal(pendente(e), undefined);
  assert.equal(resolvida(e).status, 'commented_own_pr');
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(leiturasDoPr, 0, 'autor gravado basta, sem leitura gh do PR');
  for (let ciclo = 0; ciclo < 2; ciclo++) assert.equal(await esperaProva.varrerEsperas(e), 0);
  assert.deepEqual(e.eventos, [['auto-commented', PR.key]]);
});

test('espera da prova que já existia em PR da própria conta, conta esperando você: larga, mesa com o motivo, aviso uma vez', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  pendente(e).pr.author = 'EU';
  esperaVoce(e);
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

test('espera sem autor gravado: o autor lido do GitHub na varredura também conta, e o comentário sai', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  pendente(e).pr.author = '';
  gh.autor = 'eu';
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(pendente(e), undefined);
  assert.equal(resolvida(e).status, 'commented_own_pr');
  assert.deepEqual(e.eventos, [['auto-commented', PR.key]]);
});

test('espera do CI que já existia em PR da própria conta também é largada e comentada', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  const d = pendente(e);
  d.esperaProva = null;
  d.esperaCi = { desde: 1, checks: [], pontos: [] };
  d.pr.author = 'eu';
  assert.equal(await esperaProva.varrerEsperas(e), 1);
  assert.equal(pendente(e), undefined);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.deepEqual(e.eventos, [['auto-commented', PR.key]]);
});

test('espera do CI em PR da própria conta com a conta esperando você: larga e vai para a mesa', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  const d = pendente(e);
  d.esperaProva = null;
  d.esperaCi = { desde: 1, checks: [], pontos: [] };
  d.pr.author = 'eu';
  esperaVoce(e);
  assert.equal(await esperaProva.varrerEsperas(e), 1);
  assert.equal(pendente(e).esperaCi, null);
  assert.equal(textos(pendente(e))[0], TEXTO_PROPRIO);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

// Revisão do PR #248 (Codex, 17/10/2026). Cada caso abaixo reprovava no head 38f8300.

test('PR #248, achado 3: o portão de postagem recusa APPROVE e REQUEST_CHANGES em PR da própria conta, por qualquer via', async () => {
  const e = motor();
  const pr = { ...PROPRIO };
  for (const event of ['APPROVE', 'REQUEST_CHANGES']) {
    const r = await e.postReview(pr, { event, body: 'Leitura completa, sem bloqueios.', commit_id: HEAD }, { via: 'clique' });
    assert.equal(r.ok, false, event);
    assert.equal(r.blocked, 'pr_proprio', event);
    assert.match(r.error, /própria conta que revisa \(@eu\)/);
  }
  assert.deepEqual(envios, [], 'nada chegou ao GitHub');
  const comentario = await e.postReview(pr, { event: 'COMMENT', body: 'Anotei um ponto para depois.' }, { via: 'clique' });
  assert.notEqual(comentario.blocked, 'pr_proprio', 'comentar o próprio PR continua permitido');
});

test('PR #248, achado 3: a pendência de PR próprio não oferece Aprovar nem Pedir mudanças', async () => {
  const e = esperaVoce(motor());
  const d = await revisado(e, PROPRIO, {});
  const tela = e.decisionForUi(d);
  assert.equal(tela.prProprio, true);
  const meta = staleCardMeta(tela, null);
  assert.equal(meta.semDecisivos, true);
  assert.equal(meta.approveDisabled, true);
  // a decisão pelo clique também não sai
  envios = [];
  await e.decide(d.id, 'approve').catch(() => { });
  assert.deepEqual(envios, []);
  assert.equal(staleCardMeta(e.decisionForUi(await revisado(motor(), PR, SEM_PROTOCOLO)), null).semDecisivos, undefined, 'PR de outra pessoa segue com os botões');
});

test('PR #248, achado 4: largar a espera de PR próprio durante a rodada complementar limpa o estado de commit novo', async () => {
  const e = motor();
  await revisado(e, PR, SEM_PROTOCOLO);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'a busca relançou no mesmo head');
  assert.equal(pendente(e).blockedKind, 'stale_head');
  pendente(e).pr.author = 'eu';
  esperaVoce(e);
  assert.equal(await esperaProva.varrerEsperas(e), 1);
  const d = pendente(e);
  assert.equal(d.esperaProva, null);
  assert.equal(d.blockedKind, undefined, 'sem stale_head');
  assert.equal(d.blockedHead, undefined);
  assert.equal(reviewMod.explicaReRound(e, { ...PR }, new Set(), Date.now()).estado, 'sem_gatilho', 'o round automático não mira mais o PR');
  const meta = staleCardMeta(e.decisionForUi(d), null);
  assert.equal(meta.stale, false, 'sem card de commit novo');
  assert.equal(meta.semDecisivos, true);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});
