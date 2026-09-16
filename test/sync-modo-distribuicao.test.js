// Modo da distribuição (7.C5, anexo S3, "Degradação e volta"): a parte pura.
//
// Cair para local é imediato ao vencer (o vencimento já embute três intervalos), e voltar
// para distribuído é imediato no primeiro valor fresco: não existe histerese na subida.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-modo-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';

const modo = (await import('../lib/sync/modo-distribuicao.js')).default;

const T = 1_800_000_000_000;
const I = 120 * 1000;

function estado(extra = {}) {
  return { sequenciaVista: 3, fresca: true, ultimaMudancaEm: T, ...extra };
}

test('prontidão desconhecida vale como indisponível: modo local', () => {
  assert.equal(modo.modoDe(null, { agora: T, intervaloMs: I }), 'local');
  assert.equal(modo.modoDe(estado({ fresca: false }), { agora: T, intervaloMs: I }), 'local');
});

test('distribuído enquanto a prontidão está dentro de três intervalos, local logo depois', () => {
  assert.equal(modo.modoDe(estado(), { agora: T + 3 * I, intervaloMs: I }), 'distribuido');
  assert.equal(modo.modoDe(estado(), { agora: T + 3 * I + 1, intervaloMs: I }), 'local');
});

test('a virada é nomeada nos dois sentidos, e ficar parado não é virada', () => {
  assert.equal(modo.transicao('distribuido', 'local'), 'para-local');
  assert.equal(modo.transicao('local', 'distribuido'), 'para-distribuido');
  assert.equal(modo.transicao('local', 'local'), null);
  assert.equal(modo.transicao('', 'local'), null, 'boot em local não devolve nada: não havia o que devolver');
});

test('o jitter é estável por aparelho, fica abaixo do teto e espalha a frota', () => {
  const teto = 15000;
  assert.equal(modo.jitterMs('dA', teto), modo.jitterMs('dA', teto));
  const valores = new Set();
  for (let i = 0; i < 20; i++) {
    const j = modo.jitterMs(`dev-${i}`, teto);
    assert.ok(j >= 0 && j < teto, String(j));
    valores.add(j);
  }
  assert.ok(valores.size >= 15, 'vinte aparelhos não caem no mesmo segundo');
  assert.equal(modo.jitterMs('dA', 0), 0);
});

test('a volta sai em lotes: os mais antigos primeiro, e o resto espera o próximo giro', () => {
  const itens = [
    { key: 'c', desde: T + 3 }, { key: 'a', desde: T + 1 }, { key: 'b', desde: T + 2 },
  ];
  const r = modo.loteDaVolta(itens, 2);
  assert.deepEqual(r.agora.map((i) => i.key), ['a', 'b']);
  assert.deepEqual(r.depois.map((i) => i.key), ['c']);
  assert.deepEqual(modo.loteDaVolta([], 2), { agora: [], depois: [] });
});
