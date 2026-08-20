// UM Farol por PR (v2.51.0). O que dá pra provar sem rede é o que importa aqui:
// a leitura das labels é PURA, o gate é síncrono e sem IO (mesmo contrato do
// reReviewTargets: quem decide gastar sessão Claude tem que ser testável), a saída
// de cena é DURÁVEL (era o defeito da v2.49.0: adiava cinco minutos e revisava
// depois, deixando o comentário público mentindo), ela CADUCA quando a sessão do
// colega morre sem deixar review, e a co-assinatura é opt-in com gates próprios.
import os from 'node:os';
import path from 'node:path';
// ISOLAMENTO OBRIGATÓRIO, e ele estava faltando: saiDeCena/podarSkipComentado
// GRAVAM em STATE_DIR, que o paths.js resolve na hora do import. Sem fixar o
// FAROL_HOME antes, a suíte escrevia `skip-comentado.json` na instalação REAL
// (achado em 20/08/2026, com lixo de teste no ~/.farol de verdade). É a mesma
// lição do spawnlog.test.js documentada no CLAUDE.md, com outra roupa: lá o
// problema era o import hasteado, aqui era não ter env nenhuma.
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-skip-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skip = await import('../lib/engine/skip-review.js');
const io = (await import('../lib/io.js')).default;
const { revisandoPorOutros, textoDoPulo, outrosRevisando, standDownCaducou, quemAprovou } = skip;

/* ---------- leitura das labels (PURA) ---------- */

test('revisandoPorOutros: acha a label de outra pessoa', () => {
  assert.deepEqual(revisandoPorOutros(['thiagocarvalho-dev:revisando'], 'wandersonbiuder'), ['thiagocarvalho-dev']);
});

test('revisandoPorOutros: a MINHA própria label não me barra, mesmo com outra caixa', () => {
  assert.deepEqual(revisandoPorOutros(['wandersonbiuder:revisando'], 'wandersonbiuder'), []);
  assert.deepEqual(revisandoPorOutros(['WandersonBiuder:revisando'], 'wandersonbiuder'), []);
});

// regra explícita do Wanderson: review de ferramenta não substitui olho humano
test('revisandoPorOutros: acrity NUNCA entra na conta', () => {
  assert.deepEqual(revisandoPorOutros(['acrity:revisando'], 'eu'), []);
  assert.deepEqual(revisandoPorOutros(['acrity:revisando', 'ana:revisando'], 'eu'), ['ana']);
});

test('revisandoPorOutros: label que não é de revisando é ignorada', () => {
  assert.deepEqual(revisandoPorOutros(['bug', 'acrity:approved', 'review:in-progress'], 'eu'), []);
});

test('revisandoPorOutros: várias pessoas saem sem repetição e em ordem estável', () => {
  assert.deepEqual(revisandoPorOutros(['zoe:revisando', 'ana:revisando', 'zoe:revisando'], 'eu'), ['ana', 'zoe']);
});

test('revisandoPorOutros: entrada torta nunca lança', () => {
  assert.deepEqual(revisandoPorOutros(null, 'eu'), []);
  assert.deepEqual(revisandoPorOutros('nao-e-array', 'eu'), []);
  assert.deepEqual(revisandoPorOutros([null, '', ':revisando'], 'eu'), []);
});

/* ---------- o gate: síncrono e sem IO ---------- */

test('outrosRevisando: lê só o que a busca já trouxe, nunca chama gh', () => {
  const engine = {
    accountForPr: () => 'eu',
    ghEnv: () => { throw new Error('o gate não podia tocar o gh'); },
    tokenFor: () => { throw new Error('o gate não podia perguntar token'); },
  };
  assert.deepEqual(outrosRevisando(engine, { labels: ['ana:revisando'] }), ['ana']);
  // PR de uma busca antiga (sem o campo labels) degrada pra "ninguém revisando",
  // que é o comportamento de antes desta feature: falta de dado nunca pula revisão
  assert.deepEqual(outrosRevisando(engine, {}), []);
});

/* ---------- texto do comentário ---------- */

test('textoDoPulo: sem citar automação, sem pronome de gênero e sem travessão', () => {
  const t = textoDoPulo(['ana']);
  assert.match(t, /@ana já está revisando/);
  assert.doesNotMatch(t, /Farol|automa|bot|IA|revisão automática/i);
  assert.doesNotMatch(t, /\bele\b|\bela\b/i);
  assert.doesNotMatch(t, /—/);
});

test('textoDoPulo: plural e lista com "e" no fim', () => {
  assert.match(textoDoPulo(['ana', 'zoe']), /@ana e @zoe já estão revisando/);
  assert.match(textoDoPulo(['ana', 'bia', 'zoe']), /@ana, @bia e @zoe/);
  assert.equal(textoDoPulo([]), '');
});

test('textoDaCoassinatura: humano e sem vazar automação', () => {
  const t = skip.textoDaCoassinatura('ana');
  assert.match(t, /@ana/);
  assert.doesNotMatch(t, /Farol|automa|bot|IA|co-assin/i);
});

/* ---------- caducidade (PURA) ---------- */

// a rede de segurança: sem isso, um crash na máquina do colega deixaria o PR órfão
test('standDownCaducou: caduca quando quem pegou sumiu sem deixar review', () => {
  const reg = { quem: ['ana'] };
  assert.equal(standDownCaducou(reg, [], []), true);
});

test('standDownCaducou: NÃO caduca enquanto a pessoa ainda está com a label', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, ['ana'], []), false);
});

test('standDownCaducou: NÃO caduca quando ela deixou review no head', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], [{ quem: 'ana', state: 'APPROVED' }]), false);
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], [{ quem: 'ana', state: 'CHANGES_REQUESTED' }]), false);
});

// sem prova (rede fora) fico de fora: é o lado seguro de "um Farol por PR"
test('standDownCaducou: sem a lista de reviews NUNCA caduca', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], null), false);
});

test('standDownCaducou: com duas pessoas, basta uma seguir viva pra não caducar', () => {
  assert.equal(standDownCaducou({ quem: ['ana', 'zoe'] }, ['zoe'], []), false);
  assert.equal(standDownCaducou({ quem: ['ana', 'zoe'] }, [], []), true);
});

test('quemAprovou: só considera quem eu saí de cena por causa', () => {
  const reg = { quem: ['ana'] };
  assert.equal(quemAprovou(reg, [{ quem: 'ana', state: 'APPROVED' }]), 'ana');
  assert.equal(quemAprovou(reg, [{ quem: 'ana', state: 'CHANGES_REQUESTED' }]), '');
  // aprovação de terceiro que não é quem pegou o PR não conta
  assert.equal(quemAprovou(reg, [{ quem: 'bob', state: 'APPROVED' }]), '');
});

/* ---------- saída de cena e co-assinatura ---------- */

function engineFalso(extra = {}) {
  return {
    skipComentado: {},
    config: {},
    logs: [], toasts: [], rodou: [], postados: [],
    accountForPr: () => 'eu',
    tokenFor: () => 'tok',
    ghEnv: () => ({}),
    log(nivel, msg) { this.logs.push({ nivel, msg }); },
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    myReviewStates: async () => [],
    postReview: async (pr, payload) => { extra.postados && extra.postados.push(payload); return { ok: true }; },
    ...extra,
  };
}

// substitui io.run pelo espião e devolve a função de restaurar
function espiaGh(engine, ok = true) {
  const original = io.run;
  io.run = (cmd, args) => { engine.rodou.push(args); return Promise.resolve({ ok, stdout: '[]', stderr: 'falhou' }); };
  return () => { io.run = original; };
}

const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1 };

test('saiDeCena: comenta e grava a âncora POR HEAD', async (t) => {
  const engine = engineFalso();
  t.after(espiaGh(engine));
  const ok = await skip.saiDeCena(engine, PR, ['ana'], 'sha1');
  assert.equal(ok, true);
  assert.deepEqual(engine.rodou[0].slice(0, 3), ['pr', 'comment', PR.url]);
  assert.equal(engine.skipComentado['o/r#1'].head, 'sha1');
  assert.deepEqual(engine.skipComentado['o/r#1'].quem, ['ana']);
});

// a âncora só nasce de um comentário que SAIU: um 503 não pode registrar uma
// saída de cena silenciosa, senão o Farol some do PR sem ninguém ser avisado
test('saiDeCena: gh que falha não grava âncora', async (t) => {
  const engine = engineFalso();
  t.after(espiaGh(engine, false));
  assert.equal(await skip.saiDeCena(engine, PR, ['ana'], 'sha1'), false);
  assert.equal(engine.skipComentado['o/r#1'], undefined);
  assert.equal(engine.logs[0].nivel, 'WARN');
});

// mesma raiz A1 do resto do engine: agir sem identidade provada é pior que não agir
test('saiDeCena: conta sem token não roda gh', async (t) => {
  const engine = engineFalso({ tokenFor: () => null });
  t.after(espiaGh(engine));
  assert.equal(await skip.saiDeCena(engine, PR, ['ana'], 'sha1'), false);
  assert.equal(engine.rodou.length, 0);
});

test('coAssinar: posta APPROVE em meu nome e marca a âncora', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  t.after(espiaGh(engine));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  assert.equal(await skip.coAssinar(engine, PR, 'ana', 'sha1'), true);
  assert.equal(postados[0].event, 'APPROVE');
  assert.match(postados[0].body, /@ana/);
  assert.equal(engine.skipComentado['o/r#1'].coAssinado, true);
});

// postar review não é idempotente: sem confirmar o que já existe, não posta
test('coAssinar: não posta quando eu já aprovei este head', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados, myReviewStates: async () => ['APPROVED'] });
  t.after(espiaGh(engine));
  assert.equal(await skip.coAssinar(engine, PR, 'ana', 'sha1'), false);
  assert.equal(postados.length, 0);
});

test('coAssinar: sem conseguir confirmar meus reviews (null), não posta', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados, myReviewStates: async () => null });
  t.after(espiaGh(engine));
  assert.equal(await skip.coAssinar(engine, PR, 'ana', 'sha1'), false);
  assert.equal(postados.length, 0);
});

/* ---------- o ciclo: seguir fora, caducar ou co-assinar ---------- */

// espião que devolve uma lista de reviews de outros pelo caminho do gh api
function espiaReviews(engine, lista) {
  const original = io.run;
  io.run = (cmd, args) => {
    engine.rodou.push(args);
    if (args[0] === 'api') return Promise.resolve({ ok: true, stdout: JSON.stringify(lista), stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  return () => { io.run = original; };
}

test('seguirForaDeCena: sessão do colega morreu sem review, a saída caduca', async (t) => {
  const engine = engineFalso();
  t.after(espiaReviews(engine, []));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, false, 'volta a revisar');
  assert.equal(engine.skipComentado['o/r#1'], undefined, 'âncora some');
});

test('seguirForaDeCena: com a chave DESLIGADA, aprovação do colega não co-assina', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, true, 'segue fora de cena');
  assert.equal(postados.length, 0, 'nada foi postado');
});

test('seguirForaDeCena: com a chave LIGADA, aprovação do colega vira co-assinatura', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  engine.config.coAssinarReview = true;
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, true);
  assert.equal(postados[0].event, 'APPROVE');
});

// pedido de mudanças do colega NÃO é aprovação: nada é co-assinado, e o PR
// continua fora de cena (um Farol por PR), esperando o autor corrigir
test('seguirForaDeCena: colega pediu mudanças, não co-assina e segue fora', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  engine.config.coAssinarReview = true;
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'CHANGES_REQUESTED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  assert.equal(await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1'), true);
  assert.equal(postados.length, 0);
});

test('seguirForaDeCena: já co-assinado não posta de novo', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  engine.config.coAssinarReview = true;
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'], coAssinado: true };
  await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(postados.length, 0);
});

// review de head ANTIGO não conta: o autor empurrou código novo desde então
test('reviewsDeOutros: filtra pelo head pedido', async (t) => {
  const engine = engineFalso();
  t.after(espiaReviews(engine, [
    { quem: 'ana', state: 'APPROVED', commit_id: 'sha-velho' },
    { quem: 'zoe', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const lista = await skip.reviewsDeOutros(engine, PR, 'sha1');
  assert.deepEqual(lista.map(r => r.quem), ['zoe']);
});

test('podarSkipComentado: âncora some junto com o PR que saiu do panorama', () => {
  const engine = engineFalso();
  engine.skipComentado = { 'o/r#1': { at: 1 }, 'o/r#2': { at: 2 } };
  skip.podarSkipComentado(engine, new Set(['o/r#1']));
  assert.deepEqual(Object.keys(engine.skipComentado), ['o/r#1']);
});

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
