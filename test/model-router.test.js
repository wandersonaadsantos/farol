// Roteador de modelo por custo-benefício (lib/engine/model-router.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAutoModel, escolheModelo, rotuloOrigem,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
} from '../lib/engine/model-router.js';

test('isAutoModel: só a string auto (caixa ignorada)', () => {
  assert.equal(isAutoModel('auto'), true);
  assert.equal(isAutoModel('AUTO'), true);
  assert.equal(isAutoModel(' auto '), true);
  assert.equal(isAutoModel('sonnet'), false);
  assert.equal(isAutoModel(''), false);
  assert.equal(isAutoModel(null), false);
});

test('escolheModelo: modelo pinado devolve a config, sem olhar métricas', () => {
  const r = escolheModelo({ lines: 50, changedFiles: 2 }, {
    reviewModel: 'opus', reviewEffort: 'xhigh', reviewFast: true,
  });
  assert.deepEqual(r, { model: 'opus', effort: 'xhigh', fast: true, origem: 'config' });
});

test('escolheModelo: auto + PR pequeno -> haiku + fast', () => {
  const r = escolheModelo(
    { lines: PEQUENO_LINHAS - 1, changedFiles: PEQUENO_ARQUIVOS - 1 },
    { reviewModel: 'auto' },
  );
  assert.equal(r.model, 'haiku');
  assert.equal(r.effort, '');
  assert.equal(r.fast, true);
  assert.equal(r.origem, 'auto-pequeno');
});

test('escolheModelo: auto + PR médio -> sonnet', () => {
  const r = escolheModelo(
    { lines: 400, changedFiles: 10 },
    { reviewModel: 'auto', reviewFast: false },
  );
  assert.equal(r.model, 'sonnet');
  assert.equal(r.effort, 'medium');
  assert.equal(r.fast, false);
  assert.equal(r.origem, 'auto-medio');
});

test('escolheModelo: auto + PR grande (limiar fan-out) -> sonnet high', () => {
  const r = escolheModelo(
    { lines: MEDIO_LINHAS, changedFiles: 3 },
    { reviewModel: 'auto' },
  );
  assert.equal(r.model, 'sonnet');
  assert.equal(r.effort, 'high');
  assert.equal(r.fast, false);
  assert.equal(r.origem, 'auto-grande');
});

test('escolheModelo: auto + muitos arquivos também é grande', () => {
  const r = escolheModelo(
    { lines: 100, changedFiles: MEDIO_ARQUIVOS },
    { reviewModel: 'auto' },
  );
  assert.equal(r.origem, 'auto-grande');
});

test('escolheModelo: auto sem métrica degrada pra sonnet (nunca haiku)', () => {
  const r = escolheModelo(null, { reviewModel: 'auto' });
  assert.equal(r.model, 'sonnet');
  assert.equal(r.effort, 'medium');
  assert.equal(r.fast, false);
  assert.equal(r.origem, 'auto-sem-metrica');
});

test('escolheModelo: auto no médio herda reviewFast da config', () => {
  const r = escolheModelo(
    { lines: 300, changedFiles: 8 },
    { reviewModel: 'auto', reviewFast: true },
  );
  assert.equal(r.origem, 'auto-medio');
  assert.equal(r.fast, true);
});

test('rotuloOrigem: cobre as origens conhecidas', () => {
  assert.match(rotuloOrigem('auto-pequeno'), /haiku/i);
  assert.match(rotuloOrigem('auto-grande'), /sonnet/i);
  assert.equal(rotuloOrigem('config'), 'modelo fixo da configuração');
});
