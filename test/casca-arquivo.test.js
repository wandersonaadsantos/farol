// state/casca.json (Farol nativo, Task 4): o arquivo pelo qual a casca nativa descobre o
// motor que subiu como sidecar. FAROL_HOME temporário antes do import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-casca-arquivo-'));
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { publicarCasca, lerCasca, apagarCasca, marcarProximaVersao } = await import('../lib/engine/casca-arquivo.js');
const { CASCA_FILE, APP_VERSION, IS_WIN } = await import('../lib/paths.js');
const { LOCAL_AUTH } = await import('../lib/constants.js');
const { tentarCodigo } = await import('../lib/local-auth/pareamento.js');

after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('publicarCasca grava porta, pid, versão e um código de uso único com 0600', () => {
  publicarCasca({ config: {} }, 47191);
  const c = lerCasca();
  assert.equal(c.porta, 47191); assert.equal(c.pid, process.pid); assert.equal(c.versao, APP_VERSION);
  assert.equal(c.codigoPareamento.length, LOCAL_AUTH.CODIGO_TAMANHO, 'o formato é o de gerarCodigo(): CODIGO_TAMANHO letras do ALFABETO, sem hífen');
  assert.equal(c.proximaVersao, null);
  if (!IS_WIN) assert.equal(fs.statSync(CASCA_FILE).mode & 0o777, 0o600);
  // Uso único: uma tentativa só, e a segunda com o mesmo código já não entra.
  const r = tentarCodigo(c.codigoPareamento);
  assert.equal(r.ok, true);
  assert.equal(r.classe, 'casca');
  assert.equal(tentarCodigo(c.codigoPareamento).ok, false);
});

test('marcarProximaVersao preserva o resto e apagarCasca remove', () => {
  publicarCasca({ config: {} }, 1);
  marcarProximaVersao('2.80.0');
  assert.equal(lerCasca().proximaVersao, '2.80.0'); assert.equal(lerCasca().porta, 1);
  apagarCasca(); assert.equal(lerCasca(), null);
});

test('lerCasca com arquivo corrompido devolve null', () => {
  fs.writeFileSync(CASCA_FILE, '{nope'); assert.equal(lerCasca(), null);
});
