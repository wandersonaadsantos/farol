// Checkpoint compartilhado (7.C7), a parte pura.
//
// Os casos que carregam o contrato: entrada inválida fica INTEIRA de fora (falha fechada),
// a passada viaja amarrada ao aparelho de origem (senão duas passadas de aparelhos
// diferentes com o mesmo id local virariam uma só e a divergência sumiria do gate), e o
// desfecho da herança é nomeado.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-checkpoint-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';

const cp = (await import('../lib/sync/checkpoint.js')).default;

const K = Buffer.alloc(32, 7);
const PR = 'dono/repo#1';

function entrada(extra = {}) {
  return { claim: 'x.ts:10 confirma y', file: 'x.ts', line: 10, verdict: 'confirmado', evidence: 'li o arquivo', sessionId: 's1', headSha: 'sha1', blobSha: 'blob1', at: '2026-09-16T10:00:00', ...extra };
}

test('a allowlist da entrada: o que não está nela não viaja', () => {
  const limpa = cp.sanearEntrada({ ...entrada(), segredo: 'token', prUrl: 'https://x' });
  assert.deepEqual(Object.keys(limpa).sort(), ['at', 'blobSha', 'claim', 'evidence', 'file', 'headSha', 'line', 'sessionId', 'verdict']);
});

test('entrada sem afirmação, sem arquivo ou com veredito desconhecido fica de fora INTEIRA', () => {
  assert.equal(cp.sanearEntrada({ ...entrada(), claim: '' }), null);
  assert.equal(cp.sanearEntrada({ ...entrada(), file: '' }), null);
  assert.equal(cp.sanearEntrada({ ...entrada(), verdict: 'talvez' }), null, 'veredito novo não entra pela porta dos fundos');
  assert.equal(cp.sanearEntrada(null), null);
});

test('as duas lojas são nomeadas, e nome de fora não vira loja', () => {
  assert.equal(cp.lojaValida('review'), 'review');
  assert.equal(cp.lojaValida('self'), 'self');
  assert.equal(cp.lojaValida('outra'), '');
});

test('o id é do conteúdo: mesma entrada dá o mesmo id, e outra passada dá outro', () => {
  const a = cp.idDaEntrada(K, { dev: 'dA', prKey: PR, entrada: entrada() });
  assert.equal(a, cp.idDaEntrada(K, { dev: 'dA', prKey: PR, entrada: entrada() }));
  assert.notEqual(a, cp.idDaEntrada(K, { dev: 'dA', prKey: PR, entrada: entrada({ sessionId: 's2' }) }));
  assert.notEqual(a, cp.idDaEntrada(K, { dev: 'dB', prKey: PR, entrada: entrada() }), 'outro aparelho é outra entrada');
  assert.equal(cp.idDaEntrada(K, { dev: 'dA', prKey: PR, entrada: { claim: '' } }), '');
});

test('mesclar: o que já é meu não duplica, e o que vem de fora carrega o aparelho', () => {
  const minha = entrada();
  const r = cp.mesclar({
    locais: [minha],
    remotas: [
      { id: cp.idDaEntrada(K, { dev: 'dA', prKey: PR, entrada: minha }), dev: 'dA', entrada: minha },
      { id: 'i2', dev: 'dB', entrada: entrada({ claim: 'outra afirmação' }) },
    ],
    kId: K, dev: 'dA', prKey: PR,
  });
  assert.equal(r.novas.length, 1);
  assert.equal(r.novas[0].dev, 'dB');
  assert.equal(r.novas[0].sessionId, 'dB:s1', 'a passada do outro aparelho não se confunde com a minha');
  assert.equal(r.ignoradas, 0);
});

test('entrada remota que não tem forma é ignorada, e a contagem aparece', () => {
  const r = cp.mesclar({
    locais: [],
    remotas: [{ id: 'i1', dev: 'dB', entrada: { claim: 'a' } }, { id: '', dev: 'dB', entrada: entrada() }],
    kId: K, dev: 'dA', prKey: PR,
  });
  assert.deepEqual(r.novas, []);
  assert.equal(r.ignoradas, 2);
});

test('o desfecho da herança é nomeado: integral, parcial ou reinício', () => {
  assert.equal(cp.desfechoDaHeranca({ herdadas: 0, relevantes: 0 }), 'reinicio');
  assert.equal(cp.desfechoDaHeranca({ herdadas: 3, relevantes: 3 }), 'integral');
  assert.equal(cp.desfechoDaHeranca({ herdadas: 3, relevantes: 1 }), 'parcial');
});
