import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gravarBaseline, lerBaseline } from '../lib/engine/baseline.js';

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'farol-baseline-')); }

test('lerBaseline aceita o formato antigo (ISO) e o novo (JSON) e devolve null sem arquivo', () => {
  const dir = pasta();
  assert.equal(lerBaseline(path.join(dir, 'nao-existe')), null);
  const antigo = path.join(dir, 'antigo');
  fs.writeFileSync(antigo, '2026-09-15T00:00:00.000Z\n');
  assert.deepEqual(lerBaseline(antigo), { at: Date.parse('2026-09-15T00:00:00.000Z'), marcados: null });
  const novo = path.join(dir, 'novo');
  fs.writeFileSync(novo, JSON.stringify({ at: 1000, marcados: 14 }));
  assert.deepEqual(lerBaseline(novo), { at: 1000, marcados: 14 });
  const lixo = path.join(dir, 'lixo');
  fs.writeFileSync(lixo, 'qualquer coisa');
  assert.equal(lerBaseline(lixo), null);
});

test('gravarBaseline escreve JSON que lerBaseline lê de volta', () => {
  const arq = path.join(pasta(), 'baselined');
  gravarBaseline(arq, { at: 123456, marcados: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), { at: 123456, marcados: 3 });
  assert.deepEqual(lerBaseline(arq), { at: 123456, marcados: 3 });
});
