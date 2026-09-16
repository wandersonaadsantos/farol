// Quem está na frota v2 (CT-COMPAT e 7.C3): o gate que decide se vale publicar conteúdo
// compartilhado.
//
// Publicar sem ninguém para ler é cota gasta e superfície de dado sem leitor, e o caso que
// guarda isso é o do aparelho SOZINHO: uma frota só com ele nunca vale publicar. Sem esse
// caso, o Farol publicaria para si mesmo para sempre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import frota from '../lib/sync/frota.js';
import { SYNC } from '../lib/constants.js';

const AGORA = 1_800_000_000_000;
const JANELA = SYNC.FROTA_JANELA_MS;
const EU = 'dEste';

function bom(extra = {}) {
  return { contract: 2, keyReady: true, lastSeenAt: AGORA - 1000, name: 'Celular', ...extra };
}

function ctx(extra = {}) {
  return { meuId: EU, agora: AGORA, janelaMs: JANELA, ...extra };
}

test('contrato antigo não conta', () => {
  assert.equal(frota.aparelhoV2(bom({ contract: 1 }), ctx()), false);
  assert.equal(frota.aparelhoV2(bom({ contract: undefined }), ctx()), false);
});

test('chave não pronta não conta: ler o conteúdo exige a chave aberta', () => {
  assert.equal(frota.aparelhoV2(bom({ keyReady: false }), ctx()), false);
  assert.equal(frota.aparelhoV2(bom({ keyReady: undefined }), ctx()), false);
  assert.equal(frota.aparelhoV2(bom({ keyReady: 'sim' }), ctx()), false, 'só true explícito');
});

test('a janela é de 24 horas, e o relógio adiantado do outro não a quebra', () => {
  assert.equal(frota.aparelhoV2(bom({ lastSeenAt: AGORA - JANELA + 1000 }), ctx()), true);
  assert.equal(frota.aparelhoV2(bom({ lastSeenAt: AGORA - JANELA - 1000 }), ctx()), false);
  assert.equal(frota.aparelhoV2(bom({ lastSeenAt: AGORA + 60_000 }), ctx()), true, 'visto "no futuro" continua visto');
});

test('aposentado não conta, mesmo visto agora', () => {
  assert.equal(frota.aparelhoV2(bom({ retiredAt: AGORA - 10 }), ctx()), false);
  assert.equal(frota.aparelhoV2(bom({ retiredAt: 0 }), ctx()), true);
});

test('entrada malformada não conta e não lança', () => {
  for (const d of [null, undefined, 'texto', 42, [], { contract: '2', keyReady: true, lastSeenAt: AGORA }]) {
    assert.equal(frota.aparelhoV2(d, ctx()), false, JSON.stringify(d));
  }
});

// O caso central.
test('sozinho nunca vale publicar: o próprio aparelho não conta', () => {
  const devices = { [EU]: bom({ name: 'Notebook' }) };
  assert.deepEqual(frota.outrosV2(devices, ctx()), []);
  assert.equal(frota.valePublicar(devices, ctx()), false);
});

test('com outro aparelho pronto, vale publicar, e só ele aparece na lista', () => {
  const devices = { [EU]: bom(), dOutro: bom(), dVelho: bom({ contract: 1 }) };
  assert.deepEqual(frota.outrosV2(devices, ctx()), ['dOutro']);
  assert.equal(frota.valePublicar(devices, ctx()), true);
});

test('frota vazia ou malformada não vale publicar', () => {
  for (const d of [null, undefined, {}, 'nao e frota']) {
    assert.equal(frota.valePublicar(d, ctx()), false, JSON.stringify(d));
  }
});
