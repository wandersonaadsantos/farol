// A primeira checagem da vida (lib/engine/baseline.js, registrarBaseline): o estoque fica
// visto e ignorado, o arquivo é gravado, o engine guarda o retrato e a tela recebe o aviso
// com singular e plural.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrarBaseline, lerBaseline } from '../lib/engine/baseline.js';

function engineFalso() {
  const e = { vistos: [], ignorados: [], toasts: [], baseline: null };
  e.markSeen = (k) => e.vistos.push(k);
  e.marcarIgnorado = (k) => e.ignorados.push(k);
  e.emit = (tipo, dados) => e.toasts.push([tipo, dados]);
  return e;
}

test('registrarBaseline marca o estoque, grava o arquivo, guarda o retrato e avisa', () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'farol-baseline-reg-')), 'baselined');
  const e = engineFalso();
  registrarBaseline(e, arq, [{ key: 'o/r#1' }, { key: 'o/r#2' }]);
  assert.deepEqual(e.vistos, ['o/r#1', 'o/r#2']);
  assert.deepEqual(e.ignorados, ['o/r#1', 'o/r#2']);
  assert.equal(e.baseline.marcados, 2);
  assert.deepEqual(lerBaseline(arq), e.baseline);
  assert.equal(e.toasts.length, 1);
  assert.equal(e.toasts[0][0], 'toast');
  assert.equal(e.toasts[0][1].kind, 'info');
  assert.match(e.toasts[0][1].text, /^Primeira checagem: 2 PRs que já pediam sua revisão ficaram fora da fila/);
});

test('registrarBaseline com um PR usa o singular', () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'farol-baseline-reg-')), 'baselined');
  const e = engineFalso();
  registrarBaseline(e, arq, [{ key: 'o/r#1' }]);
  assert.match(e.toasts[0][1].text, /^Primeira checagem: 1 PR que já pedia sua revisão ficou fora da fila/);
});
