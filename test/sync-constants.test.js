// lib/constants.js, objeto SYNC: o lar dos tempos e tetos da sincronização entre
// dispositivos, e a coerência dele com firebase/database.rules.json (as regras são
// JSON puro, sem como importar a constante, então o número se repete lá e é aqui que
// os dois são obrigados a concordar).
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import constants, { SYNC, TEMPOS } from '../lib/constants.js';

const REGRAS_PATH = path.join(import.meta.dirname, '..', 'firebase', 'database.rules.json');

test('SYNC: lease sem renovação vence ANTES do teto que as regras aceitam', () => {
  assert.ok(SYNC.LEASE_TTL_MS < SYNC.LEASE_TTL_MAX_MS);
  assert.ok(SYNC.HEARTBEAT_MS < SYNC.LEASE_TTL_MS, 'o heartbeat precisa renovar antes de o lease vencer');
});

test('SYNC: tempos e tetos são números positivos', () => {
  for (const k of ['LEASE_TTL_MS', 'LEASE_TTL_MAX_MS', 'HEARTBEAT_MS', 'PRESENCE_TICK_MS', 'TOKEN_MARGIN_MS',
    'REQUEST_TIMEOUT_MS', 'STREAM_RECONNECT_MS', 'STREAM_RECONNECT_MAX_MS', 'ESPERA_ALHEIO_MS', 'RECEIPT_TTL_MS',
    'ROUNDS_TTL_MS', 'ORPHAN_AFTER_MS', 'DAILY_ROUNDS_MAX', 'OUTBOX_BATCH', 'OUTBOX_MAX_REJEICOES', 'STREAM_IDLE_MS',
    'FAXINA_MS', 'FAXINA_MAX_PRS']) {
    assert.equal(typeof SYNC[k], 'number', k);
    assert.ok(Number.isFinite(SYNC[k]) && SYNC[k] > 0, k);
  }
  assert.equal(SYNC.PRESENCE_TICK_MS, 5 * 60000);
  assert.equal(SYNC.RECEIPT_TTL_MS, 180 * TEMPOS.DIA_MS);
  assert.equal(SYNC.ROUNDS_TTL_MS, 8 * TEMPOS.DIA_MS);
  assert.ok(SYNC.STREAM_RECONNECT_MS < SYNC.STREAM_RECONNECT_MAX_MS);
  // o banco manda keep-alive a cada ~30 s: a vigia tolera perder dois antes de derrubar
  assert.equal(SYNC.STREAM_IDLE_MS, 90 * 1000);
  assert.equal(SYNC.FAXINA_MS, TEMPOS.DIA_MS, 'uma faxina de retenção por dia');
  assert.equal(SYNC.FAXINA_MAX_PRS, 200);
  // a remoção antecipada de recibo por ausência do panorama saiu do MVP (D17): a
  // expiração de 180 dias cobre, e a constante sem uso não pode ficar sugerindo o contrário
  assert.equal(SYNC.PRUNE_STRIKES, undefined);
});

test('SYNC: textos de infra', () => {
  for (const k of ['IDENTITY_TOOLKIT_URL', 'SECURE_TOKEN_URL', 'CREDENTIALS_FILE', 'DEVICE_FILE', 'OUTBOX_FILE', 'DAY_TZ']) {
    assert.equal(typeof SYNC[k], 'string', k);
    assert.ok(SYNC[k].length > 0, k);
  }
  assert.match(SYNC.IDENTITY_TOOLKIT_URL, /^https:\/\//);
  assert.match(SYNC.SECURE_TOKEN_URL, /^https:\/\//);
  assert.equal(SYNC.DAY_TZ, 'America/Sao_Paulo');
});

test('SYNC viaja no export default e no nomeado', () => {
  assert.equal(constants.SYNC, SYNC);
});

function regras() {
  return JSON.parse(fs.readFileSync(REGRAS_PATH, 'utf8')).rules.users.$uid;
}

test('regras do banco: o teto de expiresAt do lease é SYNC.LEASE_TTL_MAX_MS', () => {
  const validate = regras().leases.$acct.$pr['.validate'];
  const tetos = [...validate.matchAll(/now \+ (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(tetos, [SYNC.LEASE_TTL_MAX_MS], 'um único teto, igual à constante');
  assert.ok(SYNC.LEASE_TTL_MS < SYNC.LEASE_TTL_MAX_MS, 'lease recém-escrito cabe no teto das regras');
});

test('regras do banco: dayPolicy das rodadas é SYNC.DAY_TZ', () => {
  const validate = regras().dailyRounds.$acct.$pr.$day['.validate'];
  const m = /newData\.child\('dayPolicy'\)\.val\(\) == '([^']+)'/.exec(validate);
  assert.ok(m, 'a regra confere dayPolicy');
  assert.equal(m[1], SYNC.DAY_TZ);
});

test('regras do banco: leitura e escrita só do próprio uid', () => {
  const u = regras();
  assert.equal(u['.read'], 'auth != null && auth.uid == $uid');
  // A C1 tirou o '.write' da RAIZ (era ele que permitia o apagão de /users/{uid}). A
  // garantia continua a mesma e fica mais forte: a escrita passou a ser concedida nó a
  // nó, e toda concessão exige o próprio uid.
  assert.equal(u['.write'], undefined);
  const comEscrita = Object.keys(u).filter((k) => u[k] && u[k]['.write']);
  assert.ok(comEscrita.length > 0, 'algum nó precisa conceder escrita, senão nada sobe');
  // o keyring exige mais que o dono (senha recente, rev monotônico), então o que vale
  // para todos é conter a checagem do uid, nunca dispensá-la
  for (const no of comEscrita) assert.ok(u[no]['.write'].startsWith('auth != null && auth.uid == $uid'), no);
});

test('firebase.json aponta as regras e fixa as portas do emulador', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'firebase', 'firebase.json'), 'utf8'));
  assert.equal(cfg.database.rules, 'database.rules.json');
  assert.equal(cfg.emulators.database.port, 9000);
  assert.equal(cfg.emulators.auth.port, 9099);
});

test('SYNC: o login do emulador aponta para a porta do Auth que o firebase.json fixa', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'firebase', 'firebase.json'), 'utf8'));
  const origem = `http://127.0.0.1:${cfg.emulators.auth.port}`;
  assert.equal(SYNC.AUTH_EMULATOR_IDENTITY_URL, `${origem}/identitytoolkit.googleapis.com/v1`);
  assert.equal(SYNC.AUTH_EMULATOR_TOKEN_URL, `${origem}/securetoken.googleapis.com/v1/token`);
});
