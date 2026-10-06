// A troca do Electron na instalação do Windows não pode misturar versões.
//
// O install.ps1 espelhava o node_modules validado por cima do instalado com robocopy /MIR.
// O npm grava todo arquivo do pacote com a data fixa de 1979, e o robocopy pula o arquivo de
// mesmo tamanho e mesma data. Medido em 05/10/2026 na troca do Electron 44.3.0 pelo 44.5.1:
// ffmpeg.dll, vk_swiftshader.dll e dist\version ficaram da versão antiga ao lado do
// electron.exe novo. Nem /IS /IT resolvem sempre: em 40 cópias de um arquivo de mesmo
// tamanho e data, 6 ficaram velhas (classe "modificado", que só /IM cobre, e /IM não
// existe em robocopy antigo). A cópia agora vai para pasta vazia e troca o nome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const HELPER = path.join(RAIZ, 'installer', 'electron-runtime.ps1');
const INSTALL = fs.readFileSync(path.join(RAIZ, 'installer', 'install.ps1'), 'utf8');
const temporarios = [];
after(() => { for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true }); });
const SO_WINDOWS = { skip: process.platform === 'win32' ? false : 'PowerShell e robocopy só no Windows' };

test('o install.ps1 troca o Electron pela função, sem espelhar por cima', () => {
  assert.match(INSTALL, /Copy-ElectronRuntime \$Runtime\.Source \$App/);
  assert.doesNotMatch(INSTALL, /robocopy \$Runtime\.Source/, 'espelhar por cima é o que misturava versões');
});

// Mesma data fixa nos dois lados e conteúdo diferente do mesmo tamanho: o caso medido.
function cenario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-copia-electron-'));
  temporarios.push(dir);
  const fonte = path.join(dir, 'fonte', 'electron', 'dist');
  const app = path.join(dir, 'app');
  const instalado = path.join(app, 'node_modules', 'electron', 'dist');
  fs.mkdirSync(fonte, { recursive: true }); fs.mkdirSync(instalado, { recursive: true });
  const data = new Date('1985-10-26T08:15:00Z');
  for (const [pasta, versao] of [[fonte, '44.5.1'], [instalado, '44.3.0']]) {
    fs.writeFileSync(path.join(pasta, 'version'), versao);
    fs.writeFileSync(path.join(pasta, 'ffmpeg.dll'), 'dll-' + versao);
    for (const f of ['version', 'ffmpeg.dll']) fs.utimesSync(path.join(pasta, f), data, data);
  }
  fs.writeFileSync(path.join(instalado, 'sobra-da-versao-antiga'), 'x');
  return { dir, fonte: path.join(dir, 'fonte'), app, instalado };
}

function copiar(fonte, app) {
  const file = path.join(path.dirname(app), 'copia.ps1');
  fs.writeFileSync(file, `$ErrorActionPreference='Stop'\n. $env:TEST_HELPER\nCopy-ElectronRuntime $env:TEST_SRC $env:TEST_APP\n`);
  return cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
    env: { ...process.env, TEST_HELPER: HELPER, TEST_SRC: fonte, TEST_APP: app }, encoding: 'utf8', timeout: 60000,
  });
}

test('arquivos de mesmo tamanho e data chegam na versão nova, e a sobra da antiga sai', SO_WINDOWS, () => {
  for (let i = 0; i < 5; i++) {
    const c = cenario();
    const r = copiar(c.fonte, c.app);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(path.join(c.instalado, 'version'), 'utf8'), '44.5.1');
    assert.equal(fs.readFileSync(path.join(c.instalado, 'ffmpeg.dll'), 'utf8'), 'dll-44.5.1');
    assert.equal(fs.existsSync(path.join(c.instalado, 'sobra-da-versao-antiga')), false, 'a pasta antiga não deixa resto');
    assert.deepEqual(fs.readdirSync(c.app), ['node_modules'], 'sem node_modules.novo nem .antigo sobrando');
  }
});

test('origem que não existe: falha e o node_modules instalado fica intacto', SO_WINDOWS, () => {
  const c = cenario();
  const r = copiar(path.join(c.dir, 'nao-existe'), c.app);
  assert.notEqual(r.status, 0, 'falha visível');
  assert.equal(fs.readFileSync(path.join(c.instalado, 'version'), 'utf8'), '44.3.0', 'a instalação anterior foi preservada');
  assert.deepEqual(fs.readdirSync(c.app), ['node_modules']);
});
