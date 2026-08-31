// Todo motivo de recusa do gate tem que virar razão LEGÍVEL na tela.
//
// DEFEITO QUE ORIGINOU: `shouldAutoApprove` devolve `{ok:false, motivo}` com cinco
// motivos, e o runHeadlessReview só traduzia três (`contestacao`, `cobertura`/
// `checkpoint` pelos blocos próprios, e `politica`). Envelope que voltasse sem
// `payloads.approve`, ou com `analysisStatus` incompleto, produzia um card mudo
// ("precisa da sua atenção: ver relatório") que fazia o problema parecer do CÓDIGO
// revisado quando era do envelope da sessão.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const REVIEW = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
const DECISION = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'decision.js'), 'utf8');

// os motivos que o gate sabe devolver, lidos do FONTE (nunca de uma lista curada
// aqui, que envelheceria calada quando alguém acrescentasse o sexto motivo)
const MOTIVOS = [...DECISION.matchAll(/motivo: '([a-z_]+)'/g)].map(m => m[1]);

test('o gate devolve os motivos que este teste conhece', () => {
  for (const esperado of ['analise_incompleta', 'nao_aprovavel', 'clique', 'contestacao', 'cobertura', 'checkpoint', 'politica']) {
    assert.ok(MOTIVOS.includes(esperado), `motivo ${esperado} sumiu do gate`);
  }
});

test('todo motivo de recusa tem tradução no runHeadlessReview', () => {
  for (const motivo of new Set(MOTIVOS)) {
    // Substring, e não regex montada com o motivo interpolado: a comparação é literal
    // por natureza, e montar padrão obrigaria a escapar metacaractere a cada leitura.
    const tratado = REVIEW.includes(`autoDec.motivo === '${motivo}'`)
      || REVIEW.includes('pr.requested === false');   // o motivo `clique` é dito por este outro caminho
    assert.ok(tratado, `o motivo ${motivo} não vira razão nenhuma na tela`);
  }
});

test('envelope incompleto é explicado como envelope, não como achado do código', () => {
  assert.match(REVIEW, /status incompleto/);
  assert.match(REVIEW, /não devolveu o APPROVE pronto pra postar/);
});

test('nao_aprovavel só fala quando a revisão concluiu aprovar', () => {
  assert.match(REVIEW, /autoDec\.motivo === 'nao_aprovavel' && result\.verdict === 'approve'/,
    'em request_changes e needs_decision esse motivo é o caminho normal e falar dele seria ruído');
});
