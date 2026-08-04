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

const { runClaudeStream } = require('../lib/engine/session');
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
  assert.match(argv[1], /^claude -p --output-format stream-json --verbose --dangerously-skip-permissions/);
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
