import test from 'node:test';
import assert from 'node:assert/strict';
import { criarAgendaVisual, telaVisivel } from '../ui/telas/pintura.js';
import { gruposDaPintura } from '../ui/telas/pintura-estado.js';
import { criarCacheMarkdown } from '../ui/telas/markdown.js';
import { criarPreservacaoDeFormulario } from '../ui/telas/formularios.js';
import { limitarAtividadeVisual, registrarAtividadeVisual, fluxoDaAtividade, LIMITE_ATIVIDADE_VISUAL } from '../ui/telas/atividade-visual.js';
import { stageFlowFrom } from '../ui/pure/sessao.js';

function pagina() {
  const doc = { hidden: false, activeElement: null, body: { dataset: { tab: 'radar', radarSub: 'mim' } },
    querySelector: () => ({ classList: { contains: () => false } }) };
  globalThis.document = doc;
  const contagem = {}, frames = [];
  const pintar = new Proxy({}, { get: (_target, id) => () => { contagem[id] = (contagem[id] || 0) + 1; } });
  const agenda = criarAgendaVisual({ grupos: gruposDaPintura(pintar), oculta: () => doc.hidden, agendar: fn => frames.push(fn) });
  const flush = () => { while (frames.length) frames.shift()(); };
  return { doc, contagem, frames, agenda, flush };
}

test('mudanças de execução atualizam decisões e histórico sem esperar outro snapshot', () => {
  for (const campo of ['activeSessions', 'headlessWaiting', 'headlessWaitingContas']) {
    const { agenda, flush, contagem } = pagina();
    agenda.invalidar([campo]); flush();
    assert.equal(contagem.decisoes, 1, `${campo} deve atualizar os cards de execução`);
    agenda.invalidar([campo]); flush();
    assert.equal(contagem.decisoes, 2, `${campo} também deve refletir o fim da execução`);
  }
});

test('rajada de consumo pinta a fila dependente uma vez, sem reconstruir relatório ou configurações', () => {
  const { agenda, flush, frames, contagem } = pagina();
  for (let i = 0; i < 100; i++) agenda.invalidar(['usage']);
  assert.equal(frames.length, 1);
  flush();
  assert.equal(contagem.fila, 1);
  assert.equal(contagem.decisoes, undefined);
  assert.equal(contagem.configuracoes, undefined);
  assert.equal(contagem.consumo, undefined);
  assert.ok(agenda.pendentes().includes('consumo'));
});

test('aba oculta não pinta e consome a invalidação ao abrir com o estado atual', () => {
  const { agenda, doc, flush, contagem } = pagina();
  agenda.invalidar(['config']); flush();
  assert.equal(contagem.configuracoes, undefined);
  doc.body.dataset.tab = 'sistema';
  agenda.pintar();
  assert.equal(contagem.configuracoes, 1);
  agenda.pintar();
  assert.equal(contagem.configuracoes, 1);
});

test('janela oculta recebe invalidações sem agenda visual e recompõe ao retornar', () => {
  const { agenda, doc, flush, frames, contagem } = pagina();
  doc.hidden = true;
  agenda.invalidar(['status', 'activeSessions', 'activity']);
  assert.equal(frames.length, 0);
  agenda.pintar();
  assert.deepEqual(contagem, {});
  doc.hidden = false;
  agenda.pedirPintura(); flush();
  assert.equal(contagem.status, 1);
  assert.equal(contagem.sessoes, 1);
  assert.equal(contagem.relogio, 1);
});

test('foco num formulário adia a pintura e mantém a invalidação para o fim da edição', () => {
  const { agenda, doc, flush, contagem } = pagina();
  doc.body.dataset.tab = 'sistema'; doc.activeElement = { tagName: 'TEXTAREA' };
  agenda.invalidar(['config']); flush();
  assert.equal(contagem.configuracoes, undefined);
  doc.activeElement = null; agenda.pintar();
  assert.equal(contagem.configuracoes, 1);
});

test('seleção de texto no relatório preserva o DOM e a atualização reaparece ao terminar a seleção', () => {
  const { agenda, doc, flush, contagem } = pagina();
  let selecionado = true;
  doc.getSelection = () => ({ isCollapsed: !selecionado, anchorNode: {} });
  doc.querySelector = () => ({ contains: () => true, classList: { contains: () => false } });
  agenda.invalidar(['decisions']); flush();
  assert.equal(contagem.decisoes, undefined);
  selecionado = false; agenda.pintar();
  assert.equal(contagem.decisoes, 1);
});

test('visibilidade do espelho segue a navegação da aba e subaba, mesmo com hidden=false', () => {
  const { doc } = pagina();
  doc.body.dataset.radarSub = 'apar';
  assert.equal(telaVisivel('radar', 'apar'), true);
  doc.body.dataset.tab = 'sistema';
  assert.equal(telaVisivel('radar', 'apar'), false);
  doc.body.dataset.tab = 'radar'; doc.body.dataset.radarSub = 'mim';
  assert.equal(telaVisivel('radar', 'apar'), false);
  doc.body.dataset.radarSub = 'apar'; doc.hidden = true;
  assert.equal(telaVisivel('radar', 'apar'), false);
});

test('cache de Markdown evita conversão repetida, invalida por conteúdo e respeita o orçamento', () => {
  let conversoes = 0;
  const converter = texto => { conversoes++; return `<p>${texto}</p>`; };
  const cache = criarCacheMarkdown(converter, 2, 100);
  assert.equal(cache('um'), cache('um'));
  assert.equal(conversoes, 1);
  cache('dois'); cache('tres'); cache('um');
  assert.equal(conversoes, 4, 'entrada mais antiga sai do cache');
  cache('x'.repeat(200)); cache('x'.repeat(200));
  assert.equal(conversoes, 6, 'documento acima do orçamento não fica retido');
});

test('snapshot extenso mantém só a cauda visual e preserva os tempos observados das etapas', () => {
  const itens = Array.from({ length: 1000 }, (_, i) => ({ t: 1000 + i * 10, s: i < 400 ? 'leitura' : 'verificacao', text: `linha ${i}` }));
  const fonte = { sessao: itens };
  const atividade = limitarAtividadeVisual(fonte, [{ id: 'sessao', startedAt: 1000 }]);
  assert.equal(atividade.sessao.length, LIMITE_ATIVIDADE_VISUAL);
  assert.equal(fonte.sessao.length, 1000, 'não modifica a fonte recebida');
  assert.deepEqual(fluxoDaAtividade('sessao', atividade.sessao, 1000, 12000), stageFlowFrom(itens, 1000, 12000));
});

test('eventos entre snapshots também são limitados e não perdem o resumo temporal', () => {
  const atividade = limitarAtividadeVisual({ rajada: [] }, [{ id: 'rajada', startedAt: 1000 }]);
  const itens = Array.from({ length: 1600 }, (_, i) => ({ t: 1000 + i * 10, s: i < 800 ? 'leitura' : 'raciocinio' }));
  for (const item of itens) registrarAtividadeVisual(atividade, 'rajada', item, 1000);
  assert.equal(atividade.rajada.length, LIMITE_ATIVIDADE_VISUAL);
  assert.deepEqual(fluxoDaAtividade('rajada', atividade.rajada, 1000, 18000), stageFlowFrom(itens, 1000, 18000));
});

test('rascunho sobrevive à substituição do campo e a confirmação libera nova projeção', () => {
  let campo = { id: 'intervalo', tagName: 'INPUT', type: 'number', value: '300', checked: false };
  const raiz = { querySelectorAll: () => [campo] };
  const preservar = criarPreservacaoDeFormulario();
  const pintar = valor => () => { campo = { ...campo, value: valor }; };
  preservar(raiz, pintar('300'));
  campo.value = '600';
  preservar(raiz, pintar('300'));
  assert.equal(campo.value, '600');
  preservar(raiz, pintar('600'));
  preservar(raiz, pintar('900'));
  assert.equal(campo.value, '900', 'valor confirmado deixa de ser rascunho');
});

test('arquivo selecionado mantém o controle e FileList originais sem atribuir value não-vazio', () => {
  let campo, atribuicoes = 0;
  const arquivo = { name: 'preferencias-fixture.json' };
  function controle() {
    const el = { id: 'arquivo', tagName: 'INPUT', type: 'file', files: [], checked: false,
      replaceWith: original => { campo = original; } };
    Object.defineProperty(el, 'value', {
      get: () => el.files.length ? 'C:\\fakepath\\preferencias-fixture.json' : '',
      set: value => { atribuicoes++; if (value) throw new DOMException('File input value cannot be assigned', 'InvalidStateError'); el.files = []; },
    });
    return el;
  }
  campo = controle();
  const raiz = { querySelectorAll: () => [campo] };
  const preservar = criarPreservacaoDeFormulario();
  preservar(raiz, () => {});
  campo.files = [arquivo]; const original = campo, files = campo.files;
  assert.doesNotThrow(() => preservar(raiz, () => {}));
  assert.doesNotThrow(() => preservar(raiz, () => { campo = controle(); }));
  assert.equal(campo, original, 'não reconstrói o controle que possui o arquivo escolhido');
  assert.equal(campo.files, files);
  assert.equal(campo.files[0], arquivo);
  assert.equal(atribuicoes, 0, 'nem atribuição vazia que limparia a seleção');
});
