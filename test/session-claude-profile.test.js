'use strict';
// buildSessionScript/buildSessionScriptMac usam resolveClaudeConfigDir(account) em vez
// de ler config.claudeConfigDir direto — pra a sessão de terminal (Windows/mac) respeitar
// o perfil por conta, igual ao headless (ghEnv, ver ghEnv.test em claude-profiles.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsMod = require('node:fs');
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

// Prova de verdade (execução real com bash, não só leitura do template literal) de que
// um `dir` com aspa simples não escapa da atribuição `export CLAUDE_CONFIG_DIR='...'`
// e executa comando arbitrário. Achado de auditoria adversarial (Fix 2).
test('buildSessionScriptMac: aspa simples no dir é escapada, não quebra a string bash (execução real)', () => {
  const proofFile = path.join(os.tmpdir(), 'PROOF_INJECTION_' + process.pid).replace(/\\/g, '/');
  const maliciousDir = `/tmp/x' ; touch ${proofFile} #`;
  const engine = fakeEngine({ bob: maliciousDir });
  const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'bob');
  const exportLine = script.split('\n').find(l => l.startsWith('export CLAUDE_CONFIG_DIR'));
  assert.ok(exportLine, 'linha do export existe no script gerado');

  const { execSync } = require('node:child_process');
  const tmpScript = path.join(os.tmpdir(), 'farol-test-escape-' + process.pid + '.sh');
  try { fsMod.unlinkSync(proofFile); } catch { /* já não existe */ }
  fsMod.writeFileSync(tmpScript, `#!/bin/bash\n${exportLine}\necho "va-$CLAUDE_CONFIG_DIR-lor"\n`);
  let out;
  try {
    out = execSync(`bash "${tmpScript}"`).toString();
  } finally {
    try { fsMod.unlinkSync(tmpScript); } catch { /* best-effort */ }
  }
  assert.equal(fsMod.existsSync(proofFile), false, 'comando injetado NÃO deve ter rodado (touch do arquivo de prova)');
  assert.match(out, /va-\/tmp\/x' ; touch .* #-lor/, 'valor preservado como string literal única, aspa simples incluída');
  try { fsMod.unlinkSync(proofFile); } catch { /* limpeza, caso o teste falhe e o comando tenha rodado */ }
});
