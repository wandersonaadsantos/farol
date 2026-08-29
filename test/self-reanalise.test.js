/* RELANÇAMENTO DA AUTOANÁLISE (bug de campo relatado pelo Wanderson em
   29/08/2026). A autoanálise só existia por CLIQUE: `launchSelfAnalysis` tinha
   um único chamador, a rota /api/self-review. Quando entrava commit novo, o
   resultado era descartado nos dois caminhos (`enrichMyPRBranches` no ciclo
   seguinte, e a re-checagem pós-sessão do `runSelfAnalysis`) e ninguém
   relançava: o código dizia, na letra, "sem re-enfileirar (relançar é decisão
   do usuário)". O farol.log desta máquina registrou 10 análises jogadas fora em
   3 dias (biud-frontend#845 três vezes), cada uma com sessão gasta e zero
   entrega. Uma análise que VOCÊ pediu e que um commit invalidou volta sozinha
   sobre o head novo, com as MESMAS três travas do round de review: debounce de
   head quieto, âncora por head e teto diário. */
import test from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-selfre-'));
const selfMod = (await import('../lib/engine/selfpr.js')).default;
const { MAX_RODADAS_AUTO_DIA, diaLocal } = await import('../lib/engine/review.js');
const { TEMPOS } = await import('../lib/constants.js');

const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
const AGORA = 1_800_000_000_000;
const QUIETO = AGORA - TEMPOS.HEAD_QUIETO_MS - 1000;

function engineBase() {
  return {
    myPRs: [{ key: 'o/r#1', repo: 'o/r', number: 1, url: 'u1', headSha: H2, isDraft: false }],
    selfAnalyses: {},
    selfReanalisePendente: { 'o/r#1': { head: H2, at: QUIETO } },
    selfReanaliseLancada: {},
    headlessQueue: [],
    activeReviews: new Map(),
    autoReviewParked: new Set(),
    accountForPr: () => 'conta',
    tokenFor: () => 'tok',
    isMuted: () => false,
    autoReviewFor: () => true,
    budgetBlockedFor: () => null,
    saveSelfReanalise: () => {},
    processHeadless: () => {},
    pushState: () => {},
    emit: () => {},
    log: () => {},
  };
}

test('análise invalidada por commit novo volta sozinha, sem clique', async () => {
  const e = engineBase();
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 1);
  assert.equal(e.headlessQueue[0].key, 'o/r#1');
  assert.equal(e.headlessQueue[0].kind, 'self', 'entra pela mesma fila da autoanálise de clique');
});

test('debounce: head que acabou de mudar espera a janela de quietude', async () => {
  const e = engineBase();
  e.selfReanalisePendente['o/r#1'].at = AGORA - 1000;
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 0, 'rajada de pushes não vira uma sessão por push');
});

test('head andou de novo desde a intenção: re-carimba e espera, não gasta sessão', async () => {
  const e = engineBase();
  e.myPRs[0].headSha = H1; // a intenção era sobre H2
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 0);
  assert.deepEqual(e.selfReanalisePendente['o/r#1'], { head: H1, at: AGORA },
    'o relógio recomeça no head novo, igual ao headQuietoDesde do round de review');
});

test('âncora por head: relança UMA vez por head', async () => {
  const e = engineBase();
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 1);
  e.headlessQueue = [];
  e.selfReanalisePendente['o/r#1'] = { head: H2, at: QUIETO };
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 0, 'mesmo head não gasta uma segunda sessão');
});

// a lição da v2.54.3: âncora que impede repetição só se grava depois do trabalho
test('alvo barrado por uma trava NÃO queima a âncora do head', async () => {
  const e = engineBase();
  e.autoReviewFor = () => false;
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.selfReanaliseLancada['o/r#1'], undefined,
    'senão o relançamento morre pra sempre naquele head quando a trava sair');
});

test('travas da conta: sem token, silenciada, orçamento estourado e draft não relançam', async () => {
  for (const quebra of [
    (e) => { e.tokenFor = () => ''; },
    (e) => { e.isMuted = () => true; },
    (e) => { e.budgetBlockedFor = () => ({ id: 'p', label: 'Perfil' }); },
    (e) => { e.myPRs[0].isDraft = true; },
    (e) => { e.autoReviewParked = new Set(['o/r#1']); },
  ]) {
    const e = engineBase();
    quebra(e);
    await selfMod.launchSelfReanalyses(e, AGORA);
    assert.equal(e.headlessQueue.length, 0);
  }
});

test('não duplica o que já está na fila nem o que está rodando', async () => {
  const e = engineBase();
  e.headlessQueue = [{ kind: 'self', key: 'o/r#1' }];
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 1);

  const e2 = engineBase();
  e2.activeReviews = new Map([['s1', { mode: 'self', keys: ['o/r#1'] }]]);
  await selfMod.launchSelfReanalyses(e2, AGORA);
  assert.equal(e2.headlessQueue.length, 0);
});

test('teto diário: para no limite e não relança mais naquele dia', async () => {
  const e = engineBase();
  e.selfReanaliseLancada['o/r#1'] = { head: H1, dia: diaLocal(AGORA), rodadas: MAX_RODADAS_AUTO_DIA };
  await selfMod.launchSelfReanalyses(e, AGORA);
  assert.equal(e.headlessQueue.length, 0, 'o teto do round de review vale igual aqui');
});

test('marcaReanalise: registra a intenção com o head novo', () => {
  const e = engineBase();
  e.selfReanalisePendente = {};
  selfMod.marcaReanalise(e, { key: 'o/r#9' }, H2, AGORA);
  assert.deepEqual(e.selfReanalisePendente['o/r#9'], { head: H2, at: AGORA });
});

test('marcaReanalise sem head não cria intenção cega', () => {
  const e = engineBase();
  e.selfReanalisePendente = {};
  selfMod.marcaReanalise(e, { key: 'o/r#9' }, '', AGORA);
  assert.equal(e.selfReanalisePendente['o/r#9'], undefined);
});

test('podarReanalise: PR que saiu dos meus PRs perde intenção e âncora', () => {
  const e = engineBase();
  e.selfReanalisePendente['o/r#99'] = { head: H1, at: AGORA };
  e.selfReanaliseLancada['o/r#99'] = { head: H1, dia: diaLocal(AGORA), rodadas: 1 };
  selfMod.podarReanalise(e, new Set(['o/r#1']));
  assert.equal(e.selfReanalisePendente['o/r#99'], undefined);
  assert.equal(e.selfReanaliseLancada['o/r#99'], undefined);
  assert.ok(e.selfReanalisePendente['o/r#1'], 'o que segue aberto fica');
});
