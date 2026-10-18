// A aprovação que espera a PROVA técnica e se reavalia sozinha (17/10/2026).
//
// Caso medido: biudtech/biud-frontend#1465, head 1f18057, conta em "aprova sozinho". A revisão
// concluiu aprovar, `shouldAutoApprove` devolveu `prova_tecnica_incompleta` (lacuna de
// alcance, critérios do card, dependência em aberto) e o resultado foi para "Precisa de você"
// esperando um clique que nunca deveria ser preciso. A regra do dono: com aprovação automática
// configurada, o desfecho nunca depende de ação humana. O invariante 4 não afrouxa: com lacuna
// exigida NADA é postado. O que muda é o que vem depois: desde a v2.72.6 o app BUSCA a prova
// sozinho, revisando de novo o mesmo commit na hora, até duas vezes; depois delas o que faltar
// vira ressalva (test/busca-da-prova.test.js cobre o desfecho).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-espera-prova-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '1f18057f09f3cef5043ec47e5eebbc5e8c44eb9c';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';

// o gh é a fronteira de rede: `gh` guarda o que o GitHub responderia AGORA
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let leiturasDoPr = 0;
let leiturasDeDependencia = 0;
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    leiturasDoPr++;
    if (gh.leituraFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: gh.state, headRefOid: gh.head, author: { login: 'dev' } }) };
  }
  if (sub.startsWith('pr view 7 --repo acme/lib --json state')) {
    leiturasDeDependencia++;
    return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.dependencia }), stderr: '' };
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
const reviewMod = (await import('../lib/engine/review.js')).default;
const pendencia = (await import('../lib/sync/pendencia.js')).default;
const fila = (await import('../lib/sync/fila.js')).default;
const { separarPendentes, staleCardMeta } = await import('../ui/pure/review.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = []; leiturasDoPr = 0; leiturasDeDependencia = 0;
  gh = { state: 'OPEN', head: HEAD, updatedAt: '2026-10-17T12:00:00Z', reviewDecision: 'REVIEW_REQUIRED', reviews: [], dependencia: 'OPEN', leituraFalha: false };
});

// `politica` = [limpo, com ressalvas]
function motor(politica = ['approve', 'approve']) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.approvePolicyFor = (_conta, limpo) => (limpo ? politica[0] : politica[1]);
  // a conta não reprova sozinha: com ela reprovando, a parte do card deste PR dita não
  // entregue (COM_DEPENDENCIA) vira REQUEST_CHANGES na hora (test/decisao-sem-mesa.test.js)
  e.rejectPolicyFor = () => 'wait';
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
const pendente = (e) => e.decisions.pending.find((x) => x.key === PR.key);
const textos = (d) => (d.reasons || []).map((r) => r.text || r);
// lacuna que a própria sessão preenche ao revisar de novo (envelope)
const SEM_PROTOCOLO = { protocolo: { prReviewer: 'pulado' } };
// lacuna que só o mundo resolve (estado). Desde 17/10/2026 a dependência sozinha é ressalva;
// a lacuna é a sessão dizendo que a parte do card deste PR não foi entregue, e a dependência
// citada segue sendo lida a cada ciclo, porque ela fechar é estado novo para revisar de novo.
const COM_DEPENDENCIA = { card: 'CARD-1', cardMet: false, cardParteDestePr: false, dependenciasAbertas: ['acme/lib#7 precisa entrar antes deste PR'] };

async function revisado(e, extra) {
  sessao(e, extra);
  await e.runHeadlessReview({ ...PR });
  return pendente(e);
}

test('aprovável com prova incompleta: nada é postado, e a pendência BUSCA A PROVA, sem pedir você', async () => {
  const e = motor();
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.deepEqual(envios, [], 'nenhum APPROVE com lacuna (invariante 4)');
  assert.ok(d && d.esperaProva, 'a marca durável está no decisions.json');
  assert.equal(d.esperaProva.tentativas, 0);
  assert.equal(d.esperaProva.soEnvelope, true);
  assert.ok(d.esperaProva.lacunas.includes('protocolo de revisão não comprovado'), d.esperaProva.lacunas.join(' | '));
  assert.equal(d.reasons[0].espera, true, 'o motivo da espera é marcado, como na espera do CI');
  assert.deepEqual(e.eventos, [], 'sem needs-decision');
  assert.ok(e.toasts.some((t) => t === '⏳ acme/app#1: aprovável, faltou prova (protocolo de revisão não comprovado); busco a prova sozinho (tentativa 1 de 2)'), e.toasts.join(' | '));
  assert.equal(e.toasts.some((t) => /precisa da sua atenção/.test(t)), false);
  const tela = e.decisionForUi(d);
  assert.equal(tela.esperaProva.tentativas, 0, 'a tela sabe que é espera');
  assert.equal(e.reviewActions()[PR.key].esperaProva, true, 'o Panorama também');
  const { precisam, esperandoCi } = separarPendentes([tela]);
  assert.equal(precisam.length, 0, 'fora de Precisa de você');
  assert.equal(esperandoCi.length, 1);
  const meta = staleCardMeta(tela, null);
  assert.match(meta.statusHtml, /Buscando a prova \(tentativa 1 de 2\)/);
  assert.match(meta.statusHtml, /Reviso de novo sozinho neste commit/);
  assert.match(meta.verdictHtml, /BUSCANDO A PROVA/);
});

test('conta que manda esperar você: a lacuna vai para a mesa, como antes', async () => {
  const e = motor(['wait', 'wait']);
  const d = await revisado(e, SEM_PROTOCOLO);
  assert.equal(d.esperaProva, undefined);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
  assert.deepEqual(envios, []);
});

test('armar: só prova_tecnica_incompleta, sem violação confirmada, com a política aprovando', () => {
  const e = motor();
  const base = { headSha: HEAD, approvalEvidence: ['protocolo de revisão não comprovado'], reasons: [] };
  assert.ok(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', base, []));
  assert.equal(esperaProva.armar(e, PR, 'politica', base, []), null);
  assert.equal(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', { ...base, approvalEvidence: ['violação técnica confirmada'] }, []), null, 'violação vai para a mesa');
  assert.equal(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', { ...base, headSha: '' }, []), null, 'sem head lido não há o que conferir');
  assert.equal(esperaProva.armar(e, PR, 'prova_tecnica_incompleta', { ...base, technicalRecheck: true }, []), null);
  assert.equal(esperaProva.armar(motor(['approve', 'wait']), PR, 'prova_tecnica_incompleta', base, [{ text: 'ressalva', kind: 'content' }]), null);
  const ci = esperaProva.armarEspera(e, PR, 'ci_em_andamento', { checksObrigatorios: [] }, []);
  assert.ok(ci && ci.extra.esperaCi, 'a espera do CI segue com o mesmo funil');
});

test('ciclo: commit novo larga a espera e carimba stale_head', async () => {
  const e = motor();
  await revisado(e, COM_DEPENDENCIA);
  gh.head = HEAD_NOVO;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  const d = pendente(e);
  assert.equal(d.blockedKind, 'stale_head');
  assert.equal(d.blockedHead, HEAD_NOVO);
  assert.equal(d.esperaProva, null, 'a espera foi largada: quem age é o round do commit novo');
  assert.equal(d.reasons.some((r) => r && r.espera === true), false);
  assert.match(textos(d)[0], /commit novo/);
  assert.deepEqual(envios, []);
  assert.deepEqual(e.eventos, []);
});

test('ciclo: PR fechado é do reconcilePending, leitura que falha espera, coordenação fora do ar não lê', async () => {
  const e = motor();
  await revisado(e, COM_DEPENDENCIA);
  gh.state = 'MERGED';
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(pendente(e).blockedKind, undefined);
  gh.state = 'OPEN';
  gh.leituraFalha = true;
  e.salvas = 0;
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  assert.equal(e.salvas, 0);
  gh.leituraFalha = false;
  leiturasDoPr = 0;
  e.syncCoordenacaoAtiva = () => true;
  e.sync = { status: 'desconectado' };
  assert.equal(await esperaProva.varrerEsperas(e), 0);
  assert.equal(leiturasDoPr, 0, 'coordenação ligada e fora do ar: espera a conexão, como o reenvio');
});

test('a política mudou durante a espera: aí sim vai para a mesa, dizendo qual configuração segurou', async () => {
  const e = motor();
  await revisado(e, COM_DEPENDENCIA);
  e.approvePolicyFor = () => 'wait';
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
  const d = pendente(e);
  assert.equal(d.esperaProva, null);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

test('outros aparelhos: a espera da prova viaja como fato e não pede ninguém', () => {
  const p = pendencia.projetarPendencia({ key: PR.key, pr: { account: 'eu' }, verdict: 'approve', esperaProva: { desde: 1 } }, { kId: Buffer.alloc(32, 1) });
  assert.equal(p.espera, 'prova');
  assert.equal(pendencia.esperaLida('prova'), 'prova');
  assert.equal(pendencia.deveNotificar('x', { notificadas: new Set(), vistos: {}, espera: 'prova' }), false);
  assert.equal(pendencia.esperaLida('outra'), '', 'lixo segue pendência comum');
  const f = fila.estadoDaFila(PR.key, { pendentes: new Map([[PR.key, 5]]), esperandoProva: new Set([PR.key]) });
  assert.deepEqual(f, { estado: 'decidir', motivo: 'espera-prova', desde: 5, ate: 0 });
});

// Revisão do Codex no PR #245 (17/10/2026): três furos, cada um provado aqui antes da correção.

test('furo 2: rodada relançada que estacionou volta para a mesa, com o motivo e o botão de revisar', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  e.autoReviewParked.add(PR.key);
  e.parkedMotivos = { [PR.key]: { tipo: 'falha', motivo: 'saiu com código 1', at: new Date().toISOString() } };
  await esperaProva.reverQuandoAProvaMudar(e);
  const d = pendente(e);
  assert.equal(d.esperaProva, null, 'estacionado não relança sozinho: a marca de espera sai');
  assert.equal(d.blockedKind, 'stale_head');
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
  const tela = e.decisionForUi(d);
  assert.equal(separarPendentes([tela]).precisam.length, 1, 'conta em Precisa de você');
  // e a tela, entre um ciclo e outro, não promete revisão automática de rodada parada
  const marcada = { ...tela, esperaProva: { tentativas: 1 } };
  const meta = staleCardMeta(marcada, { estado: 'parado', motivo: 'estacionado', headRound: HEAD });
  assert.equal(/Revisando de novo para fechar a prova/.test(meta.statusHtml), false);
  assert.equal(meta.reviewBtn, 'primary');
});

test('furo 2: rodada relançada que saiu e não concluiu (âncora queimada, fora da fila) também volta para a mesa', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  await esperaProva.reverQuandoAProvaMudar(e);
  e.reReviewLaunched[PR.key] = { head: HEAD, dia: '', rodadas: 1, at: Date.now() - 3600 * 1000 };
  await esperaProva.reverQuandoAProvaMudar(e);
  assert.equal(pendente(e).esperaProva, null);
  assert.deepEqual(e.eventos, [['needs-decision', PR.key]]);
});

function coordenado(e, recibo, { leituraFalha = false } = {}) {
  const apagados = [];
  e.config.sync = { enabled: true, coordination: { enabled: true } };
  e.syncCoordenacaoAtiva = () => true;
  e.sync = {
    status: 'conectado', uid: 'u1', deviceId: 'este', recibosVistos: { [PR.key]: {} }, agora: () => Date.now(),
    client: {
      get: async () => (leituraFalha ? { ok: false, code: 'indisponivel' } : { ok: true, data: recibo, etag: 'etag-1' }),
      del: async (caminho, opcoes) => { apagados.push([caminho, opcoes.ifMatch]); return { ok: true }; },
    },
  };
  return apagados;
}

test('furo 3: com coordenação, o recibo pendente DESTE aparelho para este head é invalidado antes do relançamento', async () => {
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  const apagados = coordenado(e, { outcome: 'completed', publicationState: 'pending', deviceId: 'este', expiresAt: Date.now() + 1e9 });
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1);
  assert.equal(apagados.length, 1, 'o recibo que barraria a admissão como "recibo" sai');
  assert.equal(apagados[0][1], 'etag-1', 'condicionado ao etag lido');
  assert.match(apagados[0][0], /\/receipts\/.+\/review_/);
  assert.equal(e.sync.recibosVistos[PR.key], undefined);
  assert.equal(pendente(e).blockedKind, 'stale_head');
});

test('furo 3: recibo publicado, de outro aparelho ou leitura que falha: não apaga e não relança', async () => {
  for (const [recibo, opcoes] of [
    [{ outcome: 'completed', publicationState: 'published', deviceId: 'este', expiresAt: Date.now() + 1e9 }, {}],
    [{ outcome: 'completed', publicationState: 'pending', deviceId: 'outro', expiresAt: Date.now() + 1e9 }, {}],
    [null, { leituraFalha: true }],
  ]) {
    const e = motor();
    await revisado(e, SEM_PROTOCOLO);
    const apagados = coordenado(e, recibo, opcoes);
    e.salvas = 0;
    assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 0);
    assert.deepEqual(apagados, []);
    assert.equal(pendente(e).blockedKind, undefined);
    assert.equal(e.salvas, 0);
  }
  const e = motor();
  await revisado(e, SEM_PROTOCOLO);
  const apagados = coordenado(e, null);
  assert.equal(await esperaProva.reverQuandoAProvaMudar(e), 1, 'sem recibo nenhum, relança normalmente');
  assert.deepEqual(apagados, []);
});
