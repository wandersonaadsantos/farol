// Credencial por conta na aptidão de destino (Task 2, 28/09/2026): o `token` publicado
// era um booleano só de máquina (`gh auth` global), e um aparelho parecia apto para
// qualquer conta cujo token individual não existia. Agora a aptidão confere a TAG da
// conta em `contasComToken`, publicada por `sync-publicacao.js`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { destinoApto } from '../lib/sync/transferencia.js';

const base = { frescoAte: 10, aceitarAdmin: true, teto: 2, ocupadas: 0, iaPronta: true };

test('destino com a conta configurada mas sem token dela não é apto', () => {
  const r = destinoApto({ ...base, contas: ['t1'], token: true, contasComToken: [] }, { acctTag: 't1', agora: 1 });
  assert.deepEqual(r, { apto: false, motivo: 'sem-credencial' });
});

test('destino com token da conta é apto', () => {
  const r = destinoApto({ ...base, contas: ['t1'], contasComToken: ['t1'] }, { acctTag: 't1', agora: 1 });
  assert.equal(r.apto, true);
});

test('aparelho antigo, sem contasComToken, não é destino (falha fechada)', () => {
  const r = destinoApto({ ...base, contas: ['t1'], token: true }, { acctTag: 't1', agora: 1 });
  assert.equal(r.apto, false);
});
