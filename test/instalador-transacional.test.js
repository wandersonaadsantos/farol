// Reinício no meio do update não pode deixar o app inutilizável, e instalar de novo tem de consertar.
//
// Medido em 03/11/2026 na v2.78.30: reinício abrupto 25 s depois do início do update deixou seis
// arquivos com o tamanho certo e o conteúdo todo nulo, o Electron abria com SyntaxError, e rodar o
// instalador de novo saía com sucesso sem mudar nada (robocopy pula mesmo tamanho e mesma data).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const HELPER = path.join(RAIZ, 'installer', 'copia-transacional.ps1');
const INSTALL = fs.readFileSync(path.join(RAIZ, 'installer', 'install.ps1'), 'utf8');
const INSTALL_SH = fs.readFileSync(path.join(RAIZ, 'installer', 'install.sh'), 'utf8');
const temporarios = [];
after(() => { for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true }); });
const SO_WINDOWS = { skip: process.platform === 'win32' ? false : 'PowerShell e robocopy só no Windows' };

test('o install.ps1 copia o app pela transação, sem robocopy no lugar definitivo', () => {
  assert.match(fs.readFileSync(path.join(RAIZ, 'installer', 'electron-runtime.ps1'), 'utf8'), /copia-transacional\.ps1/);
  assert.match(INSTALL, /Install-AppTransacional/);
  assert.doesNotMatch(INSTALL, /robocopy \$srcDir/);
});

test('o install.sh manda os dados ao disco antes da troca de nome', () => {
  const troca = INSTALL_SH.indexOf('mv "$APP" "$LIVE_APP"');
  assert.ok(troca > 0);
  assert.ok(INSTALL_SH.lastIndexOf('\nsync', troca) > 0, 'sem sync, o reinício pode zerar o que o rename já expôs');
});

function escrever(raiz, arquivos) {
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), conteudo);
  }
}

function cenario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-transacao-'));
  temporarios.push(dir);
  const src = path.join(dir, 'src'), app = path.join(dir, 'app');
  escrever(src, { 'main.js': 'main novo', 'package.json': '{"version":"2"}', 'lib/a.js': 'export const a = 1;\n', 'ui/b.js': 'b novo', 'docs/GUIA.md': 'guia', 'docs/INTERNO.md': 'fora da lista' });
  escrever(app, { 'main.js': 'main velho', 'package.json': '{"version":"1"}', 'lib/a.js': 'velho', 'lib/removido.js': 'sobra', 'ui/b.js': 'b velho', 'docs/ANTIGO.md': 'sai', 'node_modules/electron/x': 'preservado' });
  return { dir, src, app };
}

function instalar(c, extra = '') {
  const file = path.join(c.dir, 'instala.ps1');
  fs.writeFileSync(file, `$ErrorActionPreference='Stop'\n. $env:TEST_HELPER\n${extra}\nInstall-AppTransacional -Src $env:TEST_SRC -App $env:TEST_APP -Pastas @('lib','ui','nao-existe') -Arquivos @('main.js','package.json','ausente.md') -Guias @('GUIA.md')\n`);
  return cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
    env: { ...process.env, TEST_HELPER: HELPER, TEST_SRC: c.src, TEST_APP: c.app }, encoding: 'utf8', timeout: 60000,
  });
}
const ler = (c, rel) => fs.readFileSync(path.join(c.app, rel), 'utf8');
const semSobras = (c) => assert.deepEqual(fs.readdirSync(c.dir).filter(n => /^app\.(novo|antigo)$/.test(n)), []);

test('instala por cima: conteúdo novo, sobra removida, guia pela lista e Electron intacto', SO_WINDOWS, () => {
  const c = cenario();
  const r = instalar(c);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(ler(c, 'main.js'), 'main novo');
  assert.equal(ler(c, 'lib/a.js'), 'export const a = 1;\n');
  assert.equal(fs.existsSync(path.join(c.app, 'lib/removido.js')), false);
  assert.deepEqual(fs.readdirSync(path.join(c.app, 'docs')), ['GUIA.md']);
  assert.equal(ler(c, 'node_modules/electron/x'), 'preservado');
  semSobras(c);
});

test('o caso medido: arquivo zerado de mesmo tamanho e data é consertado ao instalar de novo', SO_WINDOWS, () => {
  for (let i = 0; i < 3; i++) {
    const c = cenario();
    const origem = path.join(c.src, 'lib/a.js'), zerado = path.join(c.app, 'lib/a.js');
    const tamanho = fs.statSync(origem).size;
    fs.writeFileSync(zerado, Buffer.alloc(tamanho));
    const data = new Date('2026-11-03T22:46:00Z');
    fs.utimesSync(origem, data, data); fs.utimesSync(zerado, data, data);
    const r = instalar(c);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(ler(c, 'lib/a.js'), 'export const a = 1;\n');
  }
});

test('sobra de instalação interrompida não entra na cópia', SO_WINDOWS, () => {
  const c = cenario();
  escrever(`${c.app}.novo`, { 'lib/lixo.js': Buffer.alloc(32) });
  escrever(`${c.app}.antigo`, { 'lib/velho.js': 'x' });
  const r = instalar(c);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(path.join(c.app, 'lib/lixo.js')), false);
  semSobras(c);
});

test('falha na troca devolve o que já tinha trocado: o app fica inteiro na versão anterior', SO_WINDOWS, () => {
  const c = cenario();
  // Uma pasta nova cujo destino a função não consegue mover: arquivo aberto sem compartilhamento.
  const r = instalar(c, `$script:trava = [IO.File]::Open((Join-Path $env:TEST_APP 'ui\\b.js'), 'Open', 'Read', 'None')`);
  assert.notEqual(r.status, 0, 'falha visível');
  assert.equal(ler(c, 'main.js'), 'main velho');
  assert.equal(ler(c, 'lib/a.js'), 'velho');
  assert.equal(ler(c, 'ui/b.js'), 'b velho');
  assert.equal(ler(c, 'lib/removido.js'), 'sobra');
  semSobras(c);
});

test('guia ausente na origem: falha antes de tocar no app', SO_WINDOWS, () => {
  const c = cenario();
  fs.rmSync(path.join(c.src, 'docs/GUIA.md'));
  const r = instalar(c);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Guia ausente/);
  assert.equal(ler(c, 'main.js'), 'main velho');
  semSobras(c);
});

test('a comparação olha o conteúdo: mesmo tamanho e data não passam', SO_WINDOWS, () => {
  const c = cenario();
  const a = path.join(c.dir, 'a', 'x.js'), b = path.join(c.dir, 'b', 'x.js');
  fs.mkdirSync(path.dirname(a)); fs.mkdirSync(path.dirname(b));
  fs.writeFileSync(a, 'abcd'); fs.writeFileSync(b, Buffer.alloc(4));
  const data = new Date('2026-11-03T22:46:00Z');
  fs.utimesSync(a, data, data); fs.utimesSync(b, data, data);
  const file = path.join(c.dir, 'compara.ps1');
  fs.writeFileSync(file, `$ErrorActionPreference='Stop'\n. $env:TEST_HELPER\nWrite-Output ('dif=' + (@(Get-DiferencasDaCopia $env:TEST_A $env:TEST_B) -join ','))\n`);
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
    env: { ...process.env, TEST_HELPER: HELPER, TEST_A: path.dirname(a), TEST_B: path.dirname(b) }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dif=x\.js/);
});

// O bloco de cópia do install-linux.sh, de verdade, com a instalação em pasta temporária.
const BASH = cp.spawnSync('bash', ['--version']).status === 0 ? false : 'sem bash';
function blocoLinux() {
  const t = fs.readFileSync(path.join(RAIZ, 'installer', 'install-linux.sh'), 'utf8');
  const ini = t.indexOf('step "Copiando o app para $APP"'), fim = t.indexOf('# --- dependencias (Electron)');
  assert.ok(ini > 0 && fim > ini, 'o teste ficou cego: bloco de cópia não encontrado');
  return t.slice(ini, fim);
}
function instalarLinux(c) {
  for (const doc of ['CONFIGURATION.md', 'REVIEW-GATES.md', 'MACOS.md', 'RELEASE.md']) escrever(c.src, { [`docs/${doc}`]: doc });
  const file = path.join(c.dir, 'instala.sh');
  fs.writeFileSync(file, `step() { :; }\ndie() { echo "$1"; exit 1; }\n${blocoLinux()}\n`);
  const barra = p => p.replaceAll('\\', '/');
  return cp.spawnSync('bash', [barra(file)], { env: { ...process.env, SRC: barra(c.src), APP: barra(c.app) }, encoding: 'utf8', timeout: 60000 });
}
test('install-linux: troca no fim, cura arquivo zerado, remove sobra e preserva o Electron', { skip: BASH }, () => {
  const c = cenario();
  const origem = path.join(c.src, 'lib/a.js'), zerado = path.join(c.app, 'lib/a.js');
  fs.writeFileSync(zerado, Buffer.alloc(fs.statSync(origem).size));
  escrever(`${c.app}.novo`, { 'lib/lixo.js': Buffer.alloc(32) });
  const r = instalarLinux(c);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(ler(c, 'lib/a.js'), 'export const a = 1;\n');
  assert.equal(ler(c, 'main.js'), 'main novo');
  assert.equal(fs.existsSync(path.join(c.app, 'lib/removido.js')), false);
  assert.equal(fs.existsSync(path.join(c.app, 'lib/lixo.js')), false);
  assert.equal(fs.existsSync(path.join(c.app, 'docs/ANTIGO.md')), false);
  assert.equal(ler(c, 'node_modules/electron/x'), 'preservado');
  semSobras(c);
});
test('install-linux: guia ausente falha antes de tocar no app', { skip: BASH }, () => {
  const c = cenario();
  const file = path.join(c.dir, 'instala.sh');
  fs.writeFileSync(file, `step() { :; }\ndie() { echo "$1"; exit 1; }\n${blocoLinux()}\n`);
  const barra = p => p.replaceAll('\\', '/');
  const r = cp.spawnSync('bash', [barra(file)], { env: { ...process.env, SRC: barra(c.src), APP: barra(c.app) }, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Guia ausente/);
  assert.equal(ler(c, 'main.js'), 'main velho');
  assert.equal(ler(c, 'lib/a.js'), 'velho');
});

// Achados da revisão: a versão anterior nunca pode se perder, mesmo com o desfazer falhando.
function instalarComFalha(c, extra) {
  const file = path.join(c.dir, 'instala.ps1');
  fs.writeFileSync(file, `$ErrorActionPreference='Stop'\n. $env:TEST_HELPER\n${extra}\nInstall-AppTransacional -Src $env:TEST_SRC -App $env:TEST_APP -Pastas @('lib','ui') -Arquivos @('main.js','package.json') -Guias @('GUIA.md')\n`);
  return cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
    env: { ...process.env, TEST_HELPER: HELPER, TEST_SRC: c.src, TEST_APP: c.app }, encoding: 'utf8', timeout: 90000,
  });
}
test('troca e desfazer falhando: a versão anterior fica guardada e a próxima instalação recupera', SO_WINDOWS, () => {
  const c = cenario();
  // 'ui' não sai do novo para o lugar nem volta do guardado: o caso que perdia a pasta.
  const r = instalarComFalha(c, `function Move-ItemDoApp([string]$De, [string]$Para) {
  if (($De -like '*.novo*ui') -or ($De -like '*.antigo*ui')) { throw 'falha injetada' }
  Move-Item -LiteralPath $De -Destination $Para -Force
}`);
  assert.notEqual(r.status, 0, 'falha visível');
  assert.equal(fs.readFileSync(path.join(`${c.app}.antigo`, 'ui/b.js'), 'utf8'), 'b velho', 'a única cópia não pode ser apagada');
  const segunda = instalarComFalha(c, '');
  assert.equal(segunda.status, 0, segunda.stdout + segunda.stderr);
  assert.equal(ler(c, 'ui/b.js'), 'b novo');
  semSobras(c);
});
test('reinício entre os dois movimentos: o item só em app.antigo volta, mesmo com o pacote recusado', SO_WINDOWS, () => {
  const c = cenario();
  fs.mkdirSync(`${c.app}.antigo`);
  fs.renameSync(path.join(c.app, 'lib'), path.join(`${c.app}.antigo`, 'lib'));
  fs.rmSync(path.join(c.src, 'docs/GUIA.md'));
  const r = instalar(c);
  assert.notEqual(r.status, 0);
  assert.equal(ler(c, 'lib/a.js'), 'velho', 'a pasta guardada não pode sumir');
});
test('o package.json é o último a trocar: troca interrompida não anuncia a versão nova', SO_WINDOWS, () => {
  const c = cenario();
  const r = instalarComFalha(c, `$script:ordem = @()
function Move-ItemDoApp([string]$De, [string]$Para) {
  if ($De -like '*.novo*') { $script:ordem += (Split-Path -Leaf $De) }
  Move-Item -LiteralPath $De -Destination $Para -Force
  if ($script:ordem[-1] -eq 'package.json' -and ($De -like '*.novo*')) { Write-Output ('ordem=' + ($script:ordem -join ',')) }
}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ordem=(?:(?!package).)*package\.json\s*$/m);
});
test('arquivo somente leitura no pacote não derruba a instalação', SO_WINDOWS, () => {
  const c = cenario();
  const ro = path.join(c.src, 'lib/somente-leitura.js');
  fs.writeFileSync(ro, 'x'); fs.chmodSync(ro, 0o444);
  const r = instalar(c);
  fs.chmodSync(ro, 0o666);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(ler(c, 'lib/somente-leitura.js'), 'x');
  fs.chmodSync(path.join(c.app, 'lib/somente-leitura.js'), 0o666);
});
test('install-linux: item só em app.antigo volta antes da limpeza', { skip: BASH }, () => {
  const c = cenario();
  fs.mkdirSync(`${c.app}.antigo`);
  fs.renameSync(path.join(c.app, 'lib'), path.join(`${c.app}.antigo`, 'lib'));
  const file = path.join(c.dir, 'instala.sh');
  fs.writeFileSync(file, `step() { :; }\ndie() { echo "$1"; exit 1; }\n${blocoLinux()}\n`);
  const barra = p => p.replaceAll('\\', '/');
  const r = cp.spawnSync('bash', [barra(file)], { env: { ...process.env, SRC: barra(c.src), APP: barra(c.app) }, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(r.status, 0, 'sem os guias a cópia é recusada');
  assert.equal(ler(c, 'lib/a.js'), 'velho');
});
