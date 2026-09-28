// Task 9 (28/09/2026): quem não é admin vê só o próprio trabalho, e a decisão do admin
// avisa o executor. As seções da frota (o que está acontecendo nos OUTROS aparelhos) só
// existem em quem é o admin agora; e quando o admin decide uma pendência, o aparelho dono
// dela (o executor) avisa o PRÓPRIO usuário do que aconteceu, pelo mesmo canal de toast.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { secoesDaFrota } = await import('../ui/pure.js');
const comandos = (await import('../lib/engine/sync-comandos.js')).default;
const kek = (await import('../lib/sync/kek.js')).default;
const { itemIdDe } = await import('../lib/sync/pendencia.js');

const MATERIAL = kek.novoMaterial();
const DEV = 'd'.repeat(32);

/* ---------- secoesDaFrota: pura, só o admin vê a frota ---------- */

test('secoesDaFrota: verdadeira só com sync.admin.souEu true', () => {
  assert.equal(secoesDaFrota({ admin: { souEu: true } }), true);
});

test('secoesDaFrota: falsa quando este aparelho não é o admin', () => {
  assert.equal(secoesDaFrota({ admin: { souEu: false } }), false);
});

test('secoesDaFrota: falsa sem admin conhecido', () => {
  assert.equal(secoesDaFrota({}), false);
  assert.equal(secoesDaFrota({ admin: null }), false);
});

test('secoesDaFrota: falsa com sync nulo ou ausente', () => {
  assert.equal(secoesDaFrota(null), false);
  assert.equal(secoesDaFrota(undefined), false);
});

/* ---------- decidir aplicado: o executor avisa o próprio usuário ---------- */

function engineDecidir({ decideOk = true } = {}) {
  const avisos = [];
  const engine = {
    sync: { material: MATERIAL, deviceId: DEV },
    decisions: { pending: [{ id: 'i1', key: 'acme-exemplo/app-web#41' }] },
    decide: async () => (decideOk ? { ok: true } : { ok: false, code: 'nao_postou' }),
    emit: (evento, corpo) => avisos.push({ evento, corpo }),
  };
  return { engine, avisos };
}

function kId() { return kek.bufferDe(MATERIAL.id); }

test('decidir aplicado emite toast com "o admin decidiu" e o PR (approve)', async () => {
  const { engine, avisos } = engineDecidir();
  const itemId = itemIdDe(kId(), DEV, 'i1');
  const r = await comandos.executar(engine, {}, 'c1', { tipo: 'decidir', args: { itemId, acao: 'approve' } }, 1);
  assert.equal(r.estado, 'aplicado');
  const toasts = avisos.filter((a) => a.evento === 'toast');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].corpo.kind, 'info');
  assert.match(toasts[0].corpo.text, /admin decidiu/);
  assert.match(toasts[0].corpo.text, /aprovar/);
  assert.match(toasts[0].corpo.text, /acme-exemplo\/app-web#41/);
});

test('decidir aplicado usa o rótulo certo por ação, inclusive reject mapeado', async () => {
  const casos = [
    ['request_changes', /pedir mudanças/],
    ['comment', /só comentar/],
    ['skip', /pular/],
    ['reject', /pedir mudanças/],
  ];
  for (const [acao, esperado] of casos) {
    const { engine, avisos } = engineDecidir();
    const itemId = itemIdDe(kId(), DEV, 'i1');
    const r = await comandos.executar(engine, {}, 'c-' + acao, { tipo: 'decidir', args: { itemId, acao } }, 1);
    assert.equal(r.estado, 'aplicado', acao);
    const toasts = avisos.filter((a) => a.evento === 'toast');
    assert.equal(toasts.length, 1, acao);
    assert.match(toasts[0].corpo.text, esperado, acao);
  }
});

test('decidir recusado não avisa o usuário: sem sucesso, sem toast', async () => {
  const { engine, avisos } = engineDecidir({ decideOk: false });
  const itemId = itemIdDe(kId(), DEV, 'i1');
  const r = await comandos.executar(engine, {}, 'c1', { tipo: 'decidir', args: { itemId, acao: 'approve' } }, 1);
  assert.equal(r.estado, 'recusado');
  assert.deepEqual(avisos.filter((a) => a.evento === 'toast'), []);
});
