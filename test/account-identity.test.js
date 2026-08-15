'use strict';
// Identidade de conta (raiz P1 do relatório de gaps): o Farol NUNCA age no GitHub nem
// abre sessão Claude com o token de uma conta no lugar de outra. tokenFor é a fonte
// única de "token desta conta, sem herdar"; as guardas das tarefas seguintes usam ele.
// Padrões seguidos: espião no io.run ANTES do require do server.js (merge-gates.test.js)
// e Engine real contra FAROL_HOME temporário (claude-profiles.test.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-identidade-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// espião no run: os módulos de engine capturam a referência na desestruturação do
// require, então a troca tem que acontecer antes do require('../server.js'). O default
// devolve ok vazio: NENHUM gh real roda neste arquivo.
const io = require('../lib/io');
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [], env: (opts || {}).env });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = require('../server.js');
const { STATE_DIR } = require('../lib/paths');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

// engine com duas contas: alice (primária, com token) e bob (trabalho, SEM token),
// exatamente o cenário do flake de keyring que dispara o A1
function engineDuasContas() {
  const e = new Engine();
  e.config.accounts = [
    { user: 'alice', owners: ['acme'] },
    { user: 'bob', owners: ['biudtech'] }
  ];
  e.token = 'tok-alice';
  e.tokens = { alice: 'tok-alice' }; // bob ficou sem token neste ciclo
  e.tokenOk = true;
  e.refreshTokens = async () => { };
  e.refreshToken = async () => { };
  e.log = () => { };            // não sujar o farol.log do temp
  e.on('toast', () => { });
  e.pushState = () => { };
  return e;
}

test('tokenFor: conta pedida sem token devolve null, nunca o token da primária', () => {
  const e = engineDuasContas();
  assert.equal(e.tokenFor('bob'), null, 'bob sem token = null (herdar tok-alice seria o A1)');
  assert.equal(e.tokenFor('alice'), 'tok-alice');
});

test('tokenFor: sem user cai na primária (único fallback legítimo, contrato do update.js)', () => {
  const e = engineDuasContas();
  assert.equal(e.tokenFor(''), 'tok-alice');
  assert.equal(e.tokenFor(undefined), 'tok-alice');
  e.token = null;
  assert.equal(e.tokenFor(undefined), null, 'primária sem token = null, não inventa');
});

/* ---------- buscas gh: nunca com a identidade errada (A1, M11) ---------- */

test('searchPRs: conta sem token não roda gh nenhum e devolve null (falha de busca, não identidade errada)', async () => {
  const e = engineDuasContas();
  const r = await e.searchPRs(['--review-requested=@me'], 'bob');
  assert.equal(r, null);
  assert.equal(chamadas.length, 0, 'zero chamadas gh: o @me nunca resolve na conta errada');
});

test('searchPRs: conta com token busca com o token DELA', async () => {
  const e = engineDuasContas();
  runImpl = () => Promise.resolve({ ok: true, code: 0, stdout: '[]', stderr: '' });
  const r = await e.searchPRs(['--owner', 'acme'], 'alice');
  assert.deepEqual(r, []);
  assert.equal(chamadas[0].env.GH_TOKEN, 'tok-alice');
});

test('myAuthoredPRs: conta sem token devolve null sem rodar gh', async () => {
  const e = engineDuasContas();
  assert.equal(await e.myAuthoredPRs('bob'), null);
  assert.equal(chamadas.length, 0);
});

test('fetchDeliveries: alvo de conta sem token vira partial, os outros alvos seguem', async () => {
  const e = engineDuasContas();
  runImpl = () => Promise.resolve({ ok: true, code: 0, stdout: '[]', stderr: '' });
  const d = await e.fetchDeliveries(7, '');
  assert.equal(d.partial, true, 'a UI avisa que uma conta ficou de fora, nada de corte silencioso');
  assert.ok(chamadas.length > 0, 'a conta com token buscou normalmente');
  for (const c of chamadas) assert.equal(c.env.GH_TOKEN, 'tok-alice', 'nenhuma busca saiu com token trocado');
});

/* ---------- postagem: nunca com a identidade errada (A1, consequência 2) ---------- */

test('postReview: conta do PR sem token NÃO posta (o APPROVE não sai pela primária)', async () => {
  const e = engineDuasContas();
  const pr = { key: 'biudtech/app#9', repo: 'biudtech/app', number: 9 };
  const r = await e.postReview(pr, { event: 'APPROVE', body: 'ok' });
  assert.equal(r.ok, false);
  assert.match(r.error, /sem token/);
  assert.equal(chamadas.length, 0, 'nenhum gh api reviews foi chamado');
});

test('myReviewStates: conta sem token devolve null (não confirma dedup pela identidade errada)', async () => {
  const e = engineDuasContas();
  const s = await e.myReviewStates({ key: 'biudtech/app#9', repo: 'biudtech/app', number: 9 });
  assert.equal(s, null);
  assert.equal(chamadas.length, 0);
});

/* ---------- Meus PRs: gate pela conta DONA do PR, não pela primária (M10) ---------- */

test('launchSelfAnalysis: recusa quando a conta do PR está sem token, mesmo com a primária ok (M10)', async () => {
  const e = engineDuasContas(); // primária alice ok, bob sem token
  e.myPRs = [{ key: 'biudtech/app#3', url: 'https://github.com/biudtech/app/pull/3', repo: 'biudtech/app', number: 3 }];
  const r = await e.launchSelfAnalysis('https://github.com/biudtech/app/pull/3');
  assert.equal(r.ok, false, 'não abre sessão que rodaria gh e Claude com identidade errada');
  assert.equal(e.headlessQueue.length, 0);
});

test('launchSelfAnalysis: conta do PR com token passa, mesmo com a PRIMÁRIA sem token (o M10 recusava isso)', async () => {
  const e = engineDuasContas();
  e.token = null; e.tokenOk = false; e.tokens = { bob: 'tok-bob' }; // só a de trabalho autenticada
  e.myPRs = [{ key: 'biudtech/app#3', url: 'https://github.com/biudtech/app/pull/3', repo: 'biudtech/app', number: 3 }];
  e.processHeadless = () => { }; // não abrir sessão de verdade no teste
  const r = await e.launchSelfAnalysis('https://github.com/biudtech/app/pull/3');
  assert.equal(r.ok, true);
  assert.equal(e.headlessQueue[0].account, 'bob');
});

test('setReviewers: conta do PR sem token recusa mesmo com token primário presente (precedência corrigida)', async () => {
  const e = engineDuasContas();
  e.config.defaultReviewers = { biudtech: ['carol'] };
  const r = await e.setReviewers('https://github.com/biudtech/app/pull/5');
  assert.equal(r.ok, false);
  assert.equal(chamadas.filter(c => c.args.join(' ').startsWith('pr edit')).length, 0,
    'nenhum pr edit sai assinado pela primária');
});

/* ---------- leitores best-effort: sem token = incerteza pelo contrato ---------- */

test('fetchMergeState: conta da org sem token devolve null sem rodar gh', async () => {
  const e = engineDuasContas();
  const ms = await e.fetchMergeState('https://github.com/biudtech/app/pull/8');
  assert.equal(ms, null);
  assert.equal(chamadas.length, 0);
});

test('staleForReview: conta sem token devolve indeterminado (nunca reativa Re-revisar nem relança por incerteza)', async () => {
  const e = engineDuasContas();
  const info = await e.staleForReview({ key: 'biudtech/app#8', repo: 'biudtech/app', number: 8, url: 'https://github.com/biudtech/app/pull/8' });
  assert.equal(info.stale, false);
  assert.equal(info.head, '', 'sem head, o gate de re-revisão automática também não arma');
  assert.equal(chamadas.length, 0);
});

/* ---------- chat: sessão com a conta dona do PR (A3) ---------- */

test('chatSend passa a conta do PR ao runClaudeStream (token gh e perfil Claude certos)', async () => {
  const e = engineDuasContas();
  e.tokens.bob = 'tok-bob'; // bob autenticado: o que se prova aqui é o REPASSE da conta
  let captured = null;
  e.runClaudeStream = async (prompt, opts) => { captured = opts; return { text: 'oi', sessionId: 's1' }; };
  e.saveChats = () => { };
  const r = await e.chatSend('biudtech/app#7', 'https://github.com/biudtech/app/pull/7', 'olá');
  assert.equal(r.ok, true);
  while (e.chats['biudtech/app#7'].status === 'running') await new Promise(res => setTimeout(res, 10));
  assert.ok(captured, 'runClaudeStream foi chamado');
  assert.equal(captured.account, 'bob', 'sem isso o resume cai no perfil Claude padrão e o gh no token primário (A3)');
});

test('chatSend recusa quando a conta do PR está sem token (nunca conversa com identidade errada)', async () => {
  const e = engineDuasContas(); // bob sem token
  let abriu = false;
  e.runClaudeStream = async () => { abriu = true; return { text: 'x' }; };
  e.saveChats = () => { };
  const r = await e.chatSend('biudtech/app#7', 'https://github.com/biudtech/app/pull/7', 'olá');
  assert.equal(r.ok, false);
  assert.match(r.error, /sem token/);
  assert.equal(abriu, false, 'nenhuma sessão abre com o token da primária');
});

/* ---------- lançamento de revisão: só conta com token abre sessão ---------- */

test('launchReview: PR de conta sem token fica de fora (e na fila); os das contas com token seguem', async () => {
  const e = engineDuasContas();
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  const r = await e.launchReview([
    'https://github.com/acme/app/pull/1',
    'https://github.com/biudtech/app/pull/2'
  ], 'auto');
  assert.equal(r.ok, true);
  assert.deepEqual(enfileirados.map(p => p.account), ['alice'], 'só o PR da conta autenticada entrou');
});

test('launchReview: todas as contas sem token devolve erro sem enfileirar nada', async () => {
  const e = engineDuasContas();
  e.token = null; e.tokens = {}; e.tokenOk = false;
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  const r = await e.launchReview(['https://github.com/acme/app/pull/1'], 'auto');
  assert.equal(r.ok, false);
  assert.equal(enfileirados.length, 0);
});

test('runOneHeadless: falha por "sem token" é transitória (retry no próximo ciclo, não estaciona)', async () => {
  const e = engineDuasContas();
  e.runHeadlessReview = async () => { throw new Error('conta bob sem token no gh (gh auth login --user bob)'); };
  e.writeInflight = () => { };
  const pr = { key: 'biudtech/app#2', url: 'https://github.com/biudtech/app/pull/2', repo: 'biudtech/app', number: 2, account: 'bob' };
  await e.runOneHeadless(pr, 'bob');
  assert.equal(e.autoReviewParked.has('biudtech/app#2'), false, 'flake de keyring se resolve sozinho, não pode estacionar');
  // desde a Onda 7 (tarefa 7.4) o Map guarda { tries, pr }, não o número cru
  assert.equal(e.retryAfterNet.get('biudtech/app#2').tries, 1);
});

/* ---------- a raiz (A1): ghEnv nunca herda identidade ---------- */

test('ghEnv: conta pedida sem token LANÇA em vez de herdar o token da primária', () => {
  const e = engineDuasContas();
  assert.throws(() => e.ghEnv('bob'), /bob sem token no gh/);
  assert.equal(e.ghEnv('alice').GH_TOKEN, 'tok-alice');
  assert.equal(e.ghEnv().GH_TOKEN, 'tok-alice', 'sem user = primária, contrato do update.js preservado');
});

test('ghEnv: sem user e sem token nenhum não lança (comportamento legado do doctor/boot)', () => {
  const e = engineDuasContas();
  e.token = null;
  const env = e.ghEnv();
  assert.equal('GH_TOKEN' in env, false);
});
