import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-terminal-dedup-'));
process.env.FAROL_HOME = root;
const { Engine } = await import('../server.js');
const { sessionCardHtml, liberaTerminal, textoDoCancelamento } = await import('../ui/pure/sessao.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const pr = numero => ({ key: `org/repo#${numero}`, url: `https://github.com/org/repo/pull/${numero}`,
  repo: 'org/repo', number: numero, author: 'dev', account: 'eu', requested: true });

function motor() {
  const engine = new Engine();
  engine.token = 'token-de-teste';
  engine.tokens = { eu: 'token-de-teste' };
  engine.config.accounts = [{ user: 'eu', owners: ['org'] }];
  engine.config.sync.enabled = false;
  engine.seen = new Set();
  engine.headlessIniciando = new Set();
  engine.pushState = () => {};
  engine.writeInflight = () => {};
  engine.log = () => {};
  engine.checkNow = () => {};
  engine.processHeadless = () => {};
  engine.bloqueiaAutomatico = async () => false;
  engine.queue = [pr(1), pr(2)];
  engine.abertos = [];
  // Só a fronteira que abriria uma janela é substituída, a admissão e a fila são reais.
  engine.spawnConsole = (_comando, label, keys) => {
    const id = `terminal-${engine.abertos.length}`;
    engine.abertos.push(keys);
    engine.activeReviews.set(id, { id, label, keys, mode: 'terminal' });
  };
  return engine;
}

test('terminal em curso impede outra sessão terminal e outra revisão headless do mesmo PR', async () => {
  const e = motor();
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, true);
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, false);
  assert.equal((await e.launchReview([pr(1).url], 'auto', 'clique')).ok, false);
  assert.deepEqual(e.enqueueHeadless(pr(1)), { ok: false, code: 'duplicado' });
  assert.equal(e.abertos.length, 1);
  assert.equal(e.headlessQueue.length, 0);
});

test('terminal respeita headless enfileirado, iniciando e ativo, incluindo caixa diferente no nome', async () => {
  for (const fase of ['fila', 'inicio', 'ativo']) {
    const e = motor();
    if (fase === 'fila') e.headlessQueue.push(pr(1));
    if (fase === 'inicio') e.headlessIniciando.add(pr(1).key);
    if (fase === 'ativo') e.activeReviews.set('headless', { mode: 'auto', keys: ['ORG/Repo#1'] });
    const r = await e.launchReview([pr(1).url], 'terminal', 'clique');
    assert.equal(r.ok, false, fase);
    assert.deepEqual(r.duplicados, [pr(1).key]);
    assert.equal(e.abertos.length, 0);
    assert.equal(e.queue.some(p => p.key === pr(1).key), true);
    assert.equal(e.seen.has(pr(1).key), false);
  }
});

test('dois pedidos simultâneos atravessam preparação assíncrona e só um abre o terminal', async () => {
  const e = motor();
  const respostas = await Promise.all([
    e.launchReview([pr(1).url], 'terminal', 'clique'),
    e.launchReview([pr(1).url], 'terminal', 'clique'),
  ]);
  assert.equal(respostas.filter(r => r.ok).length, 1);
  assert.equal(e.abertos.length, 1);
});

test('lote parcial segue com PR livre e não repete URL duplicada no mesmo comando', async () => {
  const e = motor();
  e.activeReviews.set('headless', { mode: 'auto', keys: [pr(1).key] });
  const r = await e.launchReview([pr(1).url, pr(2).url, pr(2).url], 'terminal', 'clique');
  assert.equal(r.ok, true);
  assert.deepEqual(e.abertos, [[pr(2).key]]);
  assert.equal(e.queue.some(p => p.key === pr(1).key), true);
});

test('fechar terminal libera o PR e login sem PR não ocupa revisão', async () => {
  const e = motor();
  e.activeReviews.set('login', { mode: 'terminal', keys: [], login: true });
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, true);
  e.sessionExit('terminal-0');
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, true);
  assert.equal(e.abertos.length, 2);
});

test('conta silenciada e regra manual mantêm suas recusas', async () => {
  const e = motor();
  e.config.accounts[0].muted = true;
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, false);
  assert.equal(e.abertos.length, 0);
  e.config.accounts[0].muted = false;
  e.config.accounts[0].reviewRules = { org: { mode: 'manual' } };
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'auto')).ok, false);
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, true);
});

test('Liberar PR solta o terminal cujo aviso de fim se perdeu, sem tocar login nem sessão automática', async () => {
  const e = motor();
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, true);
  assert.equal((await e.launchReview([pr(1).url], 'auto', 'clique')).ok, false, 'o terminal segura o PR');
  assert.deepEqual(e.cancelSession('terminal-0'), { ok: true, liberado: true });
  assert.equal(e.activeReviews.has('terminal-0'), false);
  assert.equal((await e.launchReview([pr(1).url], 'terminal', 'clique')).ok, true, 'liberado, o PR volta a poder ser revisado');
  e.activeReviews.set('login', { id: 'login', mode: 'terminal', keys: [], login: true });
  assert.equal(e.cancelSession('login').ok, false, 'login não segura PR e não é liberado por aqui');
  assert.equal(e.activeReviews.has('login'), true);
});

test('o cartão do terminal de revisão oferece Liberar PR; login, sessão sem PR e sessão não cancelável não', () => {
  const terminal = { id: 't1', label: 'org/repo#1', mode: 'terminal', keys: ['org/repo#1'] };
  assert.equal(liberaTerminal(terminal), true);
  assert.equal(textoDoCancelamento(terminal), 'Liberar PR');
  assert.match(sessionCardHtml(terminal), /act-cancel" data-id="t1">Liberar PR</);
  for (const s of [{ ...terminal, login: true }, { ...terminal, keys: [] }, { id: 'a1', mode: 'auto', keys: ['org/repo#1'] }]) {
    assert.equal(liberaTerminal(s), false);
    assert.doesNotMatch(sessionCardHtml(s), /act-cancel/);
  }
  assert.match(sessionCardHtml({ id: 'a2', mode: 'auto', keys: ['org/repo#1'], cancellable: true }), />Cancelar</);
});

test('autoanálise continua recusada com revisão automática ativa do mesmo PR', () => {
  const e = motor();
  e.activeReviews.set('headless', { id: 'headless', mode: 'auto', keys: [pr(1).key] });
  assert.deepEqual(e.enqueueHeadless({ ...pr(1), kind: 'self' }), { ok: false, code: 'duplicado' });
  e.activeReviews.delete('headless');
  assert.notDeepEqual(e.enqueueHeadless({ ...pr(1), kind: 'self' }), { ok: false, code: 'duplicado' });
});
