'use strict';
// Branch POSIX do spawn headless (macOS/Linux). Pula no Windows, porque IS_WIN é const de
// nível de módulo lida de lib/paths no load: não dá pra forçar o outro branch daqui.
//
// Por que existe: o caminho headless é o item 5 do checklist do port do macOS e nunca
// rodou num Mac de verdade. Este teste não substitui essa validação, mas garante que,
// quando o primeiro Mac rodar `npm test`, o contrato do spawn dê SINAL em vez de silêncio.
// O que ele trava:
//   - shell /bin/sh com -lc (login shell: sem isso o PATH do Homebrew não entra e o
//     `claude` some quando o app é aberto pelo Finder)
//   - detached: true, que é a PRÉ-CONDIÇÃO do killTree posix (process.kill(-pid) só mata
//     o grupo se o filho for líder de grupo). Sem isso, cancelar uma revisão deixa o
//     claude e os subagentes rodando órfãos.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-posix-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

// mesmo padrão de test/session-claude-profile.test.js: o mock precisa estar em vigor
// ANTES do require de lib/engine/session, que captura `spawn` no load
const childProcess = require('child_process');
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { runClaudeStream, buildSessionScriptMac, buildLoginScriptMac } = require('../lib/engine/session');
const { claudeAuthShellLines, claudeAuthPosixPrefix } = require('../lib/parse');
const { WORKSPACE, IS_WIN } = require('../lib/paths');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// filho falso: encerra na hora pra runClaudeStream resolver sem processo de verdade
function filhoFalso() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => { }; // runClaudeStream liga utf8 no stream real (M4)
  child.stderr = new EventEmitter();
  // stdin precisa de .on: runClaudeStream registra handler de 'error' (B4)
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  setImmediate(() => { child.emit('close', 0); });
  return child;
}

function engineFalso(config = {}) {
  return {
    config,
    ghEnv: () => ({ PATH: '/usr/bin' }),
    pushActivity() { },
    setSessionModel() { },
    // legado (sem perfil de chave de API): authProfileId fica vazio
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
  };
}

test('spawn headless posix: /bin/sh -lc, detached e cwd no WORKSPACE', { skip: IS_WIN ? 'só roda em POSIX' : false }, async () => {
  let capturado = null;
  spawnImpl = (...args) => { capturado = args; return filhoFalso(); };
  try {
    await runClaudeStream(engineFalso({ reviewModel: 'opus', reviewEffort: 'high' }), 'prompt qualquer', {});
  } catch { /* o filho falso não devolve envelope; o que importa são os args do spawn */ }
  spawnImpl = null;

  assert.ok(capturado, 'spawn foi chamado');
  const [cmd, argv, opts] = capturado;
  assert.equal(cmd, '/bin/sh');
  assert.equal(argv[0], '-lc', 'login shell, senão o PATH do Homebrew não entra');
  // o unset vem colado no começo da linha, DEPOIS do sourcing do profile que o -l faz (G21)
  assert.match(argv[1], /^unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; claude -p --output-format stream-json --verbose --dangerously-skip-permissions/);
  assert.match(argv[1], / --model opus --effort high$/, 'as flags entram no fim da linha');
  assert.equal(opts.detached, true, 'pré-condição do killTree posix (process.kill(-pid))');
  assert.equal(opts.cwd, WORKSPACE);
});

test('spawn headless windows: cmd.exe com verbatim args e janela escondida', { skip: IS_WIN ? false : 'só roda no Windows' }, async () => {
  let capturado = null;
  spawnImpl = (...args) => { capturado = args; return filhoFalso(); };
  try {
    await runClaudeStream(engineFalso({ reviewModel: 'sonnet', reviewEffort: 'low' }), 'prompt qualquer', {});
  } catch { /* idem */ }
  spawnImpl = null;

  assert.ok(capturado, 'spawn foi chamado');
  const [cmd, argv, opts] = capturado;
  assert.equal(cmd, 'cmd.exe');
  assert.deepEqual(argv.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(argv[3], / --model sonnet --effort low"$/, 'as flags entram no fim da linha');
  assert.equal(opts.windowsHide, true, 'sem isso o console pisca na cara do usuário');
  assert.equal(opts.windowsVerbatimArguments, true);
  assert.equal(opts.cwd, WORKSPACE);
});

// --- G21: env de auth da máquina não sobrevive ao login shell posix ----------
// Os testes de spawn acima pulam no Windows (IS_WIN é const de módulo), mas o CONTEÚDO do
// que vai pro shell é texto: montar a linha/o script e inspecionar o texto roda em
// qualquer SO, e é isso que os testes abaixo fazem.
//
// O defeito: applyClaudeAuthEnv limpa ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN do env, mas
// no posix o profile do usuário é sourceado DEPOIS disso (o -l do `/bin/sh -lc` no
// headless; o login shell do Terminal.app antes de executar o .command). Um `export
// ANTHROPIC_API_KEY` perdido no ~/.profile re-injeta a chave POR CIMA do perfil resolvido,
// e a precedência oficial do claude CLI põe a chave acima do login OAuth: o perfil de
// assinatura do Farol seria anulado em silêncio. Por isso o unset é emitido DENTRO do
// shell, depois de qualquer sourcing e antes do exec do claude.
function ordem(texto, ...pedacos) {
  return pedacos.map(p => texto.indexOf(p));
}

function engineMac(auth) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeAuth: () => auth,
    primaryUser: () => 'default-user',
  };
}

test('claudeAuthShellLines posix (assinatura): unset das vars de auth ANTES do export do dir', () => {
  const linhas = claudeAuthShellLines({ kind: 'dir', dir: '/tmp/perfil' }, false);
  assert.equal(linhas[0], 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN');
  assert.match(linhas[1], /^export CLAUDE_CONFIG_DIR='\/tmp\/perfil'$/);
});

test('claudeAuthShellLines posix (assinatura sem dir, legado): ainda assim emite o unset', () => {
  const linhas = claudeAuthShellLines({ kind: 'dir', dir: '' }, false);
  assert.equal(linhas[0], 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN');
});

test('claudeAuthShellLines posix (chave de API): a própria chave é setada DEPOIS do unset', () => {
  const linhas = claudeAuthShellLines({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }, false);
  assert.equal(linhas[0], 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN');
  assert.match(linhas[1], /^export ANTHROPIC_API_KEY='sk-ant-1'$/);
});

test('claudeAuthShellLines windows: NÃO emite unset (cmd.exe não sourceia profile nenhum)', () => {
  const dir = claudeAuthShellLines({ kind: 'dir', dir: 'C:\\perfil' }, true);
  const chave = claudeAuthShellLines({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }, true);
  assert.equal(dir.some(l => /unset/.test(l)), false);
  assert.equal(chave.some(l => /unset/.test(l)), false);
});

test('claudeAuthPosixPrefix: perfil de assinatura prefixa o unset na linha headless', () => {
  assert.equal(claudeAuthPosixPrefix({ kind: 'dir', dir: '/tmp/x' }), 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; ');
  assert.equal(claudeAuthPosixPrefix({ kind: 'dir', dir: '' }), 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; ');
});

test('claudeAuthPosixPrefix: perfil de chave NÃO prefixa (a chave viaja pelo env, e não pode ir pra linha de comando)', () => {
  assert.equal(claudeAuthPosixPrefix({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }), '');
});

test('buildSessionScriptMac (assinatura): unset vem antes da linha do claude', () => {
  const script = buildSessionScriptMac(engineMac({ kind: 'dir', dir: '/tmp/perfil' }), '/pr-review x', 'id1', 'bob');
  const [iUnset, iDir, iClaude] = ordem(script, 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN', 'export CLAUDE_CONFIG_DIR', '\nclaude ');
  assert.ok(iUnset > 0, 'o unset existe no script');
  assert.ok(iUnset < iDir, 'unset antes do perfil resolvido');
  assert.ok(iDir < iClaude, 'tudo antes do exec do claude');
});

test('buildSessionScriptMac (chave de API): a chave do perfil é exportada DEPOIS do unset', () => {
  const script = buildSessionScriptMac(engineMac({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }), '/pr-review x', 'id1', 'bob');
  const [iUnset, iChave, iClaude] = ordem(script, 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN', "export ANTHROPIC_API_KEY='sk-ant-1'", '\nclaude ');
  assert.ok(iUnset > 0 && iUnset < iChave, 'o unset não pode apagar a chave do próprio perfil');
  assert.ok(iChave < iClaude);
});

test('buildLoginScriptMac: unset antes da linha do claude (a sessão de login é onde a chave errada mais engana)', () => {
  const script = buildLoginScriptMac(engineMac({ kind: 'dir', dir: '' }), '/tmp/perfil', 'id1');
  const [iUnset, iDir, iClaude] = ordem(script, 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN', 'export CLAUDE_CONFIG_DIR', '\nclaude');
  assert.ok(iUnset > 0, 'o unset existe no script de login');
  assert.ok(iUnset < iDir && iDir < iClaude);
});
