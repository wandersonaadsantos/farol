// O preparo da revisão diz o que está fazendo (08/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoDaBusca, TEXTO_DA_AVALIACAO, duracao, textoDePronto, avisarPreparo } from '../lib/engine/aviso-do-preparo.js';
import { stageOfLine } from '../lib/engine/etapas-revisao.js';

test('a busca do código diz quantos outros preparos estão em andamento', () => {
  assert.equal(textoDaBusca(0), 'Buscando o código do PR.');
  assert.equal(textoDaBusca(1), 'Buscando o código do PR, com 1 outro preparo em andamento.');
  assert.equal(textoDaBusca(3), 'Buscando o código do PR, com 3 outros preparos em andamento.');
  assert.equal(textoDaBusca(undefined), 'Buscando o código do PR.');
});

test('a duração sai em segundos e, acima de um minuto, em minutos', () => {
  assert.equal(duracao(400), '0 s');
  assert.equal(duracao(59_400), '59 s');
  assert.equal(duracao(60_000), '1 min');
  assert.equal(duracao(286_000), '4 min 46 s');
  assert.equal(textoDePronto('Código do PR pronto', 12_000), 'Código do PR pronto em 12 s.');
});

test('as linhas contam como etapa de preparo na esteira', () => {
  for (const text of [textoDaBusca(0), TEXTO_DA_AVALIACAO, textoDePronto('Avaliação técnica pronta', 1000)]) {
    assert.equal(stageOfLine({ k: 'info', text }), 'preparo', text);
  }
});

test('sem sessão ou sem feed, avisar não faz nada e não lança', () => {
  const linhas = [];
  const engine = { pushActivity: (...a) => linhas.push(a) };
  avisarPreparo(engine, '', 'x');
  avisarPreparo(engine, undefined, 'x');
  avisarPreparo({}, 's1', 'x');
  avisarPreparo(null, 's1', 'x');
  assert.deepEqual(linhas, []);
  avisarPreparo(engine, 's1', 'pronto');
  assert.deepEqual(linhas, [['s1', 'info', 'pronto', undefined, 'preparo']]);
});

test('o preparo não conta como sinal do provedor', () => {
  const sessoes = new Map([['s1', {}], ['s2', { ultimoSinalEm: 123 }]]);
  const engine = { activeReviews: sessoes, pushActivity(id) { sessoes.get(id).ultimoSinalEm = 999; } };
  avisarPreparo(engine, 's1', 'x');
  avisarPreparo(engine, 's2', 'x');
  assert.equal(sessoes.get('s1').ultimoSinalEm, undefined, 'sem sinal do stream, a tela segue em preparando');
  assert.equal(sessoes.get('s2').ultimoSinalEm, 123);
});
