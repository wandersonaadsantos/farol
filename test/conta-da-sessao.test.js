// A sessão leva a CONTA que revisa (29/09/2026). Caso medido no celular: a conta silenciada,
// usada para revisões escolhidas a dedo, não monitora organização nenhuma. O registro da
// sessão guardava o PR sem a conta, e quem o lia (a tela, o andamento entre aparelhos)
// deduzia a conta pelo dono do repositório: a revisão sumia da fila da silenciada e
// aparecia "em execução" na conta dona da org. A lista de espera tinha o mesmo defeito.
// Runner nativo, ZERO deps. Engine real com FAROL_HOME temporário e gh desligado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-conta-da-sessao-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');
const { prDaSessao } = await import('../lib/engine/conta-na-tela.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// `normal` é dona da org acme; `calado` está silenciada e não monitora org nenhuma
function engineComSilenciada() {
  const e = new Engine();
  e.config.accounts = [{ user: 'normal', owners: ['acme'] }, { user: 'calado', owners: [], muted: true }];
  e.config.autoReview = false;
  e.token = 'tok';
  e.tokens = { normal: 'tok', calado: 'tok2' };
  e.tokenOk = true;
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.pushState = () => { };
  return e;
}

const PR = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', repo: 'acme/app', number: 7, author: 'bob', title: 'Ajuste', account: 'calado' };

// Captura o registro da sessão no instante em que ela nasce (o activity.set vem logo depois
// do activeReviews.set, nos dois caminhos) e interrompe ali: o resto da sessão não interessa.
const PAROU = new Error('registro capturado');
function capturarRegistro(e) {
  const vistos = [];
  e.activity = new Map();
  e.activity.set = function set(id) {
    if (e.activeReviews.has(id)) vistos.push(e.snapshot().activeSessions.find((x) => x.id === id));
    throw PAROU;
  };
  return vistos;
}

test('prDaSessao leva a conta do item, não a do dono do repositório', () => {
  const e = engineComSilenciada();
  assert.equal(prDaSessao(e, PR).account, 'calado');
  const { account, ...semConta } = PR;
  void account;
  assert.equal(prDaSessao(e, semConta).account, 'normal', 'sem conta no item, vale a regra de sempre');
});

test('revisão headless: a sessão ativa da conta silenciada é da conta silenciada', async () => {
  const e = engineComSilenciada();
  const vistos = capturarRegistro(e);
  await assert.rejects(e.runHeadlessReview({ ...PR }), PAROU);
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].pr.account, 'calado');
  assert.equal(e.accountForPr(vistos[0].pr), 'calado', 'quem lê o registro chega à conta certa');
});

test('autoanálise: a sessão ativa leva a conta também', async () => {
  const e = engineComSilenciada();
  const vistos = capturarRegistro(e);
  await assert.rejects(e.runSelfAnalysis({ ...PR, author: 'calado' }), PAROU);
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].pr.account, 'calado');
});

test('lista de espera: a tela recebe a conta de cada PR, na ordem da fila', async () => {
  const e = engineComSilenciada();
  e.processHeadless = () => { };
  e.queue = [{ ...PR }];
  const r = await e.launchReview([PR.url], 'auto', 'clique');
  assert.equal(r.ok, true);
  const snap = e.snapshot();
  assert.deepEqual(snap.headlessWaiting, ['acme/app#7']);
  assert.deepEqual(snap.headlessWaitingContas, { 'acme/app#7': 'calado' });
});
