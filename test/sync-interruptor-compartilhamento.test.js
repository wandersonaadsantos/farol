// O quarto interruptor da sincronização (CT-ENV): compartilhamento de conteúdo cifrado.
// Nasce desligado, só liga com true explícito e nunca liga sozinho por config editado à
// mão, corrompido ou de versão antiga, pela mesma razão dos outros três.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-interruptor-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const cfgMod = (await import('../lib/sync/config.js')).default;
const { sharedActive } = await import('../lib/sync/config.js');
const syncMod = (await import('../lib/engine/sync.js')).default;
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

test('o padrão nasce desligado, com a mesma forma dos outros interruptores', () => {
  const d = cfgMod.syncDefaults();
  assert.deepEqual(d.shared, { enabled: false });
});

test('só true explícito liga; qualquer outro valor fica desligado', () => {
  for (const v of [undefined, null, 'true', 1, {}, { enabled: 'true' }, { enabled: 1 }]) {
    assert.deepEqual(cfgMod.parseSyncConfig({ shared: v }).shared, { enabled: false }, JSON.stringify(v));
  }
  assert.deepEqual(cfgMod.parseSyncConfig({ shared: { enabled: true } }).shared, { enabled: true });
});

test('sharedActive exige a chave geral ligada também', () => {
  assert.equal(sharedActive({ enabled: false, shared: { enabled: true } }), false);
  assert.equal(sharedActive({ enabled: true, shared: { enabled: false } }), false);
  assert.equal(sharedActive({ enabled: true, shared: { enabled: true } }), true);
  assert.equal(sharedActive(null), false);
});

test('statusForUi expõe o interruptor, e ele é falso por padrão', () => {
  const e = new Engine();
  assert.equal(syncMod.statusForUi(e).shared, false);
  e.config.sync = { ...e.config.sync, enabled: true, shared: { enabled: true } };
  assert.equal(syncMod.statusForUi(e).shared, true);
});

test('desligar a chave geral zera o compartilhamento no objeto salvo', () => {
  const salvo = cfgMod.parseSyncConfig({ enabled: false, shared: { enabled: true } });
  assert.equal(sharedActive(salvo), false);
});
