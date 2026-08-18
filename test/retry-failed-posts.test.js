// Postagem que falhou por instabilidade tenta de novo sozinha.
//
// Bug real (biudtech/biud-frontend#774, 17/08/2026): a revisão decidiu approve, o
// gate LIBEROU (nenhum motivo de bloqueio bateu) e o POST morreu num 503 durante um
// major_outage do GitHub. Nada tentava de novo, então a pendência ficava presa
// esperando clique humano, mesmo com a decisão já pronta e o payload já gravado. O
// usuário via "aprovar sozinho" ligado e um PR na mesa mesmo assim, o que fazia a
// automação parecer quebrada quando o que houve foi a rede cair.
//
// A trava que mantém isso seguro é o dedup por head (myReviewStates): postar review
// NÃO é idempotente, então antes de reenviar o app confere se o review já está no PR.
// Se a 1ª tentativa tinha ido pro ar e só a resposta se perdeu, o retry vira no-op e
// a pendência resolve sem duplicar nada. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-retry-posts-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { MAX_POST_RETRY_ATTEMPTS } = await import('../lib/engine/decision.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';

function pendencia(extra = {}) {
  return {
    id: 'd-774', createdAt: Date.now(), status: 'pending', verdict: 'approve',
    key: 'o/r#774',
    pr: { repo: 'o/r', number: 774, url: 'https://github.com/o/r/pull/774', title: 't', author: 'alex' },
    headSha: HEAD,
    reasons: [
      { text: 'a doc afirma algo que o GitHub não faz', kind: 'content' },
      { text: 'falha ao postar o APPROVE: HTTP 503', kind: 'infra' },
    ],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    postRetry: { event: 'approve', attempts: 0 },
    ...extra
  };
}

// engine sem rede: postReview e myReviewStates são os únicos pontos de I/O e entram
// stubados. `posts` acumula o que teria ido pro GitHub, que é como os testes provam
// ausência de duplicata.
function engineCom(item, { postOk = true, states = [], head = HEAD } = {}) {
  const e = new Engine();
  const posts = [];
  e.decisions = { pending: item ? [item] : [], resolved: [] };
  e.saveDecisions = () => { };
  e.accountForPr = () => 'trabalho';
  e.writeMemory = () => { };
  // head AO VIVO: o retry confere se o código ainda é o mesmo que a revisão leu.
  // Por padrão devolve o mesmo HEAD, que é o caminho feliz; os testes de gate
  // passam outro valor (ou null) pra exercitar a recusa.
  e.headSha = async () => head;
  e.myReviewStates = async () => states;
  e.postReview = async (pr, payload) => {
    posts.push({ pr, payload });
    return postOk ? { ok: true } : { ok: false, attempted: true, error: 'HTTP 503 de novo' };
  };
  e.posts = posts;
  return e;
}

test('postagem que falhou por instabilidade vai sozinha no ciclo seguinte', async () => {
  const e = engineCom(pendencia());
  const n = await e.retryFailedPosts();
  assert.equal(n, 1, 'uma pendência resolvida sozinha');
  assert.equal(e.posts.length, 1, 'reenviou o review');
  assert.equal(e.posts[0].payload.event, 'APPROVE', 'reusou o payload já decidido');
  assert.equal(e.posts[0].payload.commit_id, HEAD, 'ancorado no head que a sessão leu');
  assert.equal(e.decisions.pending.length, 0, 'saiu de Precisa de você');
  const h = e.decisions.resolved[0];
  assert.equal(h.status, 'auto_approved', 'entra no histórico como aprovação automática, porque foi isso');
  assert.equal(h.postRetry, null, 'o marcador de retry morre junto');
});

test('a razão de INFRA some ao resolver, o achado da revisão fica', async () => {
  // a falha de rede deixou de existir (o post foi), mas o que a revisão apontou
  // sobre o código continua valendo e precisa seguir visível no histórico
  const e = engineCom(pendencia());
  await e.retryFailedPosts();
  const h = e.decisions.resolved[0];
  assert.equal(h.reasons.length, 1);
  assert.equal(h.reasons[0].kind, 'content');
  assert.match(h.reasons[0].text, /a doc afirma/);
});

test('review que JÁ estava no PR não é postado de novo (dedup por head)', async () => {
  // o cenário perigoso: a 1ª tentativa chegou no GitHub e só a resposta se perdeu.
  // Sem esta trava o retry duplicaria o review no PR de verdade.
  const e = engineCom(pendencia(), { states: ['APPROVED'] });
  const n = await e.retryFailedPosts();
  assert.equal(n, 1, 'a pendência resolve do mesmo jeito');
  assert.equal(e.posts.length, 0, 'mas NADA foi postado de novo');
  assert.equal(e.decisions.resolved[0].status, 'auto_approved');
});

test('falha de novo incrementa a tentativa e mantém a pendência', async () => {
  const e = engineCom(pendencia(), { postOk: false });
  const n = await e.retryFailedPosts();
  assert.equal(n, 0, 'nada resolvido');
  assert.equal(e.decisions.pending.length, 1, 'o card continua na sua mesa');
  assert.equal(e.decisions.pending[0].postRetry.attempts, 1);
  assert.equal(e.decisions.pending[0].postRetry.exhausted, false);
});

test('esgotadas as tentativas, para de tentar e a pendência espera você', async () => {
  const e = engineCom(pendencia());
  e.postReview = async () => ({ ok: false, attempted: true, error: 'HTTP 503 de novo' });
  for (let i = 0; i < MAX_POST_RETRY_ATTEMPTS; i++) await e.retryFailedPosts();
  const p = e.decisions.pending[0];
  assert.equal(p.postRetry.attempts, MAX_POST_RETRY_ATTEMPTS);
  assert.equal(p.postRetry.exhausted, true, 'marcado como esgotado pra tela poder dizer que desistiu');

  // e o próximo ciclo não tenta mais: acima do teto o filtro nem pega o item
  let tentou = false;
  e.postReview = async () => { tentou = true; return { ok: false, error: 'x' }; };
  await e.retryFailedPosts();
  assert.equal(tentou, false, 'não insiste pra sempre');
});

test('pendência SEM marcador de retry nunca é tocada pelo sweep', async () => {
  // é a maioria: gate barrou por regra ou conteúdo, e aí postar sozinho seria
  // exatamente o que o invariante 4 proíbe
  const e = engineCom(pendencia({ postRetry: null }));
  const n = await e.retryFailedPosts();
  assert.equal(n, 0);
  assert.equal(e.posts.length, 0, 'nada postado');
  assert.equal(e.decisions.pending.length, 1, 'segue esperando você');
});

test('marcador sem o payload correspondente desarma em vez de reenviar às cegas', async () => {
  const e = engineCom(pendencia({ payloads: {} }));
  const n = await e.retryFailedPosts();
  assert.equal(n, 0);
  assert.equal(e.posts.length, 0, 'não inventa um review pra postar');
  assert.equal(e.decisions.pending[0].postRetry, null, 'e não fica tentando pra sempre');
});

/* ---------- os dois gates do reenvio (achados em auditoria, 17/08/2026) ----------
   A primeira versão deste sweep conferia só "eu já postei neste head?". Faltavam
   duas perguntas, e as duas viraram furo real:

   1. O head ainda é o mesmo? A decisão foi tomada sobre item.headSha e o reenvio
      pode acontecer horas depois (até 3 ciclos de polling). Se o autor empurrou
      commit novo, o APPROVE guardado fala de código que não está mais lá, e postar
      aprova o que ninguém revisou. O decide() (caminho do clique) já lia o head ao
      vivo antes de postar; o retry não.

   2. Dá pra confirmar? Nos caminhos de PRIMEIRA tentativa, seguir sem confirmação
      é seguro porque nada tinha sido enviado. Aqui um POST já saiu (é por isso que
      existe retry) e o erro pode ter vindo DEPOIS de o GitHub aceitar, então
      reenviar sem prova arrisca review duplicado. */

test('head mudou: não posta, desarma o retry e explica na pendência', () => {
  const item = pendencia();
  const e = engineCom(item, { head: 'outro-head-porque-o-autor-empurrou' });
  return e.retryFailedPosts().then(() => {
    assert.equal(e.posts.length, 0, 'não aprova código que a revisão não leu');
    assert.equal(e.decisions.pending.length, 1, 'a pendência fica na mesa');
    assert.equal(e.decisions.pending[0].postRetry, null, 'e o retry desarma, não fica tentando pra sempre');
    const txt = (e.decisions.pending[0].reasons || []).map(r => r.text).join(' ');
    assert.match(txt, /commit novo/, 'o motivo diz o que houve');
    assert.ok(!(e.decisions.pending[0].reasons || []).some(r => r.kind === 'infra'),
      'a razão de infra sai: o problema já não é mais a rede');
  });
});

test('head não confirmado (null): não posta e tenta no ciclo seguinte', () => {
  const item = pendencia();
  const e = engineCom(item, { head: null });
  return e.retryFailedPosts().then(() => {
    assert.equal(e.posts.length, 0, 'sem prova do head, não escreve');
    assert.equal(e.decisions.pending.length, 1);
    assert.deepEqual(e.decisions.pending[0].postRetry, { event: 'approve', attempts: 0 },
      'o marcador fica intacto: não gastou tentativa por falta de dado nossa');
  });
});

test('dedup não confirmado (null): não reenvia, pra não arriscar duplicata', () => {
  const item = pendencia();
  const e = engineCom(item, { states: null });
  return e.retryFailedPosts().then(() => {
    assert.equal(e.posts.length, 0, 'a 1a tentativa pode ter ido pro ar: sem confirmar, não repete');
    assert.equal(e.decisions.pending.length, 1);
    assert.deepEqual(e.decisions.pending[0].postRetry, { event: 'approve', attempts: 0 },
      'tampouco gasta tentativa');
  });
});
