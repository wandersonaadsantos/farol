// Plano 4 do Farol nativo, Task 1: `tools/make-package.sh` é a porta POSIX do
// `tools/make-package.ps1`, e a semente do motor das cascas sai dele. As duas portas têm
// de levar EXATAMENTE o mesmo pacote: as listas do `.sh` são conferidas contra as do
// `.ps1` (lidas pelo mesmo helper que trava a distribuição), o zip de verdade é
// conferido contra `arquivosQueViajam`, e o pente anti-vazamento é o mesmo texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listaPowershell, arquivosQueViajam } from './helpers/listas-do-pacote.js';
import { zipDe } from './helpers/arquivos-compactados.js';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const PS1 = ler('tools/make-package.ps1');
const SH = ler('tools/make-package.sh');
const VERSAO = JSON.parse(ler('package.json')).version;
const existe = (cmd, args) => { const r = spawnSync(cmd, args); return !r.error && r.status === 0; };
const PWSH = ['/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh', '/usr/bin/pwsh'].find((p) => fs.existsSync(p))
  || (existe('pwsh', ['-v']) ? 'pwsh' : null);
// os .sh precisam de bash, zip (`zip -@`), unzip e git; o CI do Windows não tem `zip`, e lá
// o pacote sai do make-package.ps1, então esses casos pulam com motivo
function motivoParaPularSh() {
  if (process.platform === 'win32') return 'make-package.sh e semente-do-motor.sh são do macOS e do Linux; no Windows vale o .ps1';
  const faltando = ['zip', 'unzip', 'git'].filter((c) => !existe('sh', ['-c', `command -v ${c}`]));
  return faltando.length ? `ferramenta ausente: ${faltando.join(', ')}` : false;
}
const SO_POSIX = { skip: motivoParaPularSh() };

// mesma leitura do `listaBash` de test/distribuicao-listas.test.js
const NOME_SIMPLES = /^[A-Za-z][\w.-]*$/;
function listaBash(texto, variavel) {
  const re = new RegExp(`^for ${variavel} in (.+); do$`, 'gm');
  const achadas = [...texto.matchAll(re)]
    .map((m) => m[1].trim().split(/\s+/))
    .filter((itens) => itens.every((i) => NOME_SIMPLES.test(i)));
  assert.equal(achadas.length, 1, `tools/make-package.sh: esperava UMA lista de ${variavel}, achei ${achadas.length}`);
  return achadas[0];
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-make-package-sh-'));
const DIST = path.join(TMP, 'dist');
const ZIP = path.join(DIST, `farol-v${VERSAO}.zip`);
const AMBIENTE = {
  ...process.env,
  FAROL_ALLOW_DIRTY: '1',
  FAROL_DIST: DIST,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
};
const ESPERADO = [...arquivosQueViajam(RAIZ)].sort();

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function listarTudo(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listarTudo(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

for (const variavel of ['f', 'd', 't', 'doc']) {
  test(`make-package.sh copia a mesma lista de ${variavel} que o make-package.ps1`, () => {
    assert.deepEqual(listaBash(SH, variavel), listaPowershell(PS1, variavel, 'tools/make-package.ps1'));
  });
}

test('make-package.sh audita com os mesmos padrões do make-package.ps1', () => {
  const credencial = /Select-String -Pattern '([^']+)'/.exec(PS1)[1];
  const proibidos = /\$_ -match '(node_modules[^']+)'/.exec(PS1)[1];
  assert.ok(SH.includes(`'${credencial}'`), 'o pente de credencial do .sh divergiu do .ps1');
  assert.ok(SH.includes(`'${proibidos}'`), 'a lista de caminhos proibidos do .sh divergiu do .ps1');
  // o Select-String ignora caixa por padrão: o grep tem que ignorar também
  assert.match(SH, /grep -[a-zA-Z]*i[a-zA-Z]*E/);
});

test('make-package.sh gera o zip com exatamente os arquivos que viajam', SO_POSIX, () => {
  const r = spawnSync('bash', [path.join(RAIZ, 'tools', 'make-package.sh')], { env: AMBIENTE, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(ZIP), `zip ausente em ${ZIP}`);
  const entradas = spawnSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
  assert.deepEqual(entradas, ESPERADO);
});

test('semente-do-motor.sh com --zip extrai o pacote em <destino>/engine/app e imprime a versão', SO_POSIX, () => {
  assert.ok(fs.existsSync(ZIP), 'depende do zip gerado no teste anterior');
  const destino = path.join(TMP, 'semente-zip');
  const r = spawnSync('bash', [path.join(RAIZ, 'tools', 'release', 'semente-do-motor.sh'), '--zip', ZIP, '--destino', destino],
    { env: AMBIENTE, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout.trim(), VERSAO);
  assert.deepEqual(listarTudo(path.join(destino, 'engine', 'app')).sort(), ESPERADO);
});

test('semente-do-motor.sh sem --zip gera o pacote pelo make-package.sh', SO_POSIX, () => {
  const destino = path.join(TMP, 'semente-build');
  const r = spawnSync('bash', [path.join(RAIZ, 'tools', 'release', 'semente-do-motor.sh'), '--destino', destino],
    { env: AMBIENTE, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout.trim(), VERSAO);
  assert.ok(fs.existsSync(path.join(destino, 'engine', 'app', 'server.js')));
  assert.deepEqual(listarTudo(path.join(destino, 'engine', 'app')).sort(), ESPERADO);
});

test('semente-do-motor.sh sem --destino falha', SO_POSIX, () => {
  const r = spawnSync('bash', [path.join(RAIZ, 'tools', 'release', 'semente-do-motor.sh'), '--zip', ZIP],
    { env: AMBIENTE, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--destino/);
});

// o zip deste caso é montado em Node a partir de `arquivosQueViajam`, então ele roda também
// no Windows, onde não há `zip` nem make-package.sh
test('semente-do-motor.ps1 com --zip extrai o mesmo pacote', { skip: PWSH ? false : 'pwsh ausente nesta máquina' }, () => {
  const zipPs1 = path.join(TMP, 'pacote-ps1.zip');
  fs.writeFileSync(zipPs1, zipDe(ESPERADO.map((rel) => ({ nome: rel, conteudo: fs.readFileSync(path.join(RAIZ, rel)) }))));
  const destino = path.join(TMP, 'semente-ps1');
  const r = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-File', path.join(RAIZ, 'tools', 'release', 'semente-do-motor.ps1'),
    '--zip', zipPs1, '--destino', destino], { env: AMBIENTE, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout.trim(), VERSAO);
  assert.deepEqual(listarTudo(path.join(destino, 'engine', 'app')).sort(), ESPERADO);
});
