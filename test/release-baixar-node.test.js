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

const RAIZ = path.join(import.meta.dirname, '..');
const SH = path.join(RAIZ, 'tools', 'release', 'baixar-node.sh');
const PS1 = path.join(RAIZ, 'tools', 'release', 'baixar-node.ps1');
const VERSAO_NVMRC = fs.readFileSync(path.join(RAIZ, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
const PWSH = ['/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh', '/usr/bin/pwsh'].find((p) => fs.existsSync(p))
  || (spawnSync('pwsh', ['-v']).status === 0 ? 'pwsh' : null);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-baixar-node-'));
const SITE = path.join(TMP, 'site');
const VERSAO_ERRADA = '9.9.9';
const VERSAO_SEM_SHASUMS = '8.8.8';

const sha256 = (arquivo) => crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');

// o "binário" é um script que imprime a versão: dá para rodar e conferir o conteúdo
function binarioFalso(versao) {
  return `#!/bin/sh\necho v${versao}\n`;
}

// monta node-v<v>-<plat>.tar.gz e node-v<v>-win-x64.zip com o leiaute oficial e mais
// um arquivo que NÃO pode sair do pacote
function fabricarVersao(versao, { shasums = 'certo' } = {}) {
  const dir = path.join(SITE, `v${versao}`);
  fs.mkdirSync(dir, { recursive: true });
  const obra = fs.mkdtempSync(path.join(TMP, 'obra-'));
  const nomes = [];
  for (const plat of ['darwin-arm64', 'darwin-x64']) {
    const raiz = `node-v${versao}-${plat}`;
    fs.mkdirSync(path.join(obra, raiz, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(obra, raiz, 'include'), { recursive: true });
    fs.writeFileSync(path.join(obra, raiz, 'bin', 'node'), binarioFalso(versao), { mode: 0o755 });
    fs.writeFileSync(path.join(obra, raiz, 'include', 'node.h'), '// cabecalho\n');
    const nome = `${raiz}.tar.gz`;
    const r = spawnSync('tar', ['-czf', path.join(dir, nome), raiz], { cwd: obra });
    assert.equal(r.status, 0, String(r.stderr));
    nomes.push(nome);
  }
  const raizWin = `node-v${versao}-win-x64`;
  fs.mkdirSync(path.join(obra, raizWin), { recursive: true });
  fs.writeFileSync(path.join(obra, raizWin, 'node.exe'), `MZ falso v${versao}\n`);
  fs.writeFileSync(path.join(obra, raizWin, 'npm.cmd'), '@echo off\n');
  const nomeWin = `${raizWin}.zip`;
  const z = spawnSync('zip', ['-q', '-r', path.join(dir, nomeWin), raizWin], { cwd: obra });
  assert.equal(z.status, 0, String(z.stderr));
  nomes.push(nomeWin);
  if (shasums === 'ausente') return;
  const linhas = nomes.map((n) => {
    const hash = shasums === 'errado' ? 'f'.repeat(64) : sha256(path.join(dir, n));
    return `${hash}  ${n}`;
  });
  // linhas de outros arquivos antes, como no SHASUMS256.txt de verdade
  fs.writeFileSync(path.join(dir, 'SHASUMS256.txt'), [`${'0'.repeat(64)}  node-v${versao}.tar.gz`, ...linhas, ''].join('\n'));
}

fabricarVersao(VERSAO_NVMRC);
fabricarVersao(VERSAO_ERRADA, { shasums: 'errado' });
fabricarVersao(VERSAO_SEM_SHASUMS, { shasums: 'ausente' });

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

// assíncrono de propósito: o servidor falso mora neste processo e precisa do laço livre
function rodar(script, args) {
  const [cmd, base] = script.endsWith('.ps1')
    ? [PWSH, ['-NoProfile', '-NonInteractive', '-File', script]]
    : ['bash', [script]];
  return new Promise((ok) => {
    execFile(cmd, [...base, ...args], { timeout: 60_000 }, (err, stdout, stderr) => {
      ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
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
  const pular = script === PS1 && !PWSH ? 'pwsh ausente nesta máquina' : false;

  test(`${nome}: hash certo, darwin-arm64, versão do .nvmrc por padrão: só bin/node sai do pacote`, { skip: pular }, async () => {
    const destino = destinoNovo();
    const r = await rodar(script, ['--plataforma', 'darwin-arm64', '--destino', destino, '--origem', origem]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(listarTudo(destino), ['bin/node']);
    assert.equal(fs.readFileSync(path.join(destino, 'bin', 'node'), 'utf8'), binarioFalso(VERSAO_NVMRC));
    assert.ok(fs.statSync(path.join(destino, 'bin', 'node')).mode & 0o100, 'bin/node tem que sair executável');
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
}
