// Conta silenciada continua monitorada, mas nunca é a identidade que age (06/10/2026).
//
// Incidente: no Farol de um celular, o `gh` tinha duas contas cobrindo a org `biudtech`, a
// primeira silenciada (`wandersonbiuder`) e a segunda ativa (`Alexpraxedes`). O dono quis agir
// como o Alex num PR da org e a ação saiu como `wandersonbiuder`. As duas metades da correção
// moram em lib/engine/conta-que-age.js: RESOLVER (a org entrega a conta capaz, e o dedup das
// buscas segue o G18) e RECUSAR (escrita com conta silenciada não sai, e diz por quê).
//
// Padrões seguidos: espião no io.run antes do import do server.js (account-identity.test.js)
// e o engine de check() com as buscas roteirizadas (check-resilience.test.js).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-silenciada-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// espião no run: NENHUM gh real roda neste arquivo
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [], env: (opts || {}).env });
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');
const { STATE_DIR, BASELINE_FILE } = await import('../lib/paths.js');
const contasGh = (await import('../lib/engine/contas-gh.js')).default;
const porta = (await import('../lib/engine/porta-de-execucao.js')).default;
const contaQueAge = (await import('../lib/engine/conta-que-age.js')).default;
const P = await import('../ui/pure.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; });

const SILENCIADA = 'wandersonbiuder';
const ATIVA = 'Alexpraxedes';
const URL_76 = 'https://github.com/biudtech/internal-auth/pull/76';
const KEY_76 = 'biudtech/internal-auth#76';

// O incidente: a silenciada listada ANTES da ativa, as duas cobrindo a mesma org, as duas
// com token no gh.
function engineDoIncidente(contas) {
  const e = new Engine();
  e.config.accounts = contas || [
    { user: SILENCIADA, owners: ['biudtech'], muted: true, autoReview: false },
    { user: ATIVA, owners: ['biudtech'], autoReview: false },
  ];
  e.token = 'tok-silenciada';
  e.tokens = { [SILENCIADA]: 'tok-silenciada', [ATIVA]: 'tok-ativa' };
  e.tokenOk = true;
  e.refreshTokens = async () => { };
  e.refreshToken = async () => { };
  e.log = () => { };
  e.pushState = () => { };
  e.saveChats = () => { };
  e.saveDecisions = () => { };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  return e;
}

// a silenciada é a única conta que cobre a org: a resolução não tem alternativa, e quem
// segura é a recusa na escrita
function engineSoSilenciada() {
  return engineDoIncidente([
    { user: SILENCIADA, owners: ['biudtech'], muted: true, autoReview: false },
    { user: 'alice', owners: ['acme'], autoReview: false },
  ]);
}

const escritas = () => chamadas.filter((c) => {
  const a = c.args.join(' ');
  return /--input|pr edit|pr merge|pr review|-X DELETE|label create/.test(a);
});

/* ---------- 1 e 2: resolver pela org entrega a conta que AGE ---------- */

test('accountForOwner: silenciada listada antes da ativa na mesma org, vence a ativa', () => {
  const e = engineDoIncidente();
  assert.equal(e.accountForOwner('biudtech'), ATIVA);
  assert.equal(e.accountForPr({ key: KEY_76 }), ATIVA, 'PR sem conta marcada (URL avulsa, chat) também');
});

test('accountForOwner: ativa sem token perde para a ativa com token; sem nenhuma com token, fica a ativa', () => {
  const e = engineDoIncidente([
    { user: 'sem-token', owners: ['biudtech'] },
    { user: ATIVA, owners: ['biudtech'] },
  ]);
  e.tokens = { [ATIVA]: 'tok-ativa' };
  assert.equal(e.accountForOwner('biudtech'), ATIVA);
  e.tokens = {};
  assert.equal(e.accountForOwner('biudtech'), 'sem-token', 'nenhuma com token: a primeira ATIVA, e a escrita recusa por token');
});

test('accountForOwner: casos antigos seguem iguais (uma conta, empate entre capazes, org sem dona)', () => {
  const uma = engineDoIncidente([{ user: 'eu', owners: ['acme'] }]);
  uma.tokens = { eu: 'tok' };
  assert.equal(uma.accountForOwner('acme'), 'eu');
  assert.equal(uma.accountForOwner('outra-org'), 'eu', 'org sem dona cai na primária');
  const duas = engineDoIncidente([{ user: 'primeira', owners: ['acme'] }, { user: 'segunda', owners: ['acme'] }]);
  duas.tokens = { primeira: 't1', segunda: 't2' };
  assert.equal(duas.accountForOwner('ACME'), 'primeira', 'empate entre duas capazes mantém a primeira');
});

test('accountForOwner: a silenciada só responde pela org quando ninguém mais a cobre', () => {
  const e = engineSoSilenciada();
  assert.equal(e.accountForOwner('biudtech'), SILENCIADA);
});

test('atribuicaoDoPr: a org entrega a ativa; reserva e única continuam como eram', () => {
  const e = engineDoIncidente();
  assert.deepEqual(contasGh.atribuicaoDoPr(e, { key: KEY_76 }), { conta: ATIVA, por: 'org' });
  assert.deepEqual(contasGh.atribuicaoDoPr(e, { key: KEY_76, account: SILENCIADA }), { conta: SILENCIADA, por: 'busca' },
    'conta marcada pela busca não é trocada aqui: quem decide a marca é o dedup G18');
  assert.deepEqual(contasGh.atribuicaoDoPr(e, { key: 'outra/app#1' }), { conta: SILENCIADA, por: 'reserva' });
  const sozinha = engineDoIncidente([{ user: 'eu', owners: ['acme'] }]);
  assert.deepEqual(contasGh.atribuicaoDoPr(sozinha, { key: 'outra/app#1' }), { conta: 'eu', por: 'unica' });
});

/* ---------- 3: o panorama segue o G18 ---------- */

const PR_TERCEIRO = {
  key: 'biudtech/app#5', url: 'https://github.com/biudtech/app/pull/5', title: 'PR de terceiro',
  author: 'carol', repo: 'biudtech/app', number: 5, updatedAt: '2026-10-06T10:00:00Z',
};

// engine de check() com as buscas roteirizadas por conta (check-resilience.test.js)
function engineDeCheck(contas, tokens) {
  const e = engineDoIncidente(contas);
  e.tokens = tokens;
  e.seen = new Set();
  e.reReviewedKeys = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.queue = [];
  e.resolveAccount = async () => { };
  e.myAuthoredPRs = async () => [];
  e.enrichMyPRBranches = async () => { };
  e.refreshMergeStates = async () => { };
  e.refreshStaleStates = async () => { };
  e.refreshReviewSignals = async () => { };
  e.scanPushbacks = async () => { };
  e.checkUpdate = async () => { };
  e.launchReview = () => { throw new Error('launchReview não deveria rodar neste teste'); };
  e.schedule = () => { };
  e.saveSeen = () => { };
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  e.searchPRs = async (extraArgs, user) => (extraArgs[0] === '--owner' ? [{ ...PR_TERCEIRO, account: user }] : []);
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  return e;
}

test('panorama: PR de terceiro achado pelas duas contas fica com a ativa, não com a silenciada listada antes', async () => {
  const e = engineDeCheck(undefined, { [SILENCIADA]: 'tok-silenciada', [ATIVA]: 'tok-ativa' });
  await e.check('test');
  assert.equal(e.panorama.length, 1, 'o PR entra no panorama uma vez só (dedup por key)');
  assert.equal(e.panorama[0].account, ATIVA);
  assert.equal(e.accountForPr(e.panorama[0]), ATIVA);
});

test('panorama: duas contas capazes, a primeira não é destronada (empate mantém a primeira)', async () => {
  const e = engineDeCheck([{ user: 'primeira', owners: ['biudtech'] }, { user: 'segunda', owners: ['biudtech'] }],
    { primeira: 't1', segunda: 't2' });
  await e.check('test');
  assert.equal(e.panorama.length, 1);
  assert.equal(e.panorama[0].account, 'primeira');
});

test('panorama: primeira conta sem token perde para a segunda capaz', async () => {
  const e = engineDeCheck([{ user: 'sem-token', owners: ['biudtech'] }, { user: 'segunda', owners: ['biudtech'] }],
    { segunda: 't2' });
  // sem token a busca real nem roda; o roteiro devolve mesmo assim para provar o critério
  await e.check('test');
  assert.equal(e.panorama[0].account, 'segunda');
});

/* ---------- 4: os caminhos de escrita por clique recusam a conta silenciada ---------- */

test('chat: conta do PR silenciada recusa sem abrir sessão (que rodaria com o GH_TOKEN dela)', async () => {
  const e = engineSoSilenciada();
  let abriu = false;
  e.runClaudeStream = async () => { abriu = true; return { text: 'x' }; };
  const r = await e.chatSend(KEY_76, URL_76, 'dispensa o review e pede de novo');
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'conta_silenciada');
  assert.match(r.error, /conta wandersonbiuder está silenciada e não age; reative a conta ou use outra/);
  assert.equal(abriu, false);
  assert.equal(chamadas.length, 0, 'nenhum gh');
});

test('chat: no cenário do incidente, a conversa abre com a ativa', async () => {
  const e = engineDoIncidente();
  let captured = null;
  e.runClaudeStream = async (prompt, opts) => { captured = opts; return { text: 'oi', sessionId: 's1' }; };
  const r = await e.chatSend(KEY_76, URL_76, 'olá');
  assert.equal(r.ok, true);
  while (e.chats[KEY_76].status === 'running') await new Promise((res) => setTimeout(res, 10));
  assert.equal(captured.account, ATIVA);
});

test('launchReview: conta silenciada não abre revisão nem pelo clique, e o aviso diz por quê', async () => {
  const e = engineSoSilenciada();
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); return { ok: true }; };
  e.spawnConsole = () => { throw new Error('terminal não deveria abrir'); };
  const r = await e.launchReview([URL_76], 'auto', 'clique');
  assert.equal(r.ok, false);
  assert.equal(enfileirados.length, 0);
  const r2 = await e.launchReview([URL_76], 'terminal', 'clique');
  assert.equal(r2.ok, false, 'o terminal também roda com o GH_TOKEN da conta');
  const aviso = e.toasts.find((t) => t.kind === 'error' && /silenciada e não age/.test(t.text));
  assert.ok(aviso, 'erro visível na tela');
  assert.equal(escritas().length, 0);
});

test('launchReview: no cenário do incidente, a revisão sai com a ativa', async () => {
  const e = engineDoIncidente();
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); return { ok: true }; };
  const r = await e.launchReview([URL_76], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.deepEqual(enfileirados.map((p) => p.account), [ATIVA]);
});

test('porta de execução: conta silenciada é motivo próprio, e o enqueueHeadless devolve o código', () => {
  const e = engineSoSilenciada();
  const pr = { key: KEY_76, url: URL_76, repo: 'biudtech/internal-auth', number: 76, author: 'alguem', account: SILENCIADA };
  assert.equal(porta.motivoParaNaoExecutar(e, pr), 'conta_silenciada');
  e.processHeadless = () => { };
  assert.deepEqual(e.enqueueHeadless({ ...pr }), { ok: false, code: 'conta_silenciada' });
  // o recibo de um comando entre aparelhos ganha texto na tela, não "código conta_silenciada"
  const recibo = P.reciboEstado({ tipo: 'revisar' }, { estado: 'recusado', code: 'conta_silenciada', at: 0 });
  assert.equal(recibo.detalhe.includes('código conta_silenciada'), false);
});

test('postagem: PR marcado com a conta silenciada recusa antes de qualquer gh (chat, terminal, reenvio)', async () => {
  const e = engineDoIncidente();
  const pr = { key: KEY_76, repo: 'biudtech/internal-auth', number: 76, account: SILENCIADA };
  const r = await e.postReview(pr, { event: 'COMMENT', body: 'Ok por aqui.' });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'conta_silenciada');
  assert.equal(chamadas.length, 0);
});

test('decide: clique na pendência de conta silenciada não posta e avisa na tela', async () => {
  const e = engineDoIncidente();
  e.headSha = async () => 'abc123';
  e.myReviewStates = async () => [];
  e.decisions = {
    pending: [{
      id: 'd1', key: KEY_76, headSha: 'abc123',
      pr: { key: KEY_76, url: URL_76, repo: 'biudtech/internal-auth', number: 76, account: SILENCIADA },
      payloads: { approve: { event: 'APPROVE', body: 'Li o diff inteiro e está certo.', comments: [] } },
    }],
    resolved: [],
  };
  const r = await e.decide('d1', 'approve');
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'conta_silenciada');
  assert.equal(e.decisions.pending.length, 1, 'a pendência fica na mesa');
  assert.ok(e.toasts.some((t) => t.kind === 'error' && /silenciada/.test(t.text)));
  assert.equal(escritas().length, 0);
});

test('Meus PRs: pedir reviewers num PR da conta silenciada recusa, sem trocar para a ativa', async () => {
  const e = engineDoIncidente();
  e.config.defaultReviewers = { biudtech: [ATIVA, 'carol'] };
  e.myPRs = [{ key: KEY_76, url: URL_76, repo: 'biudtech/internal-auth', number: 76, author: SILENCIADA, account: SILENCIADA }];
  const r = await e.setReviewers(URL_76);
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'conta_silenciada');
  assert.equal(escritas().length, 0, 'nenhum pr edit (assignee ou reviewer) com identidade nenhuma');
  assert.ok(e.toasts.some((t) => t.kind === 'error' && /wandersonbiuder está silenciada/.test(t.text)));
});

test('Meus PRs: merge num PR da conta silenciada recusa antes de ler o PR', async () => {
  const e = engineDoIncidente();
  e.myPRs = [{ key: KEY_76, url: URL_76, repo: 'biudtech/internal-auth', number: 76, author: SILENCIADA, account: SILENCIADA }];
  const r = await e.mergeSelfPR(URL_76);
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'conta_silenciada');
  assert.equal(chamadas.length, 0);
});

test('Meus PRs: a conta autora ativa continua pedindo reviewers como antes', async () => {
  const e = engineDoIncidente();
  e.config.defaultReviewers = { biudtech: ['carol'] };
  e.myPRs = [{ key: KEY_76, url: URL_76, repo: 'biudtech/internal-auth', number: 76, author: ATIVA, account: ATIVA }];
  const r = await e.setReviewers(URL_76);
  assert.equal(r.ok, true);
  const edits = chamadas.filter((c) => c.args[0] === 'pr' && c.args[1] === 'edit');
  assert.ok(edits.length >= 2);
  for (const c of edits) assert.equal(c.env.GH_TOKEN, 'tok-ativa');
});

test('sinal legado: a coleta de ref órfã não apaga nada com a conta silenciada', async () => {
  const e = engineSoSilenciada();
  const { gcSignals } = await import('../lib/engine/review-signal.js');
  const corridas = [];
  await gcSignals(e, 'biudtech/app', SILENCIADA, [{ ref: 'refs/farol/revisando/1/x/1', epochMs: 1 }], Date.now(), async (...a) => { corridas.push(a); return { ok: true }; });
  assert.equal(corridas.length, 0);
});

test('conta-que-age: guardarPelaCapaz troca só da incapaz para a capaz', () => {
  const e = engineDoIncidente();
  const mapa = new Map();
  contaQueAge.guardarPelaCapaz(e, mapa, { key: 'k', account: SILENCIADA }, SILENCIADA);
  contaQueAge.guardarPelaCapaz(e, mapa, { key: 'k', account: ATIVA }, ATIVA);
  assert.equal(mapa.get('k').account, ATIVA);
  contaQueAge.guardarPelaCapaz(e, mapa, { key: 'k', account: SILENCIADA }, SILENCIADA);
  assert.equal(mapa.get('k').account, ATIVA, 'a capaz nunca perde para a incapaz');
});
