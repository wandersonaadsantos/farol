// Identificadores v2 (CT-ENV): o "sal" é a chave secreta K_id, não um valor público. Sal
// público não resolve contra dicionário, porque quem lê o banco lê o sal junto.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-tags-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const tags = await import('../lib/sync/tags.js');
const { sha256Hex, canonicalPrKey, assertRtdbKey } = await import('../lib/sync/keys.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const K = Buffer.alloc(32, 7);
const K2 = Buffer.alloc(32, 9);
const PR_KEY = 'Org/Repo#7';

test('tag: 32 hex, determinística, e tag64 com o hex inteiro', () => {
  const t = tags.tag(K, 'pr', canonicalPrKey(PR_KEY));
  assert.match(t, /^[0-9a-f]{32}$/);
  assert.equal(t, tags.tag(K, 'pr', canonicalPrKey(PR_KEY)));
  assert.equal(tags.tag64(K, 'pr', canonicalPrKey(PR_KEY)).slice(0, 32), t);
  assert.match(tags.tag64(K, 'pr', canonicalPrKey(PR_KEY)), /^[0-9a-f]{64}$/);
});

test('HMAC, não SHA-256: a tag difere do hash com prefixo e muda com a chave', () => {
  const canonica = canonicalPrKey(PR_KEY);
  assert.notEqual(tags.tag(K, 'pr', canonica), sha256Hex('pr:' + canonica).slice(0, 32));
  assert.notEqual(tags.tag(K, 'pr', canonica), tags.tag(K2, 'pr', canonica));
});

test('o domínio separa espaços: mesmo valor em domínios diferentes dá tags diferentes', () => {
  assert.notEqual(tags.tag(K, 'acct', 'x'), tags.tag(K, 'pr', 'x'));
  assert.notEqual(tags.tag(K, 'event', 'x'), tags.tag(K, 'review', 'x'));
});

test('o valor entra inteiro na pré-imagem: NUL dentro do valor não é engolido', () => {
  // se o separador fosse ignorado ou o valor fosse saneado, estes dois cairiam na mesma
  // pré-imagem, e dois PRs diferentes dividiriam identificador
  assert.notEqual(tags.tag(K, 'acct', 'b\u0000c'), tags.tag(K, 'acct', 'bc'));
  assert.notEqual(tags.tag(K, 'acct', 'a\u0000b'), tags.tag(K, 'acct', 'ab'));
});

test('domínio fora da lista lança, em vez de gravar num espaço inventado', () => {
  assert.throws(() => tags.tag(K, 'inventado', 'x'), /domínio/i);
  assert.deepEqual([...tags.DOMINIOS], ['acct', 'pr', 'org', 'mat', 'event', 'review', 'pending']);
});

test('chave que não tem 32 bytes lança: K_id malformada nunca produz identificador', () => {
  assert.throws(() => tags.tag(Buffer.alloc(16, 1), 'pr', 'x'), /K_id/);
  assert.throws(() => tags.tag('nao-e-buffer', 'pr', 'x'), /K_id/);
});

test('as normalizações são as mesmas de hoje', () => {
  assert.equal(tags.acctTag(K, '  Fulano  '), tags.tag(K, 'acct', 'fulano'));
  assert.equal(tags.prTag(K, 'ORG/Repo#07'), tags.tag(K, 'pr', 'org/repo#7'));
  assert.equal(tags.prTag(K, 'sem-formato'), '', 'chave de PR inválida não vira tag');
});

test('toda tag passa no validador de chave do banco', () => {
  for (const d of tags.DOMINIOS) assert.equal(assertRtdbKey(tags.tag(K, d, 'valor')), tags.tag(K, d, 'valor'));
});

test('mesmaTag compara em tempo constante e não confunde tamanhos', () => {
  const t = tags.tag(K, 'pr', 'org/repo#7');
  assert.equal(tags.mesmaTag(t, t), true);
  assert.equal(tags.mesmaTag(t, t.slice(0, 31)), false);
  assert.equal(tags.mesmaTag('', ''), false);
  assert.equal(tags.mesmaTag(t, tags.tag(K2, 'pr', 'org/repo#7')), false);
});
