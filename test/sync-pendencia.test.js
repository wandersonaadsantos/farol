// Pendência e visto, a parte pura (7.C3, decisão D3).
//
// O que sobe de uma pendência é o que a tela do outro aparelho precisa para mostrar "Precisa
// de você" e dizer por quê: PR e conta por tag, veredito, motivos já projetados para a tela
// e o bloqueio. Nada do relatório interno, nada do corpo do review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pendencia from '../lib/sync/pendencia.js';

const K = randomBytes(32);
const ITEM = {
  id: 'd17', createdAt: 1_800_000_000_000, key: 'dono/repo#12', verdict: 'approve',
  pr: { repo: 'dono/repo', number: 12, title: 'Titulo secreto', author: 'alguem', account: 'conta1' },
  reasons: [{ text: 'aprovável com ressalvas', kind: 'gate' }, { text: 'x'.repeat(900), kind: 'inventado' }],
  reportMarkdown: 'RELATORIO INTERNO', reviewMarkdown: 'CORPO DO REVIEW', blockedKind: 'stale_head', blockedHead: 'abc123',
};

// `acoes` e `reviewId` entraram com a decisão remota (Task 8): o review viaja no corpo do
// histórico, e a pendência só aponta para ele
test('a projeção leva tags, veredito, motivos, bloqueio, ações e o id do corpo, e nada mais', () => {
  const p = pendencia.projetarPendencia(ITEM, { kId: K });
  assert.deepEqual(Object.keys(p).sort(), ['acctTag', 'acoes', 'bloqueio', 'motivos', 'motivosOmitidos', 'prTag', 'reviewId', 'veredito']);
  assert.equal(p.motivosOmitidos, 0, 'nada caiu');
  assert.deepEqual(p.acoes, ['skip'], 'sem payload, só pular');
  assert.match(p.prTag, /^[0-9a-f]{32}$/);
  assert.match(p.acctTag, /^[0-9a-f]{32}$/);
  assert.equal(p.veredito, 'approve');
  assert.equal(p.bloqueio, 'stale_head');
  assert.equal(p.motivos[0].kind, 'gate');
  assert.equal(p.motivos[1].kind, 'content', 'kind desconhecido vira conteúdo');
  assert.ok(p.motivos[1].text.length <= pendencia.MAX_MOTIVO);
});

test('relatório interno, corpo do review, título, repo e login não sobem', () => {
  const cru = JSON.stringify(pendencia.projetarPendencia(ITEM, { kId: K }));
  for (const p of ['RELATORIO', 'CORPO DO REVIEW', 'Titulo', 'dono/repo', 'alguem', 'conta1', 'abc123']) {
    assert.equal(cru.includes(p), false, p);
  }
});

test('veredito e bloqueio fora da lista viram vazio', () => {
  const p = pendencia.projetarPendencia({ ...ITEM, verdict: '<script>', blockedKind: 'qualquer' }, { kId: K });
  assert.equal(p.veredito, '');
  assert.equal(p.bloqueio, '');
});

test('muitos motivos são cortados, e o id do item amarra aparelho e decisão', () => {
  const muitos = { ...ITEM, reasons: Array.from({ length: 30 }, (_, i) => ({ text: `m${i}`, kind: 'gate' })) };
  assert.ok(pendencia.projetarPendencia(muitos, { kId: K }).motivos.length <= pendencia.MAX_MOTIVOS);
  const a = pendencia.itemIdDe(K, 'dev1', 'd17');
  assert.equal(a, pendencia.itemIdDe(K, 'dev1', 'd17'));
  assert.notEqual(a, pendencia.itemIdDe(K, 'dev2', 'd17'));
  assert.match(a, /^[0-9a-f]{32}$/);
});

// Revisão final (28/09/2026): o admin aprova com base nesta lista, então o que o orçamento
// corta é CONTADO, e a tela diz que há mais no review completo.
test('motivos que não cabem são contados em motivosOmitidos, nunca somem em silêncio', () => {
  const muitos = { ...ITEM, reasons: Array.from({ length: 30 }, (_, i) => ({ text: `m${i}`, kind: 'gate' })) };
  const p = pendencia.projetarPendencia(muitos, { kId: K });
  assert.equal(p.motivos.length + p.motivosOmitidos, 30);
  assert.equal(p.motivosOmitidos, 30 - pendencia.MAX_MOTIVOS);
  const pesados = { ...ITEM, reasons: Array.from({ length: 10 }, () => ({ text: '"'.repeat(300), kind: 'content' })) };
  const q = pendencia.projetarPendencia(pesados, { kId: K });
  assert.ok(q.motivosOmitidos > 0, 'aspas pesam o dobro no JSON, e o orçamento conta isso');
  assert.equal(q.motivos.length + q.motivosOmitidos, 10);
});

test('o orçamento mede o JSON escapado dos motivos, não os bytes crus', () => {
  for (const ch of ['"', '\\', '\u0001', 'ç', 'x']) {
    const reasons = Array.from({ length: 10 }, () => ({ text: ch.repeat(300), kind: 'content' }));
    const p = pendencia.projetarPendencia({ ...ITEM, reasons }, { kId: K });
    const escapado = p.motivos.reduce((n, m) => n + Buffer.byteLength(JSON.stringify(m.text), 'utf8') - 2, 0);
    assert.ok(escapado <= pendencia.ORCAMENTO_MOTIVOS, `${JSON.stringify(ch)}: ${escapado}`);
  }
});

// D3: todos notificam o que ainda não foi visto em lugar nenhum; um visto cala os outros.
test('notificar só o que não foi visto aqui nem em outro aparelho', () => {
  const notificadas = new Set(['a1']);
  const vistos = { b2: { at: 1, dev: 'dOutro' } };
  assert.equal(pendencia.deveNotificar('a1', { notificadas, vistos }), false, 'já avisado aqui');
  assert.equal(pendencia.deveNotificar('b2', { notificadas, vistos }), false, 'visto no outro aparelho cala este');
  assert.equal(pendencia.deveNotificar('c3', { notificadas, vistos }), true);
});

test('o visto tem forma fixa, e só pode ser apagado quando a pendência sumiu ou com 30 dias', () => {
  assert.deepEqual(pendencia.vistoDe({ dev: 'd1', agora: 5 }), { at: 5, dev: 'd1' });
  const T = 1_800_000_000_000;
  assert.equal(pendencia.vistoApagavel({ at: T }, { pendenciaExiste: true, agora: T + 1000 }), false);
  assert.equal(pendencia.vistoApagavel({ at: T }, { pendenciaExiste: false, agora: T + 1000 }), true);
  assert.equal(pendencia.vistoApagavel({ at: T }, { pendenciaExiste: true, agora: T + pendencia.VISTO_MAX_MS + 1 }), true);
});
