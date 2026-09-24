// O Farol sabe QUE CONTA ele e, e escreve na primeira pessoa (23/09/2026).
//
// Caso medido em biudtech/biud-frontend#1150: o Farol, rodando na conta @Gabrielk5,
// postou um comentario que dizia "@Gabrielk5 ja deixou isso registrado na review de
// aprovacao, com a mesma evidencia". Quem escreveu e quem foi citado sao a MESMA conta:
// o texto fala de si mesmo em terceira pessoa, como se a aprovacao anterior fosse de
// outra pessoa. E a assinatura mais clara possivel de que nao foi uma pessoa que
// escreveu, exatamente o contrario do que o review publicado deve parecer.
//
// Duas camadas, porque prompt e defesa de geracao e nao garantia:
//   1. a sessao passa a receber QUEM ela e (o login que vai postar), na revisao e no chat;
//   2. o gate deterministico de linguagem publica recusa o corpo que menciona a propria
//      conta, do mesmo jeito que ja recusa vocabulario de proveniencia.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-quem-sou-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const prompt = (await import('../lib/engine/review-prompt.js')).default;
const chat = (await import('../lib/engine/chat.js')).default;
const pub = (await import('../lib/engine/public-review.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const LOGIN = 'Gabrielk5';
// o texto REAL postado em biud-frontend#1150
const CORPO_DO_CASO = '@Gabrielk5 já deixou isso registrado na review de aprovação, com a mesma evidência.';

/* ---------- 1) a sessão sabe quem ela é ---------- */

test('o bloco de identidade diz a conta e manda falar na primeira pessoa', () => {
  const b = prompt.identidadeBlock(LOGIN);
  assert.match(b, /@Gabrielk5/, 'a conta que vai postar é nomeada');
  assert.match(b, /primeira pessoa/i);
  assert.match(b, /sã?o (os )?seus|suas?\b/i, 'review e comentário daquela conta são DELE');
  assert.match(b, /terceira pessoa/i, 'e o erro a evitar está nomeado');
});

test('sem conta conhecida o bloco não inventa identidade nenhuma', () => {
  assert.equal(prompt.identidadeBlock(''), '');
  assert.equal(prompt.identidadeBlock(null), '');
});

test('o prompt da revisão carrega a identidade da conta que vai postar', () => {
  const e = new Engine();
  e.accountForPr = () => LOGIN;
  e.personProfileBlock = () => '';
  e.reviewFormatBlock = () => '';
  const p = e.headlessPromptFor('https://github.com/o/r/pull/1', 'outro');
  assert.match(p, /@Gabrielk5/);
  assert.match(p, /primeira pessoa/i);
});

test('o chat também sabe quem ele é (foi de lá que saiu o comentário do caso)', () => {
  const e = new Engine();
  e.accountForPr = () => LOGIN;
  const p = chat.chatPreamble(e, 'o/r#1150', 'https://github.com/o/r/pull/1150', false);
  assert.match(p, /@Gabrielk5/);
  assert.match(p, /primeira pessoa/i);
});

/* ---------- 2) o gate determinístico ---------- */

test('corpo que menciona a PRÓPRIA conta é recusado', () => {
  const issues = pub.publicReviewLanguageIssues({ event: 'COMMENT', body: CORPO_DO_CASO }, LOGIN);
  assert.ok(issues.some(i => i.code === 'self_third_person'), JSON.stringify(issues));
});

test('terceira pessoa sem arroba também conta', () => {
  const issues = pub.publicReviewLanguageIssues(
    { event: 'COMMENT', body: 'Gabrielk5 já apontou isso na aprovação anterior.' }, LOGIN);
  assert.ok(issues.some(i => i.code === 'self_third_person'));
});

test('a arroba na própria conta conta mesmo sem verbo de revisão junto', () => {
  // "cc @Gabrielk5", "marquei @Gabrielk5": ninguém se marca num comentário que está
  // escrevendo. Este caso existe para a regra da arroba ter valor PRÓPRIO: sem ele, ela
  // seria redundante com a de terceira pessoa (que já pega "@X já deixou").
  const issues = pub.publicReviewLanguageIssues(
    { event: 'COMMENT', body: 'Marquei @Gabrielk5 para acompanhar o ajuste.' }, LOGIN);
  assert.ok(issues.some(i => i.code === 'self_third_person'));
});

test('mencionar OUTRA pessoa continua livre', () => {
  const issues = pub.publicReviewLanguageIssues(
    { event: 'COMMENT', body: '@Alexpraxedes já apontou isso na revisão anterior.' }, LOGIN);
  assert.deepEqual(issues, [], 'citar um colega é escrita humana normal');
});

test('a própria conta como literal técnico (código, URL) não é menção', () => {
  const issues = pub.publicReviewLanguageIssues({
    event: 'COMMENT',
    body: 'O job falhou com `run-as: Gabrielk5` e o log está em https://github.com/Gabrielk5/x/runs/1.'
  }, LOGIN);
  assert.deepEqual(issues, [], 'crase e URL já são mascaradas antes da leitura');
});

test('comentário inline também passa pelo gate', () => {
  const issues = pub.publicReviewLanguageIssues({
    event: 'REQUEST_CHANGES', body: 'ok',
    comments: [{ path: 'a.ts', line: 1, side: 'RIGHT', body: CORPO_DO_CASO }]
  }, LOGIN);
  assert.ok(issues.some(i => i.code === 'self_third_person' && i.field === 'comments[0].body'));
});

test('sem saber a conta, o gate não inventa: nada é bloqueado por identidade', () => {
  const issues = pub.publicReviewLanguageIssues({ event: 'COMMENT', body: CORPO_DO_CASO }, '');
  assert.ok(!issues.some(i => i.code === 'self_third_person'),
    'conta desconhecida não pode virar bloqueio de texto legítimo');
});

/* ---------- 3) a fiação: o post de verdade é barrado ---------- */

test('postReview recusa o corpo que fala de si em terceira pessoa, antes de qualquer gh', async () => {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => LOGIN;
  e.tokenFor = () => 'tok';
  e.refreshTokens = async () => { };
  e.token = 'tok';
  let rodou = false;
  const io = (await import('../lib/io.js')).default;
  const original = io.run;
  io.run = async () => { rodou = true; return { ok: true, code: 0, stdout: '{}', stderr: '' }; };
  try {
    const r = await e.postReview({ key: 'o/r#1150', repo: 'o/r', number: 1150 },
      { event: 'COMMENT', body: CORPO_DO_CASO });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, 'internal_language');
    assert.equal(rodou, false, 'nada chega no gh: a trava é anterior à credencial');
  } finally {
    io.run = original;
  }
});
