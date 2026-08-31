// Duas falhas que eram SILENCIOSAS e agora deixam rastro.
//
// 1. Rodada sem head confirmado (12 de 247 rodadas desde 15/08, medido em 30/08/2026):
//    sem head o dedup compara com qualquer review meu antigo, o gate de "o head andou
//    durante a sessão" nunca arma, o review sai sem âncora de commit e o checkpoint
//    nasce sem head. Em engine-ai#51 isso postou um SEGUNDO APPROVE no mesmo commit.
// 2. "A sessão não devolveu JSON" tinha duas causas opostas com a mesma frase: resultado
//    VAZIO (falha de transporte) e PROSA em vez do envelope (contrato quebrado).
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { semJsonText } = await import('../lib/format.js');

const REVIEW = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');

test('rodada sem head confirmado vira linha no log, e continua rodando', () => {
  assert.match(REVIEW, /if \(!headShaAtual\) \{\s*\n\s*engine\.log\('WARN'/,
    'a rodada cega precisa deixar rastro');
  assert.equal(/if \(!headShaAtual\)[\s\S]{0,400}?return;/.test(REVIEW), false,
    'e NÃO pode cancelar: falha de rede nunca derruba a revisão');
});

test('semJsonText separa resultado vazio de prosa sem objeto', () => {
  assert.match(semJsonText(''), /resultado veio vazio/);
  assert.match(semJsonText(undefined), /resultado veio vazio/);
  assert.match(semJsonText('desculpa, não consegui'), /22 caracteres de texto, nenhum objeto/);
});

test('semJsonText preserva o prefixo (a taxonomia de falha casa por texto)', () => {
  for (const t of ['', 'prosa qualquer']) {
    assert.match(semJsonText(t), /^a sessão não devolveu JSON/);
  }
});

test('semJsonText nunca copia o texto da sessão pro log', () => {
  const segredo = 'ghp_' + 'x'.repeat(36);
  assert.equal(semJsonText(`nada de json aqui, ${segredo}`).includes(segredo), false,
    'log é pra sempre: vai só o tamanho');
});
