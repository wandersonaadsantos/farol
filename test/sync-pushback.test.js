// Memória de pushback (7.C3), a parte pura: o que sobe, quem vence e o que é conflito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pb from '../lib/sync/pushback-sync.js';

const K = randomBytes(32);
const MANUAL = { outcome: 'rejected', note: 'discordou', at: 1000, source: 'manual', status: 'confirmed', author: 'Fulano' };
const AUTO = { outcome: 'accepted', note: 'aceitou', at: 2000, source: 'auto', status: 'confirmed', confidence: 'high', author: 'fulano' };

test('só registro confirmado sobe: suspeita de baixa confiança fica local', () => {
  assert.equal(pb.confirmado(MANUAL), true);
  assert.equal(pb.confirmado({ ...AUTO, status: 'pending' }), false);
  assert.equal(pb.confirmado({ ...AUTO, outcome: 'inventado' }), false);
  assert.equal(pb.confirmado(null), false);
});

test('a projeção leva desfecho, nota, origem, autor por tag e instante, e nada mais', () => {
  const p = pb.projetar(MANUAL, { kId: K });
  assert.deepEqual(Object.keys(p).sort(), ['at', 'autorTag', 'desfecho', 'nota', 'origem']);
  assert.match(p.autorTag, /^[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(p).includes('Fulano'), false);
  assert.equal(pb.projetar({ ...MANUAL, author: 'FULANO' }, { kId: K }).autorTag, pb.projetar({ ...MANUAL, author: 'fulano' }, { kId: K }).autorTag);
  assert.ok(pb.projetar({ ...MANUAL, note: 'x'.repeat(500) }, { kId: K }).nota.length <= pb.MAX_NOTA);
});

test('manual vence automático, mesmo sendo mais antigo', () => {
  const local = pb.projetar(MANUAL, { kId: K });
  const remoto = pb.projetar(AUTO, { kId: K });
  assert.deepEqual(pb.mesclar(local, remoto), { valor: local, origem: 'local', conflito: false });
  assert.deepEqual(pb.mesclar(remoto, local), { valor: local, origem: 'remoto', conflito: false });
});

test('entre dois automáticos, vence o mais novo', () => {
  const velho = pb.projetar({ ...AUTO, at: 1 }, { kId: K });
  const novo = pb.projetar({ ...AUTO, at: 9, outcome: 'partial' }, { kId: K });
  assert.equal(pb.mesclar(velho, novo).valor.desfecho, 'partial');
  assert.equal(pb.mesclar(novo, velho).valor.desfecho, 'partial');
});

// O caso que a spec nomeia: conflito não resolvido não é combinado em silêncio.
test('dois manuais que discordam viram conflito, e o local continua valendo', () => {
  const local = pb.projetar(MANUAL, { kId: K });
  const remoto = pb.projetar({ ...MANUAL, outcome: 'accepted', at: 5000 }, { kId: K });
  const r = pb.mesclar(local, remoto);
  assert.equal(r.conflito, true);
  assert.deepEqual(r.valor, local);
});

test('dois manuais que concordam não são conflito', () => {
  const local = pb.projetar(MANUAL, { kId: K });
  const remoto = pb.projetar({ ...MANUAL, at: 5000 }, { kId: K });
  assert.equal(pb.mesclar(local, remoto).conflito, false);
});

test('sem um dos lados, vale o que existe', () => {
  const local = pb.projetar(MANUAL, { kId: K });
  assert.deepEqual(pb.mesclar(local, null), { valor: local, origem: 'local', conflito: false });
  assert.deepEqual(pb.mesclar(null, local), { valor: local, origem: 'remoto', conflito: false });
  assert.deepEqual(pb.mesclar(null, null), { valor: null, origem: 'local', conflito: false });
});

test('lápide retira o que é dela ou mais antigo, e não retira o que veio depois', () => {
  assert.equal(pb.retiradoDepoisDe({ del: true, u: 100 }, { at: 50 }), true);
  assert.equal(pb.retiradoDepoisDe({ del: true, u: 100 }, { at: 200 }), false, 'registro novo não é ressuscitado nem apagado à toa');
  assert.equal(pb.retiradoDepoisDe({ u: 100 }, { at: 50 }), false, 'sem del não é lápide');
});
