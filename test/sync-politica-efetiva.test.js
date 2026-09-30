// Valor efetivo da política (CT-ADM-POL): o remoto SÓ RESTRINGE, e a queda da autoridade
// nunca amplia. Um caso por regra, porque cada uma existe por um jeito diferente de o
// aparelho acabar fazendo mais do que foi combinado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { politicaEfetiva } from '../lib/engine/politica-efetiva.js';

const LOCAL = { pausado: false, tetoParalelismo: 3 };

test('sem política remota, vale a configuração local inteira', () => {
  const e = politicaEfetiva(LOCAL, null, { autoridade: true });
  assert.deepEqual(e.pausado, false);
  assert.equal(e.tetoParalelismo, 3);
  assert.deepEqual(Object.values(e.origem), ['local', 'local']);
});

test('pausa: pausado se QUALQUER um dos dois pausar', () => {
  assert.equal(politicaEfetiva(LOCAL, { pausado: true }, { autoridade: true }).pausado, true, 'remoto pausa');
  assert.equal(politicaEfetiva({ ...LOCAL, pausado: true }, { pausado: false }, { autoridade: true }).pausado, true, 'remoto NÃO despausa');
  assert.equal(politicaEfetiva(LOCAL, { pausado: false }, { autoridade: true }).pausado, false);
});

test('teto: o menor dos dois, e o remoto maior nunca amplia', () => {
  assert.equal(politicaEfetiva(LOCAL, { tetoParalelismo: 1 }, { autoridade: true }).tetoParalelismo, 1);
  assert.equal(politicaEfetiva(LOCAL, { tetoParalelismo: 4 }, { autoridade: true }).tetoParalelismo, 3, 'o remoto maior não amplia');
});

// v2.66.2: contas elegíveis e tipos de operação saíram da política, porque nada no engine
// os aplicava. Um admin antigo que ainda os publique não pode fazê-los reaparecer aqui.
test('campo fora da política não entra no valor efetivo, venha de que lado vier', () => {
  const e = politicaEfetiva({ ...LOCAL, tiposDeOperacao: ['review'] }, { contasElegiveis: ['a'.repeat(32)], tiposDeOperacao: ['chat'] }, { autoridade: true });
  assert.deepEqual(Object.keys(e).sort(), ['origem', 'pausado', 'tetoParalelismo']);
  assert.deepEqual(Object.keys(e.origem).sort(), ['pausado', 'tetoParalelismo']);
});

test('a origem diz, campo a campo, quem decidiu', () => {
  const e = politicaEfetiva(LOCAL, { pausado: true, tetoParalelismo: 9 }, { autoridade: true });
  assert.equal(e.origem.pausado, 'remoto');
  assert.equal(e.origem.tetoParalelismo, 'local', 'o remoto não mudou nada, então quem vale é o local');
});

test('autoridade indisponível COM cache: a restrição continua, e a queda não despausa nem amplia', () => {
  const remota = { pausado: true, tetoParalelismo: 1 };
  const caida = politicaEfetiva(LOCAL, remota, { autoridade: false });
  assert.equal(caida.pausado, true, 'a queda da autoridade não despausa');
  assert.equal(caida.tetoParalelismo, 1, 'a queda da autoridade não amplia o teto');
  assert.equal(caida.origem.pausado, 'restricao-mantida');
  assert.equal(caida.origem.tetoParalelismo, 'restricao-mantida');
});

test('autoridade indisponível SEM cache: só o local, sem inventar restrição', () => {
  const e = politicaEfetiva(LOCAL, null, { autoridade: false });
  assert.equal(e.pausado, false);
  assert.equal(e.tetoParalelismo, 3);
  assert.equal(e.origem.pausado, 'local');
});

test('política remota vazia não restringe nada por si', () => {
  const e = politicaEfetiva(LOCAL, {}, { autoridade: true });
  assert.equal(e.tetoParalelismo, 3);
  assert.equal(e.pausado, false);
  assert.deepEqual(Object.values(e.origem), ['local', 'local']);
});

test('sem configuração local, a remota vale sozinha e o teto ausente não vira zero', () => {
  const e = politicaEfetiva(null, { tetoParalelismo: 2 }, { autoridade: true });
  assert.equal(e.pausado, false);
  assert.equal(e.tetoParalelismo, 2);
  assert.equal(politicaEfetiva(null, {}, { autoridade: true }).tetoParalelismo, null);
});
