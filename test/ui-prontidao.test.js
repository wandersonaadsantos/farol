// A faixa de prontidão na tela (07/11/2026): o registro do motor vira três pílulas, a forma
// curta da Compacta, os pontos do Panorama e o detalhe de cada pílula. O registro de entrada
// sai do interpretador de verdade (lib/engine/prontidao-pr-estado.js), para a tela e o motor
// não divergirem sobre a forma do dado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarProntidao } from '../lib/engine/prontidao-pr-estado.js';
import {
  pilulasDaProntidao, formaCurtaDaProntidao, pontosDaProntidao, resumoDaProntidao, barraDaProntidao, linhasDoDetalhe,
  faixaDaProntidaoHtml, trioCurtoHtml, pontosDaProntidaoHtml, legendaDosPontosHtml, resumoDaProntidaoHtml,
  linhaCompactaHtml, setaDaLinhaHtml, chaveCurta, tomDaProntidao, densidadeValida, fraseDaDecisao, acaoDaDecisaoHtml,
  fraseDaFila, rodapeDasRecentes, resolvidasHoje, resumoPraMimHtml, fraseDaEspera,
} from '../ui/pure.js';

const HEAD = 'abc1234ffff';
const run = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion, startedAt: '2026-11-07T10:00:00Z' });
const verde = n => run(n, 'COMPLETED', 'SUCCESS');
const review = (login, state, oid = HEAD) => ({ author: { login }, state, commit: { oid } });
const REGRA = { legivel: true, temRegraDeReview: true, aprovacoes: 2, codeOwner: false, checks: ['build', 'e2e'] };

function reg(extra = {}, ctx = {}) {
  const { contexts = [verde('build'), verde('e2e')], reviews = [], pedidos = [], ...resto } = extra;
  return interpretarProntidao({
    number: 1, isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED',
    baseRefName: 'develop', headRefOid: HEAD, author: { login: 'autora' }, repository: { nameWithOwner: 'acme/app' },
    reviewRequests: { nodes: pedidos.map(login => ({ requestedReviewer: { __typename: 'User', login } })) },
    latestReviews: { nodes: reviews },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: contexts } } } }] },
    ...resto,
  }, { exigidos: REGRA.checks, regra: REGRA, eu: 'eu', at: 1, ...ctx });
}

test('as três pílulas na ordem Checks, Reviewers, Merge, com o caso do desenho (1 de 2 aprovou)', () => {
  const r = reg({ pedidos: ['gabriel'], reviews: [review('thiago', 'APPROVED')] });
  const [c, rv, m] = pilulasDaProntidao(r);
  assert.deepEqual([c.id, rv.id, m.id], ['checks', 'reviewers', 'merge']);
  assert.deepEqual([c.tom, c.valor, c.curto], ['ok', '2 de 2 verdes', '2/2']);
  assert.deepEqual([rv.tom, rv.valor, rv.curto], ['wait', '1 de 2 aprovou', '1/2']);
  assert.equal(pilulasDaProntidao(reg({ pedidos: ['gabriel'] }))[1].valor, '0 de 2 aprovou');
  assert.deepEqual([m.tom, m.valor, m.curto], ['wait', 'Bloqueado · falta 1 aprovação', 'Falta 1 aprovação']);
  assert.deepEqual(rv.avatares.map(a => [a.login, a.tom]), [['gabriel', 'wait'], ['thiago', 'ok']]);
});

test('forma curta da Compacta e os pontos do Panorama com o texto completo', () => {
  const r = reg({ contexts: [verde('build'), run('e2e', 'COMPLETED', 'FAILURE')], reviews: [review('thiago', 'CHANGES_REQUESTED')] });
  assert.deepEqual(formaCurtaDaProntidao(r), ['e2e falhou', 'Mudança pedida', 'Bloqueado']);
  const p = pontosDaProntidao(r);
  assert.deepEqual(p.tons, ['fail', 'fail', 'fail']);
  assert.equal(p.rotulo, 'Checks obrigatórios: 1 falhando · e2e · Reviewers: Mudança pedida · Merge: Bloqueado · 3 motivos');
});

test('Pra mim: reviewers incluem você ("Gabriel aprovou, falta você")', () => {
  const r = reg({ pedidos: ['eu'], reviews: [review('gabriel', 'APPROVED')] });
  const [, rv, m] = pilulasDaProntidao(r);
  assert.equal(rv.valor, 'gabriel aprovou, falta você');
  assert.equal(m.valor, 'Bloqueado · falta a sua aprovação');
  assert.equal(m.curto, 'Falta a sua');
  const so = reg({ pedidos: ['eu'] }, { regra: { ...REGRA, temRegraDeReview: false }, exigidos: [] });
  assert.equal(pilulasDaProntidao(so)[1].valor, 'Só você marcado');
});

test('estados cinza: nenhum exigido, ninguém marcado, rascunho e repo bloqueado', () => {
  const r = reg({ isDraft: true, mergeStateStatus: 'DRAFT', reviewDecision: null }, { exigidos: [], regra: { ...REGRA, temRegraDeReview: false } });
  assert.deepEqual(formaCurtaDaProntidao(r), ['Nenhum', 'Ninguém', 'Rascunho']);
  assert.deepEqual(pilulasDaProntidao(r).map(p => p.tom), ['none', 'none', 'none']);
  assert.equal(pilulasDaProntidao(reg({ mergeStateStatus: 'CLEAN' }), { repoBloqueado: true })[2].valor, 'Repo bloqueado');
});

test('checks rodando, nunca reportado e merge esperando os checks', () => {
  const rodando = reg({ contexts: [verde('build'), run('e2e', 'IN_PROGRESS', null)], reviews: [review('a', 'APPROVED'), review('b', 'APPROVED')] });
  assert.deepEqual(formaCurtaDaProntidao(rodando), ['1/2 rodando', '2/2', 'Esperando checks']);
  const ausente = reg({ contexts: [verde('build')] });
  assert.equal(pilulasDaProntidao(ausente)[0].valor, '1 não rodou · e2e');
});

test('sem registro: nenhuma pílula, e o HTML mostra o estado neutro, nunca erro', () => {
  assert.deepEqual(pilulasDaProntidao(undefined), []);
  assert.match(faixaDaProntidaoHtml(null), /ainda lendo do GitHub/);
  assert.match(trioCurtoHtml(null), /lendo/);
  assert.match(pontosDaProntidaoHtml(null), /ainda não lidos/);
  assert.equal(linhasDoDetalhe('checks', null), null);
  assert.equal(barraDaProntidao(null), '');
});

test('detalhe: checks exigidos no head, reviewers com menção e o que o merge exige', () => {
  const r = reg({ pedidos: ['gabriel'], reviews: [review('thiago', 'APPROVED', 'velho')] }, { exigidos: ['build', 'e2e', 'acrity/review'] });
  const c = linhasDoDetalhe('checks', r);
  assert.equal(c.titulo, 'Checks obrigatórios da develop · no head abc1234');
  assert.match(c.nota, /acrity\/review/);
  const rv = linhasDoDetalhe('reviewers', r);
  assert.equal(rv.titulo, 'Reviewers · a branch exige 2 aprovações');
  assert.deepEqual(rv.linhas.map(l => l.estado), ['aguardando', 'aprovou commit antigo']);
  const m = linhasDoDetalhe('merge', r);
  assert.ok(m.linhas.some(l => l.nome === 'Aprovações (2 exigidas)' && l.estado === 'falta 2'));
  assert.match(m.nota, /botão Merge continua dependendo da autoanálise/);
  const html = faixaDaProntidaoHtml(r, { key: 'acme/app#1', aberta: 'reviewers' });
  assert.match(html, /class="person-mention"/, 'pessoa no detalhe é menção navegável');
  assert.match(html, /aria-expanded="true"/);
  assert.equal((html.match(/<button type="button" class="pron-pill/g) || []).length, 3);
  assert.equal((html.match(/class="pron-detalhe"/g) || []).length, 1, 'um detalhe por vez');
});

test('proteção clássica: o detalhe diz que a regra da branch não é legível', () => {
  const r = reg({}, { regra: { legivel: true, temRegraDeReview: false, aprovacoes: 0, checks: [] }, exigidos: [] });
  assert.equal(linhasDoDetalhe('reviewers', r).titulo, 'Reviewers · regra da branch não legível');
});

test('resumo do topo e barra pela pílula Merge', () => {
  const pronto = reg({ mergeStateStatus: 'CLEAN' });
  const travado = reg({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  const esperando = reg({});
  assert.deepEqual(resumoDaProntidao([pronto, travado, esperando, null]), { prontos: 1, esperando: 1, travados: 1 });
  assert.match(resumoDaProntidaoHtml({ prontos: 1, esperando: 2, travados: 1 }), /1 pronto pra merge.*2 esperando.*1 travado/);
  assert.equal(resumoDaProntidaoHtml({ prontos: 0, esperando: 0, travados: 0 }), '');
  assert.equal(barraDaProntidao(pronto), 'pron-b-ok');
  assert.equal(barraDaProntidao(travado), 'pron-b-fail');
});

test('pontos e legenda do Panorama: cor nunca é a única leitura', () => {
  const html = pontosDaProntidaoHtml(reg({ mergeStateStatus: 'CLEAN' }));
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Checks obrigatórios: 2 de 2 verdes/);
  assert.match(legendaDosPontosHtml(), /checks obrigatórios.*reviewers.*merge/);
});

test('linha compacta: repo#N, título cortado, seta e o que a seção pede', () => {
  const html = linhaCompactaHtml({ key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', titulo: 'feat: <x>', attrs: 'data-id="d1"', classe: 'decision', refClasse: 'dec-ref', estado: { texto: 'Aprovar', tom: 'wait' } });
  assert.match(html, />app#7</);
  assert.match(html, /feat: &lt;x&gt;/);
  assert.match(html, /data-id="d1"/);
  assert.match(html, /class="pl-ref dec-ref"/);
  assert.match(html, /data-linha="acme\/app#7"/);
  assert.match(setaDaLinhaHtml('k', true), /Recolher/);
  assert.equal(chaveCurta('a/b#1'), 'b#1');
  assert.equal(tomDaProntidao('xyz'), 't-none');
});

test('densidade: Compacta é a padrão e valor estranho volta para ela', () => {
  assert.equal(densidadeValida('expandida'), 'expandida');
  assert.equal(densidadeValida('<script>'), 'compacta');
  assert.equal(densidadeValida(undefined), 'compacta');
});

test('Pra mim na Compacta: frase e ação principal de cada card', () => {
  assert.deepEqual(fraseDaDecisao({ verdict: 'approve' }, { reasons: ['a', 'b'] }), { texto: 'Aprovar com 2 ressalvas', tom: 'wait' });
  assert.deepEqual(fraseDaDecisao({ verdict: 'request_changes' }, { reasons: ['a'] }), { texto: 'Pedir mudanças · 1 motivo', tom: 'fail' });
  assert.equal(fraseDaDecisao({}, { stale: true }).texto, 'Commit novo depois da revisão');
  assert.match(acaoDaDecisaoHtml({ verdict: 'approve' }, {}), /data-action="approve"/);
  assert.match(acaoDaDecisaoHtml({ verdict: 'approve' }, { approveDisabled: true }, true), /disabled/);
  assert.match(acaoDaDecisaoHtml({ verdict: 'x' }, {}), /data-action="request_changes"/);
  assert.match(acaoDaDecisaoHtml({ pr: { url: 'u' } }, { stale: true, reviewBtn: 'primary' }), /act-review/);
  assert.equal(acaoDaDecisaoHtml({}, { stale: true, reviewBtn: 'none' }), '');
  assert.equal(fraseDaFila({}, { posicao: 1 }).texto, '1º na fila');
  assert.equal(fraseDaFila({}, { checksRodando: true }).texto, 'Checks obrigatórios rodando');
  assert.equal(fraseDaFila({}, { parado: true }).tom, 'fail');
  assert.equal(fraseDaFila({}, { manual: true, posicao: 2 }).texto, 'Revisão automática desligada');
  assert.equal(fraseDaEspera(true).tom, 'run');
});

test('Revisões recentes na Compacta vira uma linha "N resolvidas hoje · mostrar"', () => {
  const agora = Date.parse('2026-11-07T15:00:00');
  const resolved = [{ resolvedAt: agora - 1000 }, { resolvedAt: agora - 1000 }, { resolvedAt: agora - 3 * 86400000 }];
  assert.equal(resolvidasHoje(resolved, agora), 2);
  assert.equal(rodapeDasRecentes(2, 3, false), '2 resolvidas hoje · mostrar');
  assert.equal(rodapeDasRecentes(0, 3, false), '3 revisões recentes · mostrar');
  assert.equal(rodapeDasRecentes(2, 3, true), 'Esconder revisões recentes');
});

test('resumo de Pra mim: cada item leva à sua seção, e some quando não há nada', () => {
  const html = resumoPraMimHtml({ analisando: 1, precisam: 2, sozinhos: 1, fila: 2, resolvidas: 2 });
  assert.match(html, /1 analisando/);
  assert.match(html, /2 precisam de você/);
  assert.match(html, /1 se resolve sozinho/);
  assert.match(html, /data-goto="aba:radar:#decisionsWrap"/);
  assert.equal(resumoPraMimHtml({}), '');
});

test('regra da branch não legível: a pílula diz isso, igual ao detalhe', () => {
  const r = reg({}, { exigidos: null, regra: null });
  const [c] = pilulasDaProntidao(r);
  assert.deepEqual([c.tom, c.valor, c.curto], ['none', 'Regra não legível', 'Regra não legível']);
  assert.match(linhasDoDetalhe('checks', r).nota, /Regra da branch não legível/);
  const sem = reg({}, { exigidos: [] });
  assert.equal(pilulasDaProntidao(sem)[0].valor, 'Nenhum exigido');
});
