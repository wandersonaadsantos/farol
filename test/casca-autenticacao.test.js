import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exigeAutenticacao } from '../lib/local-auth/modo.js';

test('a casca nativa exige autenticação mesmo no desktop e sem localAuth', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, modoCasca: 'mac' }), true);
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, modoCasca: 'win' }), true);
});

test('sem casca nada muda no desktop', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true, modoCasca: '' }), false);
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true }), false);
});
