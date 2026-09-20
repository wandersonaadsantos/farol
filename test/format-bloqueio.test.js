// O AVISO DE COORDENAÇÃO: quem analisou, e de que lado da tela ele está.
//
// A queixa que criou este arquivo (20/09/2026, com print): o alerta dizia
//   "este commit já foi analisado por o aparelho Windows Predator i9 4070"
// numa tela aberta NO Windows Predator i9 4070. Dois defeitos na mesma frase:
//
//   1. o texto foi escrito para o caso de OUTRO aparelho e não tinha caso local. A raiz
//      estava em `nomeDoDispositivo` (lib/sync/coordinator.js), que devolve o nome do
//      próprio aparelho sem marcá-lo como local, e em `textoBloqueio`, que embrulha esse
//      nome como se fosse sempre de terceiro;
//   2. "por o aparelho", quando o português pede "pelo aparelho".
//
// O mais revelador é que o MESMO bug já tinha sido consertado no caminho vizinho: o
// comentário de `alheioDeVerdade` (coordinator.js) diz, com todas as letras, que "sem esta
// distinção o preflight nomeava o próprio aparelho como 'outro' e a tela mandava esperar
// por si mesmo". Aquela guarda cobre o motivo `alheio`; o motivo `recibo` ficou de fora.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-bloqueio-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { textoBloqueio } = await import('../lib/format.js');

const KEY = 'acme/app#42';
const NOME = 'Windows Predator i9 4070';

function bloqueio(reason, detail) {
  return textoBloqueio(KEY, { admitted: false, reason, detail });
}

test('recibo do PRÓPRIO aparelho: a frase é em primeira pessoa, e não nomeia um terceiro', () => {
  const t = bloqueio('recibo', { deviceName: NOME, local: true });
  assert.match(t, /analisado neste aparelho/);
  assert.equal(t.includes(NOME), false, 'o aparelho onde a tela está aberta não é "o aparelho X"');
  assert.match(t, /nada foi refeito/, 'o bloqueio continua certo: não há o que refazer');
});

test('recibo de OUTRO aparelho: nomeia o aparelho, com a crase certa', () => {
  const t = bloqueio('recibo', { deviceName: 'Celular', local: false });
  assert.match(t, /analisado pelo aparelho Celular/);
  assert.equal(t.includes('por o aparelho'), false, 'o português pede "pelo"');
});

test('recibo sem nome de aparelho continua dizendo "outro aparelho"', () => {
  assert.match(bloqueio('recibo', {}), /analisado por outro aparelho/);
});

test('recibo externo (GitHub) não fala de aparelho nenhum', () => {
  assert.match(bloqueio('recibo', { deviceName: NOME, local: true, externo: true }), /você já se manifestou neste commit no GitHub/);
});

test('alheio: o texto continua o de sempre, e com a crase certa', () => {
  const t = bloqueio('alheio', { deviceName: 'Celular' });
  assert.match(t, /o aparelho Celular está analisando este PR agora/);
  assert.match(t, /este aparelho espera ele terminar/);
});

// `alheioDeVerdade` já impede que `alheio` fale do próprio aparelho. Se um dia alguém
// tirar aquela guarda, o texto não pode mandar esperar por si mesmo em silêncio.
test('alheio apontando para o próprio aparelho não manda esperar por si mesmo', () => {
  const t = bloqueio('alheio', { deviceName: NOME, local: true });
  assert.equal(/espera ele terminar/.test(t), false, 'ninguém espera por si mesmo');
  assert.match(t, /neste aparelho/);
});

test('os outros motivos seguem intactos', () => {
  assert.match(bloqueio('esgotado', {}), /rodadas automáticas de hoje/);
  assert.match(bloqueio('indisponivel', { motivo: 'sem rede' }), /coordenação entre aparelhos indisponível \(sem rede\)/);
});
