// O orçamento de busca existe para o Farol NÃO tomar 403. Os casos abaixo são as três
// perguntas que ele responde: cabe agora? se não cabe, daqui a quanto? e a janela anda?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TETO_POR_JANELA, JANELA_MS, ESPACO_MIN_MS,
  registrarBusca, esperaAntesDaBusca, buscasNaJanela,
} from '../lib/engine/orcamento-busca.js';

function novo() { return new Map(); }

test('conta sem histórico busca na hora', () => {
  assert.equal(esperaAntesDaBusca(novo(), 'ana', 1000), 0);
});

// O caso que originou tudo: o ciclo dispara as buscas quase juntas. Com 1 owner, mais
// review-requested, reviewed-by e autoria, uma conta faz 7 seguidas em milissegundos.
test('busca colada na anterior espera o espaçamento mínimo', () => {
  const reg = novo();
  registrarBusca(reg, 'ana', 1000);
  assert.equal(esperaAntesDaBusca(reg, 'ana', 1000), ESPACO_MIN_MS);
  assert.equal(esperaAntesDaBusca(reg, 'ana', 1000 + ESPACO_MIN_MS), 0);
});

test('o espaçamento é por conta: a fila de uma não atrasa a da outra', () => {
  const reg = novo();
  registrarBusca(reg, 'ana', 1000);
  assert.equal(esperaAntesDaBusca(reg, 'bia', 1000), 0);
});

// rajada de verdade (o que o ciclo faz hoje): os carimbos entram quase no mesmo instante
function encherOTeto(reg, inicio = 1000) {
  for (let i = 0; i < TETO_POR_JANELA; i++) registrarBusca(reg, 'ana', inicio + i);
  return inicio + TETO_POR_JANELA;
}

test('estourado o teto da janela, a espera vai até a busca mais antiga sair dela', () => {
  const reg = novo();
  const agora = encherOTeto(reg);
  const espera = esperaAntesDaBusca(reg, 'ana', agora);
  assert.ok(espera > 0, 'com o teto cheio a busca tem que esperar');
  // a mais antiga entrou em 1000; ela sai da janela em 1000 + JANELA_MS
  assert.equal(agora + espera, 1000 + JANELA_MS);
});

test('a janela anda: passada a janela inteira, o teto está livre de novo', () => {
  const reg = novo();
  const ultima = encherOTeto(reg);
  const depois = ultima + JANELA_MS + 1;   // até a ÚLTIMA da rajada sair da janela
  assert.equal(esperaAntesDaBusca(reg, 'ana', depois), 0);
  assert.equal(buscasNaJanela(reg, 'ana', depois), 0);
});

// A janela é DESLIZANTE, não um balde que zera de uma vez: assim que a mais antiga sai,
// abre uma vaga, e é isso que faz o ciclo seguinte não esperar o minuto inteiro.
test('a vaga abre uma a uma, conforme cada carimbo vence', () => {
  const reg = novo();
  encherOTeto(reg);
  const saiAPrimeira = 1000 + JANELA_MS;
  assert.equal(esperaAntesDaBusca(reg, 'ana', saiAPrimeira), 0, 'a vaga da mais antiga já abriu');
  assert.equal(buscasNaJanela(reg, 'ana', saiAPrimeira), TETO_POR_JANELA - 1);
});

test('buscasNaJanela conta só o que está dentro dela', () => {
  const reg = novo();
  registrarBusca(reg, 'ana', 1000);
  registrarBusca(reg, 'ana', 1000 + JANELA_MS - 1);
  assert.equal(buscasNaJanela(reg, 'ana', 1000 + JANELA_MS - 1), 2);
  assert.equal(buscasNaJanela(reg, 'ana', 1000 + JANELA_MS + 1), 1);
});

// O teto do GitHub para a API de busca é 30 por minuto. O nosso fica abaixo de
// propósito: clique manual, re-checagem e o que o gh faz fora do ciclo também gastam.
test('o teto fica com folga real sob o limite do GitHub', () => {
  assert.equal(JANELA_MS, 60_000);
  assert.ok(TETO_POR_JANELA < 30, 'teto tem que deixar folga sob as 30 buscas por minuto');
  assert.ok(TETO_POR_JANELA >= 14, 'e tem que caber um ciclo inteiro da configuração real (14 buscas)');
});

// Registro de conta que parou de ser usada não pode crescer para sempre na memória do
// engine: o que saiu da janela é descartado na própria leitura.
test('o registro não acumula carimbo velho', () => {
  const reg = novo();
  for (let i = 0; i < 50; i++) registrarBusca(reg, 'ana', 1000 + i);
  registrarBusca(reg, 'ana', 1000 + JANELA_MS + 5000);
  assert.equal(reg.get('ana').length, 1);
});
