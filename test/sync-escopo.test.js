// Panorama e Meus PRs, a parte pura (7.C3): linhas por conta monitorada, com o resumo
// que decide se a linha mudou e a forma do tombstone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import escopo from '../lib/sync/escopo.js';

const K = randomBytes(32);
const PR = {
  key: 'dono/repo#5', url: 'u', title: 'Titulo', author: 'alguem', repo: 'dono/repo', number: 5,
  isDraft: false, updatedAt: '2026-09-16T10:00:00Z', mine: true, reviewedByMe: false, reRequested: true,
  mergeable: 'MERGEABLE', headRefName: 'feat/x', baseRefName: 'main', headRefOid: 'abc', corpo: 'texto enorme',
};

test('linha do Panorama: allowlist com selos, sem estado de merge', () => {
  const l = escopo.linhaDe('panorama', PR);
  assert.deepEqual(Object.keys(l).sort(), ['author', 'isDraft', 'key', 'number', 'repo', 'selos', 'title', 'updatedAt', 'url']);
  assert.deepEqual(l.selos, { mine: true, reviewedByMe: false, reRequested: true });
});

test('linha de Meus PRs leva o estado de merge e as branches, e nunca o corpo', () => {
  const l = escopo.linhaDe('myPrs', PR);
  assert.equal(l.mergeable, 'MERGEABLE');
  assert.equal(l.headRefName, 'feat/x');
  assert.equal(l.corpo, undefined);
  assert.equal(l.headRefOid, undefined, 'SHA não sobe: ele leva direto ao repositório');
});

test('tipo desconhecido não produz linha', () => {
  assert.equal(escopo.linhaDe('outro', PR), null);
});

test('ctag muda com o conteúdo, não com a ordem, e é tag (não o texto)', () => {
  const a = escopo.ctagDe(K, escopo.linhaDe('panorama', PR));
  const b = escopo.ctagDe(K, escopo.linhaDe('panorama', { ...PR, title: 'Outro' }));
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
  const invertido = Object.fromEntries(Object.entries(escopo.linhaDe('panorama', PR)).reverse());
  assert.equal(escopo.ctagDe(K, invertido), a);
});

test('su ordena por escopo e instante com 13 dígitos; o id junta escopo e PR', () => {
  assert.equal(escopo.suDe('abc', 7), 'abc|0000000000007');
  assert.equal(escopo.idDe('abc', 'def'), 'abc_def');
});

test('meta: publica quem não tem dono vivo, ou quem já é o dono', () => {
  const T = 1_800_000_000_000;
  assert.equal(escopo.possoPublicar(null, 'eu', T), true);
  assert.equal(escopo.possoPublicar({ dev: 'outro', x: T + 1 }, 'eu', T), false, 'outro publicador vivo');
  assert.equal(escopo.possoPublicar({ dev: 'outro', x: T - 1 }, 'eu', T), true, 'o outro sumiu');
  assert.equal(escopo.possoPublicar({ dev: 'eu', x: T + 1 }, 'eu', T), true);
  assert.deepEqual(escopo.metaDe({ dev: 'eu', agora: T }), { dev: 'eu', x: T + escopo.META_MS });
});

test('tombstone apagável só 24 h depois', () => {
  const T = 1_800_000_000_000;
  assert.equal(escopo.tombstoneApagavel({ del: true, u: T }, T + 1000), false);
  assert.equal(escopo.tombstoneApagavel({ del: true, u: T }, T + escopo.TOMBSTONE_MS + 1), true);
  assert.equal(escopo.tombstoneApagavel({ u: T }, T + escopo.TOMBSTONE_MS + 1), false, 'linha viva não é tombstone');
});
