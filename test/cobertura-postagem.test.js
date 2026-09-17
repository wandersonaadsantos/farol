// CT-COMPAT, ativação por versão: a arbitragem de postagem só é declarada coberta para uma
// conta quando todo aparelho visto participa do protocolo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-cobertura-postagem-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { coberturaDePostagem, compararVersao, POSTAGEM_COORDENADA_DESDE } from '../lib/sync/cobertura-postagem.js';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const NOVO = { name: 'Notebook', farolVersion: POSTAGEM_COORDENADA_DESDE, lastSeenAt: 1 };

test('a versão mínima é posterior à última medida sem a arbitragem (2.59.3)', () => {
  assert.equal(compararVersao(POSTAGEM_COORDENADA_DESDE, '2.59.3'), 1);
  assert.equal(compararVersao('2.10.0', '2.9.9'), 1);
  assert.equal(compararVersao('x', '2.9.9'), null);
});

test('todos os aparelhos na versão que participa: coberta', () => {
  assert.deepEqual(coberturaDePostagem({ d1: NOVO, d2: { ...NOVO, name: 'Desktop', farolVersion: '9.0.0' } }, 'eu'), { account: 'eu', coberta: true, naoCobertaPor: [] });
});

test('um aparelho antigo, mesmo sem batimento recente: não coberta, nomeando o aparelho', () => {
  const r = coberturaDePostagem({ d1: NOVO, d2: { name: 'Desktop velho', farolVersion: '2.59.3', lastSeenAt: 0 } }, 'eu');
  assert.deepEqual(r, { account: 'eu', coberta: false, naoCobertaPor: ['Desktop velho'] });
});

test('aparelho sem versão legível conta como antigo; sem nome, vale o id', () => {
  assert.deepEqual(coberturaDePostagem({ d9: { farolVersion: '' } }, 'eu').naoCobertaPor, ['d9']);
});

test('nenhum aparelho visto: não declara cobertura', () => {
  assert.equal(coberturaDePostagem({}, 'eu').coberta, false);
  assert.equal(coberturaDePostagem(null, 'eu').coberta, false);
});

test('statusForUi: uma entrada por conta com a coordenação ligada, nenhuma com ela desligada', () => {
  const e = new Engine();
  e.config.accounts = [{ user: 'eu', owners: ['o'] }];
  e.sync.devices = { d1: NOVO, d2: { name: 'Desktop velho', farolVersion: '2.59.3', lastSeenAt: 0 } };
  assert.deepEqual(syncMod.statusForUi(e).coberturaPostagem, []);
  e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  assert.deepEqual(syncMod.statusForUi(e).coberturaPostagem, [{ account: 'eu', coberta: false, naoCobertaPor: ['Desktop velho'] }]);
});
