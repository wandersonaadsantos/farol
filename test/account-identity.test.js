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

test('staleForReview: conta sem token devolve false (nunca reativa Re-revisar por incerteza)', async () => {
  const e = engineDuasContas();
  const stale = await e.staleForReview({ key: 'biudtech/app#8', repo: 'biudtech/app', number: 8, url: 'https://github.com/biudtech/app/pull/8' });
  assert.equal(stale, false);
  assert.equal(chamadas.length, 0);
});
