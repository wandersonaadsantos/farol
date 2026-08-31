// A limpeza de label presa no boot precisa de TOKEN, e ele não existe ainda.
//
// DEFEITO QUE ORIGINOU (medido em 30/08/2026): `start()` chamava limparLabelsOrfas
// ANTES do primeiro `check()`, e `this.tokens` só é preenchido pelo refreshTokens de
// dentro do check. Com `tokens` vazio, o `if (!engine.tokenFor(acc)) continue` do
// limparLabelsOrfas caía em toda iteração, de forma síncrona, e a função terminava no
// mesmo tick sem uma única chamada gh. A cura da label presa da v2.54.3 nunca removeu
// nada em produção, e o teste da função ficava verde porque injeta `tokenFor`.
//
// Importa porque label presa faz a frota inteira sair de cena naquele PR, e o app
// reinicia sozinho (auto-update, queda de renderer).
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FONTE = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
const START = FONTE.slice(FONTE.indexOf('  async start()'));

test('o boot resolve os tokens antes de tentar limpar label presa', () => {
  const tokens = START.indexOf('this.refreshTokens()');
  const limpeza = START.indexOf('reviewMod.limparLabelsOrfas(');
  assert.ok(tokens > 0, 'o start() resolve os tokens');
  assert.ok(limpeza > 0, 'o start() ainda limpa label presa');
  assert.ok(tokens < limpeza, 'sem token resolvido a limpeza é um no-op garantido');
});

test('a limpeza continua acontecendo antes do primeiro ciclo', () => {
  const limpeza = START.indexOf('reviewMod.limparLabelsOrfas(');
  const check = START.indexOf("this.check('startup')");
  assert.ok(check > 0 && limpeza < check,
    'depois do primeiro check o app já teria saído de cena pela própria label presa');
});
