// Regressão sintética: prosa com {{N}} antes de um único envelope JSON cercado.
// Exercita o parser real sem sessão, credencial, transcript de cliente ou postagem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvelope, parseHeadlessResult } from '../lib/engine/session.js';

const engine = { parseEnvelope: raw => parseEnvelope(null, raw) };
const parse = raw => parseHeadlessResult(engine, raw);
const REVIEW = {
  decision: 'needs_decision',
  verdict: 'comment',
  analysisStatus: 'complete',
  reportMarkdown: 'O texto contém {{N}}, uma chave } e uma citação "entre aspas".',
  payloads: { comment: { event: 'COMMENT', body: 'Verifique o tratamento da entrada.' } },
};
const json = data => JSON.stringify(data, null, 2);
const fence = text => '```json\n' + text + '\n```';

test('parseHeadlessResult: JSON bruto e envelope do CLI preservam os dados', () => {
  assert.deepEqual(parse(json(REVIEW)), REVIEW);
  assert.deepEqual(parse(JSON.stringify({ type: 'result', is_error: false, result: json(REVIEW) })), REVIEW);
});

test('parseHeadlessResult: prosa com {{N}} antes do JSON não corrompe a revisão válida', () => {
  const text = 'O template usa {{N}} para representar a quantidade.\n\n' + fence(json(REVIEW)) + '\nTexto final com {outra referência}.';
  assert.deepEqual(parse(text), REVIEW);
});

test('parseHeadlessResult: chaves e escapes dentro de strings JSON são preservados', () => {
  const review = { ...REVIEW, reportMarkdown: 'Exemplo: {"valor":"\\}\\\\"}; template {{N}}.\n```json\n{"exemplo":true}\n```' };
  assert.deepEqual(parse(fence(json(review))), review);
  assert.deepEqual(parse(json(review)), review);
});

test('parseHeadlessResult: aceita fence JSON com CRLF e indentação', () => {
  const text = 'Prosa {{N}}\r\n  ```JSON  \r\n' + json(REVIEW).replaceAll('\n', '\r\n') + '\r\n  ```  \r\n';
  assert.deepEqual(parse(text), REVIEW);
});

test('parseHeadlessResult: dois blocos JSON são ambíguos, mesmo se iguais', () => {
  assert.throws(() => parse(fence(json(REVIEW)) + '\n' + fence(json(REVIEW))), /ambíguo|múltiplos/i);
});

test('parseHeadlessResult: dois objetos brutos não selecionam uma decisão', () => {
  assert.throws(() => parse(json(REVIEW) + '\n' + json({ ...REVIEW, decision: 'auto_approve' })), SyntaxError);
});

test('parseHeadlessResult: JSON explícito malformado não é reparado por recorte de chaves', () => {
  assert.throws(() => parse(fence('prefixo inválido\n' + json(REVIEW))), SyntaxError);
  assert.throws(() => parse(fence(json(REVIEW) + '\ntexto inválido')), SyntaxError);
});

test('parseHeadlessResult: fence JSON não encerrada falha mesmo com objeto completo', () => {
  assert.throws(() => parse('```json\n' + json(REVIEW)), /não encerrado/i);
});

test('parseHeadlessResult: JSON explícito inválido não cai no objeto válido da prosa', () => {
  assert.throws(() => parse(fence('não é JSON') + '\n' + json(REVIEW)), SyntaxError);
});

test('parseHeadlessResult: contrato e analysisStatus seguem obrigatórios no bloco JSON', () => {
  for (const field of ['decision', 'payloads', 'reportMarkdown']) {
    const review = { ...REVIEW };
    delete review[field];
    assert.throws(() => parse(fence(json(review))), /fora do contrato/i);
  }
  for (const analysisStatus of [undefined, null, 'partial']) {
    assert.throws(() => parse(fence(json({ ...REVIEW, analysisStatus }))), /analysisStatus/i);
  }
  assert.equal(parse(fence(json({ ...REVIEW, analysisStatus: 'incomplete' }))).analysisStatus, 'incomplete');
});

test('parseHeadlessResult: prosa simples sem fence mantém compatibilidade', () => {
  assert.deepEqual(parse('Resultado:\n' + json(REVIEW) + '\nFim.'), REVIEW);
});

test('parseHeadlessResult: erro do envelope CLI continua sendo erro de sessão', () => {
  assert.throws(() => parse(JSON.stringify({ type: 'result', is_error: true, result: fence(json(REVIEW)) })), /sessão retornou erro/i);
});

test('parseHeadlessResult: somente resultado sem objeto recebe FAROL_RESULT_MISSING', () => {
  for (const text of ['', 'A análise terminou, mas o resultado estruturado não veio.']) {
    assert.throws(() => parse(text), err => err.code === 'FAROL_RESULT_MISSING' && /não devolveu JSON/i.test(err.message));
  }
  for (const text of [fence('inválido'), fence('{}'), fence(json({ ...REVIEW, analysisStatus: 'partial' })), fence(json(REVIEW)) + '\n' + fence(json(REVIEW))]) {
    assert.throws(() => parse(text), err => err.code !== 'FAROL_RESULT_MISSING');
  }
});

test('parseHeadlessResult: erro de sintaxe não inclui trecho do conteúdo recebido', () => {
  assert.throws(() => parse(fence('{"segredo":"sentinela-sintetica", inválido}')), err =>
    err instanceof SyntaxError && err.message === 'JSON da sessão inválido');
});

test('parseHeadlessResult: objeto iniciado e truncado é JSON inválido, não resposta ausente', () => {
  assert.throws(() => parse('{"decision":'), err =>
    err instanceof SyntaxError && err.code !== 'FAROL_RESULT_MISSING' && err.message === 'JSON da sessão inválido');
});

/* ---------- envelope incompleto por falha de infra não vira veredito ---------- */

// 11/09/2026, Edicoes-CNBB/biblioteca-cnbb-ai-engine#13: os quatro lotes morreram na
// largada com "OAuth session expired and could not be refreshed" e a sessão devolveu
// um envelope VÁLIDO com analysisStatus incomplete e payloads vazios. Como não houve
// exceção, toda a máquina de retry/estacionamento (retryAfterNet, classify) ficou de
// fora e o Farol gravou a falha de credencial como se fosse veredito: card mudo de
// "precisa de você" com 24 pendências que ninguém leu. Envelope sem NENHUM conteúdo,
// incompleto e com falha de credencial/infra na prosa é falha, não revisão.
const INFRA = {
  decision: 'needs_decision',
  verdict: 'request_changes',
  analysisStatus: 'incomplete',
  reportMarkdown: 'Os quatro lotes obrigatórios foram disparados em paralelo no modo headless, mas todos encerraram antes de analisar arquivos por falha de autenticação da sessão do `pr-reviewer` (`OAuth session expired and could not be refreshed`).',
  payloads: {
    approve: { event: 'APPROVE', body: '', comments: [] },
    request_changes: { event: 'REQUEST_CHANGES', body: '', comments: [] },
    comment: { event: 'COMMENT', body: '', comments: [] },
  },
};

test('parseHeadlessResult: envelope vazio e incompleto com falha de credencial vira erro de sessão', () => {
  assert.throws(() => parse(json(INFRA)), /OAuth session expired/);
});

test('parseHeadlessResult: incompleto COM conteúdo continua sendo revisão', () => {
  // parcial legítima: a sessão não cobriu tudo, mas escreveu achado. Não é infra.
  const parcial = {
    ...INFRA,
    payloads: { ...INFRA.payloads, request_changes: { event: 'REQUEST_CHANGES', body: 'Faltou tratar o retorno nulo em app/main.py.', comments: [] } },
  };
  assert.deepEqual(parse(json(parcial)), parcial);
});

test('parseHeadlessResult: incompleto e vazio sem falha de infra continua sendo revisão', () => {
  // sessão que só não terminou: sem assinatura de credencial/rede na prosa, o gate
  // de envelope incompleto do review.js segue sendo quem decide, como antes.
  const mudo = { ...INFRA, reportMarkdown: 'Não consegui concluir a leitura do diff dentro do orçamento de contexto.' };
  assert.deepEqual(parse(json(mudo)), mudo);
});
