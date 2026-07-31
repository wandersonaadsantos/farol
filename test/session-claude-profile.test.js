'use strict';
// buildSessionScript/buildSessionScriptMac usam resolveClaudeConfigDir(account) em vez
// de ler config.claudeConfigDir direto — pra a sessão de terminal (Windows/mac) respeitar
// o perfil por conta, igual ao headless (ghEnv, ver ghEnv.test em claude-profiles.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSessionScript, buildSessionScriptMac } = require('../lib/engine/session');

// engine "de mentira": só precisa do que buildSessionScript/buildSessionScriptMac usam.
function fakeEngine(profiles) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeConfigDir(user) {
      const p = (profiles || {})[user];
      return p || '';
    },
    primaryUser() { return 'default-user'; }
  };
}

test('buildSessionScript (Windows): injeta o dir resolvido pra conta', () => {
  const engine = fakeEngine({ bob: 'C:\\biud-trabalho' });
  const script = buildSessionScript(engine, '/pr-review x', 'bob');
  assert.match(script, /set "CLAUDE_CONFIG_DIR=C:\\biud-trabalho"/);
});

test('buildSessionScript (Windows): sem dir resolvido, não seta CLAUDE_CONFIG_DIR', () => {
  const engine = fakeEngine({});
  const script = buildSessionScript(engine, '/pr-review x', 'alice');
  assert.match(script, /rem sem config dir proprio/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});

test('buildSessionScriptMac: injeta o dir resolvido pra conta', () => {
  const engine = fakeEngine({ bob: 'C:\\biud-trabalho' });
  const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'bob');
  assert.match(script, /export CLAUDE_CONFIG_DIR='C:\\biud-trabalho'/);
});

test('buildSessionScriptMac: sem dir resolvido, não exporta CLAUDE_CONFIG_DIR', () => {
  const engine = fakeEngine({});
  const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'alice');
  assert.match(script, /# sem config dir proprio/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});
