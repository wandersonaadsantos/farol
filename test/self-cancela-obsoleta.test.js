// Autoanálise que já ficou obsoleta é cancelada NA HORA, não no fim.
//
// MEDIDO EM 30/08/2026: dez sessões de autoanálise no dia, oito descartadas, e o
// descarte acontecia sempre depois de a sessão inteira ter sido paga. O app já lia o
// head fresco de todo "Meu PR" a cada ciclo de polling (enrichMyPRBranches), então
// sabia do commit novo em no máximo três minutos e deixava a sessão correr assim mesmo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { sessoesSelfObsoletas } = await import('../lib/engine/selfpr.js');

const sess = (id, key, headSha, mode = 'self') => ({ id, keys: [key], headSha, mode });

test('cancela a sessão cujo head não é mais a ponta da branch', () => {
  const vivas = [sess('s1', 'o/r#1', 'velho'), sess('s2', 'o/r#2', 'velho')];
  assert.deepEqual(sessoesSelfObsoletas(vivas, 'o/r#1', 'novo'), ['s1'], 'só a do PR pedido');
});

test('não cancela quando o head é o mesmo', () => {
  assert.deepEqual(sessoesSelfObsoletas([sess('s1', 'o/r#1', 'mesmo')], 'o/r#1', 'mesmo'), []);
});

test('sessão sem head não é cancelada: sem prova de que andou, deixa rodar', () => {
  assert.deepEqual(sessoesSelfObsoletas([sess('s1', 'o/r#1', '')], 'o/r#1', 'novo'), []);
});

test('head atual desconhecido (gh falhou) não cancela nada', () => {
  assert.deepEqual(sessoesSelfObsoletas([sess('s1', 'o/r#1', 'velho')], 'o/r#1', ''), []);
});

test('revisão oficial nunca é cancelada por este caminho', () => {
  const revisao = sess('s9', 'o/r#1', 'velho', 'auto');
  assert.deepEqual(sessoesSelfObsoletas([revisao], 'o/r#1', 'novo'), []);
});

test('lista vazia ou ausente não quebra', () => {
  assert.deepEqual(sessoesSelfObsoletas([], 'o/r#1', 'novo'), []);
  assert.deepEqual(sessoesSelfObsoletas(undefined, 'o/r#1', 'novo'), []);
});

/* ---------- fiação: o motivo chega ao toast ---------- */
// O toast de cancelamento é o MESMO do botão Cancelar, então sem o motivo a pessoa
// leria "cancelada" sem ter cancelado nada. Teste de fonte, mesmo padrão dos outros
// wirings deste repo (o caminho de verdade faz spawn e mataria processo real).

const SELF = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'selfpr.js'), 'utf8');
const REVIEW = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');

test('o polling cancela a sessão obsoleta e grava o motivo', () => {
  assert.match(SELF, /sessoesSelfObsoletas\(engine\.activeReviews\.values\(\), pr\.key, pr\.headSha\)/);
  assert.match(SELF, /engine\.selfCancelMotivo\.set\(pr\.key,/);
  assert.match(SELF, /engine\.cancelSession\(id\)/);
});

test('o toast do cancelamento usa o motivo e o consome', () => {
  assert.match(REVIEW, /engine\.selfCancelMotivo && engine\.selfCancelMotivo\.get\(pr\.key\)/);
  assert.match(REVIEW, /selfCancelMotivo\.delete\(pr\.key\)/, 'consome, pra não repetir na sessão seguinte');
});
