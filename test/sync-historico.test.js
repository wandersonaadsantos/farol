// História de revisões, a parte pura (7.C3): índice pequeno, corpo versionado.
//
// O índice é o que a lista "Revisões recentes" lê de todos os aparelhos: veredito, status,
// ação, contagens e o PR por tag. O corpo é a revisão para abrir, e ele é a projeção que a
// tela já usa, sem o login da conta (a identidade viaja por tag no índice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import historico from '../lib/sync/historico.js';

const K = randomBytes(32);
const D = {
  id: 'd9', createdAt: 1_700_000_000_000, resolvedAt: 1_700_000_050_000, key: 'dono/repo#3',
  verdict: 'approve', status: 'posted', action: 'approve', account: 'conta1',
  reasons: [{ text: 'a', kind: 'gate' }, { text: 'b', kind: 'content' }], attention: ['x'],
  pr: { repo: 'dono/repo', number: 3, url: 'u', title: 'Titulo', author: 'alguem' },
  reportMarkdown: 'RELATORIO INTERNO',
};

test('o índice leva veredito, status, ação, contagens e a tag do PR, e nada mais', () => {
  const i = historico.indiceDe(D, { kId: K });
  assert.deepEqual(Object.keys(i).sort(), ['acao', 'contagens', 'prTag', 'status', 'veredito']);
  assert.equal(i.status, 'posted');
  assert.deepEqual(i.contagens, { motivos: 2, atencao: 1 });
  assert.match(i.prTag, /^[0-9a-f]{32}$/);
  const cru = JSON.stringify(i);
  for (const p of ['dono/repo', 'Titulo', 'conta1', 'RELATORIO']) assert.equal(cru.includes(p), false, p);
});

test('status e ação fora da lista viram vazio', () => {
  const i = historico.indiceDe({ ...D, status: 'hack', action: 'merge' }, { kId: K });
  assert.equal(i.status, '');
  assert.equal(i.acao, '');
});

test('t é o instante da decisão, dt ordena por aparelho com 13 dígitos, e a versão acompanha o status', () => {
  assert.equal(historico.tDe(D), D.createdAt);
  assert.equal(historico.dtDe('dev1', 42), 'dev1|0000000000042');
  assert.equal(historico.versaoDe(D), D.resolvedAt);
  assert.equal(historico.versaoDe({ ...D, resolvedAt: undefined }), D.createdAt, 'pendente versiona pela criação');
});

test('o id da revisão amarra aparelho e decisão', () => {
  const a = historico.reviewIdDe(K, 'dev1', 'd9');
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, historico.reviewIdDe(K, 'dev2', 'd9'));
});

test('o corpo é a projeção da tela, com o review humanizado e sem o login da conta', () => {
  const ui = { ...D, reportMarkdown: 'review humanizado', postRetry: { attempts: 2 } };
  const c = historico.corpoDe(ui);
  assert.equal(c.account, undefined);
  assert.equal(c.postRetry, undefined, 'estado de retry é deste aparelho');
  assert.equal(c.pr.title, 'Titulo', 'a referência do PR na hora vai no corpo');
  assert.equal(c.reportMarkdown, 'review humanizado', 'o review que se abre no outro aparelho');
  assert.equal(JSON.stringify(c).includes('conta1'), false);
});

test('ordenar para a tela: mais recente primeiro, sem duplicar', () => {
  const lista = historico.ordenar([{ reviewId: 'a', t: 1 }, { reviewId: 'b', t: 3 }, { reviewId: 'a', t: 1 }, { reviewId: 'c', t: 2 }]);
  assert.deepEqual(lista.map((x) => x.reviewId), ['b', 'c', 'a']);
});
