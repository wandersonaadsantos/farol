// A URL reflete a tela (18/10/2026): a tradução endereço <-> rota de ui/pure/rota.js. Desde
// 20/10/2026 a rota mora no caminho (`/radar/pra-mim`), e o link antigo com `#/` é convertido.
//
// Pedido do dono: "As URLs não refletem exatamente o que vejo em tela". O que se prova aqui
// é a parte pura: ler um endereço qualquer nunca lança e cai no padrão no que não reconhece,
// escrever e ler de volta dá a mesma rota, nada fora de formato fechado entra no endereço, e
// a decisão de empilhar ou substituir no histórico. A fiação com a tela mora em
// ui/telas/rota.js e foi verificada no navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lerRota, escreverRota, mudancaDeRota } from '../ui/pure.js';

const PADRAO = {
  aba: 'radar', sub: 'mim', aparelho: '', secao: '', conta: '', pr: '',
  dias: null, agrupar: '', org: '', busca: '', repo: '', pessoa: '',
};

test('endereço vazio não é rota: a tela fica como está', () => {
  for (const h of ['', '#', '#/', '/', '//', '   ', null, undefined]) assert.equal(lerRota(h), null, String(h));
});

test('endereço desconhecido ou quebrado cai no padrão sem lançar', () => {
  for (const h of ['/nada', '/%E0%A4%A', '/radar/zzz', '?pr=lixo', '/../../etc', '/radar/%', '/sistema/%ZZ']) {
    const r = lerRota(h);
    assert.ok(r, h);
    assert.equal(r.aba, h.startsWith('/sistema') ? 'sistema' : 'radar', h);
  }
  assert.deepEqual(lerRota('/nada'), PADRAO);
  assert.deepEqual(lerRota('/sistema/inexistente'), { ...PADRAO, aba: 'sistema', sub: '', secao: 'overview' });
});

test('as seis abas e as sub-abas do Radar', () => {
  for (const aba of ['radar', 'entregas', 'destaques', 'time', 'consumo', 'sistema']) {
    assert.equal(lerRota(`/${aba}`).aba, aba);
  }
  assert.equal(lerRota('/radar/pra-mim').sub, 'mim');
  assert.equal(lerRota('/radar/aparelhos').sub, 'apar');
  assert.equal(lerRota('/radar/meus-prs').sub, 'meus');
  assert.equal(lerRota('/radar/panorama').sub, 'pano');
  // o nome interno também é aceito na leitura, mas a escrita é sempre a do endereço
  assert.equal(lerRota('/radar/pano').sub, 'pano');
  assert.equal(escreverRota(lerRota('/radar/pano')), '/radar/panorama');
  // sem barra inicial e na grafia antiga, com o hash, também
  assert.equal(lerRota('#/radar/meus-prs').sub, 'meus');
  assert.equal(lerRota('radar/meus-prs').sub, 'meus');
});

test('aparelho selecionado só existe em Radar > Aparelhos, e só como id opaco', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(lerRota(`/radar/aparelhos/${id}`).aparelho, id);
  assert.equal(escreverRota({ aba: 'radar', sub: 'apar', aparelho: id }), `/radar/aparelhos/${id}`);
  assert.equal(lerRota(`/radar/panorama/${id}`).aparelho, '');
  assert.equal(lerRota('/radar/aparelhos/<script>').aparelho, '');
  assert.equal(lerRota('/radar/aparelhos/a%2Fb').aparelho, '');
  assert.equal(escreverRota({ aba: 'radar', sub: 'meus', aparelho: id }), '/radar/meus-prs');
});

test('as treze seções do Sistema, com nome em português no endereço', () => {
  const mapa = {
    'visao-geral': 'overview', contas: 'accounts', automacao: 'automation', jira: 'jira',
    sincronizacao: 'sync', aparelhos: 'devices', grupos: 'groups', plano: 'plans',
    reviewers: 'reviewers', preferencias: 'prefs', novidades: 'news', diagnostico: 'diag', sobre: 'about',
  };
  for (const [slug, interno] of Object.entries(mapa)) {
    assert.equal(lerRota(`/sistema/${slug}`).secao, interno, slug);
    assert.equal(escreverRota({ aba: 'sistema', secao: interno }), `/sistema/${slug}`);
  }
  assert.equal(escreverRota({ aba: 'sistema' }), '/sistema/visao-geral');
});

test('filtros de Entregas: org, dias, agrupar, busca e o grupo em foco', () => {
  const r = lerRota('/entregas?org=acme&dias=15&agrupar=pessoas&busca=gate%20novo');
  assert.equal(r.aba, 'entregas');
  assert.equal(r.org, 'acme');
  assert.equal(r.dias, 15);
  assert.equal(r.agrupar, 'author');
  assert.equal(r.busca, 'gate novo');
  assert.equal(escreverRota(r), '/entregas?org=acme&dias=15&agrupar=pessoas&busca=gate%20novo');
  assert.equal(lerRota('/entregas?dias=0').dias, 0, 'Hoje é 0 e não pode virar falsy');
  assert.equal(lerRota('/entregas?dias=3').dias, null, 'período fora da lista some');
  assert.equal(lerRota('/entregas?dias=7x').dias, null);
  assert.equal(lerRota('/entregas?agrupar=x').agrupar, '');
  assert.equal(lerRota('/entregas?repo=acme/api').repo, 'acme/api');
  assert.equal(lerRota('/entregas?pessoa=bob').pessoa, 'bob');
  assert.equal(lerRota('/entregas?repo=acme/api&pessoa=bob').pessoa, '', 'um foco só por vez');
  assert.equal(lerRota('/entregas?org=-ruim').org, '');
  // filtro de Entregas fora de Entregas não entra
  assert.equal(lerRota('/radar?dias=7&org=acme').dias, null);
  assert.equal(escreverRota({ aba: 'radar', dias: 7, org: 'acme' }), '/radar/pra-mim');
});

test('busca com cara de credencial não vai para o endereço', () => {
  assert.equal(lerRota('/entregas?busca=ghp_abcdefghijklmnop').busca, '');
  assert.equal(escreverRota({ aba: 'entregas', busca: 'xx github_pat_11ABCDEFGH0123' }), '/entregas');
  assert.equal(escreverRota({ aba: 'entregas', busca: 'sk-ant-api03-zzzzzzzz' }), '/entregas');
  assert.equal(lerRota(`/entregas?busca=${'a'.repeat(500)}`).busca.length, 120, 'busca tem teto');
});

test('conta só nas abas que mostram a barra de contas', () => {
  assert.equal(lerRota('/radar/pra-mim?conta=alice').conta, 'alice');
  assert.equal(lerRota('/time?conta=alice').conta, 'alice');
  assert.equal(lerRota('/destaques?conta=alice').conta, 'alice');
  assert.equal(lerRota('/sistema/contas?conta=alice').conta, '');
  assert.equal(lerRota('/entregas?conta=alice').conta, '');
  assert.equal(lerRota('/radar?conta=all').conta, 'all', 'formato válido; quem aplica trata all como Todas');
  assert.equal(lerRota('/radar?conta=a%20b').conta, '');
  assert.equal(escreverRota({ aba: 'time', conta: 'alice' }), '/time?conta=alice');
  assert.equal(escreverRota({ aba: 'consumo', conta: 'alice' }), '/consumo');
});

test('caixa de revisão aberta: só chave de PR no formato owner/repo#N', () => {
  const r = lerRota('/consumo?pr=acme%2Fapi%2342');
  assert.equal(r.pr, 'acme/api#42');
  assert.equal(escreverRota(r), '/consumo?pr=acme%2Fapi%2342');
  assert.equal(lerRota('/consumo?pr=acme/api').pr, '');
  assert.equal(lerRota('/consumo?pr=https%3A%2F%2Fevil').pr, '');
  assert.equal(lerRota('/consumo?pr=Kudos').pr, '');
  // o # cru corta a consulta no navegador (vira o hash da página); escrito por nós ele sai
  // sempre codificado
  assert.equal(lerRota('/radar/pra-mim?pr=acme/api#42').pr, 'acme/api#42');
  assert.match(escreverRota({ aba: 'radar', pr: 'acme/api#42' }), /pr=acme%2Fapi%2342$/);
});

test('escrever e ler de volta dá a mesma rota (ida e volta)', () => {
  const casos = [
    { aba: 'radar', sub: 'apar', aparelho: 'dev-1', conta: 'alice', pr: 'a/b#1' },
    { aba: 'radar', sub: 'pano' },
    { aba: 'entregas', org: 'acme', dias: 0, agrupar: 'repo', repo: 'acme/web' },
    { aba: 'entregas', dias: 30, agrupar: 'author', pessoa: 'carol', busca: 'ação & reação?' },
    { aba: 'sistema', secao: 'diag', pr: 'x/y#9' },
    { aba: 'consumo' }, { aba: 'time', conta: 'bob' }, { aba: 'destaques' },
  ];
  for (const c of casos) {
    const hash = escreverRota(c);
    assert.equal(escreverRota(lerRota(hash)), hash, hash);
  }
});

test('a tela manda tudo o que lembra; vale só o da aba à mostra', () => {
  // cada tela lembra a sua sub-aba, seção e aparelho mesmo quando não está à mostra
  const tela = { aba: 'sistema', sub: 'meus', secao: 'accounts', aparelho: 'dev-1', conta: 'bob', dias: 7, busca: 'x' };
  assert.equal(escreverRota(tela), '/sistema/contas');
  assert.equal(escreverRota({ ...tela, aba: 'radar' }), '/radar/meus-prs?conta=bob');
  assert.equal(escreverRota({ ...tela, aba: 'radar', sub: 'apar' }), '/radar/aparelhos/dev-1?conta=bob');
  assert.equal(escreverRota({ ...tela, aba: 'entregas' }), '/entregas?dias=7&busca=x');
});

test('escrever é tolerante: lixo vira o padrão', () => {
  assert.equal(escreverRota(null), '/radar/pra-mim');
  assert.equal(escreverRota({}), '/radar/pra-mim');
  assert.equal(escreverRota({ aba: 'hack', sub: 'x', secao: 'y' }), '/radar/pra-mim');
  assert.equal(escreverRota({ aba: 'sistema', secao: 'zzz' }), '/sistema/visao-geral');
});

test('empilhar x substituir no histórico', () => {
  const r = (h) => lerRota(h);
  assert.equal(mudancaDeRota(null, r('/radar')), 'replace', 'primeira escrita substitui');
  assert.equal(mudancaDeRota(r('/radar'), r('/radar/pra-mim')), '', 'mesma tela, nada a fazer');
  assert.equal(mudancaDeRota(r('/radar'), r('/sistema')), 'push', 'troca de aba empilha');
  assert.equal(mudancaDeRota(r('/radar/pra-mim'), r('/radar/meus-prs')), 'push', 'troca de sub-aba empilha');
  assert.equal(mudancaDeRota(r('/radar/aparelhos/a'), r('/radar/aparelhos/b')), 'push', 'troca de aparelho empilha');
  assert.equal(mudancaDeRota(r('/sistema/contas'), r('/sistema/jira')), 'push', 'troca de seção empilha');
  assert.equal(mudancaDeRota(r('/entregas?dias=7'), r('/entregas?dias=30')), 'replace', 'filtro substitui');
  assert.equal(mudancaDeRota(r('/entregas'), r('/entregas?busca=x')), 'replace');
  assert.equal(mudancaDeRota(r('/radar'), r('/radar?conta=alice')), 'replace', 'conta substitui');
  assert.equal(mudancaDeRota(r('/consumo'), r('/consumo?pr=a%2Fb%231')), 'push', 'abrir a caixa empilha');
  assert.equal(mudancaDeRota(r('/consumo?pr=a%2Fb%231'), r('/consumo?pr=a%2Fb%232')), 'push', 'outra caixa empilha');
  assert.equal(mudancaDeRota(r('/consumo?pr=a%2Fb%231'), r('/consumo')), 'fechou-caixa', 'fechar volta a entrada');
  assert.equal(mudancaDeRota(r('/consumo?pr=a%2Fb%231'), r('/sistema')), 'push', 'fechar e trocar de aba empilha');
  assert.equal(mudancaDeRota(r('/radar?conta=x&pr=a%2Fb%231'), r('/radar')), 'replace', 'fechar e mudar filtro substitui');
});

test('nome de consulta fora da lista não chega ao objeto, nem __proto__', async () => {
  const { lerRota } = await import('../ui/pure/rota.js');
  const r = lerRota('/entregas?__proto__=x&constructor=y&dias=7');
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
  assert.equal(({}).x, undefined);
  assert.equal(r.dias, 7);
});

// ---------------------------------------------------------------- caminho x hash antigo (20/10/2026)

test('enderecoDaPagina: a rota vem do caminho e da consulta', async () => {
  const { enderecoDaPagina } = await import('../ui/pure/rota.js');
  assert.deepEqual(enderecoDaPagina({ pathname: '/radar/pra-mim', search: '', hash: '' }), { endereco: '/radar/pra-mim', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/entregas', search: '?dias=7', hash: '' }), { endereco: '/entregas?dias=7', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '', hash: '' }), { endereco: '', antigo: false }, 'a raiz não pede rota');
  assert.deepEqual(enderecoDaPagina({ pathname: '/index.html', search: '', hash: '' }), { endereco: '', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '?pr=a%2Fb%231', hash: '' }), { endereco: '?pr=a%2Fb%231', antigo: false });
  assert.deepEqual(enderecoDaPagina(null), { endereco: '', antigo: false }, 'tolerante');
  assert.equal(lerRota(enderecoDaPagina({ pathname: '/', search: '', hash: '' }).endereco), null);
});

test('enderecoDaPagina: link antigo com a rota no hash é reconhecido, e só na raiz', async () => {
  const { enderecoDaPagina } = await import('../ui/pure/rota.js');
  const antigo = enderecoDaPagina({ pathname: '/', search: '', hash: '#/radar/pra-mim' });
  assert.deepEqual(antigo, { endereco: '/radar/pra-mim', antigo: true });
  // o pedido do dono: https://farol.usealways.com/#/radar/pra-mim vira /radar/pra-mim
  assert.equal(escreverRota(lerRota(antigo.endereco)), '/radar/pra-mim');
  const comConsulta = enderecoDaPagina({ pathname: '/', search: '', hash: '#/consumo?pr=acme%2Fapi%2342' });
  assert.equal(escreverRota(lerRota(comConsulta.endereco)), '/consumo?pr=acme%2Fapi%2342');
  // a grafia mais antiga ainda (sem barra, nome interno da seção)
  assert.equal(escreverRota(lerRota(enderecoDaPagina({ pathname: '/', hash: '#sistema/accounts' }).endereco)), '/sistema/contas');
  // fora da raiz, ou com consulta, o hash é pedaço do endereço, nunca a rota
  assert.deepEqual(enderecoDaPagina({ pathname: '/consumo', search: '?pr=acme/api', hash: '#42' }), { endereco: '/consumo?pr=acme/api', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '?pr=acme/api', hash: '#42' }), { endereco: '?pr=acme/api', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '', hash: '#' }), { endereco: '', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '', hash: '#/' }), { endereco: '', antigo: false });
});

test('o caminho que escreverRota gera nunca leva hash', () => {
  for (const c of [{ aba: 'radar', pr: 'acme/api#42' }, { aba: 'sistema', secao: 'diag' }, { aba: 'entregas', busca: '#x' }]) {
    const e = escreverRota(c);
    assert.ok(e.startsWith('/'), e);
    assert.ok(!e.includes('#'), e);
  }
});
