// Decisão de produto não é do Farol (regra de 20/11/2026, porte do fork em 24/11/2026).
//
// Caso de origem: a decisão de um PR saiu com motivos que não falavam do código, entre eles um
// item "para quem decide o merge" dizendo que aceitar o efeito era decisão de produto e uma
// "pergunta de produto em aberto". O prompt diz à sessão que escolha de produto não é dela, e o
// motor garante que o item PURAMENTE de produto não chegue ao texto público, aos motivos, à
// ressalva nem às provas. A marca é estreita: segurança, correção, defeito e negação ficam.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-produto-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { conferirEnvelope } = await import('../lib/engine/envelope-revisao.js');
const { itensParaQuemMergeia } = await import('../lib/engine/para-quem-mergeia.js');
const { ehPontoDeProduto, semPontosDeProduto } = await import('../lib/engine/ponto-de-produto.js');
const { provasDaDecisao } = await import('../lib/engine/provas-da-decisao.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
const PERGUNTA = 'Pergunta de produto em aberto: o selo deve aparecer para empresa inativa?';
const EFEITO = 'Aceitar esse efeito é uma decisão de produto e segurança.';
const TECNICO = 'A migração apaga a coluna antiga sem cópia: um rollback perde o dado.';

function envelope(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true,
    headSha: head, checksVerifiedHead: head, reasons: [], diffMedido: ['a.md'],
    coverage: { total: 1, reviewed: ['a.md'], missing: [] }, verificationCheckpoint: { total: 0, conflicts: [] },
    payloads: { approve: { event: 'APPROVE', body: 'O cálculo novo está correto e coberto pelos testes.', comments: [] },
      request_changes: { event: 'REQUEST_CHANGES', body: '', comments: [] }, comment: { event: 'COMMENT', body: '', comments: [] } },
    ...extra };
}
const textos = (r) => attentionPoints(null, r).map((p) => (typeof p === 'string' ? p : p.text));

test('item puramente de produto não chega ao texto público, aos motivos, à ressalva nem às provas', () => {
  const ESCOLHA = 'Isso é uma escolha de produto: a tela deveria esconder o selo?';
  const r = conferirEnvelope(envelope({
    reasons: [PERGUNTA, TECNICO],
    paraQuemMergeia: [ESCOLHA, EFEITO, 'O PR liga em produção a criação de conta sem passo humano.'],
    payloads: {
      approve: { event: 'APPROVE', body: 'O cálculo novo está correto.', comments: [] },
      request_changes: { event: 'REQUEST_CHANGES', body: 'Corrija o laço antes do merge.', comments: [
        { path: 'a.js', line: 3, side: 'RIGHT', body: 'Decisão de produto à parte, este laço relê o arquivo a cada item.' }] },
      comment: { event: 'COMMENT', body: '', comments: [] },
    },
  }));
  assert.deepEqual(r.reasons, [TECNICO]);
  // EFEITO fala de segurança: fica, como ponto técnico
  assert.deepEqual(itensParaQuemMergeia(r), [EFEITO, 'O PR liga em produção a criação de conta sem passo humano.']);
  assert.ok(!r.payloads.approve.body.includes(ESCOLHA), 'o item de produto não é anexado ao APPROVE');
  assert.match(r.payloads.approve.body, /criação de conta sem passo humano/, 'o item de segurança continua anexado');
  // comentário de linha ancora achado: nunca sai pelo filtro
  assert.equal(r.payloads.request_changes.comments.length, 1);
  const pontos = textos(r).join(' | ');
  assert.ok(!pontos.includes(ESCOLHA) && !pontos.includes(PERGUNTA), pontos);
  assert.ok(pontos.includes(TECNICO), 'o motivo técnico continua ressalva');
  assert.ok(!provasDaDecisao(r).paraQuemMergeia.includes(ESCOLHA));
});

test('a marca de produto é estreita: segurança, correção, defeito e negação ficam, em qualquer ordem', () => {
  for (const t of [PERGUNTA, 'Questão de produto: manter o filtro?', 'escolhas de produto em aberto', 'Decisão de produto: o selo some depois de 30 dias.']) assert.ok(ehPontoDeProduto(t), t);
  for (const t of [TECNICO, EFEITO, 'Aceitar esse efeito é uma decisão de segurança e produto.',
    'O produto da multiplicação estoura o inteiro de 32 bits.', 'A tela de produto não trata o erro 500.',
    'Isto não é decisão de produto: o filtro descarta registros válidos.', 'Pergunta de produto: o bug do total some com o filtro?']) assert.ok(!ehPontoDeProduto(t), t);
  assert.deepEqual(itensParaQuemMergeia({ paraQuemMergeia: [PERGUNTA] }), []);
  assert.deepEqual(itensParaQuemMergeia({ paraQuemMergeia: [EFEITO] }), [EFEITO]);
  assert.ok(ehPontoDeProduto({ text: PERGUNTA, kind: 'content' }), 'motivo já normalizado também é lido');
});

test('semPontosDeProduto conta o que saiu e tolera envelope sem motivos', () => {
  const r = { reasons: [PERGUNTA, { text: 'Escolha de produto: ordenar por data?', kind: 'content' }, TECNICO] };
  assert.equal(semPontosDeProduto(r), 2);
  assert.deepEqual(r.reasons, [TECNICO]);
  assert.equal(semPontosDeProduto({}), 0);
  assert.equal(semPontosDeProduto(null), 0);
});

test('o prompt diz que decisão de produto não é da revisão e não pede produto no paraQuemMergeia', () => {
  const prompt = fs.readFileSync(new URL('../workspace-template/prompts/pr-review-auto.md', import.meta.url), 'utf8');
  assert.match(prompt, /\*\*Decisão de produto não é sua\.\*\*/);
  assert.match(prompt, /Repositório sem declaração técnica não diminui a revisão/);
  assert.ok(!/segurança, produto, escopo além do card/.test(prompt), 'paraQuemMergeia não pede produto');
});
