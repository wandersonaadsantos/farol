// O check de autenticação do gh no Diagnóstico responde sobre a identidade que o
// Farol VAI USAR, e não sobre o ambiente de quem abriu o app.
//
// Por que este arquivo existe: `gh auth token` SEM `--user` honra o GH_TOKEN do
// ambiente (medido contra o gh 2.x), enquanto `gh auth token --user X` lê o
// keyring e ignora o ambiente. O doctor só acrescenta o `--user` quando existe
// conta primária, então, sem conta configurada e com um GH_TOKEN exportado no
// shell, o check ficava VERDE por causa de um token que o `ghEnv` recusa usar.
// Doctor mais verde que a realidade é a pior falha possível num painel que
// existe pra responder "o Farol consegue rodar?".
//
// A correção é o probe rodar no MESMO env que o engine usa (`ghEnv()`), que é
// literalmente o "caminho legado do doctor/boot" nomeado no contrato do ghEnv.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-doctor-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// espião antes do import do server.js: os módulos capturam a referência na
// desestruturação, então trocar depois não alcança. NENHUM gh/claude real roda aqui.
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
const runShellReal = io.runShell;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [], env: (opts || {}).env });
  return Promise.resolve({ ok: true, code: 0, stdout: 'tok-que-o-gh-devolveu', stderr: '' });
};
io.runShell = function runShellEspiao() {
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  io.runShell = runShellReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; });

function comEnvDaMaquina(vars, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

function engineMudo() {
  const e = new Engine();
  e.log = () => { };
  e.on('toast', () => { });
  e.pushState = () => { };
  e.checkUpdate = async () => { };
  return e;
}

// a chamada do doctor que pergunta "estou autenticado?"
const probeDeAuth = () => chamadas.find(c => c.cmd === 'gh' && c.args[0] === 'auth' && c.args[1] === 'token');

test('doctor: sem conta configurada, o probe de auth não carrega o token da máquina', async () => {
  const e = engineMudo();
  e.config.accounts = [];
  e.config.ghUser = '';
  e.token = null;
  e.tokens = {};
  await comEnvDaMaquina({ GH_TOKEN: 'tok-da-maquina', GITHUB_TOKEN: 'tok-da-maquina' }, async () => {
    await e.doctor();
    const probe = probeDeAuth();
    assert.ok(probe, 'o doctor precisa perguntar sobre autenticação');
    // env ausente não é env limpo: sem a opção, o filho herda process.env INTEIRO,
    // que é justamente por onde o token da máquina entrava.
    assert.ok(probe.env, 'o probe tem que rodar num env montado pelo engine, não no herdado');
    assert.equal('GH_TOKEN' in probe.env, false, '`gh auth token` sem --user honra o ambiente: o check ficaria verde por um token que o ghEnv recusa');
    assert.equal('GITHUB_TOKEN' in probe.env, false, 'a variável vizinha responde pela mesma pergunta no github.com');
  });
});

test('doctor: com conta primária, o probe de auth carrega o token DELA, não o da máquina', async () => {
  const e = engineMudo();
  e.config.accounts = [{ user: 'alice', owners: ['acme'] }];
  e.token = 'tok-alice';
  e.tokens = { alice: 'tok-alice' };
  await comEnvDaMaquina({ GH_TOKEN: 'tok-da-maquina' }, async () => {
    await e.doctor();
    const probe = probeDeAuth();
    assert.deepEqual(probe.args, ['auth', 'token', '--user', 'alice']);
    assert.equal(probe.env.GH_TOKEN, 'tok-alice', 'o doctor tem que falar da identidade que o engine usa');
  });
});
