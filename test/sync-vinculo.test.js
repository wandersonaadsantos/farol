// Vínculo do perfil ao grupo de consumo (CT-GRUPO), em state/sync-vinculos.json.
//
// O vínculo é um INTERVALO, não um campo. É o que faz "o consumo já registrado permanece
// no grupo em que foi feito": trocar de grupo fecha o intervalo anterior e abre outro, e
// nada é apagado, duplicado ou reatribuído em silêncio.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2b-vinculo-'));
process.env.FAROL_HOME = BASE;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const vinculo = (await import('../lib/sync/vinculo.js')).default;

const G1 = 'a'.repeat(32);
const G2 = 'b'.repeat(32);
const T0 = 1_800_000_000_000;

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });
beforeEach(() => { vinculo.apagarVinculos(); });

test('vincular grava e sobrevive à releitura', () => {
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 });
  assert.deepEqual(vinculo.vinculoVigente('p1'), { grupo: G1, tipo: 'assinatura', desde: T0, ate: 0 });
  assert.equal(vinculo.lerVinculos().p1.grupo, G1);
});

// Rotacionar a credencial não muda o vínculo: quem chama revincula ao mesmo grupo, e isso
// não pode abrir intervalo novo, senão a contagem recomeçaria a cada rotação.
test('revincular ao mesmo grupo não abre intervalo novo nem move o início', () => {
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 });
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 + 90_000 });
  assert.equal(vinculo.historicoDoVinculo('p1').length, 1);
  assert.equal(vinculo.vinculoVigente('p1').desde, T0, 'a contagem não recomeça');
});

test('trocar de grupo fecha o intervalo anterior e abre outro', () => {
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 });
  vinculo.vincular('p1', { grupo: G2, tipo: 'assinatura', agora: T0 + 1000 });
  const h = vinculo.historicoDoVinculo('p1');
  assert.equal(h.length, 2, 'o anterior continua lá');
  assert.deepEqual([h[0].grupo, h[0].desde, h[0].ate], [G1, T0, T0 + 1000]);
  assert.deepEqual([h[1].grupo, h[1].desde, h[1].ate], [G2, T0 + 1000, 0]);
});

test('o consumo antigo continua no grupo em que foi feito', () => {
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 });
  vinculo.vincular('p1', { grupo: G2, tipo: 'assinatura', agora: T0 + 1000 });
  assert.equal(vinculo.grupoDoConsumo('p1', T0 + 500), G1, 'gasto de antes da troca não muda de dono');
  assert.equal(vinculo.grupoDoConsumo('p1', T0 + 1500), G2);
  assert.equal(vinculo.grupoDoConsumo('p1', T0 + 1000), G2, 'o instante da troca já é do novo');
});

test('fora de qualquer intervalo o grupo é nulo, e nulo não é o vigente', () => {
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 });
  assert.equal(vinculo.grupoDoConsumo('p1', T0 - 1), null, 'consumo anterior ao vínculo não entra no grupo');
  assert.equal(vinculo.grupoDoConsumo('p2', T0), null, 'perfil sem vínculo não herda grupo de ninguém');
});

test('desvincular fecha o vigente e preserva o histórico', () => {
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 });
  vinculo.desvincular('p1', { agora: T0 + 2000 });
  assert.equal(vinculo.vinculoVigente('p1'), null);
  assert.equal(vinculo.historicoDoVinculo('p1').length, 1);
  assert.equal(vinculo.grupoDoConsumo('p1', T0 + 500), G1, 'o que já foi gasto continua contado');
  assert.equal(vinculo.lerVinculos().p1, undefined, 'sem vínculo vigente, o perfil não aparece como identificado');
});

test('arquivo corrompido lê como vazio, sem lançar', () => {
  vinculo.vincular('p1', { grupo: G1, tipo: 'assinatura', agora: T0 });
  fs.writeFileSync(vinculo.caminhoDosVinculos(), 'nao e json');
  assert.deepEqual(vinculo.lerVinculos(), {});
  assert.deepEqual(vinculo.historicoDoVinculo('p1'), []);
});

test('grupo ou tipo inválidos não criam vínculo: identidade indefinida não vira identidade', () => {
  assert.equal(vinculo.vincular('p1', { grupo: 'nao-e-id', tipo: 'assinatura', agora: T0 }), false);
  assert.equal(vinculo.vincular('p1', { grupo: G1, tipo: 'inventado', agora: T0 }), false);
  assert.equal(vinculo.vinculoVigente('p1'), null);
});
