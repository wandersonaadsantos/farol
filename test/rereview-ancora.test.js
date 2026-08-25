import test from 'node:test';
import assert from 'node:assert';
import { normalizeAncora, proximaAncora, diaLocal, MAX_RODADAS_AUTO_DIA } from '../lib/engine/review.js';
import { TEMPOS } from '../lib/constants.js';

const AGORA = new Date('2026-08-25T15:00:00').getTime(); // horário local do teste

test('normalizeAncora: string legada vira objeto com o head preservado', () => {
  const a = normalizeAncora('a'.repeat(40));
  assert.equal(a.head, 'a'.repeat(40));
  assert.equal(a.dia, '');
  assert.equal(a.rodadas, 1);
});

test('normalizeAncora: objeto novo passa direto e valor inválido degrada pra vazio', () => {
  const nova = { head: 'b'.repeat(40), dia: '2026-08-25', rodadas: 2 };
  assert.deepEqual(normalizeAncora(nova), nova);
  assert.deepEqual(normalizeAncora(null), { head: '', dia: '', rodadas: 0 });
  assert.deepEqual(normalizeAncora(42), { head: '', dia: '', rodadas: 0 });
});

test('proximaAncora: mesmo dia incrementa rodadas, dia novo zera pra 1', () => {
  const hoje = diaLocal(AGORA);
  const inc = proximaAncora({ head: 'x', dia: hoje, rodadas: 2 }, 'y'.repeat(40), AGORA);
  assert.equal(inc.rodadas, 3);
  assert.equal(inc.head, 'y'.repeat(40));
  const ontem = proximaAncora({ head: 'x', dia: '2026-08-24', rodadas: 3 }, 'z'.repeat(40), AGORA);
  assert.equal(ontem.rodadas, 1);
  assert.equal(ontem.dia, hoje);
});

test('proximaAncora: âncora legada (string) conta como 1 rodada de dia desconhecido', () => {
  const a = proximaAncora(normalizeAncora('a'.repeat(40)), 'b'.repeat(40), AGORA);
  // dia '' nunca é igual a hoje, então recomeça em 1: legado nunca infla o teto
  assert.equal(a.rodadas, 1);
});

test('diaLocal devolve YYYY-MM-DD do fuso local', () => {
  assert.match(diaLocal(AGORA), /^\d{4}-\d{2}-\d{2}$/);
});

test('constantes do teto e do debounce existem com os valores decididos', () => {
  assert.equal(TEMPOS.HEAD_QUIETO_MS, 300000);
  assert.equal(MAX_RODADAS_AUTO_DIA, 3);
});
