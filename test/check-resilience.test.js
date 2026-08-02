'use strict';
// check() resiliente a falha PARCIAL das buscas: quando só as --review-requested
// falham (ex.: rate limit da API de search), a fila, o "é meu" do panorama e os
// marcadores do último ciclo bom são preservados, como já acontece com reviewedKeys
// e myPRs. Sem isso, um ciclo ruim zerava a fila, apagava reReviewedKeys
// (ressuscitando PRs ignorados) e re-notificava tudo na recuperação.
// Runner nativo (node --test), ZERO dependências.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-checkres-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');
const { BASELINE_FILE, STATE_DIR } = require('../lib/paths');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = {
  key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'PR de teste',
  author: 'alice', repo: 'acme/app', number: 1, updatedAt: '2026-08-01T10:00:00Z', account: 'me'
};

// Engine com TODO colaborador de rede/side-effect do check() stubado. O roteiro
// (e.scenario) diz o que cada busca devolve no ciclo corrente; null = busca falhou.
function checkEngine() {
  const e = new Engine();
  e.config.accounts = [{ user: 'me', owners: ['acme'] }];
  e.config.autoReview = false; // nunca dispara revisão headless em teste
  e.seen = new Set();
  e.reReviewedKeys = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.queue = [];
  e.resolveAccount = async () => {};
  e.refreshTokens = async () => { e.tokenOk = true; return true; };
  e.myAuthoredPRs = async () => [];
  e.enrichMyPRBranches = async () => {};
  e.refreshMergeStates = async () => {};
  e.refreshStaleStates = async () => {};
  e.scanPushbacks = async () => {};
  e.checkUpdate = async () => {};
  e.launchReview = () => { throw new Error('launchReview não deveria rodar neste teste'); };
  e.schedule = () => {};
  e.saveSeen = () => {}; // seen em memória basta pro cenário
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  e.searchPRs = async (extraArgs) => {
    const lista = extraArgs[0] === '--owner' ? e.scenario.panorama
      : extraArgs[0] === '--review-requested=@me' ? e.scenario.mine
        : e.scenario.reviewed;
    return lista === null ? null : lista.map(p => ({ ...p })); // check() muta os PRs
  };
  // baseline já existente: a 1ª checagem da vida não pode engolir a fila do teste
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  e.notices = [];
  e.on('new-prs', ev => e.notices.push(ev));
  return e;
}

test('falha só das --review-requested preserva fila e "é meu", sem re-notificar', async () => {
  const e = checkEngine();
  // ciclo 1: tudo ok, o PR pedido a mim entra na fila e notifica UMA vez
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'notificou o PR novo uma vez');
  // ciclo 2: rate limit derruba só as buscas --review-requested
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1, 'fila preservada do último ciclo bom');
  assert.equal(e.panorama.find(p => p.key === PR.key).mine, true, 'o "é meu" não some do panorama');
  assert.equal(e.notices.length, 1, 'ciclo com falha não notifica');
  assert.equal(e.lastError, null, 'falha parcial não é erro fatal do ciclo');
  // ciclo 3: a busca volta; nada é "novo" de novo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'recuperação não re-notifica o que já estava na fila');
});

test('PR ignorado não ressuscita depois de um ciclo com busca falha', async () => {
  const e = checkEngine();
  // histórico local: já revisei este PR faz tempo (fora de qualquer carência)
  e.decisions.resolved.unshift({ key: PR.key, status: 'auto_approved', action: 'approve', resolvedAt: Date.now() - 60 * 60 * 1000 });
  e.seen.add(PR.key);
  // ciclo 1: re-request real detectado, volta pra fila
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), false, 're-request des-marca o visto');
  assert.ok(e.reReviewedKeys.has(PR.key));
  // usuário ignora (re-marca visto)
  e.seen.add(PR.key);
  // ciclo 2: a falha das buscas --review-requested não pode apagar o marcador
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.ok(e.reReviewedKeys.has(PR.key), 'marcador sobrevive à falha da busca');
  // ciclo 3: busca volta e o PR segue pedido; o ignorar fica valendo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), true, 'o ignorar do usuário fica valendo');
  assert.equal(e.queue.length, 0, 'não volta pra fila sozinho');
});
