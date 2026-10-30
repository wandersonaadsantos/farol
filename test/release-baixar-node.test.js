// Plano 4 do Farol nativo, Task 1: o Node oficial que entra no bundle das cascas.
// `tools/release/baixar-node.sh` (e o `.ps1`) baixa o pacote da plataforma e o
// SHASUMS256.txt da mesma versão, confere o hash ANTES de extrair e tira do pacote só
// o binário do node. Aqui o nodejs.org é um servidor HTTP local (`--origem`), com
// pacotes fabricados na hora: o hash certo passa, o errado aborta com a mensagem que
// nomeia versão, arquivo e os dois hashes, e plataforma fora da lista nem baixa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { zipDe, tarGzDe } from './helpers/arquivos-compactados.js';

const RAIZ = path.join(import.meta.dirname, '..');
const SH = path.join(RAIZ, 'tools', 'release', 'baixar-node.sh');
const PS1 = path.join(RAIZ, 'tools', 'release', 'baixar-node.ps1');
const VERSAO_NVMRC = fs.readFileSync(path.join(RAIZ, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
const existe = (cmd, args) => { const r = spawnSync(cmd, args); return !r.error && r.status === 0; };
const PWSH = ['/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh', '/usr/bin/pwsh'].find((p) => fs.existsSync(p))
  || (existe('pwsh', ['-v']) ? 'pwsh' : null);
// o .sh precisa de bash, curl, tar, unzip e de um sha256; o CI do Windows não tem `zip` nem
// leva este script a sério (a casca do Windows usa o .ps1), então lá ele pula com motivo
function motivoParaPularSh() {
  if (process.platform === 'win32') return 'baixar-node.sh é do macOS e do Linux; no Windows vale o .ps1';
  const faltando = ['curl', 'tar', 'unzip'].filter((c) => !existe('sh', ['-c', `command -v ${c}`]));
  if (!existe('sh', ['-c', 'command -v shasum || command -v sha256sum'])) faltando.push('shasum/sha256sum');
  return faltando.length ? `ferramenta ausente: ${faltando.join(', ')}` : false;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-baixar-node-'));
const SITE = path.join(TMP, 'site');
const VERSAO_ERRADA = '9.9.9';
const VERSAO_SEM_SHASUMS = '8.8.8';
const VERSAO_SEM_LINHA = '7.7.7';

const sha256 = (arquivo) => crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');

// o "binário" é um script que imprime a versão: dá para rodar e conferir o conteúdo
function binarioFalso(versao) {
  return `#!/bin/sh\necho v${versao}\n`;
}

// monta node-v<v>-<plat>.tar.gz e node-v<v>-win-x64.zip com o leiaute oficial e mais
// um arquivo que NÃO pode sair do pacote. Em Node puro: o fixture não pode depender de
// `zip`/`tar` na máquina, senão o arquivo inteiro cai no carregamento onde eles faltam.
function fabricarVersao(versao, { shasums = 'certo', semLinha = false } = {}) {
  const dir = path.join(SITE, `v${versao}`);
  fs.mkdirSync(dir, { recursive: true });
  const nomes = [];
  for (const plat of ['darwin-arm64', 'darwin-x64']) {
    const raiz = `node-v${versao}-${plat}`;
    const nome = `${raiz}.tar.gz`;
    fs.writeFileSync(path.join(dir, nome), tarGzDe([
      { nome: `${raiz}/bin/node`, conteudo: binarioFalso(versao), modo: 0o755 },
      { nome: `${raiz}/include/node.h`, conteudo: '// cabecalho\n' },
    ]));
    nomes.push(nome);
  }
  const raizWin = `node-v${versao}-win-x64`;
  const nomeWin = `${raizWin}.zip`;
  fs.writeFileSync(path.join(dir, nomeWin), zipDe([
    { nome: `${raizWin}/node.exe`, conteudo: `MZ falso v${versao}\n` },
    { nome: `${raizWin}/npm.cmd`, conteudo: '@echo off\n' },
  ]));
  nomes.push(nomeWin);
  if (shasums === 'ausente') return;
  const linhas = (semLinha ? [] : nomes).map((n) => {
    const hash = shasums === 'errado' ? 'f'.repeat(64) : sha256(path.join(dir, n));
    return `${hash}  ${n}`;
  });
  // linhas de outros arquivos antes, como no SHASUMS256.txt de verdade
  fs.writeFileSync(path.join(dir, 'SHASUMS256.txt'), [`${'0'.repeat(64)}  node-v${versao}.tar.gz`, ...linhas, ''].join('\n'));
}

fabricarVersao(VERSAO_NVMRC);
fabricarVersao(VERSAO_ERRADA, { shasums: 'errado' });
fabricarVersao(VERSAO_SEM_SHASUMS, { shasums: 'ausente' });
fabricarVersao(VERSAO_SEM_LINHA, { semLinha: true });

let servidor;
let origem;

test.before(async () => {
  servidor = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const alvo = path.join(SITE, path.normalize(rel));
    if (!alvo.startsWith(SITE) || !fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) {
      res.writeHead(404); res.end('nao achei'); return;
    }
    res.writeHead(200); res.end(fs.readFileSync(alvo));
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  origem = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(() => {
  servidor.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// sem erro é 0; morte por sinal ou timeout (code não numérico) conta como 1
function codigoDeSaida(err) {
  if (!err) return 0;
  return typeof err.code === 'number' ? err.code : 1;
}

// o script do Windows roda pelo pwsh; o do POSIX, pelo bash
function comandoDe(script) {
  if (script.endsWith('.ps1')) return [PWSH, ['-NoProfile', '-NonInteractive', '-File', script]];
  return ['bash', [script]];
}

// o .ps1 só roda com pwsh na máquina; o .sh tem o próprio motivo
function motivoParaPular(script) {
  if (script !== PS1) return motivoParaPularSh();
  return PWSH ? false : 'pwsh ausente nesta máquina';
}

// assíncrono de propósito: o servidor falso mora neste processo e precisa do laço livre
function rodar(script, args) {
  const [cmd, base] = comandoDe(script);
  return new Promise((ok) => {
    execFile(cmd, [...base, ...args], { timeout: 60_000 }, (err, stdout, stderr) => {
      ok({ code: codigoDeSaida(err), stdout, stderr });
    });
  });
}

const destinoNovo = () => fs.mkdtempSync(path.join(TMP, 'destino-'));

function listarTudo(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listarTudo(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

for (const script of [SH, PS1]) {
  const nome = path.basename(script);
  const pular = motivoParaPular(script);

  test(`${nome}: hash certo, darwin-arm64, versão do .nvmrc por padrão: só bin/node sai do pacote`, { skip: pular }, async () => {
    const destino = destinoNovo();
    const r = await rodar(script, ['--plataforma', 'darwin-arm64', '--destino', destino, '--origem', origem]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(listarTudo(destino), ['bin/node']);
    assert.equal(fs.readFileSync(path.join(destino, 'bin', 'node'), 'utf8'), binarioFalso(VERSAO_NVMRC));
    // NTFS não guarda o bit de execução
    if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(destino, 'bin', 'node')).mode & 0o100, 'bin/node tem que sair executável');
  });

  test(`${nome}: hash certo, win-x64: só node.exe sai do zip`, { skip: pular }, async () => {
    const destino = destinoNovo();
    const r = await rodar(script, ['--versao', VERSAO_NVMRC, '--plataforma', 'win-x64', '--destino', destino, '--origem', origem]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(listarTudo(destino), ['node.exe']);
    assert.equal(fs.readFileSync(path.join(destino, 'node.exe'), 'utf8'), `MZ falso v${VERSAO_NVMRC}\n`);
  });

  test(`${nome}: hash errado aborta nomeando versão, arquivo e os dois hashes, sem extrair nada`, { skip: pular }, async () => {
    const destino = destinoNovo();
    const arquivo = `node-v${VERSAO_ERRADA}-darwin-x64.tar.gz`;
    const real = sha256(path.join(SITE, `v${VERSAO_ERRADA}`, arquivo));
    const r = await rodar(script, ['--versao', VERSAO_ERRADA, '--plataforma', 'darwin-x64', '--destino', destino, '--origem', origem]);
    assert.notEqual(r.code, 0);
    const saida = r.stderr + r.stdout;
    assert.match(saida, new RegExp(VERSAO_ERRADA.replace(/\./g, '\\.')));
    assert.ok(saida.includes(arquivo), saida);
    assert.ok(saida.includes('f'.repeat(64)), `sem o hash esperado: ${saida}`);
    assert.ok(saida.includes(real), `sem o hash obtido: ${saida}`);
    assert.deepEqual(listarTudo(destino), []);
  });

  test(`${nome}: plataforma fora da lista falha antes de baixar`, { skip: pular }, async () => {
    const destino = destinoNovo();
    const r = await rodar(script, ['--plataforma', 'linux-x64', '--destino', destino, '--origem', origem]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /linux-x64/);
    assert.deepEqual(listarTudo(destino), []);
  });

  test(`${nome}: SHASUMS256.txt ausente falha`, { skip: pular }, async () => {
    const destino = destinoNovo();
    const r = await rodar(script, ['--versao', VERSAO_SEM_SHASUMS, '--plataforma', 'darwin-arm64', '--destino', destino, '--origem', origem]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /SHASUMS256\.txt/);
    assert.deepEqual(listarTudo(destino), []);
  });

  test(`${nome}: arquivo fora do SHASUMS256.txt falha sem extrair`, { skip: pular }, async () => {
    const destino = destinoNovo();
    const r = await rodar(script, ['--versao', VERSAO_SEM_LINHA, '--plataforma', 'win-x64', '--destino', destino, '--origem', origem]);
    assert.notEqual(r.code, 0);
    const saida = r.stderr + r.stdout;
    assert.ok(saida.includes(`node-v${VERSAO_SEM_LINHA}-win-x64.zip`), saida);
    assert.match(saida, /SHASUMS256\.txt/);
    assert.deepEqual(listarTudo(destino), []);
  });

  test(`${nome}: opção no fim sem valor falha dizendo qual`, { skip: pular }, async () => {
    const r = await rodar(script, ['--plataforma', 'darwin-arm64', '--origem', origem, '--destino']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /falta o valor de --destino/);
  });
}
