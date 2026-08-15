'use strict';
// Pendência atendida FORA do botão: o review saiu pelo chat do PR (ou pela web do
// GitHub, ou por gh na mão) e o card ficava preso em "Precisa de você" pra sempre.
//
// Causa raiz do bug real (biudtech/internal-auth#34, 03/08/2026): decisions.pending só
// era esvaziado dentro de decide(), o caminho do clique. O chat posta pela sessão do
// Claude, direto no gh, e nada no ciclo de checagem confrontava a pendência com o que
// já existe de review MEU no PR. Evidência do dia: pendência criada 17:33, APPROVE meu
// submetido 17:35 pelo chat, card ainda na tela.
//
// A trava aqui é o horário: só review submetido DEPOIS da pendência a resolve. Review
// ANTERIOR é o caso do re-request (o autor derruba a minha aprovação e pede de novo);
// ali a pendência é justamente a nova rodada e não pode desaparecer. Runner nativo,
// ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-reconcile-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const CRIADA = Date.parse('2026-08-03T20:33:08Z');

function pendencia(key, at = CRIADA) {
  const [repo, number] = key.split('#');
  return {
    id: `d-${key}`, createdAt: at, status: 'pending', verdict: 'request_changes',
    key, pr: { repo, number: Number(number), url: `https://github.com/${repo}/pull/${number}`, title: 't', author: 'alex' },
    reasons: ['algo a conferir'], payloads: { approve: { event: 'APPROVE', body: 'ok' } }
  };
}

// engine sem rede: o único ponto de I/O (myReviewsWithTime) é stubado por PR.
// prState fica com a implementação real: accountForPr aponta pra 'trabalho' sem
// token nenhum em e.tokens, então tokenFor devolve falso e prState resolve pra
// null sem nenhuma chamada de rede (mesmo padrão dos outros testes deste arquivo).
function engineCom(pendentes, reviewsPorKey) {
  const e = new Engine();
  e.decisions = { pending: [...pendentes], resolved: [] };
  e.saveDecisions = () => { };
  e.accountForPr = () => 'trabalho';
  e.myReviewsWithTime = async (pr) => (pr.key in reviewsPorKey ? reviewsPorKey[pr.key] : null);
  return e;
}

test('review meu postado DEPOIS da pendência (chat) resolve o card', async () => {
  const e = engineCom([pendencia('o/r#34')], {
    'o/r#34': [{ state: 'APPROVED', at: CRIADA + 3 * 60 * 1000 }]
  });
  const n = await e.reconcilePending();
  assert.equal(n, 1, 'uma pendência reconciliada');
  assert.equal(e.decisions.pending.length, 0, 'saiu de Precisa de você');
  const h = e.decisions.resolved[0];
  assert.equal(h.key, 'o/r#34');
  assert.equal(h.status, 'already_reviewed', 'histórico marca que o review já existia, não que o Farol postou');
  assert.equal(h.action, 'approve', 'a ação vem do estado real do review no GitHub');
  assert.equal(e.reviewActions()['o/r#34'].kind, 'approve', 'o indicador para de dizer "aguardando você"');
});

test('review meu ANTERIOR à pendência (re-request) NÃO resolve o card', async () => {
  const e = engineCom([pendencia('o/r#41')], {
    'o/r#41': [{ state: 'APPROVED', at: CRIADA - 24 * 60 * 60 * 1000 }]
  });
  const n = await e.reconcilePending();
  assert.equal(n, 0, 'nada reconciliado');
  assert.equal(e.decisions.pending.length, 1, 'a nova rodada continua na sua mesa');
});

test('não deu pra confirmar (sem token ou rede caída) mantém a pendência', async () => {
  const e = engineCom([pendencia('o/r#7')], {});   // myReviewsWithTime devolve null
  assert.equal(await e.reconcilePending(), 0);
  assert.equal(e.decisions.pending.length, 1, 'card nunca desaparece por falta de prova');
});

test('review derrubado (DISMISSED) não conta como atendimento', async () => {
  const e = engineCom([pendencia('o/r#9')], {
    'o/r#9': [{ state: 'DISMISSED', at: CRIADA + 60 * 1000 }]
  });
  assert.equal(await e.reconcilePending(), 0);
  assert.equal(e.decisions.pending.length, 1);
});

test('CHANGES_REQUESTED e COMMENTED também resolvem, com a ação certa', async () => {
  const e = engineCom([pendencia('o/r#11'), pendencia('o/r#12')], {
    'o/r#11': [{ state: 'CHANGES_REQUESTED', at: CRIADA + 60 * 1000 }],
    'o/r#12': [{ state: 'COMMENTED', at: CRIADA + 60 * 1000 }]
  });
  assert.equal(await e.reconcilePending(), 2);
  const acoes = Object.fromEntries(e.decisions.resolved.map(h => [h.key, h.action]));
  assert.deepEqual(acoes, { 'o/r#11': 'request_changes', 'o/r#12': 'comment' });
});

test('vale o review MAIS RECENTE quando há vários depois da pendência', async () => {
  const e = engineCom([pendencia('o/r#13')], {
    'o/r#13': [
      { state: 'COMMENTED', at: CRIADA + 60 * 1000 },
      { state: 'APPROVED', at: CRIADA + 5 * 60 * 1000 }
    ]
  });
  assert.equal(await e.reconcilePending(), 1);
  assert.equal(e.decisions.resolved[0].action, 'approve', 'o desfecho é o último review, não o primeiro');
});

test('com keys, olha só os PRs pedidos e não gasta consulta no resto', async () => {
  const consultados = [];
  const e = engineCom([pendencia('o/r#20'), pendencia('o/r#21')], {});
  e.myReviewsWithTime = async (pr) => {
    consultados.push(pr.key);
    return [{ state: 'APPROVED', at: CRIADA + 60 * 1000 }];
  };
  const n = await e.reconcilePending(['o/r#21']);
  assert.equal(n, 1);
  assert.deepEqual(consultados, ['o/r#21'], 'só o PR pedido foi consultado');
  assert.equal(e.decisions.pending.length, 1);
  assert.equal(e.decisions.pending[0].key, 'o/r#20', 'a outra pendência ficou intacta');
});

test('sem pendência nenhuma, não consulta o GitHub', async () => {
  const e = engineCom([], {});
  let chamou = false;
  e.myReviewsWithTime = async () => { chamou = true; return null; };
  assert.equal(await e.reconcilePending(), 0);
  assert.equal(chamou, false, 'ciclo de checagem não paga consulta à toa');
});

test('PR já mergeado cancela a pendência sem consultar review nem postar nada', async () => {
  const e = engineCom([pendencia('o/r#50')], {});
  e.prState = async () => 'MERGED';
  let consultouReviews = false;
  e.myReviewsWithTime = async () => { consultouReviews = true; return null; };
  const n = await e.reconcilePending();
  assert.equal(n, 1, 'uma pendência cancelada');
  assert.equal(e.decisions.pending.length, 0, 'saiu de Precisa de você');
  assert.equal(consultouReviews, false, 'mergeado não precisa checar estado de review');
  const h = e.decisions.resolved[0];
  assert.equal(h.key, 'o/r#50');
  assert.equal(h.status, 'already_merged');
});

test('PR fechado sem merge (CLOSED) cancela a pendência sem consultar review nem postar nada', async () => {
  const e = engineCom([pendencia('o/r#55')], {});
  e.prState = async () => 'CLOSED';
  let consultouReviews = false;
  e.myReviewsWithTime = async () => { consultouReviews = true; return null; };
  const n = await e.reconcilePending();
  assert.equal(n, 1, 'uma pendência cancelada');
  assert.equal(e.decisions.pending.length, 0, 'saiu de Precisa de você');
  assert.equal(consultouReviews, false, 'fechado sem merge não precisa checar estado de review');
  const h = e.decisions.resolved[0];
  assert.equal(h.key, 'o/r#55');
  assert.equal(h.status, 'already_closed');
  assert.equal(h.action, 'skip');
});

test('PR ainda aberto (MERGED não confirmado) segue pro fluxo normal de reconciliação', async () => {
  const e = engineCom([pendencia('o/r#51')], {
    'o/r#51': [{ state: 'APPROVED', at: CRIADA + 60 * 1000 }]
  });
  e.prState = async () => 'OPEN';
  const n = await e.reconcilePending();
  assert.equal(n, 1);
  assert.equal(e.decisions.resolved[0].status, 'already_reviewed', 'PR aberto não cancela por merge, resolve pelo review de sempre');
});

test('falha ao confirmar o estado do PR (null) mantém a pendência na fila de reconciliação normal', async () => {
  const e = engineCom([pendencia('o/r#52')], {});
  e.prState = async () => { throw new Error('rede caiu'); };
  e.log = () => { };
  const n = await e.reconcilePending();
  assert.equal(n, 0);
  assert.equal(e.decisions.pending.length, 1, 'sem prova de merge, o card não desaparece');
});

test('myReviewStates continua derivando do mesmo lugar (contrato do dedup do clique)', async () => {
  const e = new Engine();
  e.myReviewsWithTime = async () => [{ state: 'APPROVED', at: CRIADA }, { state: 'COMMENTED', at: CRIADA }];
  assert.deepEqual(await e.myReviewStates({ key: 'o/r#1', repo: 'o/r', number: 1 }), ['APPROVED', 'COMMENTED']);
  e.myReviewsWithTime = async () => null;
  assert.equal(await e.myReviewStates({ key: 'o/r#1', repo: 'o/r', number: 1 }), null,
    'null (não confirmado) precisa atravessar, senão o dedup viraria "nunca revisei"');
});
