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
  // o unset vem colado no começo da linha, DEPOIS do sourcing do profile que o -l faz (G21).
  // engineFalso resolve um perfil legado (sem dir), então não há re-export de CLAUDE_CONFIG_DIR.
  assert.match(argv[1], /^unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR; claude -p --output-format stream-json --verbose --dangerously-skip-permissions/);
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
// O defeito: applyClaudeAuthEnv limpa as vars de auth do env, mas no posix o profile do
// usuário é sourceado DEPOIS disso (o -l do `/bin/sh -lc` no headless; o login shell do
// Terminal.app antes de executar o .command). Um `export ANTHROPIC_API_KEY` perdido no
// ~/.profile re-injeta a chave POR CIMA do perfil resolvido, e a precedência oficial do
// claude CLI põe a chave acima do login OAuth: o perfil de assinatura do Farol seria anulado
// em silêncio. Por isso o unset é emitido DENTRO do shell, depois de qualquer sourcing e
// antes do exec do claude.
//
// A lista cobre as MESMAS quatro vars que applyClaudeAuthEnv apaga, não só as duas de
// credencial: ANTHROPIC_BASE_URL redireciona o endpoint (mandaria credencial de assinatura
// pra host de terceiro) e CLAUDE_CONFIG_DIR troca a conta logada. Ficar em duas era
// inconsistente com o env e deixava dois furos da mesma classe abertos.
const UNSET = 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR';

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
  assert.equal(linhas[0], UNSET);
  assert.match(linhas[1], /^export CLAUDE_CONFIG_DIR='\/tmp\/perfil'$/);
});

test('claudeAuthShellLines posix (assinatura sem dir, "padrão da máquina"): unset sem export nenhum', () => {
  const linhas = claudeAuthShellLines({ kind: 'dir', dir: '' }, false);
  // sem dir do perfil, o certo é NÃO re-exportar: o padrão da máquina é o login default do
  // claude, e um CLAUDE_CONFIG_DIR herdado do profile mentiria sobre qual conta está em uso.
  assert.deepEqual(linhas, [UNSET, '# sem config dir proprio']);
});

test('claudeAuthShellLines posix (chave de API): a própria chave é setada DEPOIS do unset', () => {
  const linhas = claudeAuthShellLines({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: 'https://proxy.x' }, false);
  assert.deepEqual(linhas, [UNSET, `export ANTHROPIC_API_KEY='sk-ant-1'`, `export ANTHROPIC_BASE_URL='https://proxy.x'`]);
});

test('claudeAuthShellLines windows: NÃO emite unset (cmd.exe não sourceia profile nenhum)', () => {
  const dir = claudeAuthShellLines({ kind: 'dir', dir: 'C:\\perfil' }, true);
  const chave = claudeAuthShellLines({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }, true);
  assert.equal(dir.some(l => /unset/.test(l)), false);
  assert.equal(chave.some(l => /unset/.test(l)), false);
});

// O prefixo headless é o ÚNICO caso em que o unset precisa devolver algo: o dir do perfil
// viaja só pelo env (não há script pra re-exportá-lo), então unset sem re-export apagaria o
// perfil resolvido no caminho feliz. Por isso o export vem junto, e só quando há dir.
test('claudeAuthPosixPrefix: perfil de assinatura com dir re-exporta o dir DEPOIS do unset', () => {
  assert.equal(claudeAuthPosixPrefix({ kind: 'dir', dir: '/tmp/x' }), `${UNSET}; export CLAUDE_CONFIG_DIR='/tmp/x'; `);
});

test('claudeAuthPosixPrefix: perfil de assinatura sem dir (padrão da máquina) é só o unset', () => {
  assert.equal(claudeAuthPosixPrefix({ kind: 'dir', dir: '' }), `${UNSET}; `);
});

test('claudeAuthPosixPrefix: dir com aspa simples é escapado (vai pra linha de comando do sh)', () => {
  const prefixo = claudeAuthPosixPrefix({ kind: 'dir', dir: "/tmp/x' ; touch /tmp/PROOF #" });
  assert.equal(prefixo, `${UNSET}; export CLAUDE_CONFIG_DIR='/tmp/x'\\'' ; touch /tmp/PROOF #'; `);
});

test('claudeAuthPosixPrefix: perfil de chave NÃO prefixa (a chave viaja pelo env, e não pode ir pra linha de comando)', () => {
  assert.equal(claudeAuthPosixPrefix({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }), '');
});

test('buildSessionScriptMac (assinatura): unset vem antes da linha do claude', () => {
  const script = buildSessionScriptMac(engineMac({ kind: 'dir', dir: '/tmp/perfil' }), '/pr-review x', 'id1', 'bob');
  const [iUnset, iDir, iClaude] = ordem(script, UNSET, 'export CLAUDE_CONFIG_DIR', '\nclaude ');
  assert.ok(iUnset > 0, 'o unset existe no script');
  assert.ok(iUnset < iDir, 'unset antes do perfil resolvido');
  assert.ok(iDir < iClaude, 'tudo antes do exec do claude');
});

test('buildSessionScriptMac (chave de API): a chave do perfil é exportada DEPOIS do unset', () => {
  const script = buildSessionScriptMac(engineMac({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }), '/pr-review x', 'id1', 'bob');
  const [iUnset, iChave, iClaude] = ordem(script, UNSET, "export ANTHROPIC_API_KEY='sk-ant-1'", '\nclaude ');
  assert.ok(iUnset > 0 && iUnset < iChave, 'o unset não pode apagar a chave do próprio perfil');
  assert.ok(iChave < iClaude);
});

test('buildLoginScriptMac: unset antes da linha do claude (a sessão de login é onde a chave errada mais engana)', () => {
  const script = buildLoginScriptMac(engineMac({ kind: 'dir', dir: '' }), '/tmp/perfil', 'id1');
  const [iUnset, iDir, iClaude] = ordem(script, UNSET, 'export CLAUDE_CONFIG_DIR', '\nclaude');
  assert.ok(iUnset > 0, 'o unset existe no script de login');
  assert.ok(iUnset < iDir && iDir < iClaude);
});

test('buildLoginScriptMac (padrão da máquina): unset sem export de dir nenhum', () => {
  const script = buildLoginScriptMac(engineMac({ kind: 'dir', dir: '' }), '', 'id1');
  assert.ok(script.includes(UNSET), 'o unset existe mesmo sem perfil próprio');
  assert.doesNotMatch(script, /export CLAUDE_CONFIG_DIR/, 'sem dir do perfil não se re-exporta nada');
});

// Prova de EXECUÇÃO (não só leitura do texto montado), no mesmo padrão da prova de injeção
// que já existe em test/session-claude-profile.test.js: um profile sujo é sourceado e o
// prefixo roda depois dele, exatamente como o `/bin/sh -lc` faz com o `-l`.
let bashDisponivel = true;
try {
  require('node:child_process').execSync('bash --version', { stdio: 'ignore' });
} catch {
  bashDisponivel = false;
}

function rodaComProfileSujo(prefixo) {
  const { execSync } = require('node:child_process');
  const base = path.join(os.tmpdir(), 'farol-test-prefixo-' + process.pid).replace(/\\/g, '/');
  const profile = `${base}-profile.sh`;
  const script = `${base}-run.sh`;
  fs.writeFileSync(profile, [
    'export ANTHROPIC_API_KEY=chave-do-profile',
    'export ANTHROPIC_AUTH_TOKEN=token-do-profile',
    'export ANTHROPIC_BASE_URL=https://host-de-terceiro',
    'export CLAUDE_CONFIG_DIR=/dir/do/profile',
  ].join('\n') + '\n');
  // `. profile` é o que o -l faz por dentro; o prefixo vem DEPOIS, como na linha real
  fs.writeFileSync(script, `#!/bin/bash\n. '${profile}'\n${prefixo}echo "[$ANTHROPIC_API_KEY|$ANTHROPIC_AUTH_TOKEN|$ANTHROPIC_BASE_URL|$CLAUDE_CONFIG_DIR]"\n`);
  try {
    return execSync(`bash "${script}"`).toString().trim();
  } finally {
    for (const f of [profile, script]) { try { fs.unlinkSync(f); } catch { /* best-effort */ } }
  }
}

test('prefixo posix: profile sujo perde pro perfil resolvido (execução real com bash)', { skip: bashDisponivel ? false : 'bash não encontrado no PATH' }, () => {
  const comDir = rodaComProfileSujo(claudeAuthPosixPrefix({ kind: 'dir', dir: '/dir/do/perfil' }));
  assert.equal(comDir, '[|||/dir/do/perfil]', 'as três vars de auth somem e o dir é o do perfil, não o do profile');

  const semDir = rodaComProfileSujo(claudeAuthPosixPrefix({ kind: 'dir', dir: '' }));
  assert.equal(semDir, '[|||]', 'padrão da máquina: nenhuma var de auth sobrevive ao prefixo');
});

test('prefixo posix: aspa simples no dir não injeta comando (execução real com bash)', { skip: bashDisponivel ? false : 'bash não encontrado no PATH' }, () => {
  const proofFile = path.join(os.tmpdir(), 'PROOF_PREFIXO_' + process.pid).replace(/\\/g, '/');
  try { fs.unlinkSync(proofFile); } catch { /* já não existe */ }
  try {
    const dir = `/tmp/x' ; touch ${proofFile} #`;
    const saida = rodaComProfileSujo(claudeAuthPosixPrefix({ kind: 'dir', dir }));
    assert.equal(fs.existsSync(proofFile), false, 'comando injetado NÃO deve ter rodado');
    assert.equal(saida, `[|||${dir}]`, 'valor preservado como string literal única');
  } finally {
    try { fs.unlinkSync(proofFile); } catch { /* limpeza, caso o teste falhe e o comando tenha rodado */ }
  }
});
