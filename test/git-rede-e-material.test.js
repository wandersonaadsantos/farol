// As duas pontas que o isolamento do git deixou de fora: a rede de quem usa proxy ou CA corporativa
// precisa voltar, por lista fechada, ao fetch; e quem lê o material pelo cwd não pode executar o
// `core.fsmonitor` do `~/.gitconfig`, que lia o GH_TOKEN do processo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import io from '../lib/io.js';
import { envGitLimpo } from './helpers/git-limpo.js';
import { CHAVES_DE_REDE, FLAGS_GIT_ISOLADO, FLAGS_GIT_SOBRE_MATERIAL, flagsDeRede, flagsDeRedeDaMaquina, redeDoConfigGlobal } from '../lib/git-isolado.js';
import { debtVerdict } from '../lib/technical-review/debt.js';

const barra = caminho => caminho.replaceAll('\\', '/');
const NOMES = ['GIT_CONFIG_GLOBAL', 'GIT_SSL_CAINFO'];
const antes = Object.fromEntries(NOMES.map(nome => [nome, process.env[nome]]));
let raiz, config, canario, repo, head;

before(async () => {
  raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-git-rede-'));
  config = path.join(raiz, 'gitconfig-temporario');
  canario = path.join(raiz, 'canario.txt');
  repo = path.join(raiz, 'repo');
  await fs.mkdir(repo);
  const git = args => execFileSync('git', args, { cwd: repo, env: envGitLimpo(), encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  await fs.writeFile(path.join(repo, 'a.js'), 'um\ndois\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'base']); head = git(['rev-parse', 'HEAD']);
  delete process.env.GIT_SSL_CAINFO;
});

after(async () => {
  for (const [nome, valor] of Object.entries(antes)) {
    if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
  }
  await fs.rm(raiz, { recursive: true, force: true }).catch(() => {});
});

async function comConfig(linhas) {
  await fs.writeFile(config, `${linhas.join('\n')}\n`);
  process.env.GIT_CONFIG_GLOBAL = config;
}

test('as chaves da lista passam, com o valor conferido, e qualquer outra não', async () => {
  const ca = path.resolve(raiz, 'ca-corporativa.pem');
  await comConfig([
    '[http]', '\tproxy = http://proxy.example.test:3128', `\tsslCAInfo = ${barra(ca)}`, '\tsslBackend = openssl', '\tschannelUseSSLCAInfo = true',
    '[https]', '\tproxy = socks5h://[::1]:1080',
    '[core]', `\tfsmonitor = ${barra(canario)}`, '\tsshCommand = sh -c hostil', '\tgitProxy = hostil', '\thooksPath = /hostil',
    '[credential]', '\thelper = hostil',
    '[url "https://hostil.invalid/"]', '\tinsteadOf = https://github.com/',
  ]);
  const flags = await flagsDeRedeDaMaquina();
  assert.deepEqual(flags, [
    '-c', 'http.proxy=http://proxy.example.test:3128',
    '-c', 'https.proxy=socks5h://[::1]:1080',
    '-c', `http.sslCAInfo=${barra(ca)}`,
    '-c', 'http.sslBackend=openssl',
    '-c', 'http.schannelUseSSLCAInfo=true',
  ]);
  assert.equal(/hostil|fsmonitor|sshCommand|gitProxy|hooksPath|credential|insteadOf/i.test(flags.join(' ')), false);
  assert.deepEqual(Object.keys(CHAVES_DE_REDE).sort(), ['http.proxy', 'http.schannelUseSSLCAInfo', 'http.sslBackend', 'http.sslCAInfo', 'https.proxy'], 'a lista é fechada');
});

test('valor fora da forma não passa, mesmo na chave da lista', async () => {
  await comConfig([
    '[http]', '\tproxy = "http://usuario:senha@proxy.example.test:3128"', '\tsslCAInfo = caminho/relativo.pem', '\tsslBackend = "!sh -c hostil"', '\tschannelUseSSLCAInfo = talvez',
    '[https]', '\tproxy = "http://proxy.example.test;hostil"',
  ]);
  assert.deepEqual(await redeDoConfigGlobal(), {});
  assert.deepEqual(await flagsDeRedeDaMaquina(), []);
});

test('sem config global, nada é repassado', async () => {
  process.env.GIT_CONFIG_GLOBAL = path.join(raiz, 'nao-existe');
  assert.deepEqual(await flagsDeRedeDaMaquina(), []);
});

test('schannel escolhido pelo Farol respeita a CA declarada; o backend declarado é de quem declarou', () => {
  const ca = 'http.schannelUseSSLCAInfo=true';
  assert.ok(flagsDeRede({}, '/ca.pem', true).includes(ca), 'GIT_SSL_CAINFO não some com o schannel forçado');
  assert.ok(flagsDeRede({ 'http.sslCAInfo': '/ca.pem' }, '', true).includes(ca));
  assert.deepEqual(flagsDeRede({}, '', true), [], 'sem CA, fica o repositório de certificados da máquina');
  assert.equal(flagsDeRede({ 'http.sslCAInfo': '/ca.pem', 'http.sslBackend': 'schannel' }, '', true).includes(ca), false);
  assert.equal(flagsDeRede({ 'http.sslCAInfo': '/ca.pem', 'http.schannelUseSSLCAInfo': 'false' }, '', true).includes(ca), false);
  assert.deepEqual(flagsDeRede({}, '/ca.pem', false), [], 'fora do Windows a variável já vale sozinha');
});

test('o caminho longo vale no git isolado e em quem lê o material, só no Windows', () => {
  const windows = process.platform === 'win32';
  for (const flags of [FLAGS_GIT_ISOLADO, FLAGS_GIT_SOBRE_MATERIAL]) assert.equal(flags.includes('core.longpaths=true'), windows);
});

test('git sobre o material não executa o core.fsmonitor do config global', async () => {
  const script = path.join(raiz, 'fsmonitor.sh');
  await fs.writeFile(script, `#!/bin/sh\necho "$GH_TOKEN" >> "${barra(canario)}"\n`, { mode: 0o755 });
  await comConfig(['[core]', `\tfsmonitor = ${barra(script)}`, '[user]', '\tname = x']);
  const env = { ...envGitLimpo(), GIT_CONFIG_GLOBAL: config, GH_TOKEN: 'valor-do-token-de-teste' };
  const lido = () => (fsSync.existsSync(canario) ? fsSync.readFileSync(canario, 'utf8') : '');
  // controle: sem as travas ele roda e lê o token
  spawnSync('git', ['status', '--porcelain'], { cwd: repo, env, encoding: 'utf8', windowsHide: true });
  assert.match(lido(), /valor-do-token-de-teste/, 'o config morde sem as travas');
  await fs.rm(canario);
  for (const comando of [['status', '--porcelain'], ['ls-files', '--stage'], ['show', `${head}:a.js`]]) {
    const r = spawnSync('git', [...FLAGS_GIT_SOBRE_MATERIAL, ...comando], { cwd: repo, env, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(lido(), '', comando[0]);
  }
});

test('debt.js chama o git com as travas; runtime.js e material.js também', async () => {
  const original = io.run, chamadas = [];
  io.run = async (cmd, args, opts) => { chamadas.push(args); return original(cmd, args, opts); };
  try {
    const context = { base: head, head, snapshot: repo, profile: { baselines: [{ rule: 'r', known: ['x|a.js'] }] } };
    const result = { rules: [{ rule: 'r', conhecidos: 1, acionadores: ['a.js'] }] };
    const comparisons = [{ rule: 'r', file: 'a.js', confidence: 'alta', rationale: 'igual', state: 'unchanged', evidence: ['base', 'head'].map(revision => ({ revision, file: 'a.js', line: 1, observation: 'igual' })) }];
    assert.equal(await debtVerdict(context, result, comparisons), 'pass');
  } finally { io.run = original; }
  assert.ok(chamadas.length);
  for (const args of chamadas) assert.deepEqual(args.slice(0, FLAGS_GIT_SOBRE_MATERIAL.length), [...FLAGS_GIT_SOBRE_MATERIAL]);
  const fonte = arquivo => fs.readFile(new URL(`../lib/technical-review/${arquivo}`, import.meta.url), 'utf8');
  assert.match(await fonte('runtime.js'), /\[\.\.\.FLAGS_GIT_SOBRE_MATERIAL, 'status', '--porcelain'\]/);
  assert.match(await fonte('material.js'), /\[\.\.\.FLAGS_GIT_SOBRE_MATERIAL, 'ls-files', '--stage'\]/);
});
