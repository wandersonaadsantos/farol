import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-review-scope-'));
process.env.FAROL_HOME = testHome;
const { Engine } = await import('../server.js');
const { editarRegra, normalizarRegras, politicaDeInicio } = await import('../lib/engine/review-scope.js');
const { parseAccounts } = await import('../lib/parse.js');
const { reviewScopeHtml } = await import('../ui/pure/review-scope.js');
after(() => fs.rmSync(testHome, { recursive: true, force: true }));

const pr = (author = 'joao', org = 'acme') => ({ key: `${org}/app#1`, repo: `${org}/app`, number: 1, url: `https://github.com/${org}/app/pull/1`, account: 'revisor', author });
function engine(reviewRules, autoReview = true) {
  const e = new Engine();
  e.config.accounts = [{ user: 'revisor', owners: ['acme'], autoReview, onClean: 'wait', onCaveats: 'wait', onReject: 'wait', ...(reviewRules ? { reviewRules } : {}) }];
  e.tokens = { revisor: 'token-de-teste' };
  e.token = 'token-de-teste';
  e.log = () => {};
  e.pushState = () => {};
  e.writeInflight = () => {};
  e.processHeadless = () => {};
  e.bloqueiaAutomatico = async () => false;
  e.budgetBlockedFor = () => null;
  e.outrosRevisando = () => [];
  e.prState = async () => 'OPEN';
  e.jaResolvido = async () => false;
  return e;
}
const manual = { acme: { mode: 'manual' } };
const automatico = { acme: { mode: 'auto' } };

test('sem regra nova, preserva automático, manual e o contrato anterior de retry', () => {
  for (const ligado of [true, false]) {
    const e = engine(undefined, ligado);
    assert.equal(politicaDeInicio(e, pr()).automatic, ligado);
    assert.equal(politicaDeInicio(e, pr(), { retry: true }).automatic, true);
    assert.equal(Object.hasOwn(e.config.accounts[0], 'reviewRules'), false);
  }
});

test('organização manual bloqueia só a organização escolhida, inclusive fora de owners', () => {
  const e = engine({ externa: { mode: 'manual' } });
  assert.equal(politicaDeInicio(e, pr('joao', 'externa')).automatic, false);
  assert.equal(politicaDeInicio(e, pr()).automatic, true);
});

test('autor tem precedência na organização e conta desligada impede a exceção automática', () => {
  const e = engine({ acme: { mode: 'manual', authors: { joao: 'auto', maria: 'manual' } } });
  assert.equal(politicaDeInicio(e, pr('Joao')).automatic, true);
  assert.equal(politicaDeInicio(e, pr('maria')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('outra')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('maria', 'outra-org')).automatic, true);
  e.config.accounts[0].autoReview = false;
  assert.equal(politicaDeInicio(e, pr('joao')).automatic, false);
});

test('contas revisoras têm regras independentes para a mesma organização e autor', () => {
  const e = engine(manual);
  e.config.accounts.push({ user: 'outro', owners: ['acme'], autoReview: true });
  assert.equal(politicaDeInicio(e, pr()).automatic, false);
  assert.equal(politicaDeInicio(e, { ...pr(), account: 'outro' }).automatic, true);
});

test('autor desconhecido não atravessa restrição e login de bot é aceito', () => {
  const e = engine({ acme: { authors: { 'robot[bot]': 'manual' } } });
  assert.equal(politicaDeInicio(e, pr('')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('robot[bot]')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('joao')).automatic, true);
});

test('normalização conserva restrições e recusa modo inválido na edição', () => {
  assert.deepEqual(normalizarRegras({ ACME: { mode: 'invalido', authors: { Maria: false } } }), { acme: { mode: 'manual', authors: { maria: 'manual' } } });
  const conta = { user: 'x' };
  for (const op of [{ organization: '../acme', mode: 'auto' }, { organization: 'acme', mode: true }, { organization: 'acme', author: 'a/b', mode: 'manual' }]) {
    assert.equal(editarRegra(conta, op).ok, false);
    assert.deepEqual(conta, { user: 'x' });
  }
});

test('remover uma regra restaura herança e preserva autores e demais organizações', () => {
  const conta = { user: 'x', autoReview: false, reviewRules: { acme: { mode: 'manual', authors: { joao: 'auto', maria: 'manual' } }, outra: { mode: 'manual' } } };
  const r = editarRegra(conta, { organization: 'ACME', mode: 'inherit' });
  assert.equal(r.ok, true);
  assert.equal(r.conta.autoReview, false);
  assert.deepEqual(r.conta.reviewRules.acme.authors, conta.reviewRules.acme.authors);
  assert.equal(r.conta.reviewRules.acme.mode, undefined);
  const s = editarRegra(r.conta, { organization: 'acme', author: '@Joao', mode: 'inherit' });
  assert.deepEqual(s.conta.reviewRules.acme.authors, { maria: 'manual' });
  assert.deepEqual(s.conta.reviewRules.outra, { mode: 'manual', authors: {} });
  assert.equal(conta.reviewRules.acme.mode, 'manual');
});

test('operações pontuais persistem, sobrevivem a edição antiga de cor e não mudam políticas atuais', () => {
  const e = engine();
  e.updateSettings({ accounts: e.config.accounts });
  const antes = JSON.parse(JSON.stringify(e.config.accounts));
  assert.notEqual(e.editarConta({ tipo: 'regra-review', user: 'revisor', organization: 'ACME', author: '@Maria', mode: 'manual' }).ok, false);
  e.editarConta({ tipo: 'editar', user: 'revisor', campos: { color: '#ffffff' } });
  const conta = e.accountList()[0];
  assert.equal(conta.reviewRules.acme.authors.maria, 'manual');
  for (const campo of ['autoReview', 'onClean', 'onCaveats', 'onReject']) assert.equal(conta[campo], antes[0][campo]);
  assert.deepEqual(e.snapshot().accounts[0].reviewRules, conta.reviewRules);
  assert.equal(new Engine().accountList()[0].reviewRules.acme.authors.maria, 'manual');
  assert.equal(parseAccounts(antes)[0].reviewRules, undefined);
});

test('edição inválida não grava e conta inexistente é recusada', () => {
  const e = engine(manual);
  e.updateSettings({ accounts: e.config.accounts });
  const antes = fs.readFileSync(path.join(testHome, 'config.json'), 'utf8');
  assert.equal(e.editarConta({ tipo: 'regra-review', user: 'revisor', organization: 'acme', mode: 'invalido' }).ok, false);
  assert.equal(e.editarConta({ tipo: 'regra-review', user: 'ausente', organization: 'acme', mode: 'auto' }).ok, false);
  assert.equal(fs.readFileSync(path.join(testHome, 'config.json'), 'utf8'), antes);
});

test('entrada central barra automático, distribuição e admin, mas aceita clique explícito', () => {
  const e = engine(manual);
  for (const extras of [{}, { viaDistribuicao: true }, { viaAdmin: true }]) {
    assert.deepEqual(e.enqueueHeadless({ ...pr(), ...extras }), { ok: false, code: 'review_manual' });
  }
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.enqueueHeadless({ ...pr(), manual: true }).ok, true);
  assert.equal(e.headlessQueue.length, 1);
});

test('retry consulta a regra atual, inclusive quando a sessão original foi por clique', () => {
  const e = engine(manual);
  e.retryAfterNet.set(pr().key, { tries: 1, pr: { ...pr(), manual: true } });
  assert.deepEqual(e.retryTargets(new Set(), new Set()), []);
  e.config.accounts[0].reviewRules = automatico;
  assert.equal(e.retryTargets(new Set(), new Set()).length, 1);
  e.config.accounts[0].reviewRules = manual;
  assert.equal(e.enqueueHeadless({ ...pr(), manual: true, automaticRetry: true }).ok, false);
});

test('repescagem marca a retomada como automática sem perder a origem nem o autor', async () => {
  const e = engine(automatico);
  e.retryAfterNet.set(pr().key, { tries: 1, pr: { ...pr(), manual: true, requested: true } });
  await e._repescarRetry([], new Set());
  assert.equal(e.headlessQueue.length, 1);
  assert.equal(e.headlessQueue[0].automaticRetry, true);
  assert.equal(e.headlessQueue[0].author, 'joao');
  e.config.accounts[0].reviewRules = manual;
  let sessoes = 0;
  e.runHeadlessReview = async () => { sessoes++; };
  await e.runOneHeadless(e.headlessQueue.shift(), 'revisor');
  assert.equal(sessoes, 0);
  assert.equal(e.queue[0].key, pr().key);
});

test('troca para manual enquanto aguarda vaga devolve o PR à fila e libera o slot', async () => {
  const e = engine(automatico);
  const alvo = pr();
  e.markSeen(alvo.key);
  assert.equal(e.enqueueHeadless(alvo).ok, true);
  e.config.accounts[0].reviewRules = manual;
  e.headlessBusyAccounts.set('revisor', 1);
  let sessoes = 0;
  e.runHeadlessReview = async () => { sessoes++; };
  await e.runOneHeadless(e.headlessQueue.shift(), 'revisor');
  assert.equal(sessoes, 0);
  assert.equal(e.seen.has(alvo.key), false);
  assert.equal(e.queue[0].key, alvo.key);
  assert.equal(e.headlessBusyAccounts.has('revisor'), false);
});

test('clique novo ultrapassa manual e limpa a marca da retentativa anterior', async () => {
  const e = engine(manual);
  e.queue = [{ ...pr(), automaticRetry: true }];
  const r = await e.launchReview([pr().url], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.equal(e.headlessQueue[0].manual, true);
  assert.equal(e.headlessQueue[0].automaticRetry, false);
});

test('lançamento automático bloqueado pela regra informa espera manual e conserva a fila', async () => {
  const e = engine(manual);
  e.queue = [pr()];
  const r = await e.launchReview([pr().url], 'auto', 'auto');
  assert.equal(r.ok, false);
  assert.match(r.error, /manual/);
  assert.equal(e.queue.length, 1);
  assert.equal(e.headlessQueue.length, 0);
});

test('novas rodadas por push e por pendência respeitam o autor e não queimam âncora', async () => {
  for (const gatilho of ['push', 'pendencia']) {
    const e = engine(manual);
    e.panorama = [pr()];
    e.headQuietoDesde = { [pr().key]: { head: 'novo', at: 1 } };
    if (gatilho === 'push') e.staleInfo = { [pr().key]: { stale: true, head: 'novo', lastState: 'CHANGES_REQUESTED' } };
    else e.decisions.pending = [{ key: pr().key, pr: pr(), blockedKind: 'stale_head', blockedHead: 'novo', createdAt: 1 }];
    assert.deepEqual(e.reReviewTargets(new Set()), []);
    await e.launchReReviews();
    assert.equal(e.headlessQueue.length, 0);
    assert.equal(e.reReviewLaunched[pr().key], undefined);
    e.config.accounts[0].reviewRules = { acme: { mode: 'manual', authors: { joao: 'auto' } } };
    assert.equal(e.reReviewTargets(new Set()).length, 1);
  }
});

test('disparo inicial seleciona apenas organização e autor permitidos', async () => {
  const e = engine({ acme: { mode: 'manual', authors: { joao: 'auto' } }, externa: { mode: 'manual' } });
  e.queue = [pr(), { ...pr('maria'), key: 'acme/app#2', url: 'https://github.com/acme/app/pull/2' }, pr('joao', 'externa')];
  e._registraPulo = () => false;
  e._registraCotaCedida = () => false;
  let lancados;
  e.launchReview = async urls => { lancados = urls; };
  await e._dispararAutomacoes(e.queue);
  assert.deepEqual(lancados, [pr().url]);
  assert.equal(e.queue.length, 3, 'manual continua visível na fila');
});

test('mudança durante consulta assíncrona também impede a sessão e preserva retomada', async () => {
  const e = engine(automatico);
  let sessoes = 0;
  e.runHeadlessReview = async () => { sessoes++; };
  e.prState = async () => { e.config.accounts[0].reviewRules = manual; return 'OPEN'; };
  await e.runOneHeadless({ ...pr(), manual: true, automaticRetry: true }, 'revisor');
  assert.equal(sessoes, 0);
  assert.equal(e.queue.length, 1);
});

test('troca para manual durante a repescagem não oculta o PR nem marca visto', async () => {
  const e = engine(automatico);
  e.queue = [pr()];
  e.unsee(pr().key);
  e.retryAfterNet.set(pr().key, { tries: 1, pr: { ...pr(), manual: true } });
  e.prState = async () => { e.config.accounts[0].reviewRules = manual; return 'OPEN'; };
  await e._repescarRetry([], new Set());
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.queue.length, 1);
  assert.equal(e.seen.has(pr().key), false);
});

test('troca para manual durante o gate de nova rodada não consome a âncora', async () => {
  const e = engine(automatico);
  e.panorama = [pr()];
  e.staleInfo = { [pr().key]: { stale: true, head: 'novo', lastState: 'CHANGES_REQUESTED' } };
  e.headQuietoDesde = { [pr().key]: { head: 'novo', at: 1 } };
  e.bloqueiaAutomatico = async () => { e.config.accounts[0].reviewRules = manual; return false; };
  await e.launchReReviews();
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.reReviewLaunched[pr().key], undefined);
});

test('mudança durante consulta libera apenas a vaga original e preserva a próxima revisão', async () => {
  const e = engine(automatico);
  e.config.parallelReviews = 1;
  e.headlessBusyAccounts.set('revisor', 1);
  const seguinte = { ...pr('outro', 'outra'), manual: true };
  const terceiro = { ...seguinte, key: 'outra/app#2', number: 2, url: 'https://github.com/outra/app/pull/2' };
  e.headlessQueue = [seguinte, terceiro];
  const iniciados = [];
  // A próxima sessão fica ocupando sua vaga; só o efeito externo da sessão é dublado.
  e.runOneHeadless = p => { iniciados.push(p.key); };
  e.processHeadless = () => Engine.prototype.processHeadless.call(e);
  e.prState = async () => { e.config.accounts[0].reviewRules = manual; return 'OPEN'; };
  await Engine.prototype.runOneHeadless.call(e, { ...pr(), manual: true, automaticRetry: true }, 'revisor');
  assert.deepEqual(iniciados, [seguinte.key]);
  assert.equal(e.headlessBusyAccounts.get('revisor'), 1, 'a próxima sessão ainda ocupa a conta');
  assert.equal(e.headlessQueue.length, 1, 'o terceiro PR continua esperando sua vaga');
  assert.equal(e.queue[0].key, pr().key, 'o PR bloqueado continua visível');
});

test('tela distingue herança, autor, publicação e conta manual, e escapa texto', () => {
  const html = reviewScopeHtml({ user: 'revisor', autoReview: false, reviewRules: { acme: { mode: 'manual', authors: { joao: 'auto' } } } });
  assert.match(html, /Review por organização e autor/);
  assert.match(html, /Seguir organização/);
  assert.match(html, /Seguir conta/);
  assert.match(html, /Sem efeito: conta manual/);
  assert.match(html, /a publicação segue as opções acima/);
  assert.match(html, /data-author="joao"/);
  assert.match(html, /aria-label="Modo de review: acme, @joao"/);
  assert.doesNotMatch(reviewScopeHtml({ user: '"><script>alert(1)</script>' }), /<script>/i);
});
