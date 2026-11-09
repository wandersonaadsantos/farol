// A autoanálise em andamento na largura do card (08/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ETAPAS_DA_AUTOANALISE, PREFIXOS_DA_AVALIACAO, tempoDecorrido, etapaDaAutoanalise, andamentoDaAutoanalise, faixaDaAutoanaliseHtml, linhaDaAutoanalise } from '../ui/pure.js';
import { TEXTO_DA_AVALIACAO, textoDePronto } from '../lib/engine/aviso-do-preparo.js';

const AGORA = 1_000_000_000;
const sessao = (extra = {}) => ({ id: 's', startedAt: AGORA - 48_000, ultimoSinalEm: 0, ...extra });

test('o tempo sai em segundos e, acima de um minuto, com os segundos em dois dígitos', () => {
  assert.equal(tempoDecorrido(48_000), '48 s');
  assert.equal(tempoDecorrido(123_000), '2 min 03 s');
});

test('a tela reconhece as linhas que o motor escreve na avaliação técnica', () => {
  assert.ok(TEXTO_DA_AVALIACAO.startsWith(PREFIXOS_DA_AVALIACAO[0]));
  assert.ok(textoDePronto('Avaliação técnica pronta', 1000).startsWith(PREFIXOS_DA_AVALIACAO[1]));
});

test('a etapa segue o feed e nunca volta', () => {
  const s = sessao({ totalArquivos: 2, lidos: 1 });
  assert.equal(etapaDaAutoanalise(s, [{ s: 'preparo', text: 'Buscando o código do PR.' }]), 0);
  assert.equal(etapaDaAutoanalise(s, [{ s: 'preparo', text: TEXTO_DA_AVALIACAO }]), 1);
  assert.equal(etapaDaAutoanalise(s, [{ s: 'preparo', text: TEXTO_DA_AVALIACAO }, { s: 'preparo', text: 'Card lido' }]), 1, 'linha de preparo depois não recua');
  assert.equal(etapaDaAutoanalise(s, [{ s: 'leitura' }, { s: 'raciocinio' }]), 2, 'comentário no meio da leitura não adianta');
  assert.equal(etapaDaAutoanalise({ ...s, lidos: 2 }, [{ s: 'raciocinio' }]), 3, 'leu tudo e raciocina: verificação');
  assert.equal(etapaDaAutoanalise(s, [{ s: 'verificacao' }, { s: 'leitura' }]), 3);
  assert.equal(etapaDaAutoanalise({ fase: 'fechando' }, []), 4);
});

test('a barra só anda de verdade na leitura', () => {
  const lendo = andamentoDaAutoanalise({ sess: sessao({ totalArquivos: 23, lidos: 8, ultimoSinalEm: AGORA }), itens: [{ s: 'leitura', k: 'tool', text: 'Lendo a.ts' }], agora: AGORA });
  assert.deepEqual([lendo.barra, lendo.pct, lendo.texto, lendo.apoio, lendo.frase], ['definida', 34, 'Lendo a.ts', '8 de 23 arquivos', 'Lendo 8 de 23']);
  const preparo = andamentoDaAutoanalise({ sess: sessao(), itens: [{ s: 'preparo', text: 'Buscando o código do PR.' }], agora: AGORA });
  assert.equal(preparo.barra, 'indefinida');
  assert.equal(preparo.texto, 'Buscando o código do PR.');
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
  const m = andamentoDaAutoanalise({ sess: sessao(), itens: [{ s: 'preparo', text: TEXTO_DA_AVALIACAO }], agora: AGORA });
  const html = faixaDaAutoanaliseHtml(m, { key: 'o/r#1', url: 'u', agora: AGORA });
  for (const nome of ETAPAS_DA_AUTOANALISE) assert.ok(html.includes(nome), nome);
  assert.match(html, /aa-et feita[^]*Código/);
  assert.match(html, /aa-et agora" aria-current="step"[^]*Avaliação técnica/);
  assert.match(html, /aa-cancelar" data-key="o\/r#1"/);
  assert.ok(html.includes(`data-aa-desde="${AGORA - 48_000}">48 s`));
  const falha = faixaDaAutoanaliseHtml(andamentoDaAutoanalise({ falha: '<b>x</b>' }), { key: 'k', url: 'http://u' });
  assert.match(falha, /act-self" data-url="http:\/\/u">Tentar de novo/);
  assert.ok(falha.includes('&lt;b&gt;x'));
  assert.doesNotMatch(faixaDaAutoanaliseHtml(andamentoDaAutoanalise({ iniciandoDesde: AGORA }), { key: 'k' }), /aa-cancelar/, 'ainda não há o que cancelar');
  const cancelando = faixaDaAutoanaliseHtml({ ...m, cancelando: true }, { key: 'k' });
  assert.match(cancelando, /disabled>Cancelando…/);
});

test('a linha da Compacta traz a frase, o tempo, a ação e o fio', () => {
  const m = andamentoDaAutoanalise({ sess: sessao({ totalArquivos: 4, lidos: 1, ultimoSinalEm: AGORA }), itens: [{ s: 'leitura' }], agora: AGORA });
  const l = linhaDaAutoanalise(m, { key: 'k', agora: AGORA });
  assert.deepEqual(l.estado, { tom: 'run', texto: 'Lendo 1 de 4' });
  assert.match(l.meio, /data-aa-tempo/);
  assert.match(l.acoes, /aa-cancelar/);
  assert.match(l.rodape, /width:25%/);
});
