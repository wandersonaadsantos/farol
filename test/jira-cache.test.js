// O relógio entra por parâmetro em vez de Date.now() dentro do módulo: teste de
// expiração com relógio real é teste que dorme, e teste que dorme é teste que
// alguém desliga depois.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-jira-cache-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const cache = await import('../lib/jira/cache.js');
const { JIRA } = await import('../lib/constants.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const CARD = { key: 'XX-1', summary: 'titulo', status: 'Em andamento', description: '', criteria: [], scope: [], outOfScope: [] };

test('grava e lê dentro da validade', () => {
  cache.writeCachedCard('s1', 'XX-1', CARD, 1000);
  assert.deepEqual(cache.readCachedCard('s1', 'XX-1', 1000), CARD);
  assert.deepEqual(cache.readCachedCard('s1', 'XX-1', 1000 + JIRA.CACHE_TTL_MS - 1), CARD);
});

test('expira depois do TTL', () => {
  cache.writeCachedCard('s1', 'XX-2', CARD, 1000);
  assert.equal(cache.readCachedCard('s1', 'XX-2', 1000 + JIRA.CACHE_TTL_MS + 1), null);
});

test('um site não lê o cache do outro', () => {
  cache.writeCachedCard('s1', 'XX-3', CARD, 1000);
  assert.equal(cache.readCachedCard('s2', 'XX-3', 1000), null);
});

test('cache ausente ou corrompido é miss, nunca exceção', () => {
  assert.equal(cache.readCachedCard('s1', 'NAO-EXISTE', 1000), null);
  const arquivo = cache.cardCachePath('s1', 'XX-4');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, 'isto não é json', 'utf8');
  assert.equal(cache.readCachedCard('s1', 'XX-4', 1000), null);
});

test('sanitizar é exportado e impede identificador de escapar da pasta', () => {
  assert.equal(cache.sanitizar('../fuga'), '__fuga');
  assert.equal(cache.sanitizar('a b'), 'a_b');
  const p = cache.cardCachePath('../fuga', 'XX/1');
  assert.ok(!p.includes('..'), 'siteId com .. não pode subir de pasta');
  assert.ok(p.endsWith(path.join('__fuga', 'XX_1.json')));
});
