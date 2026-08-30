import test, { after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-quieto-'));
const { Engine } = await import('../server.js');

// O FAROL_HOME de teste e apagado no fim. Sem isto cada rodada da suite deixa um
// diretorio para tras: medido em 6 por rodada, somando mais de mil na maquina.
after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
});


const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
function engineComPanorama(infoPorKey) {
  const e = Object.create(Engine.prototype);
  e.panorama = Object.keys(infoPorKey).map(key => ({ key, reviewedByMe: true }));
  e.reviewActions = () => ({});
  e.staleForReview = async (pr) => infoPorKey[pr.key];
  e.headQuietoDesde = {};
  return e;
}

test('head novo carimba o momento da primeira observação', async () => {
  const e = engineComPanorama({ 'acme/r#1': { stale: true, head: H1, lastState: 'APPROVED' } });
  await e.refreshStaleStates(1000);
  assert.deepEqual(e.headQuietoDesde['acme/r#1'], { head: H1, at: 1000 });
});

test('mesmo head em ciclo seguinte PRESERVA o carimbo (é isso que faz o tempo passar)', async () => {
  const e = engineComPanorama({ 'acme/r#1': { stale: true, head: H1, lastState: 'APPROVED' } });
  await e.refreshStaleStates(1000);
  await e.refreshStaleStates(5000);
  assert.equal(e.headQuietoDesde['acme/r#1'].at, 1000);
});

test('head que mudou re-carimba: rajada de pushes nunca acumula quietude', async () => {
  const info = { 'acme/r#1': { stale: true, head: H1, lastState: 'APPROVED' } };
  const e = engineComPanorama(info);
  await e.refreshStaleStates(1000);
  info['acme/r#1'] = { stale: true, head: H2, lastState: 'APPROVED' };
  await e.refreshStaleStates(2000);
  assert.deepEqual(e.headQuietoDesde['acme/r#1'], { head: H2, at: 2000 });
});

test('head vazio (indeterminado) não carimba nem apaga o carimbo anterior', async () => {
  const info = { 'acme/r#1': { stale: true, head: H1, lastState: 'APPROVED' } };
  const e = engineComPanorama(info);
  await e.refreshStaleStates(1000);
  info['acme/r#1'] = { stale: false, head: '', lastState: '' };
  await e.refreshStaleStates(2000);
  assert.deepEqual(e.headQuietoDesde['acme/r#1'], { head: H1, at: 1000 });
});
