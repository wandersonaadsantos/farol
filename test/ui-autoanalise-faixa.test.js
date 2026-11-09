// A autoanálise em andamento na largura do card (08/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ETAPAS_DA_AUTOANALISE, sessaoSumiuSemResultado, tempoDecorrido, etapaDaAutoanalise, andamentoDaAutoanalise, faixaDaAutoanaliseHtml, linhaDaAutoanalise } from '../ui/pure.js';
import { stageOfLine } from '../lib/engine/etapas-revisao.js';
import { esperaParaTela } from '../lib/engine/conta-na-tela.js';

const AGORA = 1_000_000_000;
const sessao = (extra = {}) => ({ id: 's', startedAt: AGORA - 48_000, ultimoSinalEm: 0, ...extra });

test('o tempo sai em segundos e, acima de um minuto, com os segundos em dois dígitos', () => {
  assert.equal(tempoDecorrido(48_000), '48 s');
  assert.equal(tempoDecorrido(123_000), '2 min 03 s');
});

// o feed como o motor grava: a etapa vem do stageOfLine, nunca escrita à mão
const doMotor = (k, text) => ({ k, text, s: stageOfLine({ k, text }) });

test('a etapa segue o feed estampado pelo motor', () => {
  const s = sessao({ totalArquivos: 2, lidos: 1 });
  const preparo = { s: 'preparo', k: 'info', text: 'Buscando o código do PR.' };
  assert.equal(etapaDaAutoanalise(s, [preparo]), 0);
  assert.equal(etapaDaAutoanalise(s, [preparo, doMotor('tool', 'Read a.ts')]), 1);
  assert.equal(etapaDaAutoanalise(s, [preparo, doMotor('tool', 'Read a.ts'), doMotor('text', 'Comparando')]), 1, 'comentário no meio da leitura não adianta');
  assert.equal(etapaDaAutoanalise({ ...s, lidos: 2 }, [doMotor('text', 'Comparando')]), 2, 'leu tudo e raciocina: verificação');
  assert.equal(etapaDaAutoanalise(s, [doMotor('text', 'FAROL_CHECKPOINT {}')]), 2);
  assert.equal(etapaDaAutoanalise({ fase: 'fechando' }, []), 3);
});

test('a etapa não recua quando as linhas antigas saem da janela do feed', () => {
  const m = andamentoDaAutoanalise({ sess: sessao({ ultimoSinalEm: AGORA }), itens: [doMotor('tool', 'Read b.ts')], agora: AGORA, etapaMinima: 2 });
  assert.equal(m.etapa, 2);
});

test('a sessão que sumiu só é falha sem análise nova e sem cancelamento', () => {
  assert.equal(sessaoSumiuSemResultado({ desde: 100 }), true);
  assert.equal(sessaoSumiuSemResultado({ desde: 100, analise: { at: 90 } }), true, 'a análise antiga não conta');
  assert.equal(sessaoSumiuSemResultado({ desde: 100, analise: { at: 100 } }), false);
  assert.equal(sessaoSumiuSemResultado({ desde: 100, cancelada: true }), false);
});

test('a fila diz quem é autoanálise, para a revisão do mesmo PR não virar faixa', () => {
  const engine = { headlessQueue: [{ key: 'a', kind: 'self' }, { key: 'b' }], accountForPr: () => null, config: {} };
  const d = esperaParaTela(engine).headlessWaitingDetails;
  assert.equal(d.a.autoanalise, true);
  assert.equal(d.b.autoanalise, undefined);
});

test('a barra só anda de verdade na leitura', () => {
  const lendo = andamentoDaAutoanalise({ sess: sessao({ totalArquivos: 23, lidos: 8, ultimoSinalEm: AGORA }), itens: [{ s: 'leitura', k: 'tool', text: 'Lendo a.ts' }], agora: AGORA });
  assert.deepEqual([lendo.barra, lendo.pct, lendo.texto, lendo.apoio, lendo.frase], ['definida', 34, 'Lendo a.ts', '8 de 23 arquivos', 'Lendo 8 de 23']);
  const preparo = andamentoDaAutoanalise({ sess: sessao(), itens: [{ s: 'preparo', text: 'Buscando o código do PR.' }], agora: AGORA });
  assert.equal(preparo.barra, 'indefinida');
  assert.equal(preparo.texto, 'Buscando o código do PR.');
});

test('sem leitura observada não há contagem: a barra fica indefinida', () => {
  const m = andamentoDaAutoanalise({ sess: sessao({ totalArquivos: 23, ultimoSinalEm: AGORA }), itens: [{ s: 'leitura', k: 'tool', text: 'x' }], agora: AGORA });
  assert.deepEqual([m.barra, m.apoio, m.frase], ['indefinida', '', 'Lendo']);
});

test('sem sinal do modelo a faixa diz isso, e o preparo silencioso não conta', () => {
  const muda = andamentoDaAutoanalise({ sess: sessao({ ultimoSinalEm: AGORA - 80_000 }), itens: [{ s: 'leitura' }], agora: AGORA });
  assert.equal(muda.tom, 'wait');
  assert.match(muda.texto, /^Sem sinal do modelo há .*A sessão segue aberta\.$/);
  assert.equal(andamentoDaAutoanalise({ sess: sessao({ ultimoSinalEm: 0 }), itens: [], agora: AGORA }).tom, 'run');
});

test('o clique responde antes do servidor, a fila e a falha têm estado próprio, e sem nada não há faixa', () => {
  assert.equal(andamentoDaAutoanalise({ iniciandoDesde: AGORA }).texto, 'Iniciando a autoanálise.');
  assert.equal(andamentoDaAutoanalise({ posicao: 2 }).frase, '2º na fila');
  assert.equal(andamentoDaAutoanalise({ falha: 'limite do plano' }).tipo, 'falha');
  assert.equal(andamentoDaAutoanalise({}), null);
  assert.equal(faixaDaAutoanaliseHtml(null), '');
});

test('o html marca a etapa atual, as feitas e a ação de cada estado, escapando o texto', () => {
  const m = andamentoDaAutoanalise({ sess: sessao({ ultimoSinalEm: AGORA }), itens: [doMotor('tool', 'Read a.ts')], agora: AGORA });
  const html = faixaDaAutoanaliseHtml(m, { key: 'o/r#1', url: 'u', agora: AGORA });
  for (const nome of ETAPAS_DA_AUTOANALISE) assert.ok(html.includes(nome), nome);
  assert.match(html, /aa-et feita[^]*Código/);
  assert.match(html, /aa-et agora" aria-current="step"[^]*Leitura/);
  assert.match(html, /aa-cancelar" data-key="o\/r#1"/);
  assert.match(html, /data-aa-etapa="1"/);
  assert.ok(html.includes(`data-aa-desde="${AGORA - 48_000}">48 s`));
  const falha = faixaDaAutoanaliseHtml(andamentoDaAutoanalise({ falha: '<b>x</b>' }), { key: 'k', url: 'http://u' });
  assert.match(falha, /act-self" data-url="http:\/\/u">Tentar de novo/);
  assert.match(falha, /aa-dispensar" data-key="k">Dispensar/);
  assert.ok(falha.includes('&lt;b&gt;x'));
  assert.doesNotMatch(faixaDaAutoanaliseHtml(andamentoDaAutoanalise({ iniciandoDesde: AGORA }), { key: 'k' }), /aa-cancelar/, 'ainda não há o que cancelar');
  const cancelando = faixaDaAutoanaliseHtml({ ...m, cancelando: true }, { key: 'k' });
  assert.match(cancelando, /disabled>Cancelando…/);
});

test('a linha da Compacta traz a frase, o tempo, a ação e o fio', () => {
  const f = linhaDaAutoanalise(andamentoDaAutoanalise({ falha: 'limite do plano' }), { key: 'k' });
  assert.match(f.meio, /title="limite do plano">nada foi publicado/);
  const m = andamentoDaAutoanalise({ sess: sessao({ totalArquivos: 4, lidos: 1, ultimoSinalEm: AGORA }), itens: [{ s: 'leitura' }], agora: AGORA });
  const l = linhaDaAutoanalise(m, { key: 'k', agora: AGORA });
  assert.deepEqual(l.estado, { tom: 'run', texto: 'Lendo 1 de 4' });
  assert.match(l.meio, /data-aa-tempo/);
  assert.match(l.acoes, /aa-cancelar/);
  assert.match(l.rodape, /width:25%/);
});
