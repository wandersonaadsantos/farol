// Re-revisão automática pós-push (round 2 sem clique): quando EU pedi mudanças num PR
// e o autor empurrou commit novo, o PR volta pra fila de revisão headless sozinho, em
// vez de esperar você notar o push e clicar Re-revisar (era o elo manual do ciclo:
// o Farol abria o round rápido e fechava passivo, medido no biud-frontend#756).
//
// O gate (reReviewTargets) é SÍNCRONO e sem IO pelo mesmo motivo do retryTargets e do
// pushbackTargets: é ele que decide gastar sessão Claude, então tem que ser testável
// sem rede. A âncora por head (reReviewLaunched) garante que cada estado do PR é
// relançado NO MÁXIMO uma vez: falha da revisão cai nos fluxos de retry/estacionamento
// de sempre, e só um head NOVO reabre o gate.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
// atribuição INCONDICIONAL (padrão dos outros arquivos da rede): o `after` daqui apaga
// recursivamente o FAROL_HOME, então respeitar um valor herdado do shell faria um
// `npm test` de quem exporta FAROL_HOME deletar o diretório real dele.
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-rereview-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const reviewMod = (await import('../lib/engine/review.js')).default;
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const KEY = 'org/app#7';

function engineBase() {
  const pr = { key: KEY, url: 'https://github.com/org/app/pull/7', author: 'dev' };
  const e = {
    pr,
    panorama: [pr],
    staleInfo: { [KEY]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    // debounce (v2.53.0): head visto há muito tempo, pra estes testes armarem o
    // gate sem precisar semear em cada um. at: 0 é "quieto" com qualquer agora real.
    headQuietoDesde: { [KEY]: { head: 'sha-novo', at: 0 } },
    reReviewLaunched: {},
    decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(),
    retryAfterNet: new Map(),
    headlessQueue: [],
    activeReviews: new Map(),
    saved: 0,
    enq: [],
    toasts: [],
    accountForPr: () => 'eu',
    isMuted: () => false,
    autoReviewFor: () => true,
    tokenFor: () => 'tok',
    budgetBlockedFor: () => null,
    // ninguém mais revisando: o gate de pulo (v2.48.4) lê isto e o default do
    // stub é "só eu", pra estes testes seguirem falando só de re-revisão
    outrosRevisando: () => [],
    saveReReviewLaunched() { this.saved++; },
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    enqueueHeadless(p) { this.enq.push(p); },
  };
  return e;
}

function targets(e) { return reviewMod.reReviewTargets(e, new Set()); }

/* ---------- o caso que a feature existe pra pegar ---------- */

test('reReviewTargets: pedi mudanças + head novo + gates ok = alvo', () => {
  const e = engineBase();
  assert.deepEqual(targets(e).map(p => p.key), [KEY]);
});

/* ---------- o que NUNCA pode relançar ---------- */

// Até a v2.52.x, aprovação stale NÃO relançava round nenhum (só pedido de
// mudanças fechava). Invertido na v2.53.0 (decisão do Wanderson, 25/08/2026,
// medida no engine-ai#90): PR iterativo travava no primeiro APPROVE, porque
// nada reabria o gate pro round seguinte. Autonomia de verdade cobre os dois
// vereditos; ver classificaReRound em lib/engine/review.js.
test('reReviewTargets: aprovação stale TAMBÉM relança (autonomia cobre os dois vereditos)', () => {
  const e = engineBase();
  e.staleInfo[KEY].lastState = 'APPROVED';
  assert.deepEqual(targets(e).map(p => p.key), [KEY]);
});

test('reReviewTargets: PR em rascunho não relança sozinho (G10, chip manual segue cobrindo)', () => {
  const e = engineBase();
  e.panorama[0].isDraft = true;
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: espelho, PR fora de rascunho continua armando (G10)', () => {
  const e = engineBase();
  e.panorama[0].isDraft = false;
  assert.deepEqual(targets(e).map(p => p.key), [KEY]);
});

test('reReviewTargets: sem commit novo depois do meu review, nada acontece', () => {
  const e = engineBase();
  e.staleInfo[KEY].stale = false;
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: sem head conhecido não relança (incerteza nunca gasta sessão)', () => {
  const e = engineBase();
  e.staleInfo[KEY].head = '';
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: head já relançado não repete; head mais novo reabre', () => {
  const e = engineBase();
  e.reReviewLaunched[KEY] = 'sha-novo';
  assert.deepEqual(targets(e), [], 'mesma âncora = já cuidei deste estado');
  e.staleInfo[KEY].head = 'sha-mais-novo';
  e.headQuietoDesde[KEY] = { head: 'sha-mais-novo', at: 0 };
  assert.deepEqual(targets(e).map(p => p.key), [KEY], 'push novo reabre o gate');
});

// Pendência VIVA (sem blockedKind) continua segurando: julgamento é seu. Pendência
// bloqueada por stale_head NÃO segura mais (v2.53.0): ela é o sintoma que o gatilho
// B existe pra resolver, ver classificaReRound.
test('reReviewTargets: pendência VIVA na sua mesa segura o relançamento (um card por vez)', () => {
  const e = engineBase();
  e.decisions.pending.push({ key: KEY, status: 'pending' });
  assert.deepEqual(targets(e), []);
});

test('reReviewTargets: respeita as mesmas travas de conta do toReview', () => {
  for (const quebra of [
    e => { e.isMuted = () => true; },
    e => { e.autoReviewFor = () => false; },
    e => { e.tokenFor = () => null; },
    e => { e.autoReviewParked.add(KEY); },
    e => { e.retryAfterNet.set(KEY, { tries: 1 }); },
    e => { e.budgetBlockedFor = () => ({ id: 'p1', label: 'perfil' }); },
  ]) {
    const e = engineBase();
    quebra(e);
    assert.deepEqual(targets(e), []);
  }
});

test('reReviewTargets: PR já na fila headless ou rodando fica de fora', () => {
  const e = engineBase();
  assert.deepEqual(reviewMod.reReviewTargets(e, new Set([KEY])), []);
});

/* ---------- launchReReviews: âncora, persistência e a fila ---------- */

test('launchReReviews: ancora o head, persiste e enfileira como revisão pedida a mim', async () => {
  const e = engineBase();
  await reviewMod.launchReReviews(e);
  assert.equal(e.reReviewLaunched[KEY], 'sha-novo', 'âncora gravada ANTES de enfileirar');
  assert.equal(e.saved, 1, 'âncora persistida');
  assert.equal(e.enq.length, 1);
  assert.equal(e.enq[0].key, KEY);
  assert.equal(e.enq[0].requested, true,
    'round 2 de um review meu é continuação do engajamento, não clique avulso: ' +
    'a postagem continua atrás do shouldAutoApprove/shouldAutoReject de sempre');
  assert.equal(e.enq[0].account, 'eu');
});

// G8: o gate SÓ arma com head conhecido (reReviewTargets exige info.head), então esse
// head já é prova. Carregá-lo no objeto enfileirado evita que um flake de gh no início
// da sessão de revisão degrade o dedup pro comportamento antigo e mate o round 2 como
// already_reviewed, justamente com a âncora do relançamento já queimada.
test('re-revisão enfileira o PR com o head que o staleInfo conheceu', async () => {
  const e = engineBase();
  await reviewMod.launchReReviews(e);
  assert.equal(e.enq.length, 1);
  assert.equal(e.enq[0].knownHead, e.staleInfo[KEY].head,
    'o head que armou o gate viaja junto pra ser o fallback do headSha da sessão');
  assert.equal(e.enq[0].requested, true);
});

test('launchReReviews: segunda passada com a mesma âncora não enfileira de novo', async () => {
  const e = engineBase();
  await reviewMod.launchReReviews(e);
  await reviewMod.launchReReviews(e);
  assert.equal(e.enq.length, 1);
});

test('launchReReviews: poda âncora de PR que saiu do panorama (fechou/mergeou)', async () => {
  const e = engineBase();
  e.reReviewLaunched['org/app#99'] = 'sha-fechado';
  await reviewMod.launchReReviews(e);
  assert.equal('org/app#99' in e.reReviewLaunched, false);
});

test('launchReReviews: sem alvo e sem órfão, não persiste nem toca a fila', async () => {
  const e = engineBase();
  e.staleInfo[KEY].stale = false;
  await reviewMod.launchReReviews(e);
  assert.equal(e.saved, 0);
  assert.deepEqual(e.enq, []);
});

/* ---------- push trivial: prova por arquivo evita o round 2 inútil ---------- */

const { saveFileProof, fileProofPath } = await import('../lib/engine/file-proof.js');
// os testes deste bloco compartilham o FAROL_HOME do arquivo: cada um deixa a
// prova de KEY no estado que o cenário pede (gravando ou apagando), sem depender
// da ordem dos anteriores
function limpaProva(key) { try { fs.rmSync(fileProofPath(key)); } catch { /* já não existia */ } }
const ARQUIVOS = [
  { path: 'src/a.ts', sha: 'blob-a', status: 'modified', lines: 10 },
  { path: 'src/b.ts', sha: 'blob-b', status: 'added', lines: 5 },
];

test('launchReReviews: push que não muda o diff efetivo NÃO gasta sessão (âncora fica)', async () => {
  const e = engineBase();
  saveFileProof(KEY, { head: 'sha-velho', files: ARQUIVOS, reviewed: ['src/a.ts', 'src/b.ts'] });
  // o diff atual é byte a byte o que a última sessão leu (rebase limpo, merge da base)
  e.fetchPrFiles = async () => ARQUIVOS.map(f => ({ ...f }));
  await reviewMod.launchReReviews(e);
  assert.deepEqual(e.enq, [], 'diff efetivo idêntico: nenhuma sessão aberta');
  assert.equal(e.reReviewLaunched[KEY], 'sha-novo',
    'a âncora do head novo fica gravada: o pulo vale até o próximo push de verdade');
  assert.ok(e.toasts.some(t => t.ev === 'toast' && /não mudou o diff efetivo/.test(t.payload.text)),
    'o pulo é avisado, nunca silencioso');
});

test('launchReReviews: push com mudança real relança normalmente mesmo com prova salva', async () => {
  const e = engineBase();
  saveFileProof(KEY, { head: 'sha-velho', files: ARQUIVOS, reviewed: ['src/a.ts', 'src/b.ts'] });
  e.fetchPrFiles = async () => [{ ...ARQUIVOS[0], sha: 'blob-a-v2' }, { ...ARQUIVOS[1] }];
  await reviewMod.launchReReviews(e);
  assert.equal(e.enq.length, 1, 'blob mudou: round 2 de verdade');
});

test('launchReReviews: medição falhando relança (na dúvida, a revisão roda)', async () => {
  const e = engineBase();
  saveFileProof(KEY, { head: 'sha-velho', files: ARQUIVOS, reviewed: [] });
  e.fetchPrFiles = async () => { throw new Error('rede caiu'); };
  await reviewMod.launchReReviews(e);
  assert.equal(e.enq.length, 1);
});

test('launchReReviews: sem prova salva nem consulta o gh (zero custo extra no caso comum)', async () => {
  const e = engineBase();
  limpaProva(KEY);
  let chamou = false;
  e.fetchPrFiles = async () => { chamou = true; return null; };
  await reviewMod.launchReReviews(e);
  assert.equal(chamou, false, 'sem prova em disco, o pulls/files não é consultado');
  assert.equal(e.enq.length, 1);
});

/* ---------- resume do round 2: o sid do round anterior viaja no enfileiramento ---------- */

test('launchReReviews: carrega o sessionId da última decisão do PR (retomada opt-in)', async () => {
  const e = engineBase();
  limpaProva(KEY);
  e.decisions.resolved.push({ key: KEY, sessionId: 'sess-round-1-uuid' });
  await reviewMod.launchReReviews(e);
  assert.equal(e.enq[0].resumeSid, 'sess-round-1-uuid');
});

test('lastReviewSessionId: pending vence resolved e ausência devolve vazio', () => {
  const e = { decisions: { pending: [{ key: KEY, sessionId: 'sid-pending' }], resolved: [{ key: KEY, sessionId: 'sid-old' }] } };
  assert.equal(reviewMod.lastReviewSessionId(e, KEY), 'sid-pending');
  assert.equal(reviewMod.lastReviewSessionId({ decisions: { pending: [], resolved: [] } }, KEY), '');
  assert.equal(reviewMod.lastReviewSessionId({}, KEY), '');
});

/* ---------- recoverInflight: poda a âncora do round 2 (G7) ---------- */

test('recoverInflight poda a âncora de re-revisão dos PRs que estavam em andamento', () => {
  // monta o FAROL_HOME temporário do processo com:
  //  - state/inflight.json = [{ key: 'acme/repo#5', url: '...', title: 't' }]
  //  - state/rereview-launched.json = { 'acme/repo#5': 'a'.repeat(40), 'acme/outro#6': 'b'.repeat(40) }
  // ANTES do new Engine(), padrão dos testes de boot em test/boot.test.js.
  const stateDir = path.join(process.env.FAROL_HOME, 'workspace', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'inflight.json'), JSON.stringify([
    { key: 'acme/repo#5', url: 'https://github.com/acme/repo/pull/5', title: 't' },
  ]));
  fs.writeFileSync(path.join(stateDir, 'rereview-launched.json'), JSON.stringify({
    'acme/repo#5': 'a'.repeat(40),
    'acme/outro#6': 'b'.repeat(40),
  }));

  const e = new Engine();
  assert.equal(e.reReviewLaunched['acme/repo#5'], undefined, 'âncora do PR interrompido foi podada');
  assert.equal(e.reReviewLaunched['acme/outro#6'], 'b'.repeat(40), 'âncora alheia intacta');
});
