// Refs de "revisão em andamento": LEITURA DE TRANSIÇÃO (28/08/2026 à tarde).
// A v2.53.9 escreveu refs git por algumas horas na manhã do mesmo dia (quando a
// label pública foi tratada como vazamento); à tarde a label voltou a ser o
// sinal escrito (lib/engine/review.js) e este módulo ficou só com o lado de
// LER as refs remanescentes e coletar as órfãs até a frota convergir. O
// contrato aqui: o parse do nome é PURO, o TTL vale pros DOIS lados do relógio,
// os GUARDAS impedem qualquer gh sem identidade provada (raiz A1) e a sequência
// listar/apagar é provada com runner injetado, sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  repoDoPr, parseSignalRef, sinalVivo,
  fetchSignalsDoRepo, gcSignals, refreshReviewSignals,
} = await import('../lib/engine/review-signal.js');
const { TEMPOS } = await import('../lib/constants.js');

const TTL = TEMPOS.SINAL_REVISAO_TTL_MS;

/* ---------- parse da ref (PURA) ---------- */

test('parseSignalRef aceita com e sem o prefixo refs/', () => {
  const esperado = { number: 845, login: 'Ana-1', epochMs: 123456 };
  assert.deepEqual(parseSignalRef('refs/farol/revisando/845/Ana-1/123456'), esperado);
  assert.deepEqual(parseSignalRef('farol/revisando/845/Ana-1/123456'), esperado);
});

test('parseSignalRef rejeita forma torta com null', () => {
  assert.equal(parseSignalRef('refs/farol/revisando/845'), null, 'ref folha no número bloquearia o namespace');
  assert.equal(parseSignalRef('refs/farol/revisando/845/ana'), null, 'faltou o epoch');
  assert.equal(parseSignalRef('refs/farol/revisando/845/ana/1/2'), null, 'segmento a mais');
  assert.equal(parseSignalRef('refs/farol/revisando/x/ana/1'), null, 'número não numérico');
  assert.equal(parseSignalRef('refs/farol/revisando/845/a b/1'), null, 'login fora do formato');
  assert.equal(parseSignalRef('refs/farol/revisando/845/ana/x'), null, 'epoch não numérico');
  assert.equal(parseSignalRef('refs/heads/main'), null);
  assert.equal(parseSignalRef(''), null);
  assert.equal(parseSignalRef(null), null);
});

/* ---------- TTL dos dois lados do relógio ---------- */

test('sinalVivo: dentro da janela vale, dos dois lados', () => {
  const agora = 1756400000000;
  assert.equal(sinalVivo(agora, agora, TTL), true);
  assert.equal(sinalVivo(agora - TTL, agora, TTL), true, 'exatamente no limite do passado ainda vale');
  assert.equal(sinalVivo(agora + TTL, agora, TTL), true, 'exatamente no limite do futuro ainda vale');
});

test('sinalVivo: fora da janela morre, dos dois lados (relógio adiantado não gera ref imortal)', () => {
  const agora = 1756400000000;
  assert.equal(sinalVivo(agora - TTL - 1, agora, TTL), false, 'sessão morta há mais de um TTL');
  assert.equal(sinalVivo(agora + TTL + 1, agora, TTL), false, 'futuro além do TTL é relógio alheio, ignora');
  assert.equal(sinalVivo(NaN, agora, TTL), false);
});

/* ---------- resolução de repo (compartilhada com a label, ver review.js) ---------- */

test('repoDoPr resolve o repo do objeto ou da key, e recusa formato inválido', () => {
  assert.equal(repoDoPr({ repo: 'biudtech/biud-core', key: 'x/y#1' }), 'biudtech/biud-core');
  assert.equal(repoDoPr({ key: 'biudtech/biud-core#42' }), 'biudtech/biud-core');
  assert.equal(repoDoPr({ key: 'sem-barra#1' }), '');
  assert.equal(repoDoPr({}), '');
  assert.equal(repoDoPr(null), '');
});

// engine mínimo que EXPLODE se o gh for alcançado: ghEnv é a última parada antes
// do run, então um guard furado vira falha alta aqui, não chamada de rede.
function engineQueNaoPodeRodarGh({ account, token }) {
  return {
    accountForPr: () => account,
    tokenFor: () => token,
    ghEnv: () => { throw new Error('ghEnv não podia ser alcançado neste teste'); },
    log: () => { throw new Error('log não podia ser alcançado neste teste'); },
  };
}

/* ---------- listagem por repo ---------- */

function engineComGh() {
  return {
    logs: [],
    accountForPr: () => 'thiagocarvalho-dev',
    tokenFor: () => 'tok',
    ghEnv: () => ({ GH_TOKEN: 'tok' }),
    log(nivel, msg) { this.logs.push({ nivel, msg }); },
  };
}

test('fetchSignalsDoRepo usa --paginate (refs órfãs não podem empurrar as vivas pra fora da página 1)', async () => {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args); return { ok: true, stdout: '' }; };
  await fetchSignalsDoRepo(engineComGh(), 'o/r', 'thiagocarvalho-dev', run);
  const args = chamadas[0];
  assert.ok(args.includes('--paginate'), '--paginate é obrigatório');
  assert.ok(args.includes('repos/o/r/git/matching-refs/farol/revisando/'), 'uma chamada cobre o namespace inteiro');
});

test('fetchSignalsDoRepo parseia as refs e ignora linha que não é sinal', async () => {
  const stdout = [
    'refs/farol/revisando/845/ana/1000',
    'refs/farol/revisando/845/Zoe-2/2000',
    'refs/farol/outra-coisa/1',
    'lixo qualquer',
    '',
  ].join('\n');
  const run = async () => ({ ok: true, stdout });
  const entries = await fetchSignalsDoRepo(engineComGh(), 'o/r', 'thiagocarvalho-dev', run);
  assert.deepEqual(entries, [
    { ref: 'refs/farol/revisando/845/ana/1000', number: 845, login: 'ana', epochMs: 1000 },
    { ref: 'refs/farol/revisando/845/Zoe-2/2000', number: 845, login: 'Zoe-2', epochMs: 2000 },
  ]);
});

test('fetchSignalsDoRepo devolve null quando o gh falha ou explode', async () => {
  assert.equal(await fetchSignalsDoRepo(engineComGh(), 'o/r', 'x', async () => ({ ok: false, stderr: '500' })), null);
  assert.equal(await fetchSignalsDoRepo(engineComGh(), 'o/r', 'x', async () => { throw new Error('rede'); }), null);
});

test('fetchSignalsDoRepo sem token não roda gh e devolve null', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'x', token: null });
  const run = async () => { throw new Error('não podia rodar'); };
  assert.equal(await fetchSignalsDoRepo(e, 'o/r', 'x', run), null);
});

/* ---------- coleta de lixo: só o passado comprovado ---------- */

test('gcSignals apaga só a ref expirada NO PASSADO; futuro além do TTL é ignorado, nunca apagado', async () => {
  const agora = 1756400000000;
  const entries = [
    { ref: 'refs/farol/revisando/1/morta/1', number: 1, login: 'morta', epochMs: agora - TTL - 1000 },
    { ref: 'refs/farol/revisando/1/viva/2', number: 1, login: 'viva', epochMs: agora - 1000 },
    { ref: 'refs/farol/revisando/1/relogio-adiantado/3', number: 1, login: 'relogio-adiantado', epochMs: agora + TTL + 1000 },
  ];
  const apagadas = [];
  const run = async (cmd, args) => { apagadas.push(args[3]); return { ok: true }; };
  await gcSignals(engineComGh(), 'o/r', 'thiagocarvalho-dev', entries, agora, run);
  assert.deepEqual(apagadas, ['repos/o/r/git/refs/farol/revisando/1/morta/1'],
    'relógio alheio adiantado não é lixo comprovado');
});

test('gcSignals: falha de uma remoção não derruba as outras (best-effort por ref)', async () => {
  const agora = 1756400000000;
  const entries = [
    { ref: 'refs/farol/revisando/1/a/1', number: 1, login: 'a', epochMs: agora - TTL - 1000 },
    { ref: 'refs/farol/revisando/1/b/2', number: 1, login: 'b', epochMs: agora - TTL - 2000 },
  ];
  const apagadas = [];
  const run = async (cmd, args) => {
    apagadas.push(args[3]);
    if (apagadas.length === 1) throw new Error('403 de quem não tem push');
    return { ok: true };
  };
  await gcSignals(engineComGh(), 'o/r', 'thiagocarvalho-dev', entries, agora, run);
  assert.equal(apagadas.length, 2, 'a segunda ref ainda foi tentada');
});

/* ---------- o refresh do ciclo ---------- */

function engineDeCiclo(extra = {}) {
  return {
    reviewSignals: new Map(),
    queue: [],
    panorama: [],
    decisions: { pending: [] },
    staleInfo: {},
    logs: [],
    accountForPr: () => 'thiagocarvalho-dev',
    tokenFor: () => 'tok',
    ghEnv: () => ({ GH_TOKEN: 'tok' }),
    log(nivel, msg) { this.logs.push({ nivel, msg }); },
    ...extra,
  };
}

test('refreshReviewSignals grava o snapshot por repo (minúsculas na chave)', async () => {
  const e = engineDeCiclo({ queue: [{ key: 'O/R#1', repo: 'O/R', number: 1, url: 'u' }] });
  const agora = Date.now();
  const run = async () => ({ ok: true, stdout: `refs/farol/revisando/1/ana/${agora}\n` });
  await refreshReviewSignals(e, run);
  const entries = e.reviewSignals.get('o/r');
  assert.ok(entries, 'a chave do Map é o repo em minúsculas');
  assert.equal(entries[0].login, 'ana');
});

test('refreshReviewSignals: busca que falha PRESERVA o snapshot anterior daquele repo', async () => {
  const anterior = [{ ref: 'refs/farol/revisando/1/ana/1000', number: 1, login: 'ana', epochMs: 1000 }];
  const e = engineDeCiclo({ queue: [{ key: 'o/r#1', repo: 'o/r', number: 1 }] });
  e.reviewSignals.set('o/r', anterior);
  await refreshReviewSignals(e, async () => ({ ok: false, stderr: '502' }));
  assert.deepEqual(e.reviewSignals.get('o/r'), anterior, 'falta de dado não apaga o que se sabia');
});

test('refreshReviewSignals cobre fila + pendência stale_head + panorama stale, com dedup de repo', async () => {
  const e = engineDeCiclo({
    queue: [{ key: 'o/r#1', repo: 'o/r', number: 1 }, { key: 'O/R#2', repo: 'O/R', number: 2 }],
    decisions: { pending: [
      { key: 'o/pend#3', blockedKind: 'stale_head', pr: { repo: 'o/pend', number: 3 } },
      { key: 'o/outra#4', blockedKind: 'coisa-diferente', pr: { repo: 'o/outra', number: 4 } },
    ] },
    panorama: [{ key: 'o/stale#5', repo: 'o/stale', number: 5 }, { key: 'o/quieto#6', repo: 'o/quieto', number: 6 }],
    staleInfo: { 'o/stale#5': { stale: true, head: 'h' }, 'o/quieto#6': { stale: false } },
  });
  const endpoints = [];
  const run = async (cmd, args) => { endpoints.push(args.find(a => a.startsWith('repos/'))); return { ok: true, stdout: '' }; };
  await refreshReviewSignals(e, run);
  assert.deepEqual(endpoints.sort(), [
    'repos/o/pend/git/matching-refs/farol/revisando/',
    'repos/o/r/git/matching-refs/farol/revisando/',
    'repos/o/stale/git/matching-refs/farol/revisando/',
  ], 'o/r entra UMA vez (dedup sem caixa), pendência não-stale e panorama quieto ficam de fora');
});

test('refreshReviewSignals roda o GC das refs expiradas do passado no mesmo ciclo', async () => {
  const agora = Date.now();
  const e = engineDeCiclo({ queue: [{ key: 'o/r#1', repo: 'o/r', number: 1 }] });
  const deletes = [];
  const run = async (cmd, args) => {
    if (args.includes('DELETE')) { deletes.push(args[3]); return { ok: true }; }
    return { ok: true, stdout: `refs/farol/revisando/1/morta/${agora - TTL - 60000}\nrefs/farol/revisando/1/viva/${agora}\n` };
  };
  await refreshReviewSignals(e, run);
  assert.deepEqual(deletes, [`repos/o/r/git/refs/farol/revisando/1/morta/${agora - TTL - 60000}`]);
});

test('refreshReviewSignals nunca lança, mesmo com engine capenga', async () => {
  const e = { log: () => {} }; // sem queue, sem Map, sem nada
  await refreshReviewSignals(e, async () => { throw new Error('não devia nem chegar aqui'); });
  assert.ok(e.reviewSignals instanceof Map, 'o Map nasce sozinho quando falta');
});
