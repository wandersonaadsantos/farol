// Controle do celular (28/09/2026), parte 1: a fila do aparelho viaja na linha do Panorama.
//
// O que este arquivo prova: cada estado da tabela da spec sai dos fatos certos, a linha só
// leva `fila` para PR pedido a mim, o vocabulário é fechado nos dois lados, e a linha
// cifrada de VERDADE (lib/sync/envelope.js, mesmo nó, esquema e extras do motor) cabe no
// teto de 2048 do `panorama/$item` com o maior título e todos os campos.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = process.env.FAROL_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-fila-celular-'));

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fila = (await import('../lib/sync/fila.js')).default;
const escopo = (await import('../lib/sync/escopo.js')).default;
const envelope = (await import('../lib/sync/envelope.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const filaEng = (await import('../lib/engine/sync-fila.js')).default;

const K = 'dono/repo#5';
const T = 1_800_000_000_000;
const VAZIO = { emCurso: new Set(), pendentes: new Map(), ignorados: new Set(), estacionados: new Map(), retry: new Map(), foraDeCena: new Map(), vistos: new Set(), conta: {} };

function com(extra) {
  return { ...VAZIO, ...extra };
}

/* ---------- a regra pura: um caso por estado da tabela ---------- */

test('cada estado da tabela sai do fato certo, com motivo e ate só onde a spec diz', () => {
  const casos = [
    [com({}), { estado: 'esperando', motivo: '', desde: 0, ate: 0 }],
    [com({ conta: { automatica: false } }), { estado: 'sem-automatica', motivo: 'conta', desde: 0, ate: 0 }],
    [com({ conta: { silenciada: true } }), { estado: 'sem-automatica', motivo: 'silenciada', desde: 0, ate: 0 }],
    [com({ emCurso: new Set([K]) }), { estado: 'revisando', motivo: '', desde: 0, ate: 0 }],
    [com({ pendentes: new Map([[K, T]]) }), { estado: 'decidir', motivo: '', desde: T, ate: 0 }],
    [com({ estacionados: new Map([[K, { tipo: 'esgotado', desde: T }]]) }), { estado: 'estacionado', motivo: 'esgotado', desde: T, ate: 0 }],
    [com({ retry: new Map([[K, { tries: 1 }]]) }), { estado: 'retry', motivo: '', desde: 0, ate: 0 }],
    [com({ foraDeCena: new Map([[K, T]]) }), { estado: 'saiu-de-cena', motivo: '', desde: T, ate: 0 }],
    [com({ conta: { limiteAte: T + 5 } }), { estado: 'limite-plano', motivo: '', desde: 0, ate: T + 5 }],
    [com({ conta: { grupoSegura: true } }), { estado: 'espera-grupo', motivo: '', desde: 0, ate: 0 }],
    [com({ vistos: new Set([K]) }), { estado: 'visto', motivo: '', desde: 0, ate: 0 }],
    [com({ ignorados: new Set([K]), vistos: new Set([K]) }), { estado: 'ignorado', motivo: '', desde: 0, ate: 0 }],
  ];
  const vistos = new Set();
  for (const [fatos, esperado] of casos) {
    assert.deepEqual(fila.estadoDaFila(K, fatos), esperado, esperado.estado);
    vistos.add(esperado.estado);
  }
  assert.deepEqual([...vistos].sort(), [...fila.ESTADOS].sort(), 'todo estado do vocabulário tem caso');
});

test('o fato mais forte vence: sessão viva sobre pendência, pendência sobre estacionado, estacionado sobre visto', () => {
  const tudo = com({
    emCurso: new Set([K]), pendentes: new Map([[K, T]]), estacionados: new Map([[K, { tipo: 'falha' }]]), vistos: new Set([K]),
  });
  assert.equal(fila.estadoDaFila(K, tudo).estado, 'revisando');
  assert.equal(fila.estadoDaFila(K, { ...tudo, emCurso: new Set() }).estado, 'decidir');
  assert.equal(fila.estadoDaFila(K, { ...tudo, emCurso: new Set(), pendentes: new Map() }).estado, 'estacionado');
  // a conta silenciada não esconde o que já aconteceu com o PR
  assert.equal(fila.estadoDaFila(K, com({ vistos: new Set([K]), conta: { silenciada: true } })).estado, 'visto');
});

test('vocabulário fechado: estado, motivo e ate fora da tabela não viajam', () => {
  assert.equal(fila.filaSaneada({ estado: 'rodando-no-meu-pc' }), null);
  assert.equal(fila.filaSaneada({ estado: 'estacionado', motivo: 'stderr: token ghp_xxx' }).motivo, '');
  assert.equal(fila.filaSaneada({ estado: 'retry', motivo: 'conta', ate: T }).motivo, '', 'motivo só existe no estado que tem motivo');
  assert.equal(fila.filaSaneada({ estado: 'retry', ate: T }).ate, 0, 'ate só no limite do plano');
  assert.deepEqual(Object.keys(fila.filaSaneada({ estado: 'visto', texto: 'x', relatorio: 'y' })).sort(), ['ate', 'desde', 'estado', 'motivo']);
});

/* ---------- a pendência que espera o CI (01/10/2026) ---------- */

// O aparelho dono aprova sozinho quando o CI fechar verde: nos outros aparelhos o item não
// pode aparecer como "precisa de você". O fato viaja como MOTIVO do estado `decidir`.
test('pendência que espera o CI: o estado segue decidir e o motivo diz espera-ci', () => {
  const fatos = com({ pendentes: new Map([[K, T]]), esperandoCi: new Set([K]) });
  assert.deepEqual(fila.estadoDaFila(K, fatos), { estado: 'decidir', motivo: 'espera-ci', desde: T, ate: 0 });
  assert.equal(fila.estadoDaFila(K, com({ pendentes: new Map([[K, T]]), esperandoCi: new Set(['outro/pr#1']) })).motivo, '', 'a espera é do PR, não do aparelho');
  assert.equal(fila.estadoDaFila(K, com({ esperandoCi: new Set([K]) })).estado, 'esperando', 'sem pendência não há o que esperar');
  assert.equal(fila.estadoDaFila(K, { ...fatos, emCurso: new Set([K]) }).motivo, '', 'sessão viva vence, e revisando não leva motivo');
});

test('espera-ci só vale em decidir, e lixo no motivo de decidir é pendência comum', () => {
  assert.equal(fila.filaSaneada({ estado: 'decidir', motivo: 'espera-ci' }).motivo, 'espera-ci');
  for (const lixo of ['ci', 'ESPERA-CI', 'espera-ci ', true, 1, { a: 1 }, ['espera-ci'], null]) {
    assert.deepEqual(fila.filaSaneada({ estado: 'decidir', motivo: lixo, desde: T }), { estado: 'decidir', motivo: '', desde: T, ate: 0 }, JSON.stringify(lixo));
  }
  assert.equal(fila.filaSaneada({ estado: 'esperando', motivo: 'espera-ci' }).motivo, '');
  assert.equal(fila.filaSaneada({ estado: 'estacionado', motivo: 'espera-ci' }).motivo, '');
});

// A allowlist de cada leitor é a DELE. Esta é a da 2.66.3 (lib/sync/fila.js na origin/main
// em 01/10/2026, linhas 16 a 48), congelada aqui porque é ela que decide a codificação: o
// que um aparelho ainda não atualizado faz com a linha que a 2.67.0 publica.
function leitorDa2663(bruto) {
  const ESTADOS = ['esperando', 'sem-automatica', 'revisando', 'decidir', 'estacionado', 'retry', 'saiu-de-cena', 'limite-plano', 'espera-grupo', 'visto', 'ignorado'];
  const MOTIVOS = { 'sem-automatica': ['conta', 'silenciada'], estacionado: ['cancelado', 'esgotado', 'falha', 'orcamento', 'autenticacao', 'legado'] };
  if (!bruto || typeof bruto !== 'object' || !ESTADOS.includes(bruto.estado)) return null;
  const permitidos = MOTIVOS[bruto.estado] || [];
  const motivo = permitidos.includes(bruto.motivo) ? bruto.motivo : '';
  return { estado: bruto.estado, motivo, desde: Math.floor(Number(bruto.desde) || 0), ate: 0 };
}

test('leitor da 2.66.3: a espera do CI chega como a pendência comum de antes, nunca some', () => {
  const publicado = fila.estadoDaFila(K, com({ pendentes: new Map([[K, T]]), esperandoCi: new Set([K]) }));
  assert.deepEqual(leitorDa2663(publicado), { estado: 'decidir', motivo: '', desde: T, ate: 0 });
  assert.deepEqual(leitorDa2663(publicado), fila.estadoDaFila(K, com({ pendentes: new Map([[K, T]]) })), 'idêntico ao que ele lia antes desta versão');
  assert.equal(leitorDa2663({ estado: 'esperando-ci', desde: T }), null, 'a contraprova: estado novo faria a linha perder a fila no leitor antigo');
  assert.deepEqual([...fila.ESTADOS], ['esperando', 'sem-automatica', 'revisando', 'decidir', 'estacionado', 'retry', 'saiu-de-cena', 'limite-plano', 'espera-grupo', 'visto', 'ignorado'], 'por isso o vocabulário de estados não cresceu');
});

test('linha publicada por versão anterior (decidir sem motivo) segue sendo pendência comum', () => {
  assert.deepEqual(fila.filaSaneada({ estado: 'decidir', desde: T }), { estado: 'decidir', motivo: '', desde: T, ate: 0 });
  assert.deepEqual(fila.filaSaneada({ estado: 'decidir', motivo: '', desde: T, ate: 0 }), { estado: 'decidir', motivo: '', desde: T, ate: 0 });
});

/* ---------- a linha do Panorama ---------- */

const PR = { key: K, url: 'u', title: 'Titulo', author: 'alguem', repo: 'dono/repo', number: 5, isDraft: false, updatedAt: 'x' };

test('a linha leva fila SÓ para PR pedido a mim, e só no Panorama', () => {
  const f = { estado: 'estacionado', motivo: 'falha', desde: T, ate: 0 };
  assert.deepEqual(escopo.linhaDe('panorama', { ...PR, mine: true }, { fila: f }).fila, f);
  assert.equal(escopo.linhaDe('panorama', { ...PR, mine: false }, { fila: f }).fila, undefined, 'PR de outro não tem fila');
  assert.equal(escopo.linhaDe('panorama', PR, { fila: f }).fila, undefined, 'sem o selo, nada de fila');
  assert.equal(escopo.linhaDe('myPrs', { ...PR, mine: true }, { fila: f }).fila, undefined, 'Meus PRs não tem fila');
  assert.equal(escopo.linhaDe('panorama', { ...PR, mine: true }, { fila: { estado: 'inventado' } }).fila, undefined);
});

test('a linha leva a conta dentro dela, e o ctag muda quando o estado da fila muda', () => {
  const kId = kek.bufferDe(kek.novoMaterial().id);
  const a = escopo.linhaDe('panorama', { ...PR, mine: true }, { conta: 'conta-do-celular', fila: { estado: 'esperando' } });
  const b = escopo.linhaDe('panorama', { ...PR, mine: true }, { conta: 'conta-do-celular', fila: { estado: 'revisando' } });
  assert.equal(a.conta, 'conta-do-celular');
  assert.notEqual(escopo.ctagDe(kId, a), escopo.ctagDe(kId, b));
});

// Pior caso: owner com 39 caracteres, repo com 100, número de seis dígitos, título de 200
// caracteres de dois bytes (ou escapados, que pesam dois no JSON), autor e conta de 39 e a
// fila com o estado e o motivo mais longos.
test('a linha cifrada cabe no teto de 2048 do panorama/$item com o maior título e todos os campos', () => {
  const material = kek.novoMaterial();
  const kId = kek.bufferDe(material.id);
  const owner = 'o'.repeat(39);
  const repo = `${owner}/${'r'.repeat(100)}`;
  const key = `${repo}#999999`;
  for (const ch of ['x', 'ç', '"', '\\']) {
    const pr = {
      key, url: `https://github.com/${repo}/pull/999999`, title: ch.repeat(200), author: 'a'.repeat(39), repo, number: 999999,
      isDraft: true, updatedAt: '2026-09-28T23:59:59Z', mine: true, reviewedByMe: true, reRequested: true,
    };
    const linha = escopo.linhaDe('panorama', pr, { conta: 'c'.repeat(39), fila: { estado: 'sem-automatica', motivo: 'silenciada', desde: T, ate: T } });
    assert.equal(linha.title.length, 200);
    assert.ok(linha.fila && linha.conta);
    const scope = 'a'.repeat(32);
    const id = escopo.idDe(scope, 'b'.repeat(32));
    const su = escopo.suDe(scope, T);
    const r = envelope.cifrar({
      uid: 'u1', caminho: `panorama/${id}`, campo: 'linha', no: 'panorama', esquema: 'panorama1', cur: 'g1', material,
      r: 1, extras: [su, escopo.ctagDe(kId, linha)], dados: { l: linha },
    });
    assert.equal(r.ok, true, `título de ${JSON.stringify(ch)} estoura o teto: ${r.motivo}`);
    assert.ok(r.enc.length <= 2048, `${r.enc.length} > 2048`);
  }
});

/* ---------- a fiação: os fatos saem do engine ---------- */

function engineFalso(extra = {}) {
  return {
    headlessQueue: [{ key: 'o/r#1' }, { key: 'o/r#9', kind: 'self' }],
    activeReviews: new Map([['s1', { keys: ['o/r#2'] }]]),
    decisions: { pending: [{ key: 'o/r#3', createdAt: T }] },
    ignorados: new Set(['o/r#4']),
    parkedParaUi: () => ({ 'o/r#5': { at: new Date(T).toISOString(), tipo: 'cancelado', motivo: 'texto que não sobe' } }),
    retryAfterNet: new Map([['o/r#6', { tries: 1 }]]),
    skipComentado: { 'o/r#7': { at: T } },
    seen: new Set(['o/r#3', 'o/r#4', 'o/r#5', 'o/r#8']),
    accountForPr: (pr) => ({ 'o/r#20': 'muda', 'o/r#21': 'manual' })[pr.key] || 'eu',
    isMuted: (c) => c === 'muda',
    autoReviewFor: (c) => c !== 'manual',
    limiteDoPlanoAte: () => 0,
    grupoSegura: () => false,
    ...extra,
  };
}

test('a fiação lê cada fato do engine e entrega o estado certo por PR', () => {
  const e = engineFalso();
  const fatos = filaEng.fatosDaFila(e);
  const estado = (key) => filaEng.filaDoPr(e, fatos, { key, mine: true }).estado;
  assert.equal(estado('o/r#1'), 'revisando', 'na fila de execução');
  assert.equal(estado('o/r#2'), 'revisando', 'sessão viva');
  assert.equal(estado('o/r#9'), 'esperando', 'autoanálise na fila não é revisão deste PR');
  assert.equal(estado('o/r#3'), 'decidir');
  assert.equal(estado('o/r#4'), 'ignorado');
  assert.deepEqual(filaEng.filaDoPr(e, fatos, { key: 'o/r#5', mine: true }), { estado: 'estacionado', motivo: 'cancelado', desde: T, ate: 0 });
  assert.equal(estado('o/r#6'), 'retry');
  assert.equal(estado('o/r#7'), 'saiu-de-cena');
  assert.equal(estado('o/r#8'), 'visto');
  assert.deepEqual(filaEng.filaDoPr(e, fatos, { key: 'o/r#20', mine: true }).motivo, 'silenciada');
  assert.deepEqual(filaEng.filaDoPr(e, fatos, { key: 'o/r#21', mine: true }).motivo, 'conta');
  assert.equal(filaEng.filaDoPr(e, fatos, { key: 'o/r#1', mine: false }), null, 'PR que não é pedido a mim não tem fila');
});

test('a fiação pergunta o limite do plano e o teto do grupo pela conta dona', () => {
  const e = engineFalso({ limiteDoPlanoAte: (c) => (c === 'eu' ? T + 99 : 0), grupoSegura: () => true });
  const f = filaEng.filaDoPr(e, filaEng.fatosDaFila(e), { key: 'o/r#30', mine: true });
  assert.deepEqual(f, { estado: 'limite-plano', motivo: '', desde: 0, ate: T + 99 });
  const g = engineFalso({ grupoSegura: (c) => c === 'eu' });
  assert.equal(filaEng.filaDoPr(g, filaEng.fatosDaFila(g), { key: 'o/r#30', mine: true }).estado, 'espera-grupo');
});

// 01/10/2026: a marca `esperaCi` da pendência (lib/engine/espera-ci.js) vira o motivo da fila.
test('a fiação marca a espera pela MESMA pendência que dá o instante, e a linha a carrega', () => {
  const e = engineFalso({ decisions: { pending: [
    { key: 'o/r#3', createdAt: T, esperaCi: { desde: T, checks: [{ nome: 'ci / build', estado: 'rodando' }], pontos: [] } },
    { key: 'o/r#40', createdAt: T + 1, esperaCi: null },
    { key: 'o/r#41', createdAt: T + 2 }, { key: 'o/r#41', createdAt: T + 3, esperaCi: { desde: T, checks: [], pontos: [] } },
  ] } });
  const fatos = filaEng.fatosDaFila(e);
  const daEspera = filaEng.filaDoPr(e, fatos, { key: 'o/r#3', mine: true });
  assert.deepEqual(daEspera, { estado: 'decidir', motivo: 'espera-ci', desde: T, ate: 0 });
  assert.equal(filaEng.filaDoPr(e, fatos, { key: 'o/r#40', mine: true }).motivo, '', 'espera largada volta a pedir decisão');
  assert.deepEqual(filaEng.filaDoPr(e, fatos, { key: 'o/r#41', mine: true }), { estado: 'decidir', motivo: '', desde: T + 2, ate: 0 }, 'a primeira pendência da chave decide as duas coisas');
  const linha = escopo.linhaDe('panorama', { ...PR, key: 'o/r#3', mine: true }, { fila: daEspera });
  assert.deepEqual(linha.fila, { estado: 'decidir', motivo: 'espera-ci', desde: T, ate: 0 });
  assert.equal(JSON.stringify(linha).includes('ci / build'), false, 'o nome do check não viaja');
  const comum = escopo.linhaDe('panorama', { ...PR, key: 'o/r#3', mine: true }, { fila: { estado: 'decidir', motivo: '', desde: T, ate: 0 } });
  const kId = kek.bufferDe(kek.novoMaterial().id);
  assert.notEqual(escopo.ctagDe(kId, linha), escopo.ctagDe(kId, comum), 'armar ou largar a espera muda o ctag, e a linha sobe de novo');
});
