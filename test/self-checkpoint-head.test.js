// A loja `self` do checkpoint precisa carimbar o head, igual à loja `review`.
//
// DEFEITO QUE ORIGINOU (medido em 30/08/2026): runSelfAnalysis montava o registro de
// activeReviews sem `headSha`, e session.js grava `headSha: (review && review.headSha) || ''`
// em toda entrada do checkpoint. Resultado em disco: as 100 entradas das quatro lojas
// `self` da máquina estavam com head vazio. Como a leitura aceitava entrada sem head
// ("falta de dado nunca descarta"), verificação feita sobre commits antigos contava como
// evidência do commit atual, nos DOIS sentidos: um `refutado` de um bug já corrigido
// travava o Merge daquele PR pra sempre (nada expira a entrada), e um `confirmado` sobre
// trecho já alterado liberava o Merge sobre código que ninguém verificou.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { verificacaoObservada } = await import('../lib/engine/selfpr.js');

const FONTE = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'selfpr.js'), 'utf8');

test('a autoanálise carimba o head no registro que alimenta o checkpoint', () => {
  assert.match(FONTE, /activeReviews\.get\(id\)\.headSha = shaAntes/,
    'sem esta linha, toda entrada da loja self nasce com head vazio');
});

test('o carimbo acontece depois de shaAntes existir e antes de a sessão rodar', () => {
  const decl = FONTE.indexOf('const shaAntes =');
  const carimbo = FONTE.indexOf('activeReviews.get(id).headSha = shaAntes');
  const stream = FONTE.indexOf('runClaudeStream(');
  assert.ok(decl > 0 && carimbo > 0 && stream > 0, 'as três âncoras existem no fonte');
  assert.ok(decl < carimbo, 'o carimbo vem depois de shaAntes ser calculado');
  assert.ok(carimbo < stream, 'o carimbo vem antes da sessão, senão as primeiras entradas saem sem head');
});

/* ---------- evidência que não dá pra atribuir a commit nenhum não decide o Merge ---------- */

test('com o head conhecido, entrada sem head não conta como evidência', () => {
  const antigas = [{ verdict: 'refutado', headSha: '' }, { verdict: 'confirmado', headSha: '' }];
  assert.deepEqual(verificacaoObservada(antigas, 'sha-atual'),
    { status: 'not_applicable', confirmed: 0, refuted: 0 });
});

test('entrada do head atual continua contando', () => {
  const e = [{ verdict: 'confirmado', headSha: 'sha-atual' }, { verdict: 'confirmado', headSha: 'sha-velho' }];
  assert.deepEqual(verificacaoObservada(e, 'sha-atual'), { status: 'satisfied', confirmed: 1, refuted: 0 });
});

test('refutado do head atual continua travando', () => {
  const e = [{ verdict: 'refutado', headSha: 'sha-atual' }, { verdict: 'confirmado', headSha: 'sha-atual' }];
  assert.deepEqual(verificacaoObservada(e, 'sha-atual'), { status: 'failed', confirmed: 1, refuted: 1 });
});

test('sem head conhecido (as duas leituras do gh falharam), a regra antiga vale inteira', () => {
  const e = [{ verdict: 'confirmado', headSha: '' }, { verdict: 'confirmado', headSha: 'x' }];
  assert.deepEqual(verificacaoObservada(e, ''), { status: 'satisfied', confirmed: 2, refuted: 0 });
});
