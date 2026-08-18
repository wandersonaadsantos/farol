// Ponte de texto pro editor de Reviewers (Sistema > Reviewers).
//
// Bug real que EU introduzi no PR #11 (onda 5, terceiro passo) e que só apareceu
// quando o Wanderson abriu a tela. Ao converter as chamadas pra receber o `ctx`, o
// regex da conversão usou `[^)]*` e parou no primeiro `)` — que era o de
// `var(--accent)`, dentro da STRING do argumento anterior. Saiu assim:
//
//   renderOrgBlock(o, meta.color || 'var(--accent, ctxRev)')
//
// O `ctxRev` virou parte do texto da cor e a função passou a receber
// `ctx === undefined`. As DUAS chamadas da tela saíram corrompidas, então o editor
// inteiro quebrava com "Cannot read properties of undefined (reading 'defaults')" —
// não era só o bloco das órfãs.
//
// Por que nenhum gate pegou: `node --check` valida sintaxe, e a sintaxe estava
// perfeita; os testes cobriam `renderOrgBlock` chamando-a direto com um ctx bom; e
// nenhum teste EXECUTA o ui/app.js. Enquanto o app.js não for executável em teste, a
// ponte possível é textual, e é esta. Runner nativo, ZERO deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APPJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');

test('toda chamada de renderOrgBlock passa o ctx', () => {
  const chamadas = [...APPJS.matchAll(/renderOrgBlock\([^;\n]*/g)].map(m => m[0]);
  assert.ok(chamadas.length >= 2, `esperava as duas chamadas da tela, achei ${chamadas.length}`);
  for (const c of chamadas) {
    assert.match(c, /,\s*ctxRev\s*\)/, `chamada sem ctx: ${c.slice(0, 100)}`);
  }
});

test('nenhum argumento-string engoliu uma variável (a assinatura do estrago)', () => {
  // 'var(--algo, variavel)' dentro de aspas é exatamente o que o regex ruim produziu
  const suspeitas = [...APPJS.matchAll(/'[^']*\(--[^')]*,\s*[A-Za-z_]\w*\)'/g)].map(m => m[0]);
  assert.deepEqual(suspeitas, [], 'variável presa dentro de string de CSS');
});

test('o ctx do editor é único e vive FORA do laço por conta', () => {
  // as órfãs renderizam depois do laço; `const` dentro dele não alcançaria, e o
  // conserto ingênuo da outra linha viraria ReferenceError
  const m = APPJS.match(/function renderReviewersEditor\(\)[\s\S]*?\n\}/);
  assert.ok(m, 'renderReviewersEditor existe');
  const corpo = m[0];
  const decl = corpo.indexOf('const ctxRev');
  const laco = corpo.indexOf('for (const a of');
  const orfas = corpo.indexOf('orphans.map');
  assert.ok(decl >= 0 && laco >= 0 && orfas >= 0, 'as três partes existem');
  assert.ok(decl < laco, 'o ctx é declarado ANTES do laço');
  assert.ok(laco < orfas, 'e as órfãs vêm depois, no mesmo escopo');
});

test('as funções puras do editor recusam ctx ausente de forma visível', () => {
  // não é pra passar undefined, mas se passar tem que explodir alto na hora, não
  // renderizar meia tela em silêncio
  return import('../ui/pure.js').then(P => {
    assert.throws(() => P.renderOrgBlock('acme', 'var(--accent)'), /undefined/,
      'sem ctx, quebra na cara em vez de devolver markup pela metade');
  });
});
