// Andamento ao vivo, a parte pura (7.C3): o que de uma sessão local pode viajar.
//
// O caso central é a AUSÊNCIA de prosa. O feed da sessão tem texto do modelo, caminho de
// arquivo, comando e trecho de código de terceiros; nada disso pode subir, nem cifrado.
// Andamento é "em que etapa, há quanto tempo, com quem", e só isso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import andamento from '../lib/sync/andamento.js';
import { matTag } from '../lib/sync/tags.js';

const K = randomBytes(32);
const T0 = 1_800_000_000_000;
const SEGREDO = 'C:/Users/fulano/projeto/src/segredo.js rm -rf texto do modelo';

function sessao(extra = {}) {
  return {
    id: 'a-17', mode: 'auto', checkpoint: 'review', startedAt: T0, model: 'Opus 5',
    pr: { key: 'dono/repo#12', url: 'u', title: 'Titulo secreto', author: 'alguem' }, account: 'conta1',
    ...extra,
  };
}

const FEED = [
  { t: T0 + 1000, k: 'text', text: SEGREDO, s: 'preparo' },
  { t: T0 + 5000, k: 'tool', text: SEGREDO, s: 'leitura', a: 'leitor-1' },
  { t: T0 + 9000, k: 'tool', text: SEGREDO, s: 'leitura', a: 'leitor-2' },
  { t: T0 + 12000, k: 'text', text: SEGREDO, s: 'raciocinio' },
];

test('a projeção leva etapa, tempos, subagentes, modelo, tags e tipo, e nada mais', () => {
  const p = andamento.projetar(sessao(), FEED, { kId: K, agora: T0 + 20000 });
  assert.deepEqual(Object.keys(p).sort(), ['acctTag', 'etapa', 'heranca', 'matTag', 'modelo', 'msPorEtapa', 'prTag', 'subagentes', 'tipo']);
  assert.equal(p.matTag, '', 'sessão sem head não inventa versão material');
  assert.equal(p.heranca, '', 'herança não decidida sai vazia');
  assert.equal(p.etapa, 'raciocinio');
  assert.equal(p.tipo, 'review');
  assert.deepEqual(p.subagentes, ['leitor-1', 'leitor-2']);
  assert.equal(p.modelo, 'Opus 5');
  assert.match(p.prTag, /^[0-9a-f]{32}$/);
  assert.match(p.acctTag, /^[0-9a-f]{32}$/);
  assert.equal(p.msPorEtapa.preparo, 1000);
  assert.equal(p.msPorEtapa.leitura, 8000);
  // mesma regra do resumo local: o intervalo ANTES de uma linha é da etapa dela, e a
  // etapa corrente continua contando até agora (3000 + 8000)
  assert.equal(p.msPorEtapa.raciocinio, 11000, 'a etapa corrente conta até agora');
});

test('o commit da sessão sobe como tag, e a herança só no vocabulário fechado', () => {
  const p = andamento.projetar(sessao({ headSha: 'shaSecreto123', heranca: 'parcial' }), FEED, { kId: K, agora: T0 + 20000 });
  assert.equal(p.matTag, matTag(K, 'shaSecreto123'), 'o head mora na sessão, não no PR');
  assert.equal(p.heranca, 'parcial');
  const doPr = andamento.projetar(sessao({ pr: { key: 'dono/repo#12', headSha: 'shaDoPr' } }), [], { kId: K, agora: T0 });
  assert.equal(doPr.matTag, matTag(K, 'shaDoPr'), 'sem head na sessão, o do PR serve de reserva');
  assert.equal(andamento.projetar(sessao({ heranca: 'tudo' }), [], { kId: K, agora: T0 }).heranca, '');
  assert.equal(JSON.stringify(p).includes('shaSecreto123'), false, 'o SHA nunca sobe em claro');
});

test('nenhuma prosa, caminho, comando, título ou login sobe', () => {
  const cru = JSON.stringify(andamento.projetar(sessao({ headSha: 'shaSecreto123' }), FEED, { kId: K, agora: T0 + 20000 }));
  for (const proibido of ['segredo', 'rm -rf', 'Users', 'Titulo', 'dono/repo', 'alguem', 'conta1', 'shaSecreto123']) {
    assert.equal(cru.includes(proibido), false, proibido);
  }
});

test('etapa fora do vocabulário vira desconhecida, e autoanálise sem feed também', () => {
  const p = andamento.projetar(sessao(), [{ t: T0 + 1, k: 'text', s: 'inventada' }], { kId: K, agora: T0 + 10 });
  assert.equal(p.etapa, 'desconhecida');
  assert.equal(Object.keys(p.msPorEtapa).includes('inventada'), false, 'o vocabulário é fechado');
  const self = andamento.projetar(sessao({ checkpoint: 'self', mode: 'self' }), [], { kId: K, agora: T0 + 10 });
  assert.equal(self.etapa, 'desconhecida');
  assert.equal(self.tipo, 'self');
});

test('rótulo de subagente é curto e sem caracteres de caminho', () => {
  const p = andamento.projetar(sessao(), [{ t: T0 + 1, k: 'tool', s: 'leitura', a: 'x/../../etc/passwd'.repeat(5) }], { kId: K, agora: T0 + 2 });
  assert.ok(p.subagentes[0].length <= 24);
  assert.equal(/[/\.]/.test(p.subagentes[0]), false);
});

test('o id da operação é estável por sessão, diferente entre sessões, e hex', () => {
  const a = andamento.opIdDe(K, 'dev1', 'a-17');
  assert.equal(a, andamento.opIdDe(K, 'dev1', 'a-17'));
  assert.notEqual(a, andamento.opIdDe(K, 'dev1', 'a-18'));
  assert.notEqual(a, andamento.opIdDe(K, 'dev2', 'a-17'), 'mesmo id local em outro aparelho é outra operação');
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('vencimento: x no passado é interrompida, e x no futuro é viva', () => {
  assert.equal(andamento.situacao({ x: T0 + 1 }, T0), 'viva');
  assert.equal(andamento.situacao({ x: T0 - 1 }, T0), 'interrompida');
  assert.equal(andamento.situacao({}, T0), 'interrompida', 'sem x não é viva');
  assert.equal(andamento.vencimentoDe(T0), T0 + andamento.TTL_MS);
});
