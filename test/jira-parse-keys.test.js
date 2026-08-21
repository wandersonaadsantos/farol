// A chave sai do título, da branch e do corpo do PR, nessa ordem de concatenação
// feita por quem chama. O texto é passado pra maiúscula antes de casar porque
// branch quase sempre vem minúscula (feat/xx-123-alguma-coisa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCardKeys } from '../lib/parse.js';

test('extractCardKeys acha em qualquer caixa e preserva a ordem', () => {
  assert.deepEqual(extractCardKeys('fix(x): corrige (xx-12)\nfeat/ab-7-coisa\ncorpo cita XX-12 de novo'), ['XX-12', 'AB-7']);
});

test('extractCardKeys filtra pelos projetos do site quando informados', () => {
  assert.deepEqual(extractCardKeys('XX-12 e AB-7', ['ab']), ['AB-7']);
  assert.deepEqual(extractCardKeys('XX-12 e AB-7', []), ['XX-12', 'AB-7']);
});

test('extractCardKeys não inventa chave', () => {
  assert.deepEqual(extractCardKeys(''), []);
  assert.deepEqual(extractCardKeys(null), []);
  assert.deepEqual(extractCardKeys('release 2.2.0 e numero 12-34'), []);
});
