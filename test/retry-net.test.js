'use strict';
// Retry pós-falha transitória: o toast promete "tento de novo no próximo ciclo",
// então o próximo ciclo tem que conseguir relançar SEM depender (a) da política
// autoReview da conta e (b) de o PR seguir na fila mine (revisão por clique no
// panorama não é mine e sai da queue no rebuild do check). O M8 era exatamente
// essa promessa quebrada. O filtro de token da Onda 1 permanece: conta sem token
// não abre sessão, então também não relança (R2 do plano mestre). Runner nativo,
// ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-retry-net-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.isMuted = (u) => u === 'silenciada';
  // tokens por conta (tokenFor consulta este mapa): 'semtoken' fica de fora de propósito
  e.tokens = { eu: 'tok-eu', silenciada: 'tok-sil' };
  e.log = () => { };
  return e;
}
const prDe = (key, extra) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}`, ...extra });

test('runOneHeadless guarda o PR junto das tentativas na falha transitória', async () => {
  const e = engineBase();
  e.runHeadlessReview = async () => { throw new Error('fetch failed'); };
  const pr = prDe('o/r#1');
  await e.runOneHeadless(pr, 'eu');
  const guardado = e.retryAfterNet.get('o/r#1');
  assert.equal(guardado.tries, 1, 'conta a tentativa');
  assert.equal(guardado.pr.url, pr.url, 'guarda o PR pra relançar sem depender da fila');
});

test('runOneHeadless cancela a revisão se o PR já foi mergeado enquanto esperava a vez', async () => {
  const e = engineBase();
  e.prState = async () => 'MERGED';
  let rodouRevisao = false;
  e.runHeadlessReview = async () => { rodouRevisao = true; };
  e.headlessBusyAccounts.add('eu');
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(rodouRevisao, false, 'não roda a sessão de revisão num PR já mergeado');
  assert.equal(e.headlessBusyAccounts.has('eu'), false, 'libera a conta pro escalonador');
});

test('runOneHeadless roda normalmente quando o estado do PR não confirma merge', async () => {
  const e = engineBase();
  e.prState = async () => 'OPEN';
  let rodouRevisao = false;
  e.runHeadlessReview = async () => { rodouRevisao = true; };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(rodouRevisao, true, 'PR aberto segue pro fluxo normal de revisão');
});

test('runOneHeadless roda normalmente quando não dá pra confirmar o estado do PR (rede caiu)', async () => {
  const e = engineBase();
  e.prState = async () => { throw new Error('rede caiu'); };
  let rodouRevisao = false;
  e.runHeadlessReview = async () => { rodouRevisao = true; };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  assert.equal(rodouRevisao, true, 'sem prova de merge, nunca pula a revisão por engano');
});

test('retryTargets relança PR de clique no panorama (fora da fila) e ignora autoReview da conta', () => {
  const e = engineBase();
  e.autoReviewFor = () => false; // conta SEM auto-revisão: a promessa do toast vale mesmo assim
  e.queue = [];                  // PR de clique não é mine: nunca volta pra queue no rebuild
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1') });
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map(p => p.key), ['o/r#1']);
});

test('retryTargets pula silenciado, recém-chegado e o que já está rodando', () => {
  const e = engineBase();
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1', { account: 'silenciada' }) });
  e.retryAfterNet.set('o/r#2', { tries: 1, pr: prDe('o/r#2') });
  e.retryAfterNet.set('o/r#3', { tries: 1, pr: prDe('o/r#3') });
  e.retryAfterNet.set('o/r#4', { tries: 1, pr: prDe('o/r#4') });
  const alvos = e.retryTargets(new Set(['o/r#2']), new Set(['o/r#3']));
  assert.deepEqual(alvos.map(p => p.key), ['o/r#4']);
});

test('retryTargets: conta sem token não relança (o filtro da Onda 1 permanece, R2)', () => {
  const e = engineBase();
  e.retryAfterNet.set('o/r#1', { tries: 1, pr: prDe('o/r#1', { account: 'semtoken' }) });
  e.retryAfterNet.set('o/r#2', { tries: 1, pr: prDe('o/r#2') });
  assert.deepEqual(e.retryTargets(new Set(), new Set()).map(p => p.key), ['o/r#2'],
    'sem token não abre sessão: o PR espera o token voltar em vez de falhar de novo');
});
