// O casca.json leva o código de pareamento em claro por até 10 minutos, e o workspace é o
// cwd de toda sessão de IA. Por isso ele mora em ~/.farol/state/, fora do workspace, no
// caminho que o spec do Farol nativo define (revisão final do plano 1, I2).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-casca-fora-'));
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const paths = await import('../lib/paths.js');
const { publicarCasca } = await import('../lib/engine/casca-arquivo.js');

after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('CASCA_FILE mora em HOME/state, fora do WORKSPACE das sessões', () => {
  const { CASCA_FILE, CASCA_DIR, WORKSPACE } = paths;
  assert.equal(CASCA_DIR, path.join(paths.HOME, 'state'));
  assert.equal(CASCA_FILE, path.join(CASCA_DIR, 'casca.json'));
  assert.ok(CASCA_FILE.startsWith(paths.HOME + path.sep), 'dentro de ~/.farol');
  assert.ok(!CASCA_FILE.startsWith(WORKSPACE + path.sep), 'nunca dentro do workspace');
});

test('publicarCasca cria a pasta com 0700 quando ela não existe', () => {
  fs.rmSync(paths.CASCA_DIR, { recursive: true, force: true });
  publicarCasca({ config: {} }, 47191);
  assert.ok(fs.existsSync(paths.CASCA_FILE));
  if (!paths.IS_WIN) assert.equal(fs.statSync(paths.CASCA_DIR).mode & 0o777, 0o700);
});
