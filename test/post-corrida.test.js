// A corrida de postagem do biud-esg#230 (23/08/2026): DOIS APPROVE meus no mesmo PR,
// com 10 segundos de diferença (02:04:33Z e 02:04:43Z). O log conta a história inteira:
// às 22:10:53 -03 a postagem morreu por rede, e às 23:04:42 -03 saiu
// "decide biud-esg#230: pendência já resolvida durante o post, histórico preservado",
// exatamente ENTRE os dois reviews. Ou seja, o reenvio automático (retryFailedPosts) e o
// clique (decide) postaram nos dois lados da mesma janela.
//
// O que NÃO estava faltando: dedup. Toda via que posta consulta myReviewStates antes
// (review.js, retryFailedPosts, decide, skip-review). O furo é que a consulta responde
// sobre o PASSADO: entre "o GitHub disse que não há review meu" e o POST cabe outro POST.
// Duas vias perguntam, as duas ouvem "ainda não", as duas postam.
//
// A trava certa mora no FUNIL: postReview é o ponto por onde as cinco vias passam. Aqui
// elas entram em fila por PR+conta, e quem chega depois não reposta o mesmo veredito no
// mesmo head. Round novo (head diferente) e comentário continuam passando: o que se
// impede é a duplicata, nunca a segunda manifestação legítima.
//
// Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-post-corrida-' + process.pid);

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const posts = [];
io.run = function runEspiao(cmd, args, opts) {
  const lista = args || [];
  // só as CHAMADAS DE POSTAGEM entram na contagem (o gh também é usado pra ler)
  if (cmd === 'gh' && lista[0] === 'api' && /\/reviews$/.test(String(lista[1] || '')) && lista.includes('--input')) {
    const corpo = io.parseJson(fs.readFileSync(lista[lista.indexOf('--input') + 1], 'utf8'), {});
    posts.push({ alvo: lista[1], event: corpo.event, commit_id: corpo.commit_id || '' });
  }
  if (runImpl) return runImpl(cmd, lista, opts);
  return runReal(cmd, lista, opts);
};

const { Engine } = await import('../server.js');
const D = (await import('../lib/engine/decision.js')).default;

after(() => {
  io.run = runReal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { posts.length = 0; runImpl = null; });

const PR = { key: 'acme/api#230', repo: 'acme/api', number: 230, url: 'u', author: 'alice' };
const OUTRO = { key: 'acme/api#231', repo: 'acme/api', number: 231, url: 'u', author: 'bob' };

function engineDeTeste() {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'conta-dona';
  e.tokenFor = () => 'tok';
  e.refreshTokens = async () => { };
  e.token = 'tok';
  e.ghEnv = () => ({});
  return e;
}

// o `gh` demora um tiquinho: sem isso as duas chamadas não chegam a se sobrepor e o
// teste passaria mesmo sem fila (era o furo do teste, não do código)
function ghLento(ms = 30, ok = true) {
  return async () => { await new Promise(r => setTimeout(r, ms)); return { ok, stdout: '{}', stderr: ok ? '' : 'boom' }; };
}

test('duas vias postando o MESMO veredito no mesmo head ao mesmo tempo: só uma vai pro GitHub', async () => {
  const e = engineDeTeste();
  runImpl = ghLento();
  const payload = { event: 'APPROVE', body: 'O gate ficou correto.', commit_id: '3cf42b3' };
  // o cenário do #230: reenvio automático e clique disparam praticamente juntos
  const [a, b] = await Promise.all([
    e.postReview(PR, { ...payload }),
    e.postReview(PR, { ...payload }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, 'quem chegou depois não vira erro: o review ESTÁ no PR');
  assert.equal(posts.length, 1, `o GitHub recebeu ${posts.length} APPROVE; era pra ser 1`);
  assert.ok(a.deduped || b.deduped, 'a segunda diz que não postou de novo');
});

test('a fila é por PR: dois PRs diferentes postam os dois', async () => {
  const e = engineDeTeste();
  runImpl = ghLento();
  const payload = { event: 'APPROVE', body: 'O gate ficou correto.', commit_id: '3cf42b3' };
  await Promise.all([e.postReview(PR, { ...payload }), e.postReview(OUTRO, { ...payload })]);
  assert.equal(posts.length, 2, 'PR diferente não pode esperar nem ser deduplicado pelo vizinho');
});

test('round novo (head diferente) posta de novo: o que se impede é duplicata, não segunda rodada', async () => {
  const e = engineDeTeste();
  runImpl = ghLento(1);
  await e.postReview(PR, { event: 'APPROVE', body: 'Primeiro round aprovado.', commit_id: '3cf42b3' });
  await e.postReview(PR, { event: 'APPROVE', body: 'Segundo round aprovado.', commit_id: 'b8722a3' });
  assert.equal(posts.length, 2, 'head novo é outra manifestação (engine-ai#51 aprovou dois rounds legítimos)');
});

test('COMMENT não entra no dedup: comentar duas vezes no mesmo head é legítimo', async () => {
  const e = engineDeTeste();
  runImpl = ghLento(1);
  await e.postReview(PR, { event: 'COMMENT', body: 'Uma pergunta sobre o gate.', commit_id: '3cf42b3' });
  await e.postReview(PR, { event: 'COMMENT', body: 'Outra pergunta, outro assunto.', commit_id: '3cf42b3' });
  assert.equal(posts.length, 2, 'o chat do PR conversa; travar isso emudeceria a conversa');
});

test('se a primeira postagem FALHA, a segunda posta de verdade (nada é dado como entregue)', async () => {
  const e = engineDeTeste();
  runImpl = ghLento(5, false);
  const primeira = await e.postReview(PR, { event: 'APPROVE', body: 'O gate ficou correto.', commit_id: '3cf42b3' });
  assert.equal(primeira.ok, false);
  runImpl = ghLento(1, true);
  const segunda = await e.postReview(PR, { event: 'APPROVE', body: 'O gate ficou correto.', commit_id: '3cf42b3' });
  assert.equal(segunda.ok, true);
  assert.equal(segunda.deduped, undefined, 'falha não conta como review entregue');
  assert.equal(posts.length, 2, 'a tentativa que falhou não pode calar a que ia dar certo');
});

test('a fila serializa: a segunda chamada só encosta no gh depois que a primeira termina', async () => {
  const e = engineDeTeste();
  let simultaneas = 0, pico = 0;
  runImpl = async () => {
    simultaneas++; pico = Math.max(pico, simultaneas);
    await new Promise(r => setTimeout(r, 20));
    simultaneas--;
    return { ok: true, stdout: '{}', stderr: '' };
  };
  // vereditos diferentes: nenhum é deduplicado, então os dois POSTAM; o que se mede
  // aqui é que eles não acontecem ao MESMO tempo (era a janela da corrida)
  await Promise.all([
    e.postReview(PR, { event: 'APPROVE', body: 'O gate ficou correto.', commit_id: '3cf42b3' }),
    e.postReview(PR, { event: 'COMMENT', body: 'Um recado sobre o gate.', commit_id: '3cf42b3' }),
  ]);
  assert.equal(posts.length, 2);
  assert.equal(pico, 1, 'duas postagens no mesmo PR nunca ficam no ar ao mesmo tempo');
});

test('contas diferentes no mesmo PR não se deduplicam (multiconta: são duas pessoas)', async () => {
  const e = engineDeTeste();
  let quem = 'conta-a';
  e.accountForPr = () => quem;
  runImpl = ghLento(1);
  await e.postReview(PR, { event: 'APPROVE', body: 'O gate ficou correto.', commit_id: '3cf42b3' });
  quem = 'conta-b';
  await e.postReview(PR, { event: 'APPROVE', body: 'O gate ficou correto.', commit_id: '3cf42b3' });
  assert.equal(posts.length, 2, 'a aprovação de cada conta é uma assinatura diferente');
});

test('sha torto não inventa round novo: o GitHub descarta a âncora, o dedup também', () => {
  // normalizeReviewPayload (public-review.js) só aceita 7 a 40 hex; fora disso o review
  // sai SEM âncora. Se a assinatura olhasse o valor cru, dois posts idênticos com lixo
  // diferente no commit_id passariam como rodadas diferentes e duplicariam o review.
  const a = { event: 'APPROVE', body: 'x', commit_id: 'nao-e-sha' };
  const b = { event: 'APPROVE', body: 'x', commit_id: 'tambem-nao' };
  assert.equal(D.postedSignature('lane', a), D.postedSignature('lane', b));
  assert.notEqual(D.postedSignature('lane', a), D.postedSignature('lane', { ...a, commit_id: '3cf42b3' }));
  assert.equal(D.postedSignature('lane', { event: 'APPROVE', body: 'x', commit_id: '3CF42B3' }),
    D.postedSignature('lane', { event: 'approve', body: 'x', commit_id: '3cf42b3' }),
    'caixa do sha e do evento não são rodadas diferentes');
});
