// Comando local de pareamento (A4, spec 7.A4 itens 3 e 4). O código sai SÓ na saída do
// terminal: nunca em farol.log, spawns.log, arquivo em claro ou linha de comando de outro
// processo. O comando honra FAROL_HOME, porque roda no aparelho ao lado do engine.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-farol-parear-'));
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { consumirCodigo, criarCodigo } = await import('../lib/local-auth/pareamento.js');
const { emitirSessao, verificarSessao, listarSessoes } = await import('../lib/local-auth/sessoes.js');
const { LOG_FILE, LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { SPAWN_LOG_FILE } = await import('../lib/spawnlog.js');

const RAIZ = path.join(import.meta.dirname, '..');
const CLI = path.join(RAIZ, 'tools', 'farol-parear.js');

function rodar(args = []) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, FAROL_HOME: HOME } });
}

function arquivosDe(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivosDe(p) : [p];
  });
}

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('imprime um código que funciona uma vez, só no stdout e só dentro do FAROL_HOME', () => {
  const r = rodar();
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/Código de pareamento: ([A-Z2-7]{10})\n/);
  assert.ok(m, `saída inesperada: ${r.stdout}`);
  const codigo = m[1];
  assert.match(r.stdout, /Vale por 10 minutos e funciona uma vez só\./);
  assert.equal(r.stderr, '');
  for (const arq of arquivosDe(HOME)) {
    assert.equal(fs.readFileSync(arq, 'utf8').includes(codigo), false, `código em claro em ${arq}`);
  }
  assert.equal(fs.existsSync(LOG_FILE), false, 'o comando não escreve farol.log');
  assert.equal(fs.existsSync(SPAWN_LOG_FILE), false, 'o comando não escreve spawns.log');
  assert.ok(fs.existsSync(path.join(LOCAL_AUTH_DIR, 'pareamentos.json')), 'o pareamento fica no FAROL_HOME do teste');
  assert.equal(consumirCodigo(codigo), true);
  assert.equal(consumirCodigo(codigo), false);
});

test('--revogar-todas derruba sessões e códigos pendentes', () => {
  const token = emitirSessao('celular');
  const codigo = criarCodigo();
  const r = rodar(['--revogar-todas']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /revogados/);
  assert.equal(verificarSessao(token), false);
  assert.equal(consumirCodigo(codigo), false);
});

test('argumento desconhecido não gera código nem mexe em nada', () => {
  const r = rodar(['--codigo', 'ABCDEFGHIJ']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Uso: node tools\/farol-parear\.js \[--revogar-todas \| --autoanalise \[rótulo\]\]/);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(LOCAL_AUTH_DIR), false);
});

test('--autoanalise emite a credencial do agente: só no stdout, só no escopo dela, revogável', () => {
  const r = rodar(['--autoanalise']);
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/Credencial do agente da autoanálise: ([A-Za-z0-9_-]{43})\n/);
  assert.ok(m, r.stdout);
  assert.equal(verificarSessao(m[1], Date.now(), 'autoanalise'), true);
  assert.equal(verificarSessao(m[1]), false, 'nunca vale como Bearer geral');
  assert.deepEqual(listarSessoes().map(s => [s.rotulo, s.classe]), [['agente', 'autoanalise']]);
  for (const arquivo of arquivosDe(HOME)) assert.equal(fs.readFileSync(arquivo, 'utf8').includes(m[1]), false, `token em claro em ${arquivo}`);
  const comRotulo = rodar(['--autoanalise', 'laptop']);
  assert.equal(comRotulo.status, 0, comRotulo.stderr);
  assert.ok(listarSessoes().some(s => s.rotulo === 'laptop' && s.classe === 'autoanalise'));
  assert.equal(rodar(['--revogar-todas']).status, 0);
  assert.equal(verificarSessao(m[1], Date.now(), 'autoanalise'), false, 'revogar-todas também derruba a do agente');
});

for (const nome of ['farol-parear.js', 'farol-autoanalise.js']) {
  test(`${nome} viaja no pacote leve, no Setup.exe e no offline do macOS`, () => {
    const pacote = fs.readFileSync(path.join(RAIZ, 'tools', 'make-package.ps1'), 'utf8');
    const pacoteSh = fs.readFileSync(path.join(RAIZ, 'tools', 'make-package.sh'), 'utf8');
    const setup = fs.readFileSync(path.join(RAIZ, 'tools', 'make-installer.ps1'), 'utf8');
    const offline = fs.readFileSync(path.join(RAIZ, 'tools', 'make-offline-mac.sh'), 'utf8');
    const ps = new RegExp(`foreach \\(\\$t in @\\([^)]*'${nome.replace('.', '\\.')}'`);
    const sh = new RegExp(`for t in [^;\\n]*\\b${nome.replace('.', '\\.')}\\b`);
    assert.match(pacote, ps, 'whitelist do pacote leve');
    assert.match(pacoteSh, sh, 'whitelist do pacote leve (sh)');
    assert.match(setup, ps, 'whitelist do Setup.exe');
    assert.match(offline, sh, 'whitelist do offline do macOS');
  });
}

test('a guarda de árvore suja do pacote lê a mesma lista que o laço de tools/ copia', () => {
  const pacote = fs.readFileSync(path.join(RAIZ, 'tools', 'make-package.ps1'), 'utf8');
  // a guarda de árvore suja passou a ler a MESMA lista que o empacotador copia (main,
  // 1e260c6): o arquivo está nela porque o laço de tools/ o acrescenta
  assert.match(pacote, /\$doPacote \+= "tools\/\$t"/, 'o laço de tools/ alimenta a lista da guarda');
  assert.match(pacote, /status --porcelain -- @doPacote/, 'o pacote recusa árvore suja também neste arquivo');
});
