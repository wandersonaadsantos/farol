import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modoCasca, versaoDaCasca, modoServidor } from '../lib/paths.js';

test('modoCasca lê FAROL_SHELL e só aceita mac e win', () => {
  assert.equal(modoCasca({ FAROL_SHELL: 'mac' }), 'mac');
  assert.equal(modoCasca({ FAROL_SHELL: 'win' }), 'win');
  assert.equal(modoCasca({ FAROL_SHELL: ' MAC ' }), 'mac', 'tolera caixa e espaço');
  for (const v of ['linux', '1', '', '   ', undefined]) assert.equal(modoCasca({ FAROL_SHELL: v }), '', `recusa ${JSON.stringify(v)}`);
  assert.equal(modoCasca({}), '');
});

test('versaoDaCasca exige X.Y.Z', () => {
  assert.equal(versaoDaCasca({ FAROL_SHELL_VERSION: '3.0.0' }), '3.0.0');
  for (const v of ['3.0', 'v3.0.0', '', undefined]) assert.equal(versaoDaCasca({ FAROL_SHELL_VERSION: v }), '');
});

test('modo casca não é modo servidor nem Electron', () => {
  assert.equal(modoServidor(undefined), true, 'sem Electron continua sendo servidor para o update de hoje');
});
