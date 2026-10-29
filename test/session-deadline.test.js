import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionDeadline } from '../lib/session-deadline.js';
import { TEMPOS } from '../lib/constants.js';

test('recuperação detecta silêncio em cinco minutos, mas progresso e cancelamento são preservados', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = [];
  const active = sessionDeadline(e => errors.push(e), () => false, { recovery: true });
  sessionDeadline(e => errors.push(e), () => true, { recovery: true });
  t.mock.timers.tick(TEMPOS.RECUPERACAO_SEM_PROGRESSO_MS - 1);
  assert.equal(errors.length, 0);
  active.progress();
  t.mock.timers.tick(TEMPOS.RECUPERACAO_SEM_PROGRESSO_MS - 1);
  assert.equal(errors.length, 0);
  t.mock.timers.tick(1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /5min sem progresso/);
});

test('progresso estende a sessão além de 30min, mas nunca além do teto absoluto', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = [];
  const deadline = sessionDeadline(e => errors.push(e));
  const step = TEMPOS.SESSAO_SEM_PROGRESSO_MS / 2;
  for (let elapsed = step; elapsed < TEMPOS.SESSAO_HEADLESS_MS; elapsed += step) {
    t.mock.timers.tick(step);
    deadline.progress();
    assert.equal(errors.length, 0);
  }
  t.mock.timers.tick(step);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /2h/);
  deadline.progress();
  t.mock.timers.tick(TEMPOS.SESSAO_HEADLESS_MS);
  assert.equal(errors.length, 1, 'expiração é única');
});

test('sem progresso encerra em 30min; stop e cancelamento não disparam erro tardio', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = [];
  sessionDeadline(e => errors.push(e));
  const stopped = sessionDeadline(e => errors.push(e));
  stopped.stop();
  sessionDeadline(e => errors.push(e), () => true);
  t.mock.timers.tick(TEMPOS.SESSAO_SEM_PROGRESSO_MS);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /sem progresso/);
  t.mock.timers.tick(TEMPOS.SESSAO_HEADLESS_MS);
  assert.equal(errors.length, 1);
});
