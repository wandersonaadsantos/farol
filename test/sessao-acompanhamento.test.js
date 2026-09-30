// O que o cartão de "Analisando agora" afirma tem que ser fato. Estes casos travam as
// três mentiras que o acompanhamento contava: etapa final que nunca acendia, percentual
// inventado, e "analisando" enquanto o modelo já tinha terminado ou o stream estava mudo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_FLOW_ORDER, stageFlowFrom, situacaoDaSessao, etapaAtiva, SEM_SINAL_MS,
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

test('situação: sessão trabalhando mostra os arquivos do PR já lidos', () => {
  const agora = 100000;
  const s = { fase: 'modelo', ultimoSinalEm: agora - 1000, lidos: 12 };
  assert.deepEqual(situacaoDaSessao(s, agora), { estado: 'ativa', texto: '12 arquivo(s) do PR lidos' });
});

test('situação: sem leitura registrada não inventa número', () => {
  const agora = 100000;
  const sit = situacaoDaSessao({ fase: 'modelo', ultimoSinalEm: agora - 1000 }, agora);
  assert.equal(sit.estado, 'ativa');
  assert.equal(sit.texto, 'em andamento');
  assert.doesNotMatch(sit.texto, /%/);
});

// O caso que fazia o cartão mentir por mais tempo: o modelo terminou e a revisão segue
// em gate e postagem, às vezes por minutos, com o feed parado.
test('situação: depois que o modelo termina, o cartão diz que está fechando', () => {
  const agora = 100000;
  const sit = situacaoDaSessao({ fase: 'fechando', ultimoSinalEm: agora - 120000 }, agora);
  assert.equal(sit.estado, 'fechando');
  assert.match(sit.texto, /decidindo e postando/);
});

test('situação: stream mudo vira aviso, não silêncio', () => {
  const agora = 100000;
  const sit = situacaoDaSessao({ fase: 'modelo', ultimoSinalEm: agora - (SEM_SINAL_MS + 15000) }, agora);
  assert.equal(sit.estado, 'muda');
  assert.match(sit.texto, /sem sinal há/);
});

test('situação: silêncio curto ainda é trabalho, não alarme', () => {
  const agora = 100000;
  const sit = situacaoDaSessao({ fase: 'modelo', ultimoSinalEm: agora - (SEM_SINAL_MS - 1000) }, agora);
  assert.equal(sit.estado, 'ativa');
});

// Trava de regressão: o percentual saía do cartão de sessão. Se alguém trouxer de volta
// a régua por contagem de linhas, este caso avisa.
test('o cartão de sessão não usa mais a régua de percentual por contagem de linhas', async () => {
  const { default: fs } = await import('node:fs');
  const tela = fs.readFileSync(new URL('../ui/telas/sessoes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tela, /sessionProgress/);
});
