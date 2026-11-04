// O git da fonte de revisão não herda nada da máquina: um `~/.gitconfig` hostil não tem efeito no
// fetch, na compactação nem na worktree. Cada caso tem o CONTROLE ao lado, o mesmo config mordendo o
// git comum, porque um teste de "não aconteceu" que não prova que aconteceria não prova nada.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import io from '../lib/io.js';
import { envGitLimpo } from './helpers/git-limpo.js';
import { SourceStore } from '../lib/review-source/store.js';
import { GitSource } from '../lib/review-source/git.js';
import { envGitIsolado, FLAGS_GIT_ISOLADO } from '../lib/git-isolado.js';

const barra = caminho => caminho.replaceAll('\\', '/');
const VARIAVEIS_MEXIDAS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_ALLOW_PROTOCOL', 'GIT_TEMPLATE_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
const envAntes = Object.fromEntries(VARIAVEIS_MEXIDAS.map(nome => [nome, process.env[nome]]));
const ORIGEM_FALSA = 'https://hostil.invalid/repo.git';
let raiz, origin, canario, runReal, gitconfig, scope, store, source, materiais, base, head;

const canarioLido = async () => (await fs.readFile(canario, 'utf8').catch(() => ''));

async function montarConfigHostil() {
  const script = path.join(raiz, 'canario.sh');
  await fs.writeFile(script, `#!/bin/sh\necho "$0 $*" >> "${barra(canario)}"\ncat\n`, { mode: 0o755 });
  const hooks = path.join(raiz, 'hooks-hostis');
  const template = path.join(raiz, 'template-hostil', 'hooks');
  await fs.mkdir(hooks); await fs.mkdir(template, { recursive: true });
  for (const pasta of [hooks, template]) {
    for (const nome of ['post-checkout', 'reference-transaction', 'post-merge']) await fs.writeFile(path.join(pasta, nome), `#!/bin/sh\necho "${nome}" >> "${barra(canario)}"\n`, { mode: 0o755 });
  }
  const atributos = path.join(raiz, 'atributos-hostis');
  await fs.writeFile(atributos, '* filter=mal\n');
  const comando = `sh ${barra(script)}`;
  gitconfig = path.join(raiz, 'casa', '.gitconfig');
  await fs.mkdir(path.dirname(gitconfig));
  await fs.writeFile(gitconfig, [
    '[core]', `\tfsmonitor = ${barra(script)}`, `\thooksPath = ${barra(hooks)}`, `\tsshCommand = ${comando}`, `\tgitProxy = ${comando}`, `\tattributesFile = ${barra(atributos)}`,
    '[init]', `\ttemplateDir = ${barra(path.dirname(template))}`,
    `[url "${barra(origin)}"]`, `\tinsteadOf = ${ORIGEM_FALSA}`,
    '[filter "mal"]', `\tsmudge = ${comando}`, '\trequired = true',
    '[filter "lfs"]', `\tsmudge = ${comando}`, `\tprocess = ${comando}`, '\trequired = true',
    '[credential]', `\thelper = !${comando}`,
    '[protocol]', '\tallow = always',
    '[submodule]', '\trecurse = true',
    '[fetch]', '\trecurseSubmodules = true',
    '',
  ].join('\n'));
}

before(async () => {
  raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-git-isolado-'));
  origin = path.join(raiz, 'origin'); materiais = path.join(raiz, 'materials'); canario = path.join(raiz, 'canario.txt');
  await fs.mkdir(origin); await fs.mkdir(materiais);
  const git = args => execFileSync('git', args, { cwd: origin, env: envGitLimpo(), encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  await fs.writeFile(path.join(origin, 'source.js'), 'export const x = 1;\n');
  await fs.writeFile(path.join(origin, '.gitattributes'), 'grande.bin filter=lfs\nfiltrado.txt filter=mal\n');
  await fs.writeFile(path.join(origin, 'grande.bin'), 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n');
  await fs.writeFile(path.join(origin, 'filtrado.txt'), 'texto cru\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'base']); base = git(['rev-parse', 'HEAD']);
  await fs.writeFile(path.join(origin, 'source.js'), 'export const x = 2;\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'head']); head = git(['rev-parse', 'HEAD']);

  await montarConfigHostil();
  runReal = io.run;
  io.run = async (cmd, args, opts) => runReal(cmd, ['-c', 'protocol.file.allow=always', ...args.map(arg => (arg === 'https://github.com/org/repo.git' ? origin : arg))], opts);
  scope = { host: 'github.com', account: 'fixture', repo: 'org/repo', repositoryId: 123 };
  store = await new SourceStore(scope, { root: path.join(raiz, 'cache'), limits: { reserveBytes: 1 } }).initialize();
  const lease = await store.acquire({ H: head, B: base, M: base });
  source = new GitSource({ ghEnv: () => ({ GH_TOKEN: 'token-de-teste', GITHUB_TOKEN: 'token-de-teste' }) }, store, lease, { head, base, mergeBase: base }, { materialRoot: materiais });

  // A partir daqui a máquina é hostil, e o ambiente do processo é o que produção herdaria.
  Object.assign(process.env, {
    HOME: path.dirname(gitconfig), USERPROFILE: path.dirname(gitconfig), XDG_CONFIG_HOME: path.join(path.dirname(gitconfig), 'xdg'), GIT_CONFIG_GLOBAL: gitconfig,
    GIT_SSH_COMMAND: `sh ${barra(path.join(raiz, 'canario.sh'))}`, GIT_ASKPASS: barra(path.join(raiz, 'canario.sh')), GIT_ALLOW_PROTOCOL: 'file:ext:http',
    GIT_TEMPLATE_DIR: barra(path.join(raiz, 'template-hostil')), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'hostil',
  });
});

after(async () => {
  io.run = runReal;
  for (const [nome, valor] of Object.entries(envAntes)) {
    if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
  }
  await fs.rm(raiz, { recursive: true, force: true }).catch(() => {});
});

test('controle: o mesmo config morde o git comum', async () => {
  const comum = { ...envGitLimpo(), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_SYSTEM: envGitLimpo().GIT_CONFIG_SYSTEM };
  delete comum.GIT_CONFIG_COUNT; delete comum.GIT_ALLOW_PROTOCOL; delete comum.GIT_TEMPLATE_DIR;
  const reescrito = spawnSync('git', ['ls-remote', ORIGEM_FALSA], { env: comum, encoding: 'utf8', windowsHide: true });
  assert.equal(reescrito.status, 0, 'insteadOf troca o servidor');
  assert.ok(reescrito.stdout.includes(head));
  // o checkout falha de propósito: o `process` hostil não fala o protocolo do filtro, mas já rodou
  spawnSync('git', ['clone', '--quiet', '--no-hardlinks', origin, path.join(raiz, 'clone-comum')], { env: comum, encoding: 'utf8', windowsHide: true });
  const mordidas = await canarioLido();
  assert.match(mordidas, /reference-transaction/, 'hooksPath roda');
  assert.match(mordidas, /canario\.sh/, 'o filtro roda');
  await fs.writeFile(canario, '');
});

test('materializar com o config hostil não executa nada e entrega os bytes crus', async () => {
  const destino = path.join(materiais, 'review-um');
  await fs.mkdir(destino);
  await source.materialize(destino);
  assert.equal(await canarioLido(), '', 'nada do config da máquina rodou');
  assert.equal(await fs.readFile(path.join(destino, 'source.js'), 'utf8'), 'export const x = 2;\n');
  assert.equal(await fs.readFile(path.join(destino, 'filtrado.txt'), 'utf8'), 'texto cru\n');
  assert.match(await fs.readFile(path.join(destino, 'grande.bin'), 'utf8'), /^version https:\/\/git-lfs/, 'LFS fica como ponteiro');
  await assert.rejects(fs.access(path.join(store.root, 'repository.git', 'hooks', 'post-checkout')), 'o template hostil não entrou');
  const status = spawnSync('git', [...FLAGS_GIT_ISOLADO, 'status', '--porcelain'], { cwd: destino, env: envGitIsolado(), encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout, '', 'o material bate com o commit');
  assert.equal(await canarioLido(), '', 'o fsmonitor hostil também não');
});

test('o git da fonte não enxerga o config hostil', async () => {
  const lista = await source.run(['config', '--list', '--show-origin']);
  assert.equal(lista.includes(barra(gitconfig)), false);
  assert.equal(/hostil|canario|insteadof/i.test(lista), false, lista);
  assert.equal(/\bfile:.*gitconfig/.test(lista), false, 'nem global nem system');
  await assert.rejects(source.run(['ls-remote', ORIGEM_FALSA]), 'insteadOf não troca o servidor');
});

test('só https sai: file, http e ext são recusados pelo git, e a variável não abre', async () => {
  const stderr = [];
  const fixture = io.run;
  io.run = async (cmd, args, opts) => { const r = await runReal(cmd, args, opts); stderr.push(r.stderr); return r; };
  try {
    for (const alvo of [origin, 'http://127.0.0.1:9/x.git', `ext::sh -c "echo x >> ${barra(canario)}"`]) {
      await assert.rejects(source.run(['ls-remote', alvo]));
      assert.match(stderr.at(-1), /transport '\w+' not allowed/, alvo);
    }
  } finally { io.run = fixture; }
  assert.equal(await canarioLido(), '');
  for (const esperado of ['protocol.allow=never', 'protocol.https.allow=always', 'submodule.recurse=false', 'fetch.recurseSubmodules=false']) {
    assert.ok(FLAGS_GIT_ISOLADO.includes(esperado), esperado);
  }
});

test('o ambiente não leva o que executa comando ou passa por cima das travas', () => {
  const env = envGitIsolado();
  for (const nome of ['GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_ALLOW_PROTOCOL', 'GIT_TEMPLATE_DIR', 'GIT_CONFIG_COUNT']) assert.equal(env[nome], undefined, nome);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_LFS_SKIP_SMUDGE, '1');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'nul' : '/dev/null');
  assert.equal(env.HOME, process.env.HOME, 'o `gh` do helper continua achando a casa dele');
});

test('o helper de credencial da fonte funciona, e o do config hostil não roda', async () => {
  const r = spawnSync('git', [...FLAGS_GIT_ISOLADO, '-c', 'credential.helper=!f() { echo username=fixture; echo password=do-helper; }; f', 'credential', 'fill'],
    { env: envGitIsolado(), input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /password=do-helper/);
  assert.equal(await canarioLido(), '');
  const semHelper = spawnSync('git', [...FLAGS_GIT_ISOLADO, 'credential', 'fill'],
    { env: envGitIsolado(), input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true });
  assert.notEqual(semHelper.status, 0, 'sem helper nem terminal, não há de onde tirar credencial');
  assert.equal(await canarioLido(), '');
});
