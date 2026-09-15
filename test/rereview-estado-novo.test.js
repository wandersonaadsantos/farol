// Card de commit novo que se explica e estado novo que destrava (v2.59.3).
//
// Caso de campo (Edicoes-CNBB/biblioteca-cnbb-api#22, 09/09/2026): o autor empurrou
// commit durante a revisão, o card stale_head foi pra mesa pedindo "Peça uma revisão
// nova", e quem olhou no minuto 2 concluiu que o Farol tinha travado. O round
// automático já ia agir sozinho, só não dizia. A investigação achou ainda duas
// travas de verdade, reproduzidas aqui antes do conserto: a rodada relançada que
// estaciona deixa a âncora presa no blockedHead (nem commit novo nem pedido de
// revisão destravam), e o "Pular" nunca volta sozinho mesmo com código novo.
import test, { after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-estado-novo-'));
const { Engine } = await import('../server.js');

after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});

const reviewMod = (await import('../lib/engine/review.js')).default;
const destrava = (await import('../lib/engine/destrava.js')).default;
const { TEMPOS } = await import('../lib/constants.js');

const KEY = 'acme/r#1';
const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40), H3 = 'c'.repeat(40);
const MIN = 60 * 1000;
const AGORA = new Date('2026-09-09T19:50:00').getTime();

function engineBase() {
  const e = Object.create(Engine.prototype);
  e.panorama = [{ key: KEY, repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1', isDraft: false, updatedAt: new Date(AGORA - MIN).toISOString() }];
  e.staleInfo = {};
  e.headQuietoDesde = {};
  e.reReviewLaunched = {};
  e.decisions = { pending: [], resolved: [] };
  e.autoReviewParked = new Set();
  e.parkedMotivos = {};
  e.retryAfterNet = new Map();
  e.skipComentado = {};
  e.headlessQueue = [];
  e.activeReviews = new Map();
  e.queue = [];
  e.seen = new Set();
  e.ignorados = new Set();
  e.mineKeys = new Set([KEY]);
  e.destravados = {};
  e.accountForPr = () => 'revisora';
  e.isMuted = () => false;
  e.autoReviewFor = () => true;
  e.tokenFor = () => 'tok';
  e.budgetBlockedFor = () => false;
  e.outrosRevisando = () => [];
  e.ghEnv = () => ({});
  e.saveReReviewLaunched = () => {};
  e.saveAutoReviewParked = () => {};
  e.saveDecisions = () => {};
  e.saveSeen = () => {};
  e.saveDestravados = () => {};
  e.pushState = () => {};
  e.log = () => {};
  e.toasts = [];
  e.emit = (ev, dados) => { if (ev === 'toast') e.toasts.push(dados.text); };
  return e;
}

const pendStale = (extra = {}) => ({
  id: 'p1', key: KEY, status: 'pending', blockedKind: 'stale_head', headSha: H1, blockedHead: H2,
  createdAt: AGORA - 2 * MIN, pr: { repo: 'acme/r', number: 1, url: 'https://github.com/acme/r/pull/1', account: 'revisora', isDraft: false }, ...extra,
});
const explica = (e, inflight = new Set(), agora = AGORA) => reviewMod.explicaReRound(e, { ...e.panorama[0] }, inflight, agora);

/* ---------- o gate explica o que vai acontecer ---------- */

test('pendência stale_head fresca: aguardando, com a hora em que o round pode sair', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale());
  const r = explica(e);
  assert.equal(r.estado, 'aguardando');
  assert.equal(r.aPartirDe, AGORA - 2 * MIN + TEMPOS.HEAD_QUIETO_MS);
});

test('pendência stale_head quieta há 5 min: relanca (o caminho feliz segue igual)', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 6 * MIN }));
  assert.equal(explica(e).estado, 'relanca');
  assert.equal(reviewMod.classificaReRound(e, { ...e.panorama[0] }, new Set(), AGORA), 'relanca');
});

test('revisão em andamento aparece como revisando, antes de qualquer outro motivo', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 20 * MIN }));
  e.reReviewLaunched[KEY] = { head: H2, dia: '2026-09-09', rodadas: 1 };
  assert.equal(explica(e, new Set([KEY])).estado, 'revisando');
});

test('cada trava que segura o round vira um motivo nomeado, nunca silêncio', () => {
  const casos = [
    ['auto_desligado', (e) => { e.autoReviewFor = () => false; }],
    ['conta_silenciada', (e) => { e.isMuted = () => true; }],
    ['sem_token', (e) => { e.tokenFor = () => ''; }],
    ['orcamento', (e) => { e.budgetBlockedFor = () => ({ id: 'p', label: 'P' }); }],
    ['rascunho', (e) => { e.panorama[0].isDraft = true; }],
    ['saiu_de_cena', (e) => { e.skipComentado[KEY] = { at: 1, quem: 'ana' }; }],
    ['ancora', (e) => { e.reReviewLaunched[KEY] = { head: H2, dia: '2026-09-09', rodadas: 1 }; }],
  ];
  for (const [motivo, prepara] of casos) {
    const e = engineBase();
    e.decisions.pending.push(pendStale({ createdAt: AGORA - 20 * MIN }));
    prepara(e);
    const r = explica(e);
    assert.equal(r.estado, 'parado', motivo);
    assert.equal(r.motivo, motivo);
    assert.equal(reviewMod.classificaReRound(e, { ...e.panorama[0] }, new Set(), AGORA), null, `${motivo} nunca relança`);
  }
});

test('outra pessoa revisando carrega quem, e estacionamento carrega o tipo', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 20 * MIN }));
  e.outrosRevisando = () => ['ana'];
  assert.deepEqual([explica(e).motivo, explica(e).detalhe], ['outros_revisando', 'ana']);
  const f = engineBase();
  f.decisions.pending.push(pendStale({ createdAt: AGORA - 20 * MIN }));
  f.autoReviewParked.add(KEY);
  f.parkedMotivos[KEY] = { at: new Date(AGORA - 10 * MIN).toISOString(), motivo: 'x', tipo: 'falha' };
  assert.deepEqual([explica(f).motivo, explica(f).detalhe], ['estacionado', 'falha']);
});

/* ---------- teto: rodadas presas em sequência, não "3 por dia" ---------- */

test('sem teto diário local: 3 rodadas hoje num head NOVO ainda relançam', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 6 * MIN }));
  e.reReviewLaunched[KEY] = { head: H1, dia: reviewMod.diaLocal(AGORA), rodadas: 3 };
  assert.equal(explica(e).estado, 'relanca');
});

test('3 rodadas seguidas presas: a espera passa a 30 min de PR quieto, e depois relança sozinho', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 10 * MIN, rodadasPresas: reviewMod.MAX_RODADAS_PRESAS }));
  const r = explica(e);
  assert.equal(r.estado, 'espera_longa');
  assert.equal(r.aPartirDe, AGORA - 10 * MIN + TEMPOS.HEAD_QUIETO_LONGO_MS);
  assert.equal(explica(e, new Set(), AGORA + 21 * MIN).estado, 'relanca');
});

test('recordDecision conta as rodadas presas em sequência e zera quando uma rodada conclui', () => {
  const e = engineBase();
  e.resolveIntoHistory = function (item) { this.decisions.resolved.unshift({ ...item, resolvedAt: Date.now() }); };
  const pr = { key: KEY, repo: 'acme/r', number: 1, url: 'u' };
  const presa = () => e.recordDecision(pr, { verdict: 'approve', reasons: [] }, { status: 'pending', blockedKind: 'stale_head', blockedHead: H2 });
  assert.equal(presa().rodadasPresas, 1);
  assert.equal(presa().rodadasPresas, 2);
  assert.equal(presa().rodadasPresas, 3);
  e.recordDecision(pr, { verdict: 'approve', reasons: [] }, { status: 'auto_approved', action: 'approve' });
  assert.equal(presa().rodadasPresas, 1, 'rodada que concluiu zera a sequência');
});

test('debounce do gatilho B respeita headQuietoDesde da pendência quando é mais novo que o createdAt', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 30 * MIN, headQuietoDesde: AGORA - MIN }));
  const r = explica(e);
  assert.equal(r.estado, 'aguardando');
  assert.equal(r.aPartirDe, AGORA - MIN + TEMPOS.HEAD_QUIETO_MS);
});

/* ---------- projeção pra tela ---------- */

test('reRoundParaUi projeta só pendências stale_head, e troca relanca por aguardando ou consciência', () => {
  const e = engineBase();
  e.nextCheckAt = AGORA + 2 * MIN;
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 6 * MIN }));
  e.decisions.pending.push({ id: 'viva', key: 'outra/r#2', status: 'pending' });
  const ui = reviewMod.reRoundParaUi(e, AGORA);
  assert.deepEqual(Object.keys(ui), [KEY]);
  assert.equal(ui[KEY].estado, 'aguardando');
  assert.equal(ui[KEY].aPartirDe, AGORA + 2 * MIN);
  e.bloqueioConsultado = { [KEY]: { head: H2, at: AGORA - MIN } };
  assert.deepEqual([reviewMod.reRoundParaUi(e, AGORA)[KEY].estado, reviewMod.reRoundParaUi(e, AGORA)[KEY].motivo], ['parado', 'consciencia']);
});

/* ---------- estado novo destrava ---------- */

test('REPRODUÇÃO: rodada relançada estacionou; autor pede revisão de novo; hoje nada destrava', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 60 * MIN }));
  e.reReviewLaunched[KEY] = { head: H2, dia: '2026-09-09', rodadas: 1, at: AGORA - 50 * MIN };
  e.autoReviewParked.add(KEY);
  e.parkedMotivos[KEY] = { at: new Date(AGORA - 40 * MIN).toISOString(), motivo: 'x', tipo: 'falha' };
  assert.equal(reviewMod.classificaReRound(e, { ...e.panorama[0] }, new Set(), AGORA), null);
  const cands = destrava.candidatosDestrave(e, new Set());
  assert.deepEqual(cands.map(c => [c.key, c.tipo]), [[KEY, 'presa']]);
});

test('candidatos: cancelado por você, ignorado, sem atividade depois da parada e em andamento ficam de fora', () => {
  const base = () => {
    const e = engineBase();
    e.autoReviewParked.add(KEY);
    e.parkedMotivos[KEY] = { at: new Date(AGORA - 40 * MIN).toISOString(), motivo: 'x', tipo: 'falha' };
    return e;
  };
  assert.equal(destrava.candidatosDestrave(base(), new Set()).length, 1, 'estacionado por falha com atividade nova entra');
  const cancelado = base(); cancelado.parkedMotivos[KEY].tipo = 'cancelado';
  assert.equal(destrava.candidatosDestrave(cancelado, new Set()).length, 0);
  const quieto = base(); quieto.panorama[0].updatedAt = new Date(AGORA - 50 * MIN).toISOString();
  assert.equal(destrava.candidatosDestrave(quieto, new Set()).length, 0);
  assert.equal(destrava.candidatosDestrave(base(), new Set([KEY])).length, 0);
  const pulado = engineBase();
  pulado.seen.add(KEY);
  pulado.decisions.resolved.push({ key: KEY, status: 'skipped', action: 'skip', headSha: H1, resolvedAt: AGORA - 30 * MIN });
  assert.deepEqual(destrava.candidatosDestrave(pulado, new Set()).map(c => c.tipo), ['pulado']);
  pulado.ignorados.add(KEY);
  assert.equal(destrava.candidatosDestrave(pulado, new Set()).length, 0, 'ignorar é descarte deliberado');
  const naoPedido = engineBase();
  naoPedido.seen.add(KEY);
  naoPedido.mineKeys = new Set();
  naoPedido.decisions.resolved.push({ key: KEY, status: 'skipped', action: 'skip', resolvedAt: AGORA - 30 * MIN });
  assert.equal(destrava.candidatosDestrave(naoPedido, new Set()).length, 0, 'Pular de PR que não pediu minha revisão não volta');
});

function timeline(linhas) {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args.join(' ')); return { ok: true, code: 0, stdout: linhas.join('\n'), stderr: '' }; };
  return { run, chamadas };
}

test('sinal: pedido de revisão pra MIM depois da parada conta; pra outra pessoa ou antes, não', async () => {
  const e = engineBase();
  const cand = { key: KEY, tipo: 'pulado', pr: e.panorama[0], desde: AGORA - 30 * MIN, headConhecido: H1 };
  const antes = new Date(AGORA - 40 * MIN).toISOString(), depois = new Date(AGORA - 5 * MIN).toISOString();
  e.headSha = async () => H1;
  const { run, chamadas } = timeline([`review_requested\t${antes}\trevisora\t`, `review_requested\t${depois}\tana\t`]);
  assert.equal(await destrava.sinalDeEstadoNovo(e, cand, run), null);
  assert.match(chamadas[0], /repos\/acme\/r\/issues\/1\/timeline/);
  const ok = timeline([`review_requested\t${depois}\tRevisora\t`]);
  const s = await destrava.sinalDeEstadoNovo(e, cand, ok.run);
  assert.deepEqual([s.tipo, s.at], ['pedido', AGORA - 5 * MIN]);
});

test('sinal: push depois da parada traz o head novo; sem evento na timeline, head diferente do conhecido também vale', async () => {
  const e = engineBase();
  const cand = { key: KEY, tipo: 'presa', pr: e.panorama[0], desde: AGORA - 30 * MIN, headConhecido: H2 };
  const depois = new Date(AGORA - 5 * MIN).toISOString();
  const s = await destrava.sinalDeEstadoNovo(e, cand, timeline([`head_ref_force_pushed\t${depois}\t\t${H3}`]).run);
  assert.deepEqual([s.tipo, s.head, s.at], ['push', H3, AGORA - 5 * MIN]);
  e.headSha = async () => H3;
  const s2 = await destrava.sinalDeEstadoNovo(e, cand, timeline([]).run);
  assert.deepEqual([s2.tipo, s2.head], ['push', H3]);
  e.headSha = async () => H2;
  assert.equal(await destrava.sinalDeEstadoNovo(e, cand, timeline([]).run), null);
  e.headSha = async () => '';
  assert.equal(await destrava.sinalDeEstadoNovo(e, cand, timeline([]).run), null, 'head desconhecido nunca inventa sinal');
});

test('sinal: timeline que falha não destrava nada', async () => {
  const e = engineBase();
  e.headSha = async () => { throw new Error('rede'); };
  const run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'HTTP 502' });
  const cand = { key: KEY, tipo: 'presa', pr: e.panorama[0], desde: AGORA - 30 * MIN, headConhecido: H2 };
  assert.equal(await destrava.sinalDeEstadoNovo(e, cand, run), null);
});

test('destrave da pendência presa: sai do estacionamento, âncora solta, head e relógio novos, e o round volta sozinho', () => {
  const e = engineBase();
  e.decisions.pending.push(pendStale({ createdAt: AGORA - 60 * MIN }));
  e.reReviewLaunched[KEY] = { head: H2, dia: '2026-09-09', rodadas: 1, at: AGORA - 50 * MIN };
  e.autoReviewParked.add(KEY);
  e.parkedMotivos[KEY] = { at: new Date(AGORA - 40 * MIN).toISOString(), motivo: 'x', tipo: 'falha' };
  const [cand] = destrava.candidatosDestrave(e, new Set());
  destrava.aplicarDestrave(e, cand, { tipo: 'push', at: AGORA - 10 * MIN, head: H3 });
  assert.equal(e.autoReviewParked.has(KEY), false);
  assert.equal(e.reReviewLaunched[KEY].head, '');
  assert.equal(e.decisions.pending[0].blockedHead, H3);
  assert.equal(e.decisions.pending[0].headQuietoDesde, AGORA - 10 * MIN);
  assert.equal(reviewMod.classificaReRound(e, { ...e.panorama[0] }, new Set(), AGORA), 'relanca');
  assert.equal(destrava.candidatosDestrave(e, new Set()).length, 0, 'o mesmo sinal não destrava duas vezes');
  assert.match(e.toasts[0], /commit novo/);
});

test('destrave do estacionado e do pulado: volta pra fila visível e pra fila automática', () => {
  const e = engineBase();
  e.seen.add(KEY);
  e.autoReviewParked.add(KEY);
  e.parkedMotivos[KEY] = { at: new Date(AGORA - 40 * MIN).toISOString(), motivo: 'x', tipo: 'esgotado' };
  const [cand] = destrava.candidatosDestrave(e, new Set());
  destrava.aplicarDestrave(e, cand, { tipo: 'pedido', at: AGORA - 5 * MIN, head: '' });
  assert.equal(e.autoReviewParked.has(KEY), false);
  assert.equal(e.seen.has(KEY), false);
  assert.deepEqual(e.queue.map(p => p.key), [KEY]);
  assert.match(e.toasts[0], /pediram revisão de novo/);

  const p = engineBase();
  p.seen.add(KEY);
  p.decisions.resolved.push({ key: KEY, status: 'skipped', action: 'skip', headSha: H1, resolvedAt: AGORA - 30 * MIN });
  const [cp] = destrava.candidatosDestrave(p, new Set());
  destrava.aplicarDestrave(p, cp, { tipo: 'push', at: AGORA - 5 * MIN, head: H2 });
  assert.equal(p.seen.has(KEY), false);
  assert.deepEqual(p.queue.map(x => x.key), [KEY]);
  assert.equal(destrava.candidatosDestrave(p, new Set()).length, 0);
});

test('destravarPorEstadoNovo amarra candidato, sinal e ação, e poda marcador de PR que saiu', async () => {
  const e = engineBase();
  e.seen.add(KEY);
  e.decisions.resolved.push({ key: KEY, status: 'skipped', action: 'skip', headSha: H1, resolvedAt: AGORA - 30 * MIN });
  e.destravados['sumiu/r#9'] = AGORA - 60 * MIN;
  e.headSha = async () => H1;
  const depois = new Date(AGORA - 5 * MIN).toISOString();
  await destrava.destravarPorEstadoNovo(e, timeline([`review_requested\t${depois}\trevisora\t`]).run);
  assert.equal(e.seen.has(KEY), false);
  assert.equal(e.destravados[KEY], AGORA - 5 * MIN);
  assert.equal('sumiu/r#9' in e.destravados, false);
});

test('estacionar guarda o head lido quando existe (é o que prova commit novo depois)', () => {
  const e = engineBase();
  reviewMod.estacionar(e, KEY, 'boom', 'falha', H1);
  assert.equal(e.parkedMotivos[KEY].head, H1);
  reviewMod.estacionar(e, 'outra/r#2', 'boom', 'falha');
  assert.equal('head' in e.parkedMotivos['outra/r#2'], false);
});
