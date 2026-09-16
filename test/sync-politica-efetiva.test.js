// Valor efetivo da política (CT-ADM-POL): o remoto SÓ RESTRINGE, e a queda da autoridade
// nunca amplia. Um caso por regra, porque cada uma existe por um jeito diferente de o
// aparelho acabar fazendo mais do que foi combinado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { politicaEfetiva } from '../lib/engine/politica-efetiva.js';

const TAG_A = 'a'.repeat(32);
const TAG_B = 'b'.repeat(32);
const TAG_C = 'c'.repeat(32);

const LOCAL = { pausado: false, tetoParalelismo: 3, contasElegiveis: [TAG_A, TAG_B], tiposDeOperacao: ['review', 'chat', 'self'] };

test('sem política remota, vale a configuração local inteira', () => {
  const e = politicaEfetiva(LOCAL, null, { autoridade: true });
  assert.deepEqual(e.pausado, false);
  assert.equal(e.tetoParalelismo, 3);
  assert.deepEqual(e.contasElegiveis, [TAG_A, TAG_B]);
  assert.deepEqual(e.tiposDeOperacao, ['review', 'chat', 'self']);
  assert.deepEqual(Object.values(e.origem), ['local', 'local', 'local', 'local']);
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

test('contas e tipos: interseção, e lista de um lado só vale sozinha', () => {
  const e = politicaEfetiva(LOCAL, { contasElegiveis: [TAG_B, TAG_C], tiposDeOperacao: ['chat', 'tool'] }, { autoridade: true });
  assert.deepEqual(e.contasElegiveis, [TAG_B], 'conta que o local não tinha não entra');
  assert.deepEqual(e.tiposDeOperacao, ['chat']);
  const semLocal = politicaEfetiva({ pausado: false, tetoParalelismo: 2 }, { contasElegiveis: [TAG_C] }, { autoridade: true });
  assert.deepEqual(semLocal.contasElegiveis, [TAG_C], 'sem lista local, a remota restringe sozinha');
});

test('a origem diz, campo a campo, quem decidiu', () => {
  const e = politicaEfetiva(LOCAL, { pausado: true, tetoParalelismo: 9 }, { autoridade: true });
  assert.equal(e.origem.pausado, 'remoto');
  assert.equal(e.origem.tetoParalelismo, 'local', 'o remoto não mudou nada, então quem vale é o local');
  assert.equal(e.origem.contasElegiveis, 'local');
});

test('autoridade indisponível COM cache: a restrição continua, e a queda não despausa nem amplia', () => {
  const remota = { pausado: true, tetoParalelismo: 1, tiposDeOperacao: ['review'] };
  const viva = politicaEfetiva(LOCAL, remota, { autoridade: true });
  const caida = politicaEfetiva(LOCAL, remota, { autoridade: false });
  assert.equal(caida.pausado, true, 'a queda da autoridade não despausa');
  assert.equal(caida.tetoParalelismo, 1, 'a queda da autoridade não amplia o teto');
  assert.deepEqual(caida.tiposDeOperacao, viva.tiposDeOperacao);
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
  assert.deepEqual(e.tiposDeOperacao, ['review', 'chat', 'self']);
  assert.equal(e.origem.tiposDeOperacao, 'local');
});

// `null` é "ninguém restringiu por conta", e é diferente de `[]`, que é "nenhuma conta
// elegível". Sem essa distinção, um lado sem lista viraria lista vazia e pararia o Farol.
test('lista ausente dos dois lados é ausência de restrição, não lista vazia', () => {
  const e = politicaEfetiva(null, { tetoParalelismo: 2 }, { autoridade: true });
  assert.equal(e.pausado, false);
  assert.equal(e.tetoParalelismo, 2);
  assert.equal(e.contasElegiveis, null);
  assert.equal(e.tiposDeOperacao, null);
  const vazia = politicaEfetiva(LOCAL, { contasElegiveis: [] }, { autoridade: true });
  assert.deepEqual(vazia.contasElegiveis, [], 'lista vazia publicada restringe de verdade');
});
