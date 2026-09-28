import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { candidatoDe, matContaTag, fundir } from '../lib/sync/candidato.js';

const kId = randomBytes(32);
const HEAD = 'a'.repeat(40);
const pr = { key: 'acme/app#7', headSha: HEAD };

test('mesmo PR e head com contas diferentes são dois itens', () => {
  const a = candidatoDe(pr, { kId, conta: 'alice', agora: 1, ttlMs: 1000 });
  const b = candidatoDe(pr, { kId, conta: 'bob', agora: 1, ttlMs: 1000 });
  assert.notEqual(a.itemId, b.itemId);
  const itens = fundir({ devA: [a], devB: [b] }, { agora: 2 });
  assert.equal(itens.length, 2, 'fundir não junta contas diferentes');
});

test('o material do candidato é o de head e conta, e a caixa do login não importa', () => {
  const a = candidatoDe(pr, { kId, conta: 'Alice', agora: 1, ttlMs: 1000 });
  assert.equal(a.matTag, matContaTag(kId, HEAD, 'alice'));
  assert.match(a.itemId, /^[0-9a-f]+_[0-9a-f]+$/, 'formato que as regras do banco validam');
});

test('sem conta não há candidato', () => {
  assert.equal(candidatoDe(pr, { kId, conta: '', agora: 1, ttlMs: 1000 }), null);
});
