// lib/sync/keys.js: as chaves derivadas que sobem para o banco. Texto legível de
// PR ou de conta nunca sobe (só o hash), e o dia do teto compartilhado é o civil de
// Brasília, igual nos dois aparelhos, qualquer que seja o fuso de cada processo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import keys, {
  sha256Hex, accountHash, canonicalPrKey, prHash, operationFingerprint,
  brasiliaDay, nextBrasiliaDayStartMs, eventIdFor, novoId, assertRtdbKey,
} from '../lib/sync/keys.js';
import { SyncError } from '../lib/sync/errors.js';

const HEX64 = /^[0-9a-f]{64}$/;
const sha = (t) => createHash('sha256').update(t).digest('hex');

test('sha256Hex: 64 hex, igual ao node:crypto', () => {
  assert.match(sha256Hex('x'), HEX64);
  assert.equal(sha256Hex('abc'), sha('abc'));
});

test('accountHash: prefixo acct:, login aparado e em minúsculas', () => {
  assert.equal(accountHash('Fulano'), sha('acct:fulano'));
  assert.equal(accountHash('  FULANO '), accountHash('fulano'));
  assert.equal(accountHash(undefined), sha('acct:'));
});

test('canonicalPrKey: owner/repo em minúsculas e número inteiro', () => {
  assert.equal(canonicalPrKey('Acme/Repo#7'), 'acme/repo#7');
  assert.equal(canonicalPrKey('acme/repo#007'), 'acme/repo#7');
  for (const ruim of ['', 'acme/repo', 'acme#7', 'a/b/c#1', 'acme/repo#x', 'acme /repo#1', null, undefined]) {
    assert.equal(canonicalPrKey(ruim), '', String(ruim));
  }
});

test('prHash: mesma chave para grafias diferentes do mesmo PR; vazio quando não é PR', () => {
  assert.equal(prHash('Acme/Repo#7'), prHash('acme/repo#7'));
  assert.equal(prHash('acme/repo#7'), sha('pr:acme/repo#7'));
  assert.notEqual(prHash('acme/repo#7'), prHash('acme/repo#8'));
  assert.equal(prHash('lixo'), '');
});

test('operationFingerprint: kind + 32 hex do sha da versão material', () => {
  const fp = operationFingerprint('review', 'abc123');
  assert.equal(fp, `review_${sha('abc123').slice(0, 32)}`);
  assert.match(operationFingerprint('self', 'x'), /^self_[0-9a-f]{32}$/);
  assert.match(operationFingerprint('pushback', 'm1'), /^pushback_[0-9a-f]{32}$/);
  assert.notEqual(operationFingerprint('review', 'a'), operationFingerprint('self', 'a'));
});

test('operationFingerprint: kind inválido ou versão vazia lança SyncError de falha interna', () => {
  for (const kind of ['chat', 'tool', '', undefined, 'Review']) {
    assert.throws(() => operationFingerprint(kind, 'abc'), (e) => e instanceof SyncError && e.code === 'falha_interna', String(kind));
  }
  for (const mv of ['', null, undefined]) {
    assert.throws(() => operationFingerprint('review', mv), (e) => e instanceof SyncError && e.code === 'falha_interna', String(mv));
  }
});

test('brasiliaDay: a virada do dia é às 03:00 UTC (UTC-3), não à meia-noite UTC', () => {
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 2, 59, 59)), '2026-09-09');
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 3, 0, 0)), '2026-09-10');
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 3, 0, 0), 'UTC'), '2026-09-10');
  assert.equal(brasiliaDay(Date.UTC(2026, 8, 10, 2, 0, 0), 'UTC'), '2026-09-10');
});

test('nextBrasiliaDayStartMs: devolve exatamente o primeiro instante do dia seguinte', () => {
  const inicio = Date.UTC(2026, 8, 10, 3, 0, 0);
  assert.equal(nextBrasiliaDayStartMs(Date.parse('2026-09-09T15:00:00Z')), inicio);
  assert.equal(nextBrasiliaDayStartMs(Date.parse('2026-09-09T15:00:30.500Z')), inicio, 'fora do minuto redondo');
  assert.equal(nextBrasiliaDayStartMs(Date.UTC(2026, 8, 10, 2, 59, 59)), inicio, 'um segundo antes da virada');
  assert.equal(nextBrasiliaDayStartMs(inicio), Date.UTC(2026, 8, 11, 3, 0, 0), 'no instante da virada é o dia de depois');
  assert.equal(nextBrasiliaDayStartMs(Date.UTC(2026, 8, 9, 3, 0, 0) + 1), inicio);
});

test('nextBrasiliaDayStartMs: vale em outro fuso passado explicitamente', () => {
  assert.equal(nextBrasiliaDayStartMs(Date.UTC(2026, 8, 9, 15, 0, 0), 'UTC'), Date.UTC(2026, 8, 10, 0, 0, 0));
});

const SESSAO = {
  at: 1757500000000, id: 's1', kind: 'review', ref: 'acme/repo#7', model: 'sonnet',
  inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5,
};

test('eventIdFor: estável para os mesmos campos imutáveis', () => {
  assert.match(eventIdFor(SESSAO, 'dev-1'), HEX64);
  assert.equal(eventIdFor({ ...SESSAO }, 'dev-1'), eventIdFor(SESSAO, 'dev-1'));
  assert.equal(eventIdFor({ ...SESSAO, status: 'erro' }, 'dev-1'), eventIdFor(SESSAO, 'dev-1'), 'status não entra: correção de desfecho reenvia o mesmo evento');
});

test('eventIdFor: sensível a cada token, ao custo, ao aparelho e à identidade da sessão', () => {
  const base = eventIdFor(SESSAO, 'dev-1');
  assert.notEqual(eventIdFor(SESSAO, 'dev-2'), base);
  for (const [k, v] of [['inputTokens', 11], ['outputTokens', 21], ['cacheReadTokens', 4], ['cacheCreationTokens', 5],
    ['costUsd', 0.51], ['at', SESSAO.at + 1], ['id', 's2'], ['kind', 'self'], ['ref', 'acme/repo#8'], ['model', 'opus']]) {
    assert.notEqual(eventIdFor({ ...SESSAO, [k]: v }, 'dev-1'), base, k);
  }
});

test('novoId: UUID v4 diferente a cada chamada', () => {
  const a = novoId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(novoId(), a);
});

test('assertRtdbKey: recusa os caracteres proibidos pelo RTDB, vazio e controle', () => {
  for (const ruim of ['a.b', 'a$b', 'a#b', 'a[b', 'a]b', 'a/b', '', 'a\u0000b', 'a\nb', 'a\u007fb', 'x'.repeat(769)]) {
    assert.throws(() => assertRtdbKey(ruim), (e) => e instanceof SyncError && e.code === 'falha_interna', JSON.stringify(ruim.slice(0, 10)));
  }
  assert.throws(() => assertRtdbKey('é'.repeat(385)), SyncError, '770 bytes em UTF-8 passam do teto mesmo com 385 caracteres');
});

test('assertRtdbKey: aceita hex, _ , - e o fingerprint', () => {
  for (const ok of [sha('x'), 'review_abc', 'a-b', '2026-09-10', operationFingerprint('review', 'h'), 'x'.repeat(768)]) {
    assert.doesNotThrow(() => assertRtdbKey(ok), ok.slice(0, 10));
  }
});

test('export default carrega o mesmo contrato dos nomeados', () => {
  assert.equal(keys.prHash, prHash);
  assert.equal(keys.brasiliaDay, brasiliaDay);
  assert.equal(keys.assertRtdbKey, assertRtdbKey);
});
