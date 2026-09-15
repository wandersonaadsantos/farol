// C0, defeito 1 (spec 7.C0): PR bloqueado por recibo de outro aparelho oscilava na fila.
//
// A admissão ouve "recibo" e o coordenador marca o PR como visto (registrarRecibo). No
// ciclo seguinte reconciliarVistos via "visto sem decisão local" e devolvia o PR à fila
// como se fosse uma revisão que morreu no meio; a automação o admitia de novo, ouvia o
// mesmo recibo e o WARN saía em todo ciclo. Reiniciar o app recomeçava a oscilação.
//
// O teste roda o CICLO de verdade (_coletarPanorama, que é onde reconciliarVistos é
// chamado antes do filtro da fila), com a busca do gh stubada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-recibo-visto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { STATE_DIR, IGNORED_FILE, BASELINE_FILE } = await import('../lib/paths.js');
const { registrarRecibo } = await import('../lib/sync/coordinator.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const KEY = 'org/repo#42';
const PR = { key: KEY, url: 'https://github.com/org/repo/pull/42', repo: 'org/repo', number: 42, title: 't', author: 'dev', updatedAt: '2026-09-15T10:00:00Z' };
const ARQUIVO = path.join(STATE_DIR, 'sync-vistos-por-recibo.json');

// baseline já feito e ignorados já migrado: sem isso o primeiro ciclo marcaria o PR como
// descarte deliberado e o teste não mediria nada
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.writeFileSync(BASELINE_FILE, '2026-09-15T00:00:00.000Z\n');
fs.writeFileSync(IGNORED_FILE, '');

function motor() {
  const e = new Engine();
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.pushState = () => { };
  e.resolveAccount = async () => { };
  e.refreshTokens = async () => { };
  e.accountList = () => [{ user: 'eu', owners: ['org'] }];
  e.tokenFor = () => 'tok';
  e.isMuted = () => false;
  e.accountForPr = () => 'eu';
  e.accountForOwner = () => 'eu';
  e.myAuthoredPRs = async () => [];
  e.searchPRs = async (args) => (args[0] === '--reviewed-by=@me' ? [] : [{ ...PR }]);
  return e;
}

const voltouComWarn = (e) => e.logs.some((l) => /voltaram à fila/.test(l));

test('PR bloqueado por recibo não volta à fila nem loga WARN nos ciclos seguintes, nem depois de reiniciar', async () => {
  const e = motor();
  const c1 = await e._coletarPanorama();
  assert.equal(c1.queue.some((p) => p.key === KEY), true, 'ciclo 1: PR novo está na fila');
  assert.equal(fs.existsSync(ARQUIVO), false, 'sem recibo nenhum, nenhum arquivo novo (CT-COMPAT)');

  // a automação lança (markSeen do lançamento) e a admissão ouve "recibo"
  e.markSeen(KEY);
  registrarRecibo(e, { prKey: KEY, operationKind: 'review' }, { deviceId: 'dOutro', completedAt: Date.now(), publicationState: 'published', operationKind: 'review' });
  assert.equal(fs.existsSync(ARQUIVO), true, 'o visto por recibo vai para o disco');

  for (const ciclo of [2, 3]) {
    const c = await e._coletarPanorama();
    assert.equal(c.queue.some((p) => p.key === KEY), false, `ciclo ${ciclo}: não volta à fila`);
    assert.equal(voltouComWarn(e), false, `ciclo ${ciclo}: nenhum WARN de devolução`);
  }

  const reiniciado = motor();
  assert.equal(reiniciado.seen.has(KEY), true);
  assert.equal(reiniciado.vistosPorRecibo.has(KEY), true, 'o conjunto sobrevive ao reinício');
  const c4 = await reiniciado._coletarPanorama();
  assert.equal(c4.queue.some((p) => p.key === KEY), false, 'depois do reinício também não volta');
  assert.equal(voltouComWarn(reiniciado), false, 'nem loga WARN depois do reinício');
});

test('unsee tira a chave do conjunto e grava: PR que volta à fila por outro caminho não fica protegido pra sempre', () => {
  const e = motor();
  e.marcarVistoPorRecibo('org/repo#77');
  e.seen.add('org/repo#77');
  e.unsee('org/repo#77');
  assert.equal(e.vistosPorRecibo.has('org/repo#77'), false);
  assert.equal(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')).includes('org/repo#77'), false);
});

test('arquivo com formato errado degrada para conjunto vazio sem derrubar o boot', () => {
  const salvo = fs.readFileSync(ARQUIVO, 'utf8');
  fs.writeFileSync(ARQUIVO, '{}');
  try {
    const e = motor();
    assert.equal(e.vistosPorRecibo.size, 0);
  } finally {
    fs.writeFileSync(ARQUIVO, salvo);
  }
});
