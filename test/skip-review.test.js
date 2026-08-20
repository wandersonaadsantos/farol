// Pular a revisão quando OUTRA PESSOA já está revisando (v2.48.4, pedido do
// Wanderson em 20/08/2026). O que dá pra provar sem rede é o que importa aqui:
// a leitura das labels é PURA, o gate é síncrono e sem IO (mesmo contrato do
// reReviewTargets: quem decide gastar sessão Claude tem que ser testável), e o
// comentário sai UMA vez por PR. Ferramenta nunca conta como pessoa.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const skip = await import('../lib/engine/skip-review.js');
const { revisandoPorOutros, textoDoPulo, outrosRevisando } = skip;

/* ---------- leitura das labels (PURA) ---------- */

test('revisandoPorOutros: acha a label de outra pessoa', () => {
  assert.deepEqual(revisandoPorOutros(['thiagocarvalho-dev:revisando'], 'wandersonbiuder'), ['thiagocarvalho-dev']);
});

test('revisandoPorOutros: a MINHA própria label não me barra', () => {
  assert.deepEqual(revisandoPorOutros(['wandersonbiuder:revisando'], 'wandersonbiuder'), []);
});

// o GitHub preserva a caixa do login na label, e login não distingue caixa
test('revisandoPorOutros: minha label com outra caixa também não me barra', () => {
  assert.deepEqual(revisandoPorOutros(['WandersonBiuder:revisando'], 'wandersonbiuder'), []);
});

// regra explícita do Wanderson: review de ferramenta não substitui olho humano,
// então ver a label dela não pode fazer o Farol se calar
test('revisandoPorOutros: acrity NUNCA entra na conta', () => {
  assert.deepEqual(revisandoPorOutros(['acrity:revisando'], 'eu'), []);
  assert.deepEqual(revisandoPorOutros(['acrity:revisando', 'ana:revisando'], 'eu'), ['ana']);
});

test('revisandoPorOutros: label que não é de revisando é ignorada', () => {
  assert.deepEqual(revisandoPorOutros(['bug', 'acrity:approved', 'review:in-progress'], 'eu'), []);
});

test('revisandoPorOutros: várias pessoas saem sem repetição e em ordem estável', () => {
  const achado = revisandoPorOutros(['zoe:revisando', 'ana:revisando', 'zoe:revisando'], 'eu');
  assert.deepEqual(achado, ['ana', 'zoe']);
});

test('revisandoPorOutros: entrada torta nunca lança', () => {
  assert.deepEqual(revisandoPorOutros(null, 'eu'), []);
  assert.deepEqual(revisandoPorOutros(undefined, 'eu'), []);
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
  assert.deepEqual(outrosRevisando(engine, { labels: [] }), []);
  // PR de uma busca antiga (sem o campo labels) degrada pra "ninguém revisando",
  // que é o comportamento de antes desta feature: falta de dado nunca pula revisão
  assert.deepEqual(outrosRevisando(engine, {}), []);
});

/* ---------- texto do comentário ---------- */

test('textoDoPulo: uma pessoa, sem citar automação e sem pronome de gênero', () => {
  const t = textoDoPulo(['ana']);
  assert.match(t, /@ana já está revisando/);
  assert.doesNotMatch(t, /Farol|automa|bot|IA|revisão automática/i);
  assert.doesNotMatch(t, /\bele\b|\bela\b/i);
  assert.doesNotMatch(t, /—/); // sem travessão (regra da casa)
});

test('textoDoPulo: duas pessoas viram lista com "e", no plural', () => {
  assert.match(textoDoPulo(['ana', 'zoe']), /@ana e @zoe já estão revisando/);
});

test('textoDoPulo: três pessoas usam vírgula e "e" no fim', () => {
  assert.match(textoDoPulo(['ana', 'bia', 'zoe']), /@ana, @bia e @zoe/);
});

test('textoDoPulo: sem ninguém não gera texto', () => {
  assert.equal(textoDoPulo([]), '');
  assert.equal(textoDoPulo(null), '');
});

/* ---------- comentário: uma vez por PR, e nunca sem identidade ---------- */

function engineFalso({ okDoGh = true } = {}) {
  return {
    skipComentado: {},
    logs: [],
    toasts: [],
    rodou: [],
    accountForPr: () => 'eu',
    tokenFor: () => 'tok',
    ghEnv: () => ({}),
    log(nivel, msg) { this.logs.push({ nivel, msg }); },
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    _run(cmd, args) { this.rodou.push(args); return Promise.resolve({ ok: okDoGh, stderr: 'falhou' }); },
  };
}

test('comentarPulos: comenta uma vez e grava a âncora', async (t) => {
  const io = (await import('../lib/io.js')).default;
  const engine = engineFalso();
  const original = io.run;
  io.run = (cmd, args) => engine._run(cmd, args);
  t.after(() => { io.run = original; });

  const pr = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' };
  await skip.comentarPulos(engine, [{ pr, outros: ['ana'] }]);
  assert.equal(engine.rodou.length, 1);
  assert.deepEqual(engine.rodou[0].slice(0, 3), ['pr', 'comment', pr.url]);
  assert.ok(engine.skipComentado['o/r#1']);
  assert.deepEqual(engine.skipComentado['o/r#1'].quem, ['ana']);
  assert.equal(engine.toasts.length, 1);

  // segunda passada com a âncora gravada: nada de novo sai
  await skip.comentarPulos(engine, [{ pr, outros: ['ana'] }]);
  assert.equal(engine.rodou.length, 1);
});

// a âncora só nasce de um comentário que SAIU: um 503 do GitHub não pode calar
// o aviso pra sempre (mesma régua do postRetry, que só marca falha transitória)
test('comentarPulos: gh que falha não grava âncora nem avisa na tela', async (t) => {
  const io = (await import('../lib/io.js')).default;
  const engine = engineFalso({ okDoGh: false });
  const original = io.run;
  io.run = (cmd, args) => engine._run(cmd, args);
  t.after(() => { io.run = original; });

  await skip.comentarPulos(engine, [{ pr: { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' }, outros: ['ana'] }]);
  assert.equal(engine.skipComentado['o/r#1'], undefined);
  assert.equal(engine.toasts.length, 0);
  assert.equal(engine.logs[0].nivel, 'WARN');
});

// mesma raiz A1 do resto do engine: agir sem identidade provada é pior que não agir
test('comentarPulo: conta sem token não roda gh', async (t) => {
  const io = (await import('../lib/io.js')).default;
  const engine = engineFalso();
  engine.tokenFor = () => null;
  const original = io.run;
  io.run = (cmd, args) => engine._run(cmd, args);
  t.after(() => { io.run = original; });

  const ok = await skip.comentarPulo(engine, { key: 'o/r#1', url: 'https://github.com/o/r/pull/1' }, ['ana']);
  assert.equal(ok, false);
  assert.equal(engine.rodou.length, 0);
});

test('podarSkipComentado: âncora some junto com o PR que saiu do panorama', () => {
  const engine = engineFalso();
  engine.skipComentado = { 'o/r#1': { at: 1 }, 'o/r#2': { at: 2 } };
  engine.log = () => { };
  skip.podarSkipComentado(engine, new Set(['o/r#1']));
  assert.deepEqual(Object.keys(engine.skipComentado), ['o/r#1']);
});
