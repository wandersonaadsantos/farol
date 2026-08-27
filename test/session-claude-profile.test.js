// buildSessionScript/buildSessionScriptMac usam resolveClaudeConfigDir(account) em vez
// de ler config.claudeConfigDir direto — pra a sessão de terminal (Windows/mac) respeitar
// o perfil por conta, igual ao headless (ghEnv, ver ghEnv.test em claude-profiles.test.js).
import os from 'node:os';
import path from 'node:path';
import fsMod from 'node:fs';

// spawnLoginConsole (Fix 2, mais abaixo) grava um .cmd de verdade em HOME/sessions -
// fixar FAROL_HOME num diretório temporário ANTES de qualquer require que carregue
// lib/paths.js (const de nível de módulo, lida uma única vez no load), senão o teste
// escreve dentro do ~/.farol real da máquina (mesmo padrão de test/boot.test.js e
// test/session-unsee-on-exit.test.js).
const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-sessprofile-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Mock de child_process.spawn pros testes de spawnLoginConsole (Fix 2): lib/engine/session.js
// faz `const { spawn } = require('child_process')` no load do módulo (const de nível de
// módulo), então o mock precisa estar em vigor ANTES do primeiro require de
// lib/engine/session logo abaixo - trocar a propriedade depois não afeta a referência já
// capturada lá dentro. Quando nenhum teste setar spawnImpl, delega pro spawn real (os
// outros testes deste arquivo só testam build*Script, funções puras que não chamam spawn).
import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const {
  buildSessionScript, buildSessionScriptMac, buildLoginScript, buildLoginScriptMac,
  buildCodexLoginScript, buildCodexLoginScriptMac, codexLoginConsoleEnv,
  spawnLoginConsole, spawnCodexLoginConsole
} = await import('../lib/engine/session.js');
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';

after(() => {
  childProcess.spawn = realSpawn;
  try { fsMod.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// engine "de mentira": só precisa do que buildSessionScript/buildSessionScriptMac usam.
function fakeEngine(profiles) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeAuth(user) {
      const dir = (profiles || {})[user] || '';
      return { kind: 'dir', dir };
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
  // desde o G21 o posix cita CLAUDE_CONFIG_DIR na linha de unset, então o que não pode
  // existir é o EXPORT (unset sem export = padrão da máquina, que é o comportamento certo)
  assert.doesNotMatch(script, /export CLAUDE_CONFIG_DIR/);
});

// engine "de mentira" v2: expõe resolveClaudeAuth (o que buildSessionScript passa a
// chamar), pros casos que envolvem perfil apikey. A fakeEngine original (linha 43-52)
// continua servindo os testes de perfil dir de sempre.
function fakeEngineAuth(authByUser) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeAuth(user) {
      return (authByUser || {})[user] || { kind: 'dir', dir: '' };
    },
    primaryUser() { return 'default-user'; }
  };
}

test('buildSessionScript (Windows): perfil apikey da conta seta ANTHROPIC_API_KEY, não CLAUDE_CONFIG_DIR', () => {
  const engine = fakeEngineAuth({ bob: { kind: 'apikey', apiKey: 'sk-ant-abc', baseUrl: '' } });
  const script = buildSessionScript(engine, '/pr-review x', 'bob');
  assert.match(script, /set "ANTHROPIC_API_KEY=sk-ant-abc"/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});

test('buildSessionScriptMac: perfil apikey da conta, com baseUrl, escaping de aspa simples', () => {
  const engine = fakeEngineAuth({ bob: { kind: 'apikey', apiKey: "sk-ant-abc' ; touch /tmp/PROOF #", baseUrl: 'https://proxy.x' } });
  const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'bob');
  assert.match(script, /export ANTHROPIC_API_KEY='sk-ant-abc'\\''/);
  assert.match(script, /export ANTHROPIC_BASE_URL='https:\/\/proxy\.x'/);
  assert.doesNotMatch(script, /export CLAUDE_CONFIG_DIR/); // ver nota do G21 acima
});

// Fix 2: sessão de terminal SÓ pra `claude login`, sem slash command, sem keys, sem
// token do gh - buildLoginScript/buildLoginScriptMac recebem o dir já resolvido
// (resolveConfigDirForLogin em server.js), diferente de buildSessionScript que resolve
// por conta GitHub.
test('buildLoginScript (Windows): roda claude puro, sem slash command, dir aplicado', () => {
  const engine = fakeEngine({});
  const script = buildLoginScript(engine, 'C:\\biud-trabalho');
  assert.match(script, /set "CLAUDE_CONFIG_DIR=C:\\biud-trabalho"/);
  assert.match(script, /^claude(\r\n|\n)/m); // roda claude sem argumento entre aspas
  assert.doesNotMatch(script, /"[^"]*claude[^"]*"/); // não tem slash command nenhum entre aspas
});

test('buildLoginScript (Windows): sem dir, não seta CLAUDE_CONFIG_DIR (login na maquina padrao)', () => {
  const engine = fakeEngine({});
  const script = buildLoginScript(engine, '');
  assert.match(script, /rem sem config dir proprio/);
  assert.doesNotMatch(script, /CLAUDE_CONFIG_DIR/);
});

// engine "de mentira" pros testes de spawnLoginConsole: precisa do que a função
// realmente usa (activeReviews, sessionSeq, buildLoginScript, log/emit/pushState) mais
// unsee/checkNow pra provar que o handler de saída da sessão de login não mexe neles.
function fakeLoginEngine() {
  const toasts = [];
  const unseen = [];
  return {
    config: { skipPermissions: false, port: 47170 },
    activeReviews: new Map(),
    sessionSeq: 0,
    buildLoginScript(dir) { return buildLoginScript(this, dir); },
    buildCodexLoginScript() { return buildCodexLoginScript(this); },
    doctor() { this.doctorCalled = true; return Promise.resolve({}); },
    log() {},
    emit(kind, payload) { toasts.push({ kind, payload }); },
    pushState() {},
    checkNow() { this.checkedNow = true; },
    unsee(key) { unseen.push(key); },
    _toasts: toasts,
    _unseen: unseen,
  };
}

// Fix 2: invariantes de segurança da sessão de login - nada garantia isso de forma
// automatizada antes. Mocka child_process.spawn (via a troca de propriedade no topo
// deste arquivo, em vigor desde antes do require de lib/engine/session) pra não abrir
// processo real nenhum, e captura o env passado pro filho.
test('spawnLoginConsole (Windows): registra keys=[] e NÃO inclui GH_TOKEN no env do processo filho', { skip: process.platform !== 'win32' ? 'caminho Windows do spawnLoginConsole' : false }, () => {
  let capturedEnv = null;
  const fakeChild = new EventEmitter();
  spawnImpl = (cmd, args, opts) => { capturedEnv = opts.env; return fakeChild; };
  try {
    const engine = fakeLoginEngine();
    spawnLoginConsole(engine, 'C:\\biud-trabalho');

    const id = Array.from(engine.activeReviews.keys())[0];
    const sess = engine.activeReviews.get(id);
    assert.ok(sess, 'sessão de login registrada em activeReviews');
    assert.deepEqual(sess.keys, [], 'sessão de login não carrega keys nenhuma');

    assert.ok(capturedEnv, 'env foi passado pro spawn');
    assert.ok(!('GH_TOKEN' in capturedEnv), 'sessão de login NÃO deve ter GH_TOKEN no env do processo filho (não chama engine.ghEnv())');
    assert.equal(capturedEnv.GH_PAGER, 'cat');
    assert.equal(capturedEnv.PAGER, 'cat');
    assert.equal(capturedEnv.CLAUDE_CONFIG_DIR, 'C:\\biud-trabalho');

    // fecha a sessão (equivalente a fechar a janela) e confirma que, com keys=[],
    // não dispara checkNow nem unsee - reforço específico da sessão de login, além
    // do teste genérico de handleSessionExit em session-unsee-on-exit.test.js.
    fakeChild.emit('exit', 0);
    assert.equal(engine.checkedNow, undefined, 'não deve rechecar (sessão sem keys)');
    assert.deepEqual(engine._unseen, [], 'não deve desfazer visto de PR nenhum');
  } finally {
    spawnImpl = null;
  }
});

test('buildCodexLoginScript (Windows): abre codex login e depois mostra o status', () => {
  const script = buildCodexLoginScript(fakeLoginEngine());
  assert.match(script, /chcp 65001>nul/);
  assert.match(script, /where codex>nul/);
  assert.match(script, /codex login/);
  assert.match(script, /codex login status/);
  assert.doesNotMatch(script, /claude/);
});

test('buildCodexLoginScriptMac: limpa chaves e abre codex login', () => {
  const script = buildCodexLoginScriptMac(fakeLoginEngine(), 'id1');
  assert.match(script, /unset GH_TOKEN OPENAI_API_KEY CODEX_API_KEY/);
  assert.match(script, /command -v codex/);
  assert.match(script, /codex login/);
  assert.match(script, /codex login status/);
});

test('codexLoginConsoleEnv: remove tokens e chaves que desviariam do plano ChatGPT', () => {
  const antes = {
    gh: process.env.GH_TOKEN,
    openai: process.env.OPENAI_API_KEY,
    codex: process.env.CODEX_API_KEY,
  };
  process.env.GH_TOKEN = 'gh';
  process.env.OPENAI_API_KEY = 'sk-openai';
  process.env.CODEX_API_KEY = 'codex-key';
  try {
    const out = codexLoginConsoleEnv();
    assert.equal('GH_TOKEN' in out, false);
    assert.equal('OPENAI_API_KEY' in out, false);
    assert.equal('CODEX_API_KEY' in out, false);
    assert.equal(out.GH_PAGER, 'cat');
  } finally {
    if (antes.gh === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = antes.gh;
    if (antes.openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = antes.openai;
    if (antes.codex === undefined) delete process.env.CODEX_API_KEY; else process.env.CODEX_API_KEY = antes.codex;
  }
});

test('spawnCodexLoginConsole (Windows): registra terminal sem keys e revalida doctor ao fechar', { skip: process.platform !== 'win32' ? 'caminho Windows do spawnCodexLoginConsole' : false }, () => {
  const fakeChild = new EventEmitter();
  let capturedEnv = null;
  spawnImpl = (cmd, args, opts) => { capturedEnv = opts.env; return fakeChild; };
  try {
    const engine = fakeLoginEngine();
    spawnCodexLoginConsole(engine);

    const id = Array.from(engine.activeReviews.keys())[0];
    const sess = engine.activeReviews.get(id);
    assert.ok(sess, 'sessão de login Codex registrada');
    assert.deepEqual(sess.keys, []);
    assert.equal(sess.label, 'Login do Codex');
    assert.equal('OPENAI_API_KEY' in capturedEnv, false);
    assert.equal('CODEX_API_KEY' in capturedEnv, false);

    fakeChild.emit('exit', 0);
    assert.equal(engine.doctorCalled, true, 'ao fechar, revalida o status do Codex');
  } finally {
    spawnImpl = null;
  }
});

// G21: o teste acima prova que o env do console de login não tem GH_TOKEN; este prova que
// ele também não tem a auth do Claude herdada da máquina. É o teste de FIAÇÃO (a função
// pura loginConsoleEnv tem os seus em claude-profiles.test.js): sem ele, o helper podia
// existir certinho e ninguém chamar, que é exatamente o defeito do fanOutBlock na v2.27.0.
test('spawnLoginConsole (Windows): env da máquina com ANTHROPIC_API_KEY não chega no console de login', { skip: process.platform !== 'win32' ? 'caminho Windows do spawnLoginConsole' : false }, () => {
  const antes = { key: process.env.ANTHROPIC_API_KEY, tok: process.env.ANTHROPIC_AUTH_TOKEN };
  process.env.ANTHROPIC_API_KEY = 'sk-da-maquina';
  process.env.ANTHROPIC_AUTH_TOKEN = 'tok-da-maquina';
  let capturedEnv = null;
  spawnImpl = (cmd, args, opts) => { capturedEnv = opts.env; return new EventEmitter(); };
  try {
    spawnLoginConsole(fakeLoginEngine(), 'C:\\biud-trabalho');
    assert.ok(capturedEnv, 'env foi passado pro spawn');
    assert.equal('ANTHROPIC_API_KEY' in capturedEnv, false, 'a chave da máquina anularia o login OAuth do perfil');
    assert.equal('ANTHROPIC_AUTH_TOKEN' in capturedEnv, false);
    assert.equal(capturedEnv.CLAUDE_CONFIG_DIR, 'C:\\biud-trabalho', 'o perfil resolvido do login é quem manda');
  } finally {
    spawnImpl = null;
    if (antes.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = antes.key;
    if (antes.tok === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = antes.tok;
  }
});

test('buildLoginScriptMac: roda claude puro, dir aplicado com escaping de aspa simples', () => {
  const engine = fakeEngine({});
  const script = buildLoginScriptMac(engine, "/tmp/x' ; touch /tmp/PROOF #", 'id1');
  assert.match(script, /export CLAUDE_CONFIG_DIR='\/tmp\/x'\\''/); // mesmo escaping do buildSessionScriptMac
  assert.doesNotMatch(script, /--user/); // login nao usa --user do gh (essa sessao nao mexe em token)
});

test('buildLoginScriptMac: sem dir, não exporta CLAUDE_CONFIG_DIR', () => {
  const engine = fakeEngine({});
  const script = buildLoginScriptMac(engine, '', 'id1');
  assert.match(script, /# sem config dir proprio/);
  assert.doesNotMatch(script, /export CLAUDE_CONFIG_DIR/); // ver nota do G21 acima
});

// bash pode não estar no PATH (ex.: Windows sem Git Bash/WSL configurado no PATH) - checa
// antes de rodar o teste de verdade, pra pular com mensagem clara em vez de estourar ENOENT
// confuso e derrubar a suíte inteira.
let bashDisponivel = true;
try {
  execSync('bash --version', { stdio: 'ignore' });
} catch {
  bashDisponivel = false;
}

// Prova de verdade (execução real com bash, não só leitura do template literal) de que
// um `dir` com aspa simples não escapa da atribuição `export CLAUDE_CONFIG_DIR='...'`
// e executa comando arbitrário. Achado de auditoria adversarial (Fix 2).
test(
  'buildSessionScriptMac: aspa simples no dir é escapada, não quebra a string bash (execução real)',
  { skip: bashDisponivel ? false : 'bash não encontrado no PATH' },
  () => {
    const proofFile = path.join(os.tmpdir(), 'PROOF_INJECTION_' + process.pid).replace(/\\/g, '/');
    const maliciousDir = `/tmp/x' ; touch ${proofFile} #`;
    const engine = fakeEngine({ bob: maliciousDir });
    const script = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'bob');
    const exportLine = script.split('\n').find(l => l.startsWith('export CLAUDE_CONFIG_DIR'));
    assert.ok(exportLine, 'linha do export existe no script gerado');

    const tmpScript = path.join(os.tmpdir(), 'farol-test-escape-' + process.pid + '.sh');
    try { fsMod.unlinkSync(proofFile); } catch { /* já não existe */ }
    fsMod.writeFileSync(tmpScript, `#!/bin/bash\n${exportLine}\necho "va-$CLAUDE_CONFIG_DIR-lor"\n`);
    let out;
    try {
      try {
        out = execSync(`bash "${tmpScript}"`).toString();
      } finally {
        try { fsMod.unlinkSync(tmpScript); } catch { /* best-effort */ }
      }
      assert.equal(fsMod.existsSync(proofFile), false, 'comando injetado NÃO deve ter rodado (touch do arquivo de prova)');
      assert.match(out, /va-\/tmp\/x' ; touch .* #-lor/, 'valor preservado como string literal única, aspa simples incluída');
    } finally {
      // garantido mesmo se alguma asserção acima falhar - senão o arquivo de prova
      // fica no /tmp pra sempre.
      try { fsMod.unlinkSync(proofFile); } catch { /* limpeza, caso o teste falhe e o comando tenha rodado */ }
    }
  }
);

/* ---------- contratos cross-platform dos scripts de sessão (auditoria 16/08) ---------- */

test('FAROL_REVIEW_CMD: quoting do stub é aspas duplas no .cmd e simples no .command', () => {
  const antes = process.env.FAROL_REVIEW_CMD;
  process.env.FAROL_REVIEW_CMD = 'meu-stub';
  try {
    const win = buildSessionScript(fakeEngine({}), '/pr-review x', 'default-user');
    const mac = buildSessionScriptMac(fakeEngine({}), '/pr-review x', 'id1', 'default-user');
    assert.ok(win.includes('meu-stub "/pr-review x"'), 'cmd.exe: aspas duplas');
    assert.ok(mac.includes("meu-stub '/pr-review x'"), 'bash: aspas simples');
  } finally {
    if (antes === undefined) delete process.env.FAROL_REVIEW_CMD; else process.env.FAROL_REVIEW_CMD = antes;
  }
});

test('buildSessionScriptMac: porta sem config cai no 47170, nunca "undefined" na URL do trap', () => {
  const engine = fakeEngine({});
  engine.config = { skipPermissions: false };   // sem port, como um config.json mínimo
  const s = buildSessionScriptMac(engine, '/pr-review x', 'id1', 'default-user');
  assert.ok(s.includes('http://127.0.0.1:47170/api/session-exit'), 'fallback de porta no notify');
  assert.ok(!s.includes('undefined'), 'porta ausente não pode virar texto na URL');
});

test('buildSessionScriptMac: conta pedida sem token ABORTA a sessão (paridade com o ghEnv)', () => {
  const s = buildSessionScriptMac(fakeEngine({}), '/pr-review x', 'id1', 'bob');
  assert.ok(s.includes("conta 'bob' nao autenticada"), 'o erro nomeia a conta');
  assert.match(s, /if \[ -z "\$GH_TOKEN" \]; then[\s\S]*exit 1/, 'token vazio sai com erro, não segue no keyring');
});

test('buildLoginScriptMac: sem GH_TOKEN herdado e com pagers, como o loginConsoleEnv do Windows', () => {
  const s = buildLoginScriptMac(fakeEngine({}), '/tmp/dir-perfil', 'id9');
  assert.ok(s.includes('unset GH_TOKEN'), 'profile sourceado pelo Terminal.app não pode injetar token');
  assert.ok(s.includes('export GH_PAGER=cat PAGER=cat'));
  assert.ok(s.includes('http://127.0.0.1:47170/api/session-exit') || !s.includes('undefined'), 'porta com fallback');
});
