// Card de commit novo (pendência stale_head, v2.59.3): a tela diz quem está com a bola.
// Até a v2.59.2 o card mandava "Peça uma revisão nova" num caso em que o Farol ia
// revisar sozinho minutos depois, e oferecia Aprovar/Pedir mudanças sobre um texto que
// o GitHub recusaria (payload ancorado no commit anterior).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/Sao_Paulo';
const P = await import('../ui/pure.js');

const H1 = '1c1de29' + 'a'.repeat(33), H2 = 'af74095' + 'b'.repeat(33);
const AS_1947 = new Date('2026-09-09T19:47:00-03:00').getTime();
const stale = (extra = {}) => ({
  key: 'Edicoes-CNBB/biblioteca-cnbb-api#22', verdict: 'approve', blockedKind: 'stale_head', headSha: H1, blockedHead: H2,
  blockedReason: 'o autor empurrou commit novo durante a revisão (1c1de29 -> af74095); este texto fala do código anterior.',
  reasons: [{ text: 'o autor empurrou commit novo durante a revisão, então não posto', kind: 'gate' }, { text: 'Card BD2-55 não verificável', kind: 'content' }],
  ...extra,
});
const semTravessao = (s) => assert.doesNotMatch(s, /[—–]/, 'texto da UI sem travessão');

test('aguardando: o Farol age sozinho, com a hora e o de/para do commit', () => {
  const st = P.reRoundStatus({ estado: 'aguardando', aPartirDe: AS_1947 }, stale());
  assert.equal(st.tom, 'info');
  assert.equal(st.automatico, true);
  assert.match(st.lead, /Reviso de novo sozinho a partir de 19:47/);
  assert.match(st.texto, /1c1de29 para af74095/);
  semTravessao(st.lead + st.texto);
});

test('revisando, espera longa e retry também são automáticos, cada um com a própria frase', () => {
  const rev = P.reRoundStatus({ estado: 'revisando' }, stale());
  assert.equal(rev.icone, 'spin');
  assert.match(rev.lead, /Revisando de novo agora/);
  const longa = P.reRoundStatus({ estado: 'espera_longa', aPartirDe: AS_1947, rodadasPresas: 3 }, stale());
  assert.equal(longa.icone, 'hourglass');
  assert.match(longa.lead, /Próxima tentativa a partir de 19:47/);
  assert.match(longa.texto, /últimas 3 revisões/);
  const retry = P.reRoundStatus({ estado: 'aguardando', motivo: 'retry' }, stale());
  assert.match(retry.lead, /conexão voltar/);
  for (const st of [rev, longa, retry]) { assert.equal(st.automatico, true); semTravessao(st.lead + st.texto); }
});

test('parado: tom de "precisa de você", motivo em português e escapado', () => {
  const st = P.reRoundStatus({ estado: 'parado', motivo: 'auto_desligado', detalhe: 'Alexpraxedes' }, stale());
  assert.equal(st.tom, 'accent');
  assert.equal(st.automatico, false);
  assert.match(st.lead, /Não vou revisar de novo sozinho/);
  assert.match(st.texto, /desligada na conta Alexpraxedes/);
  const html = P.reRoundBoxHtml(P.reRoundStatus({ estado: 'parado', motivo: 'outros_revisando', detalhe: '<b>ana</b>' }, stale()));
  assert.doesNotMatch(html, /<b>ana<\/b>/);
  assert.match(html, /&lt;b&gt;ana/);
  for (const motivo of ['rascunho', 'conta_silenciada', 'sem_token', 'orcamento', 'estacionado', 'saiu_de_cena', 'coordenacao', 'pendencia_viva', 'consciencia', 'ancora', 'desconhecido']) {
    const x = P.reRoundStatus({ estado: 'parado', motivo, detalhe: 'conta' }, stale());
    assert.ok(x.texto.length > 10, motivo);
    semTravessao(x.lead + x.texto);
  }
});

test('staleCardMeta: card de commit novo troca veredito, barra, esconde a regra do app e escolhe o botão', () => {
  const auto = P.staleCardMeta(stale(), { estado: 'aguardando', aPartirDe: AS_1947 });
  assert.equal(auto.stale, true);
  assert.equal(auto.cardClass, 'working');
  assert.match(auto.verdictHtml, /verdict stale/);
  assert.match(auto.verdictHtml, /COMMIT NOVO/);
  assert.deepEqual(auto.reasons.map(r => r.kind), ['content']);
  assert.equal(auto.reviewBtn, 'secondary');
  assert.match(auto.statusHtml, /dec-status info/);
  assert.equal(P.staleCardMeta(stale(), { estado: 'revisando' }).reviewBtn, 'none');
  const parado = P.staleCardMeta(stale(), { estado: 'parado', motivo: 'rascunho' });
  assert.equal(parado.cardClass, 'urgent');
  assert.equal(parado.reviewBtn, 'primary');
});

test('staleCardMeta: sem projeção do engine (snapshot antigo) cai no aviso de sempre, e card comum não muda', () => {
  const velho = P.staleCardMeta(stale(), undefined);
  assert.equal(velho.reviewBtn, 'primary');
  assert.match(velho.statusHtml, /dec-blocked/);
  const comum = P.staleCardMeta({ verdict: 'request_changes', reasons: [{ text: 'x', kind: 'gate' }] }, undefined);
  assert.equal(comum.stale, false);
  assert.equal(comum.cardClass, 'blocked');
  assert.equal(comum.reasons.length, 1);
  assert.equal(comum.statusHtml, '');
});
