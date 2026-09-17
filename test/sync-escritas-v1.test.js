// Regra de ouro dos nós legados: toda escrita que o v1 faz hoje continua valendo sob as
// regras v2. Aqui o teste monta os payloads REAIS (não literais escritos à mão) e confere
// que cada um satisfaz as validações publicadas. O emulador confirma no roteiro manual:
// o dublê não avalia regra (decisão 8 da spec).
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const regras = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase', 'database.rules.json'), 'utf8')).rules.users.$uid;

const { buildLease } = await import('../lib/sync/lease.js');
const { buildReceipt } = await import('../lib/sync/receipts.js');
const { payloadFor } = await import('../lib/sync/outbox.js');

const AGORA = 1_800_000_000_000;
const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

// Lê a lista de hasChildren de uma .validate e devolve os campos exigidos.
function exigidos(validate) {
  const m = /hasChildren\(\[([^\]]*)\]\)/.exec(validate || '');
  return m ? m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) : [];
}

test('lease real satisfaz a validação publicada', () => {
  const lease = buildLease({ leaseId: 'L1', deviceId: 'dA', operationKind: 'review', headSha: HEAD, nowMs: AGORA, farolVersion: '9.9.9' });
  const campos = exigidos(regras.leases.$acct.$pr['.validate']);
  assert.ok(campos.length > 0, 'a validação exige campos');
  for (const campo of campos) assert.ok(campo in lease, campo);
  assert.ok(lease.expiresAt > AGORA && lease.expiresAt <= AGORA + 300000, 'dentro do teto que a regra aceita');
});

test('recibo real satisfaz a validação publicada', () => {
  const recibo = buildReceipt({ operationKind: 'review', materialVersion: HEAD, deviceId: 'dA', leaseId: 'L1', nowMs: AGORA, outcome: 'completed', publicationState: 'published', reviewId: '', farolVersion: '9.9.9' });
  for (const campo of exigidos(regras.receipts.$acct.$pr.$fp['.validate'])) assert.ok(campo in recibo, campo);
  assert.equal(typeof recibo.completedAt, 'number');
});

test('evento de consumo real satisfaz a validação publicada', () => {
  const p = payloadFor({ id: 'a1', at: AGORA, kind: 'review', account: 'x', costUsd: 1 }, 'dA', '9.9.9');
  for (const campo of exigidos(regras.usageEvents.$device.$event['.validate'])) assert.ok(campo in p, campo);
  assert.equal(typeof p.at, 'number');
});

test('cada nó que o v1 escreve tem concessão própria, agora que a raiz não concede', () => {
  for (const no of ['leases', 'receipts', 'dailyRounds', 'devices', 'usageEvents']) {
    assert.ok(regras[no]['.write'], `${no} perdeu a concessão e o v1 pararia de escrever`);
  }
});

// A C3a acrescentou `.validate` em DOIS campos novos da presença (contract e keyReady).
// A garantia continua a mesma e é afirmada assim: nada valida o nó inteiro, nenhum campo
// que o v1 escreve ganhou validação, e os campos novos só têm `.validate` (nunca `.write`,
// que poderia restringir a escrita do nó). Aparelho antigo não escreve contract nem
// keyReady, e `.validate` de filho ausente não roda.
test('a presença do v1 continua gravável: nenhuma validação nova alcança o que ela escreve', () => {
  assert.equal(regras.devices['.validate'], undefined, 'validação no nó inteiro quebraria aparelho antigo');
  assert.deepEqual(Object.keys(regras.devices).sort(), ['$device', '.write'].sort());
  assert.deepEqual(Object.keys(regras.devices.$device).sort(), ['contract', 'keyReady']);
  for (const campo of ['contract', 'keyReady']) {
    assert.deepEqual(Object.keys(regras.devices.$device[campo]), ['.validate'], `${campo} só pode validar`);
  }
  for (const campo of ['name', 'platform', 'farolVersion', 'lastSeenAt', 'createdAt']) {
    assert.equal(regras.devices.$device[campo], undefined, `${campo} é do v1 e não pode ganhar regra`);
  }
});
