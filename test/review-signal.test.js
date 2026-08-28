// Sinal de "revisão em andamento" por ref git (28/08/2026): substituiu a label
// pública `<conta>:revisando` porque NENHUM rastro de automação pode aparecer no
// GitHub (a label era visível e os eventos de add/remove ficam pra sempre na
// timeline do PR). O contrato aqui é o mesmo do teste da label que este arquivo
// substitui: composição/parse do nome são PUROS, o TTL vale pros DOIS lados do
// relógio, os GUARDAS impedem qualquer gh sem identidade provada (raiz A1) e a
// SEQUÊNCIA criar/listar/apagar é provada com runner injetado, sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  repoDoPr, signalRefName, parseSignalRef, sinalVivo,
  addReviewSignal, removeReviewSignal, fetchSignalsDoRepo, gcSignals, refreshReviewSignals,
} = await import('../lib/engine/review-signal.js');
const { TEMPOS } = await import('../lib/constants.js');

const TTL = TEMPOS.SINAL_REVISAO_TTL_MS;

/* ---------- nome da ref (PURA) ---------- */

test('signalRefName compõe refs/farol/revisando/<numero>/<login>/<epoch>', () => {
  assert.equal(signalRefName(845, 'thiagocarvalho-dev', 1756400000000),
    'refs/farol/revisando/845/thiagocarvalho-dev/1756400000000');
});

test('signalRefName recusa entrada torta com vazio', () => {
  assert.equal(signalRefName(0, 'ana', 1), '');
  assert.equal(signalRefName(-3, 'ana', 1), '');
  assert.equal(signalRefName(1.5, 'ana', 1), '');
  assert.equal(signalRefName('845', 'ana', 1), '', 'número tem que ser número');
  assert.equal(signalRefName(845, '', 1), '');
  assert.equal(signalRefName(845, 'a b', 1), '');
  assert.equal(signalRefName(845, 'a/b', 1), '', 'barra abriria segmento extra');
  assert.equal(signalRefName(845, 'a_b', 1), '', 'login do GitHub não tem underscore');
  assert.equal(signalRefName(845, 'ana', 0), '');
  assert.equal(signalRefName(845, 'ana', -1), '');
  assert.equal(signalRefName(845, 'ana', NaN), '');
  assert.equal(signalRefName(845, 'ana', Infinity), '');
  assert.equal(signalRefName(845, 'ana', 1.5), '');
});

test('parseSignalRef aceita com e sem o prefixo refs/', () => {
  const esperado = { number: 845, login: 'Ana-1', epochMs: 123456 };
  assert.deepEqual(parseSignalRef('refs/farol/revisando/845/Ana-1/123456'), esperado);
  assert.deepEqual(parseSignalRef('farol/revisando/845/Ana-1/123456'), esperado);
});

test('parseSignalRef e signalRefName fecham o círculo', () => {
  const ref = signalRefName(7, 'zoe', 1700000000000);
  assert.deepEqual(parseSignalRef(ref), { number: 7, login: 'zoe', epochMs: 1700000000000 });
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

/* ---------- guardas (raiz A1): sem identidade provada o gh NUNCA roda ---------- */

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

const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1 };

test('addReviewSignal sem conta resolvida não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: '', token: 'tok' });
  assert.equal(await addReviewSignal(e, { ...PR }, 'sha1'), '');
});

test('addReviewSignal sem token da conta não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: null });
  assert.equal(await addReviewSignal(e, { ...PR }, 'sha1'), '');
});

test('addReviewSignal sem url do PR não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: 'tok' });
  assert.equal(await addReviewSignal(e, { ...PR, url: '' }, 'sha1'), '');
});

test('addReviewSignal sem repo resolvível não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: 'tok' });
  assert.equal(await addReviewSignal(e, { key: 'estranho', url: PR.url, number: 1 }, 'sha1'), '');
});

// a guarda NOVA em relação à label: o POST de ref exige um SHA existente no repo
test('addReviewSignal sem headSha não roda gh e devolve vazio', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: 'tok' });
  assert.equal(await addReviewSignal(e, { ...PR }, ''), '');
  assert.equal(await addReviewSignal(e, { ...PR }, '   '), '');
});

/* ---------- criar e remover, com runner injetado ---------- */

function engineComGh() {
  return {
    logs: [],
    accountForPr: () => 'thiagocarvalho-dev',
    tokenFor: () => 'tok',
    ghEnv: () => ({ GH_TOKEN: 'tok' }),
    log(nivel, msg) { this.logs.push({ nivel, msg }); },
  };
}

test('addReviewSignal cria a ref com POST ancorado no headSha e devolve o nome', async () => {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args); return { ok: true }; };
  const antes = Date.now();
  const ref = await addReviewSignal(engineComGh(), { ...PR }, 'sha1', run);
  const info = parseSignalRef(ref);
  assert.ok(info, `a ref criada tem a forma canônica (${ref})`);
  assert.equal(info.number, 1);
  assert.equal(info.login, 'thiagocarvalho-dev');
  assert.ok(info.epochMs >= antes && info.epochMs <= Date.now(), 'o epoch é o de agora');
  assert.equal(chamadas.length, 1);
  const args = chamadas[0];
  assert.deepEqual(args.slice(0, 3), ['api', '-X', 'POST']);
  assert.equal(args[3], 'repos/o/r/git/refs');
  assert.ok(args.includes(`ref=${ref}`), 'o nome inteiro (com refs/) vai no corpo do POST');
  assert.ok(args.includes('sha=sha1'), 'o POST ancora no head da sessão');
});

test('addReviewSignal com gh falhando devolve vazio (best-effort, sem retentativa)', async () => {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args); return { ok: false, stderr: 'boom' }; };
  assert.equal(await addReviewSignal(engineComGh(), { ...PR }, 'sha1', run), '');
  assert.equal(chamadas.length, 1);
});

test('removeReviewSignal sem criação comprovada é no-op (não toca o engine)', async () => {
  const e = engineQueNaoPodeRodarGh({ account: 'thiagocarvalho-dev', token: 'tok' });
  const run = async () => { throw new Error('o gh não podia rodar sem ref criada'); };
  await removeReviewSignal(e, { ...PR }, '', run);
});

test('removeReviewSignal apaga pelo caminho sem o prefixo refs/', async () => {
  const chamadas = [];
  const run = async (cmd, args) => { chamadas.push(args); return { ok: true }; };
  const e = engineComGh();
  await removeReviewSignal(e, { ...PR }, 'refs/farol/revisando/1/thiagocarvalho-dev/123', run);
  assert.deepEqual(chamadas[0].slice(0, 3), ['api', '-X', 'DELETE']);
  assert.equal(chamadas[0][3], 'repos/o/r/git/refs/farol/revisando/1/thiagocarvalho-dev/123');
  assert.equal(e.logs.length, 0, 'remoção que funcionou não gera WARN');
});

test('falha na remoção DEPOIS de criação comprovada nunca sobe: vira WARN no log', async () => {
  const e = engineComGh();
  // ghEnv explode simulando o token sumindo entre a criação e a remoção (flake
  // do keyring): a remoção não pode derrubar o finally da revisão por causa disso.
  e.ghEnv = () => { throw new Error('conta sem token no gh'); };
  await removeReviewSignal(e, { ...PR }, 'refs/farol/revisando/1/thiagocarvalho-dev/123');
  assert.equal(e.logs.length, 1);
  assert.equal(e.logs[0].nivel, 'WARN');
  assert.match(e.logs[0].msg, /farol\/revisando\/1\/thiagocarvalho-dev\/123/);
  assert.match(e.logs[0].msg, /o\/r#1/);
});

/* ---------- listagem por repo ---------- */

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
