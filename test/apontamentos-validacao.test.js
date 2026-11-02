import test from 'node:test';
import assert from 'node:assert/strict';
import { errosDaRecomendacao, conferirProduto } from '../lib/engine/apontamentos-validacao.js';
import { fontesDoCard, fontesDosComentarios } from '../lib/jira/fontes-produto.js';

const caso = (cenario, extra = {}) => ({ cenario, esperado: 'ok', observado: 'ok', prova: 'node --test: passou', resultado: 'passou', ...extra });
const recomendacao = () => ({ descricao: 'Corrigir a seleção da coluna de entrada', estado: 'validada', headSha: 'head-atual',
  casoDefeito: caso('Reenvio encontra arquivo de entrada'), casoPreservado: caso('Arquivo de saída continua disponível') });
const conferir = r => errosDaRecomendacao({ chave: 'reenvio', recomendacao: r }, 'head-atual');
const bruto = { key: 'CARD-1', fields: { description: 'Aceite: manter resumo.', updated: 'agora' } };
const site = { baseUrl: 'https://a.atlassian.net' };
const fontes = { completa: true, itens: [...fontesDoCard(bruto, site), ...fontesDosComentarios([
  { id: '123', body: 'Prefiro remover o resumo.', author: { accountId: 'pessoa' }, updated: 'ontem' },
], bruto, site)] };
const decisao = (extra = {}) => ({ descricao: 'Manter resumo', estado: 'requisito_card', uso: 'fundamenta_veredito', fonteId: 'card', trecho: 'manter resumo.', ...extra });

test('recomendação validada exige correção e preservação no head atual', () => {
  assert.deepEqual(conferir(recomendacao()), []);
  assert.match(conferir({ ...recomendacao(), headSha: 'antigo' }).join(), /head diferente/);
  assert.match(conferir({ ...recomendacao(), casoPreservado: undefined }).join(), /casoPreservado/);
  assert.match(conferir({ ...recomendacao(), casoPreservado: caso('Outra jornada', { observado: 'falhou', resultado: 'falhou' }) }).join(), /sem execução aprovada/);
  assert.match(conferir({ ...recomendacao(), casoPreservado: caso('Outra jornada', { resultado: 'nao_executado' }) }).join(), /sem execução aprovada/);
  assert.deepEqual(conferir({ ...recomendacao(), casoPreservado: caso('Outra jornada', { esperado: 'Arquivo enviado', observado: 'HTTP 200 com arquivo correto' }) }), []);
  assert.match(conferir({ ...recomendacao(), casoPreservado: recomendacao().casoDefeito }).join(), /repete/);
});

test('hipótese é permitida sem inventar testes e sem desqualificar o defeito', () => {
  assert.deepEqual(conferir({ descricao: 'Trocar a coluna após conferir consumidores', estado: 'hipotese' }), []);
  assert.match(conferir({ descricao: 'Trocar', estado: 'testada' }).join(), /estado válido/);
});

test('fonte primária liga trecho e metadados sem atribuir autoridade ao autor', () => {
  const r = conferirProduto([decisao()], fontes);
  assert.deepEqual(r.erros, []);
  assert.equal(r.registros[0].fonte.hash.length, 64);
  assert.equal(r.registros[0].fonte.url, 'https://a.atlassian.net/browse/CARD-1');
  assert.equal(r.registros[0].fonte.autoridade, 'nao_verificada');
});

test('URL alegada e trecho inventado não comprovam decisão', () => {
  assert.ok(conferirProduto([decisao({ fonteId: 'https://outro/browse/CARD-1' })], fontes).erros.length);
  assert.ok(conferirProduto([decisao({ trecho: 'PO aprovou remover tudo' })], fontes).erros.length);
});

test('comentário pode contextualizar mas não prova aprovação de PO nem altera sozinho requisito', () => {
  const d = decisao({ estado: 'registro', fonteId: 'comentario:123', trecho: 'Prefiro remover o resumo.', uso: 'contexto' });
  const r = conferirProduto([d], fontes);
  assert.deepEqual(r.erros, []);
  assert.equal(r.registros[0].fonte.autor, 'pessoa');
  assert.ok(conferirProduto([{ ...d, uso: 'fundamenta_veredito' }], fontes).erros.length);
  assert.ok(conferirProduto([{ ...d, estado: 'requisito_card' }], fontes).erros.length);
});

test('conflito, leitura incompleta e alegação sem prova não sustentam veredito automático', () => {
  for (const estado of ['conflito', 'nao_confirmada']) {
    assert.ok(conferirProduto([decisao({ estado })], fontes).erros.length);
    assert.deepEqual(conferirProduto([decisao({ estado, uso: 'contexto' })], fontes).erros, []);
  }
  assert.ok(conferirProduto([decisao()], { ...fontes, completa: false }).erros.length);
  assert.ok(conferirProduto(undefined, fontes).erros.length);
});
