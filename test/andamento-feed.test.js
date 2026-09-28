import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import andamento from '../lib/sync/andamento.js';

const kId = randomBytes(32);
const sessao = { pr: { key: 'acme/app#1' }, account: 'eu', startedAt: 1, model: 'claude-opus-5-5' };

test('o feed traz as últimas linhas, cortadas, dentro do orçamento', () => {
  const feed = Array.from({ length: 50 }, (_, i) => ({ t: i + 2, k: 'info', text: `linha ${i} ` + 'x'.repeat(300) }));
  const p = andamento.projetar(sessao, feed, { kId, agora: 100 });
  assert.ok(p.feed.length > 0);
  assert.ok(p.feed.every((l) => l.length <= andamento.MAX_LINHA_FEED));
  assert.ok(p.feed.join('').length <= andamento.ORCAMENTO_FEED);
  assert.match(p.feed.at(-1), /^linha 49/, 'a mais recente fica');
});

test('a projeção inteira cabe no nó de operações', () => {
  const feed = Array.from({ length: 120 }, (_, i) => ({ t: i + 2, k: 'info', text: 'ç'.repeat(400), a: 'leitor-' + i, s: 'leitura' }));
  const p = andamento.projetar(sessao, feed, { kId, agora: 200 });
  const claro = JSON.stringify({ p });
  assert.ok(Buffer.byteLength(claro) * 4 / 3 + 200 <= 2048, `claro de ${Buffer.byteLength(claro)} bytes não cabe cifrado em 2048`);
});
