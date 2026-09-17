// A sincronização não depende do GitHub, e o ciclo de monitoramento não pode levá-la junto
// quando a parte do GitHub falha. Medido na bancada em 16/09/2026: uma conta sem token no gh
// fazia a coleta lançar erro, o ciclo pulava o tick da sincronização, e o aparelho nunca
// reescrevia presença nem ligava o relógio da visão compartilhada (o admin ficou sem
// batimento indefinidamente).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-tick-independente-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.schedule = () => { };
  e.ticks = 0;
  e.syncTick = async () => { e.ticks += 1; return { ok: true }; };
  return e;
}

test('coleta do GitHub que lança erro não impede o tick da sincronização', async () => {
  const e = motor();
  e._coletarPanorama = async () => { throw new Error('conta alice sem token no gh'); };
  await e.check('teste');
  assert.equal(e.status, 'error', 'o ciclo continua dizendo que o monitoramento falhou');
  assert.equal(e.ticks, 1, 'e a sincronização rodou mesmo assim');
});

test('ciclo sem erro continua com um tick só', async () => {
  const e = motor();
  e._coletarPanorama = async () => ({ panorama: [], queue: [], fresh: [], mineList: [], ownersOk: new Set(), monitoredOwners: new Set() });
  e.refreshReviewSignals = async () => { };
  e._dispararAutomacoes = async () => { };
  await e.check('teste');
  assert.equal(e.ticks, 1);
});

function motorDeColeta({ ownerFalha = false, autoriaFalha = false } = {}) {
  const e = motor();
  e.resolveAccount = async () => { };
  e.refreshTokens = async () => { };
  e.accountList = () => [{ user: 'Eu', owners: ['Org'] }];
  e.tokenFor = () => 'tok';
  e.isMuted = () => false;
  e.accountForPr = () => 'Eu';
  e.accountForOwner = () => 'Eu';
  e.myAuthoredPRs = async () => (autoriaFalha ? null : []);
  e.searchPRs = async (args) => (ownerFalha && args[0] === '--owner' ? null : []);
  return e;
}

// A guarda do arranque a frio (lib/engine/sync-andamento.js, publicarEscopos) depende de o
// ciclo marcar só as buscas que responderam.
test('a coleta marca owner e conta só quando a busca respondeu', async () => {
  const boa = motorDeColeta();
  await boa._coletarPanorama();
  assert.equal(boa.ownersJaLidos.has('org'), true);
  assert.equal(boa.contasMeusPrsLidas.has('eu'), true);
  const ruim = motorDeColeta({ ownerFalha: true, autoriaFalha: true });
  await ruim._coletarPanorama();
  assert.equal(ruim.ownersJaLidos.size, 0, 'busca do owner que falhou não conta como lida');
  assert.equal(ruim.contasMeusPrsLidas.size, 0, 'busca de autoria que falhou não conta como lida');
});
