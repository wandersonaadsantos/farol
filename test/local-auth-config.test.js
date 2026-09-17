// A chave localAuth existe no config e NÃO vem da tela nem do POST /api/settings: uma
// página sem credencial não pode ligar nem desligar a própria proteção (A4).
//
// E, por CT-COMPAT (a) ("efeito zero quando não habilitado"), quem nunca ligou o recurso
// não ganha chave nova no config.json: a gravação omite a chave enquanto ela estiver no
// padrão. Isso vale de verdade porque o saveConfig grava o config INTEIRO a cada
// preferência salva, então sem a omissão a primeira troca de tema carimbaria localAuth no
// arquivo de todo mundo.
//
// FAROL_HOME temporário ANTES do import do engine (test/test-isolation.test.js). HOME e
// USERPROFILE também apontam para o temporário: o boot da Engine escreve
// ~/.claude.json (ensureWorkspaceTrusted), e teste nenhum pode mexer no arquivo real.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-local-auth-config-' + process.pid);
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, EDITAVEIS, paraGravar } from '../lib/settings.js';

const { Engine } = await import('../server.js');
const { CONFIG_FILE } = await import('../lib/paths.js');

function configGravada() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('localAuth existe no config com padrão vazio (não exige)', () => {
  assert.ok('localAuth' in defaults(1), 'a chave precisa estar na tabela única');
  assert.equal(defaults(1).localAuth, '');
});

test('localAuth não é editável pela tela nem pelo updateSettings', () => {
  assert.equal(EDITAVEIS.has('localAuth'), false);
});

test('paraGravar omite a chave no padrão e preserva quem ligou', () => {
  assert.equal('localAuth' in paraGravar({ localAuth: '', theme: 'dark' }), false);
  assert.equal(paraGravar({ localAuth: 'exigir' }).localAuth, 'exigir');
  assert.deepEqual(paraGravar({ theme: 'dark' }), { theme: 'dark' }, 'o resto da config passa inteiro');
});

test('quem nunca ligou o recurso não ganha localAuth no config.json (CT-COMPAT a)', () => {
  const engine = new Engine();
  assert.equal(engine.config.localAuth, '', 'em memória a chave existe com o padrão');
  assert.equal('localAuth' in configGravada(), false, 'o boot não carimba a chave no arquivo');
  engine.updateSettings({ soundEnabled: false });
  assert.equal('localAuth' in configGravada(), false, 'salvar preferência também não carimba');
});

test('quem ligou localAuth no arquivo não perde a chave ao salvar preferência', () => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ localAuth: 'exigir' }));
  const engine = new Engine();
  assert.equal(engine.config.localAuth, 'exigir');
  engine.updateSettings({ soundEnabled: false });
  assert.equal(configGravada().localAuth, 'exigir', 'a gravação preserva o que não está no padrão');
});
