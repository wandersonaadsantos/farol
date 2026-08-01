'use strict';
// updateSettings: allowlist e validação de reviewModel/reviewEffort pelo caminho HTTP.
// Complementa boot.test.js (que cobre o saneamento do config.json) e model-effort.test.js
// (que cobre as funções puras). Aqui é o contrato da API: o que a UI manda, o que grava.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = path.join(os.tmpdir(), 'farol-test-settings-me-' + process.pid);
process.env.FAROL_HOME = HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('updateSettings grava os aliases de modelo expostos', () => {
  const engine = new Engine();
  for (const m of ['best', 'opus', 'sonnet', 'haiku', 'fable', '']) {
    engine.updateSettings({ reviewModel: m });
    assert.equal(engine.config.reviewModel, m, `alias ${m || '(vazio)'}`);
  }
});

test('updateSettings grava os níveis de esforço expostos', () => {
  const engine = new Engine();
  for (const e of ['low', 'medium', 'high', 'xhigh', '']) {
    engine.updateSettings({ reviewEffort: e });
    assert.equal(engine.config.reviewEffort, e, `nível ${e || '(vazio)'}`);
  }
});

test('updateSettings normaliza espaço e caixa', () => {
  const engine = new Engine();
  engine.updateSettings({ reviewModel: '  SONNET ' });
  assert.equal(engine.config.reviewModel, 'sonnet');
  engine.updateSettings({ reviewEffort: '  HIGH ' });
  assert.equal(engine.config.reviewEffort, 'high');
});

test('updateSettings MANTÉM o anterior quando o valor é inválido', () => {
  // semântica de sempre: descarta em silêncio em vez de zerar, pra um patch torto não
  // apagar a escolha do usuário. A UI mostra o valor aceito no próximo estado.
  const engine = new Engine();
  engine.updateSettings({ reviewModel: 'fable', reviewEffort: 'xhigh' });

  engine.updateSettings({ reviewModel: 'opusplan' });   // plan mode não existe em claude -p
  assert.equal(engine.config.reviewModel, 'fable');
  engine.updateSettings({ reviewModel: 'default' });    // indistinguível de ''
  assert.equal(engine.config.reviewModel, 'fable');
  engine.updateSettings({ reviewModel: 'opus && calc.exe' });
  assert.equal(engine.config.reviewModel, 'fable');

  engine.updateSettings({ reviewEffort: 'max' });       // session-only
  assert.equal(engine.config.reviewEffort, 'xhigh');
  engine.updateSettings({ reviewEffort: 'ultracode' }); // session-only
  assert.equal(engine.config.reviewEffort, 'xhigh');
});

test('updateSettings aceita nome completo de modelo (escotilha sem release)', () => {
  const engine = new Engine();
  engine.updateSettings({ reviewModel: 'claude-opus-5' });
  assert.equal(engine.config.reviewModel, 'claude-opus-5');
});

test('updateSettings não cria chave fora da allowlist', () => {
  const engine = new Engine();
  engine.updateSettings({ reviewEffortTypo: 'xhigh', esforco: 'high' });
  assert.equal('reviewEffortTypo' in engine.config, false);
  assert.equal('esforco' in engine.config, false);
});

test('updateSettings persiste modelo e esforço no config.json', () => {
  const engine = new Engine();
  engine.updateSettings({ reviewModel: 'sonnet', reviewEffort: 'low' });
  const gravado = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
  assert.equal(gravado.reviewModel, 'sonnet');
  assert.equal(gravado.reviewEffort, 'low');
});
