// Cobre focusPr: o deep-link de alerta emite 'focus-pr' com a URL do PR
// (o shell chama no clique da notificação; a UI recebe via SSE e rola até o card).
// Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-focus-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

test('focusPr emite focus-pr com a url', () => {
  const e = new Engine();
  const got = [];
  e.on('focus-pr', p => got.push(p));
  e.focusPr('https://github.com/org/repo/pull/1');
  assert.deepEqual(got, [{ url: 'https://github.com/org/repo/pull/1' }]);
});

test('focusPr sem url nao emite nada', () => {
  const e = new Engine();
  const got = [];
  e.on('focus-pr', p => got.push(p));
  e.focusPr('');
  e.focusPr(null);
  assert.equal(got.length, 0);
});
