// Task 5: launchReReviews fecha o ciclo. Complementa test/rereview.test.js (que já
// cobre o pulo de push trivial e a fiação básica) com o que faltava: a âncora nova
// {head, dia, rodadas} (em vez do head cru lido de staleInfo, que é undefined no
// gatilho B), o knownHead vindo de pr._headRound (cobre os dois gatilhos) e o aviso
// de teto diário.
import test, { after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-relaunch-'));
const { Engine } = await import('../server.js');

// O FAROL_HOME de teste e apagado no fim. Sem isto cada rodada da suite deixa um
// diretorio para tras: medido em 6 por rodada, somando mais de mil na maquina.
after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});

const { MAX_RODADAS_AUTO_DIA, diaLocal } = await import('../lib/engine/review.js');
const { TEMPOS } = await import('../lib/constants.js');
const { saveFileProof } = await import('../lib/engine/file-proof.js');

const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
// tempos relativos ao Date.now() real: launchReReviews usa Date.now() por dentro,
// então não dá pra semear um AGORA fixo, só garantir que os carimbos já passaram
// do debounce de head quieto.
const QUIETO = Date.now() - TEMPOS.HEAD_QUIETO_MS - 1000;
const HOJE = diaLocal(Date.now());

function engineBase() {
  const e = Object.create(Engine.prototype);
  e.panorama = [{ key: 'acme/r#1', repo: 'acme/r', number: 1, url: 'u', isDraft: false }];
  e.staleInfo = {};
  e.headQuietoDesde = {};
  e.reReviewLaunched = {};
  e.decisions = { pending: [], resolved: [] };
  e.autoReviewParked = new Set();
  e.retryAfterNet = new Map();
  e.skipComentado = {};
  e.accountForPr = () => 'conta';
  e.isMuted = () => false;
  e.autoReviewFor = () => true;
  e.tokenFor = () => 'tok';
  e.budgetBlockedFor = () => false;
  e.outrosRevisando = () => [];
  e.headlessQueue = [];
  e.activeReviews = new Map();
  e.saveReReviewLaunched = () => {};
  e.log = () => {};
  // sem prova salva: launchReReviews não chega a chamar fetchPrFiles no caminho
  // comum, mas o stub existe pra garantir que, se chamar, o teste denuncia (o
  // brief pede exatamente esse stub: 'sem prova' significa que nunca deveria ir
  // ao gh sem prova em disco).
  e.fetchPrFiles = async () => { throw new Error('sem prova'); };
  // gate de consciência sempre livre (senão o prototype real iria ao gh); a
  // suíte dele é test/consciencia-historico.test.js
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  return e;
}

test('relançamento grava âncora nova {head, dia, rodadas} e passa knownHead do gatilho', async () => {
  const enfileirados = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = () => {};
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.reReviewLaunched['acme/r#1'] = { head: H1, dia: HOJE, rodadas: 1 };

  await e.launchReReviews();

  const a = e.reReviewLaunched['acme/r#1'];
  assert.equal(a.head, H2);
  assert.equal(a.rodadas, 2);
  assert.equal(enfileirados.length, 1);
  assert.equal(enfileirados[0].knownHead, H2);
  assert.equal(enfileirados[0].requested, true);
});

test('gatilho B (pendência stale_head): knownHead vem do blockedHead', async () => {
  const enfileirados = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = () => {};
  e.decisions.pending.push({ key: 'acme/r#1', blockedKind: 'stale_head', blockedHead: H2, createdAt: QUIETO });

  await e.launchReReviews();

  assert.equal(enfileirados.length, 1);
  assert.equal(enfileirados[0].knownHead, H2);
});

test('toast de relançamento não menciona mais só pedido de mudanças', async () => {
  const eventos = [];
  const e = engineBase();
  e.enqueueHeadless = () => {};
  e.emit = (ev, dados) => eventos.push({ ev, dados });
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'APPROVED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };

  await e.launchReReviews();

  const toast = eventos.find(x => x.ev === 'toast');
  assert.ok(toast, 'toast de relançamento tem que sair');
  assert.ok(!/pedido de mudanças/.test(toast.dados.text));
  assert.match(toast.dados.text, /commit novo depois da sua revisão/);
});

// I2: alvo do gatilho B (pendência stale_head na mesa) nunca pode cair no pulo de
// push trivial. A prova salva é do head ANTERIOR ao bloqueio (a sessão que a
// gravou nem chegou a postar); se o diff efetivo do head novo medir "igual" a
// essa prova, pular emitiria "a revisão anterior segue valendo" sem NENHUMA
// revisão ter sido postada, e a âncora já queimou o head novo: deadlock com
// toast falso.
const MESMOS_ARQUIVOS = [{ path: 'a.js', sha: 'shaA', status: 'modified', lines: 3 }];

test('gatilho B (stale_head) nunca pula, mesmo com diff efetivo idêntico à prova salva', async () => {
  const enfileirados = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = () => {};
  saveFileProof('acme/r#1', { head: H1, files: MESMOS_ARQUIVOS, reviewed: ['a.js'] });
  // se launchReReviews chamar fetchPrFiles pra este alvo, o teste falharia: o
  // ponto do fix é NUNCA medir/pular quando há pendência stale_head na mesa.
  e.fetchPrFiles = async () => { throw new Error('não deveria medir push trivial pro gatilho B'); };
  e.decisions.pending.push({ key: 'acme/r#1', blockedKind: 'stale_head', blockedHead: H2, createdAt: QUIETO });

  await e.launchReReviews();

  assert.equal(enfileirados.length, 1, 'gatilho B relança sempre, sem pulo');
  assert.equal(enfileirados[0].key, 'acme/r#1');
});

test('gatilho A (review meu stale) continua pulando quando o diff efetivo é idêntico à prova salva', async () => {
  const enfileirados = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = () => {};
  saveFileProof('acme/r#1', { head: H1, files: MESMOS_ARQUIVOS, reviewed: ['a.js'] });
  e.fetchPrFiles = async () => MESMOS_ARQUIVOS;
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };

  await e.launchReReviews();

  assert.equal(enfileirados.length, 0, 'push trivial no gatilho A continua pulando');
});

// FIX 1: poda de headQuietoDesde e avisoRodadasDia (cresciam pra sempre em
// memória). Key fora do panorama (e fora de pendência stale_head) some dos
// dois mapas; key válida (aberta / aviso de hoje) sobrevive.
test('poda headQuietoDesde: key fora do panorama some, key aberta sobrevive', async () => {
  const e = engineBase();
  e.enqueueHeadless = () => {};
  e.emit = () => {};
  e.headQuietoDesde = {
    'acme/r#1': { head: H1, at: QUIETO }, // aberta (está no panorama)
    'fechado/pr#9': { head: H1, at: QUIETO }, // fora do panorama: poda
  };

  await e.launchReReviews();

  assert.ok('acme/r#1' in e.headQuietoDesde, 'key aberta preservada');
  assert.ok(!('fechado/pr#9' in e.headQuietoDesde), 'key fora do panorama podada');
});

test('poda headQuietoDesde: key de pendência stale_head fora do panorama sobrevive', async () => {
  const e = engineBase();
  e.enqueueHeadless = () => {};
  e.emit = () => {};
  e.panorama = [];
  e.headQuietoDesde = { 'outra/org#9': { head: H1, at: QUIETO } };
  e.decisions.pending.push({ key: 'outra/org#9', blockedKind: 'stale_head', blockedHead: H1, createdAt: Date.now() });

  await e.launchReReviews();

  assert.ok('outra/org#9' in e.headQuietoDesde, 'pendência stale_head conta como aberta');
});

test('poda avisoRodadasDia: entrada de dia anterior some, entrada de hoje sobrevive', async () => {
  const e = engineBase();
  e.enqueueHeadless = () => {};
  e.emit = () => {};
  e.avisoRodadasDia = new Set([
    `acme/r#1:${HOJE}`,
    'acme/r#1:2020-01-01',
  ]);

  await e.launchReReviews();

  assert.ok(e.avisoRodadasDia.has(`acme/r#1:${HOJE}`), 'aviso de hoje preservado');
  assert.ok(!e.avisoRodadasDia.has('acme/r#1:2020-01-01'), 'aviso de dia anterior podado');
});

test('teto esgotado avisa UMA vez por PR por dia e nunca enfileira', async () => {
  const enfileirados = [];
  const eventos = [];
  const e = engineBase();
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.emit = (ev, dados) => eventos.push({ ev, dados });
  e.staleInfo['acme/r#1'] = { stale: true, head: H2, lastState: 'CHANGES_REQUESTED' };
  e.headQuietoDesde['acme/r#1'] = { head: H2, at: QUIETO };
  e.reReviewLaunched['acme/r#1'] = { head: H1, dia: HOJE, rodadas: MAX_RODADAS_AUTO_DIA };

  await e.launchReReviews();
  await e.launchReReviews();

  const avisos = eventos.filter(x => x.ev === 'toast' && /rodadas automáticas/.test(x.dados.text));
  assert.equal(avisos.length, 1);
  assert.equal(enfileirados.length, 0);
});

/* AUTONOMIA PERDIDA NO COMMIT DURANTE A SESSÃO (bug de campo relatado em
   29/08/2026). A cadeia: a sessão lê H1, o autor empurra H2 no meio, o gate de
   postagem recusa por head que andou e grava pendência stale_head. O round
   automático existe pra fechar isso sozinho, mas `launchReReviews` gravava a
   ÂNCORA de todos os alvos ANTES de consultar o gate de consciência; alvo
   bloqueado saía pelo `continue` com a âncora já queimada, e o
   `classificaReRound` nunca mais devolvia 'relanca' pra aquele head. Resultado
   visto pelo Wanderson: o PR fica esperando clique, e o clique gera um round
   que precisa de clique de novo. O G7 do recoverInflight já tinha identificado
   essa classe de defeito no caminho do CRASH; o caminho do BLOQUEIO ficou. */

function engineBloqueavel(bloqueado) {
  const e = engineBase();
  e.staleInfo = { 'acme/r#1': { stale: true, head: H2, lastState: 'APPROVED' } };
  e.headQuietoDesde = { 'acme/r#1': { head: H2, at: QUIETO } };
  e.chamadasDoGate = 0;
  e.bloqueadoPorHistorico = async () => {
    e.chamadasDoGate++;
    return bloqueado
      ? { bloqueado: true, head: H2, quem: ['ana'], decisivos: [{ quem: 'ana', state: 'APPROVED' }] }
      : { bloqueado: false, head: H2, quem: [], decisivos: [] };
  };
  e.emit = () => {};
  return e;
}

test('alvo BLOQUEADO pelo gate não queima a âncora (o round não rodou)', async () => {
  const e = engineBloqueavel(true);
  e.enqueueHeadless = () => { throw new Error('não devia enfileirar bloqueado'); };
  await e.launchReReviews();
  assert.equal(e.reReviewLaunched['acme/r#1'], undefined,
    'âncora gravada sem round mata o relançamento automático pra sempre naquele head');
});

test('quando o bloqueio sai, o round relança sozinho, sem clique', async () => {
  const e = engineBloqueavel(true);
  e.enqueueHeadless = () => {};
  await e.launchReReviews();
  // o bloqueio saiu (a pessoa dispensou o review, ou era ferramenta mal contada)
  const enfileirados = [];
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: H2, quem: [], decisivos: [] });
  e.enqueueHeadless = (p) => enfileirados.push(p);
  e.bloqueioConsultado = {}; // passou a janela de reconsulta
  await e.launchReReviews();
  assert.equal(enfileirados.length, 1, 'o round tem que voltar sozinho quando o motivo do bloqueio some');
  assert.equal(enfileirados[0].requested, true, 'round automático posta conforme a política, não vira clique');
});

test('bloqueio não é reconsultado a cada ciclo (o custo de gh continua sob controle)', async () => {
  const e = engineBloqueavel(true);
  e.enqueueHeadless = () => {};
  await e.launchReReviews();
  await e.launchReReviews();
  await e.launchReReviews();
  assert.equal(e.chamadasDoGate, 1, 'a janela de reconsulta segura as chamadas repetidas do mesmo head');
});

/* LABEL PRESA POR MORTE DO PROCESSO (mesma rodada de 29/08/2026). O finally que
   remove `<conta>:revisando` não roda quando o app morre; a label ficava no PR
   pra sempre e a frota inteira saía de cena por uma sessão inexistente. */
test('limparLabelsOrfas: remove a label da conta dona em cada PR que estava inflight', async () => {
  const { limparLabelsOrfas } = await import('../lib/engine/review.js');
  const chamadas = [];
  const e = { accountForPr: () => 'euzinho', tokenFor: () => 'tok', ghEnv: () => ({}), log: () => {} };
  const prs = [{ key: 'o/r#1', url: 'u1' }, { key: 'o/r#2', url: 'u2' }];
  await limparLabelsOrfas(e, prs, async (cmd, args) => { chamadas.push(args.join(' ')); return { ok: true }; });
  assert.deepEqual(chamadas, [
    'pr edit u1 --remove-label euzinho:revisando',
    'pr edit u2 --remove-label euzinho:revisando',
  ]);
});

test('limparLabelsOrfas: conta sem token e PR sem url são pulados, e falha do gh não lança', async () => {
  const { limparLabelsOrfas } = await import('../lib/engine/review.js');
  const chamadas = [];
  const e = { accountForPr: () => 'euzinho', tokenFor: (a) => a === 'euzinho' ? '' : 'tok', ghEnv: () => ({}), log: () => {} };
  await limparLabelsOrfas(e, [{ key: 'o/r#1', url: 'u1' }], async () => { chamadas.push('foi'); return { ok: true }; });
  assert.deepEqual(chamadas, [], 'sem token não fala com o gh');
  const e2 = { accountForPr: () => 'euzinho', tokenFor: () => 'tok', ghEnv: () => ({}), log: () => {} };
  await limparLabelsOrfas(e2, [{ key: 'o/r#2' }], async () => { throw new Error('boom'); });
  await limparLabelsOrfas(e2, [{ key: 'o/r#3', url: 'u3' }], async () => { throw new Error('boom'); });
});
