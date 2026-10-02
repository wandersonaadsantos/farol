// O que o card da fila diz quando outra pessoa está revisando ou quando a assinatura do
// Claude bateu no limite do plano (02/10/2026). Desenho do Claude Design, handoff em
// docs/superpowers/specs/2026-10-02-revisando-junto-anexos/HANDOFF.md; os estados abaixo
// usam a numeração dele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisosDoCard, othersLineHtml, limitNoteHtml, queueLimitHtml, pwOthersHtml, horaDoReset,
  contasNoLimiteDaFila, queueCardHtml, sessionCardHtml,
} from '../ui/pure.js';

const AGORA = new Date(2026, 9, 2, 16, 12).getTime();
const AS_21 = new Date(2026, 9, 2, 21, 0).getTime();
const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', title: 'Troca o frete', author: 'rafa', updatedAt: new Date(AGORA).toISOString() };
const MARK = { style: '', dot: '', chip: '' };
// o avatar do personMention traz a inicial como fallback da foto: fora do texto lido
const texto = (html) => html.replace(/<span class="avatar[^"]*">.*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('horaDoReset: hoje, amanhã e outro dia, nas duas formas', () => {
  assert.deepEqual(horaDoReset(AS_21, AGORA), { as: 'às 21:00', curta: '21:00' });
  assert.deepEqual(horaDoReset(new Date(2026, 9, 3, 9, 5).getTime(), AGORA), { as: 'amanhã às 09:05', curta: 'amanhã 09:05' });
  assert.deepEqual(horaDoReset(new Date(2026, 9, 4, 21, 0).getTime(), AGORA), { as: 'em 04/10 às 21:00', curta: '04/10 21:00' });
});

/* ---------- a precedência (seção 2 do handoff) ---------- */

test('1 e 8: ninguém revisando e nenhum registro: Revisar, coordenação como sempre', () => {
  assert.deepEqual(avisosDoCard({}, {}), { rotulo: 'Revisar', nota: 'coordenacao', formaLimite: 'longa', forma: '', logins: [] });
});

test('2 e 3: alguém revisando com a chave desligada: fora de cena, sem limite nem coordenação', () => {
  const av = avisosDoCard({ outrosRevisando: ['ana', 'bia'] }, { limiteAtivo: true });
  assert.equal(av.rotulo, 'Revisar junto');
  assert.equal(av.forma, 'fora');
  assert.equal(av.nota, '', 'falam de uma revisão automática que não vai acontecer');
  assert.deepEqual(av.logins, ['ana', 'bia']);
});

test('4, 9e e 12c: chave ligada: revisa junto, e a nota de limite ou coordenação continua', () => {
  assert.deepEqual(
    [avisosDoCard({ outrosRevisando: ['ana'] }, { revisarJunto: true }).forma, avisosDoCard({ outrosRevisando: ['ana'] }, { revisarJunto: true }).nota],
    ['junto', 'coordenacao'],
  );
  const comLimite = avisosDoCard({ outrosRevisando: ['ana'] }, { revisarJunto: true, limiteAtivo: true });
  assert.deepEqual([comLimite.forma, comLimite.nota, comLimite.rotulo], ['junto-curta', 'limite', 'Revisar junto']);
});

test('6: a label sumiu e o registro ficou (a pessoa revisou): fiquei de fora, botão Revisar', () => {
  const av = avisosDoCard({ outrosRevisando: [], foraDeCena: { quem: ['ana'], desde: 1, coAssinado: false } }, {});
  assert.deepEqual([av.forma, av.rotulo], ['terminou', 'Revisar']);
  assert.deepEqual(av.logins, ['ana']);
  assert.equal(avisosDoCard({ foraDeCena: { quem: ['ana'], coAssinado: true } }, {}).forma, '', 'co-assinado não volta ao card');
});

test('9c e 12d: a parada vence tudo; com alguém revisando ela usa a forma curta', () => {
  const av = avisosDoCard({ outrosRevisando: ['ana'] }, { temParada: true, limiteAtivo: true, revisarJunto: true });
  assert.deepEqual([av.nota, av.forma], ['parada', 'curta-parada']);
  assert.equal(avisosDoCard({}, { temParada: true, limiteAtivo: true }).nota, 'parada');
});

test('12a e 12d: limite vence a coordenação; com aviso no topo o card fica com a forma curta', () => {
  assert.equal(avisosDoCard({}, { limiteAtivo: true }).nota, 'limite');
  assert.equal(avisosDoCard({}, { limiteAtivo: true, limiteNoTopo: true }).formaLimite, 'curta');
});

/* ---------- os textos ---------- */

test('linha de pessoas: cada forma com o seu texto, e o login sempre pelo personMention', () => {
  const fora = othersLineHtml(['ana'], 'fora');
  assert.equal(texto(fora), '@ana está revisando este PR. Não reviso sozinho para não duplicar; o botão Revisar junto começa a sua revisão.');
  assert.match(fora, /class="person-mention"[^>]*href="https:\/\/github.com\/ana"/);
  assert.equal(texto(othersLineHtml(['ana', 'bia', 'cris'], 'fora')).split('.')[0], '@ana, @bia e @cris estão revisando este PR');
  assert.equal(texto(othersLineHtml(['ana'], 'curta-parada')), '@ana está revisando este PR. Tentar de novo agora é revisar junto.');
  assert.equal(texto(othersLineHtml(['ana'], 'junto-curta')), '@ana está revisando este PR. Vou revisar junto mesmo assim.');
  assert.equal(texto(othersLineHtml(['ana'], 'sessao')), '@ana também está revisando este PR.');
  assert.equal(texto(othersLineHtml(['ana', 'bia'], 'terminou')), '@ana e @bia revisaram este PR. Fiquei de fora neste commit; a decisão é sua.');
  assert.match(othersLineHtml(['ana'], 'junto'), /data-goto="sys:automation:#sys-row-revisarjunto"[^>]*role="button"[^>]*tabindex="0"/);
  assert.equal(othersLineHtml([], 'fora'), '');
});

test('nota do limite: longa com o rótulo do botão, curta sob o aviso do topo, nada depois do reset', () => {
  assert.equal(texto(limitNoteHtml(AS_21, 'longa', 'Revisar', AGORA)),
    'Revisão automática esperando o limite do plano do Claude: recomeço sozinho às 21:00. O botão Revisar tenta agora, mas pode bater no mesmo limite.');
  assert.equal(texto(limitNoteHtml(AS_21, 'curta', 'Revisar', AGORA)), 'Esperando o limite do plano, até 21:00.');
  assert.match(limitNoteHtml(AS_21, 'longa', 'Revisar', AGORA), /<span title="02\/10\/2026 21:00">/);
  assert.equal(limitNoteHtml(AS_21, 'longa', 'Revisar', AS_21 + 1), '');
  assert.equal(limitNoteHtml(0, 'longa', 'Revisar', AGORA), '');
});

test('aviso no topo: com uma conta não nomeia a conta; com várias nomeia e põe o ponto', () => {
  const uma = queueLimitHtml({ user: 'eu', label: 'BIUD', color: '#f0a' }, AS_21, 3, false, AGORA);
  assert.equal(texto(uma), 'Revisão automática esperando o limite do plano do Claude: recomeço sozinho às 21:00. Vale para 3 PRs desta fila. O botão Revisar de cada um tenta agora, mas pode bater no mesmo limite.');
  assert.doesNotMatch(uma, /acct-dot/);
  const varias = queueLimitHtml({ user: 'eu', label: 'BIUD', color: '#f0a' }, AS_21, 2, true, AGORA);
  assert.match(texto(varias), /^Revisão automática da conta BIUD esperando/);
  assert.match(varias, /acct-dot/);
  assert.match(varias, /role="status"/);
});

test('contasNoLimiteDaFila: 2 ou mais cards da mesma conta, sem contar parado nem fora de cena', () => {
  const fila = [{ key: 'a#1' }, { key: 'a#2' }, { key: 'a#3', outrosRevisando: ['ana'] }, { key: 'a#4' }, { key: 'b#1' }];
  const contaDe = (pr) => pr.key.split('#')[0];
  const limiteDe = (pr) => (contaDe(pr) === 'a' || contaDe(pr) === 'b' ? AS_21 : 0);
  assert.deepEqual(contasNoLimiteDaFila(fila, { contaDe, limiteDe, parked: { 'a#4': {} }, agora: AGORA }), { a: { ate: AS_21, n: 2 } });
  assert.deepEqual(contasNoLimiteDaFila(fila, { contaDe, limiteDe, revisarJunto: true, agora: AGORA }).a.n, 4, 'com a chave ligada quem está fora de cena também espera o limite');
  assert.deepEqual(contasNoLimiteDaFila(fila, { contaDe, limiteDe, agora: AS_21 + 1 }), {}, 'depois do reset ninguém');
});

test('Panorama: primeiro login e quantos mais, com a lista no title', () => {
  assert.equal(texto(pwOthersHtml(['ana'])), '@ana revisando');
  const dois = pwOthersHtml(['ana', 'bia']);
  assert.equal(texto(dois), '@ana e mais 1 revisando');
  assert.match(dois, /title="@ana, @bia estão revisando"/);
  assert.equal(pwOthersHtml([]), '');
});

/* ---------- o card montado ---------- */

test('card da fila, estado 2: Revisar junto, a linha de pessoas, e nenhuma nota de limite', () => {
  const html = queueCardHtml({ ...PR, outrosRevisando: ['ana'] }, { mark: MARK, people: {}, parked: {}, limiteAte: AS_21 + 10 ** 9 });
  assert.match(html, />Revisar junto<\/button>/);
  assert.match(html, /class="pr-others"/);
  assert.doesNotMatch(html, /pr-limit/);
});

test('card da fila, estado 12a: o PR que motivou (16:09, limite até 21:00) diz por que não começou', () => {
  const html = queueCardHtml(PR, { mark: MARK, people: {}, parked: {}, limiteAte: Date.now() + 3600e3 });
  assert.match(html, /class="pr-limit">Revisão automática esperando o limite do plano do Claude/);
  assert.match(html, />Revisar<\/button>/);
});

test('card da fila, estado 9c: a parada leva o rótulo do botão e vem antes da linha de pessoas', () => {
  const html = queueCardHtml({ ...PR, outrosRevisando: ['ana'] }, { mark: MARK, people: {}, parked: { 'o/r#1': { tipo: 'falha', motivo: 'x', at: AGORA } } });
  assert.match(html, /o botão Revisar junto tenta de novo/);
  assert.ok(html.indexOf('pr-parked') < html.indexOf('pr-others'));
  assert.match(texto(html), /Tentar de novo agora é revisar junto\./);
});

test('card de sessão, estado 5: só a linha curta, sem botão novo', () => {
  const html = sessionCardHtml({ id: 's1', label: 'o/r#1' }, '', ['ana']);
  assert.match(texto(html), /@ana também está revisando este PR\./);
  assert.equal(sessionCardHtml({ id: 's1', label: 'o/r#1' }, '').includes('pr-others'), false);
});
