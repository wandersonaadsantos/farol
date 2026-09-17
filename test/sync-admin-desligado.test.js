// Admin e políticas DESLIGADOS: o Farol se comporta como hoje. Este arquivo nasce antes da
// mudança e continua verde depois (CT-COMPAT e CT-ADM-POL, "sem cache vale a config local").
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-desligado-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const cfgMod = (await import('../lib/sync/config.js')).default;
const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

test('o padrão não aceita admin: aceitarAdmin nasce desligado', () => {
  assert.equal(cfgMod.syncDefaults().aceitarAdmin, false);
  for (const v of [undefined, null, 'true', 1, {}]) {
    assert.equal(cfgMod.parseSyncConfig({ aceitarAdmin: v }).aceitarAdmin, false, JSON.stringify(v));
  }
  assert.equal(cfgMod.parseSyncConfig({ aceitarAdmin: true }).aceitarAdmin, true);
});

test('nenhum payload remoto liga o consentimento: a chave não vem do banco', () => {
  const salvo = cfgMod.parseSyncConfig({ aceitarAdmin: true, politica: { aceitarAdmin: true } });
  assert.equal(salvo.aceitarAdmin, true, 'só a tela local liga');
  assert.equal(salvo.politica, undefined, 'política não entra no config');
});

test('sem admin e sem política, o status não promete autoridade nenhuma', () => {
  const e = new Engine();
  const s = syncMod.statusForUi(e);
  assert.equal(s.admin, undefined);
  assert.equal(s.autoridade, undefined);
});

test('arquivo de política e de chave de admin não existem sem ninguém pedir', () => {
  const e = new Engine();
  assert.ok(e);
  assert.equal(fs.existsSync(path.join(CASA, '.farol', 'sync-policy.json')), false);
  assert.equal(fs.existsSync(path.join(CASA, '.farol', 'sync-admin.json')), false);
});
