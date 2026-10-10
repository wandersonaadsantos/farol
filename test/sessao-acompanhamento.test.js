// O que o cartão de "Analisando agora" afirma tem que ser fato. Estes casos travam a
// esteira (etapa final que nunca acendia) e a volta da régua por contagem de linhas; a
// porcentagem, o silêncio do stream e o fechamento estão em progresso-da-sessao.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_FLOW_ORDER, stageFlowFrom, etapaAtiva,
} from '../ui/pure/sessao.js';

// A esteira da tela e as etapas do engine são a MESMA lista de ids. Enquanto a tela
// tinha 'redacao' e o engine estampava 'fechamento', o último nó nunca acendia e o tempo
// da etapa final sumia da esteira.
test('os ids da esteira são os que o engine estampa', async () => {
  const { default: fs } = await import('node:fs');
  const fonte = fs.readFileSync(new URL('../lib/engine/etapas-revisao.js', import.meta.url), 'utf8');
  const m = /const STAGE_ORDER = \[([^\]]+)\]/.exec(fonte);
  assert.ok(m, 'STAGE_ORDER não encontrada em lib/engine/etapas-revisao.js');
  const doEngine = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(STAGE_FLOW_ORDER.map(([id]) => id), doEngine);
});

test('a etapa final acende quando o engine a estampa', () => {
  const t0 = 1000;
  const flow = stageFlowFrom([
    { t: t0 + 1000, s: 'leitura' },
    { t: t0 + 2000, s: 'fechamento' },
  ], t0, t0 + 3000);
  const fim = flow.find(x => x.id === 'fechamento');
  assert.equal(fim.state, 'active');
  assert.ok(fim.ms > 0, 'a última etapa tem que acumular o tempo do silêncio final');
});

test('etapaAtiva devolve o rótulo do nó ativo, e vazio quando não há nenhum', () => {
  const t0 = 1000;
  const flow = stageFlowFrom([{ t: t0 + 500, s: 'verificacao' }], t0, t0 + 900);
  assert.equal(etapaAtiva(flow), 'verificação');
  assert.equal(etapaAtiva([]), '');
  assert.equal(etapaAtiva(null), '');
});

// Trava de regressão: a régua por contagem de linhas (que parava em 90%) não volta ao
// cartão de sessão. A porcentagem de hoje é a do progressoDaSessao, travada em
// test/progresso-da-sessao.test.js.
test('o cartão de sessão não usa mais a régua de percentual por contagem de linhas', async () => {
  const { default: fs } = await import('node:fs');
  const tela = fs.readFileSync(new URL('../ui/telas/sessoes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tela, /sessionProgress/);
});
