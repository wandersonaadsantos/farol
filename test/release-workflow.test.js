// Plano 4 do Farol nativo, Task 6: a pipeline de release (.github/workflows/release-nativo.yml).
// O YAML é lido como TEXTO: o repositório não tem dependência npm e um parser de YAML só
// para isto seria a primeira. As travas cobrem o que custa caro errar: publicar fora da
// tag, segredo interpolado em comando, job sem teto de tempo (o macOS conta 10x) e o nome
// de secret que diverge do que o docs/RELEASE.md manda cadastrar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = path.join(RAIZ, '.github', 'workflows', 'release-nativo.yml');
const JOBS = ['motor', 'mac', 'win', 'publicar'];

const ler = () => fs.readFileSync(ARQUIVO, 'utf8').replace(/\r\n/g, '\n');

// o texto de cada job: da linha `  <nome>:` (dois espaços, logo abaixo de `jobs:`) até o
// próximo job ou o fim do arquivo
function blocosDosJobs(texto) {
  const inicio = texto.indexOf('\njobs:\n');
  assert.ok(inicio >= 0, 'sem a chave jobs: no topo');
  const corpo = texto.slice(inicio + '\njobs:\n'.length);
  const blocos = {};
  const marcas = [...corpo.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)];
  marcas.forEach((m, i) => {
    const fim = i + 1 < marcas.length ? marcas[i + 1].index : corpo.length;
    blocos[m[1]] = corpo.slice(m.index, fim);
  });
  return blocos;
}

// o que vem antes de `jobs:`: gatilhos, permissões e concorrência do workflow
const topo = (texto) => texto.slice(0, texto.indexOf('\njobs:\n'));

test('o workflow existe', () => {
  assert.ok(fs.existsSync(ARQUIVO), `${ARQUIVO} ausente`);
});

test('os quatro jobs existem, e só eles', () => {
  assert.deepEqual(Object.keys(blocosDosJobs(ler())).sort(), [...JOBS].sort());
});

// Enquanto o Electron existe, as releases 2.x saem do publish-release.ps1 local; só a major 3
// em diante dispara a pipeline nativa (cada rodada custa ~45 minutos de macOS cobrados 10x)
test('gatilhos: só tag de major 3 ou mais, nunca v* puro; workflow_dispatch só constrói', () => {
  const t = topo(ler());
  const tags = t.match(/^ {2}push:\n(?: {4}#.*\n)* {4}tags:\s*\[(.*)\]\s*$/m);
  assert.ok(tags, 'push sem tags: [...]');
  assert.deepEqual(tags[1].split(',').map((p) => p.trim()), ["'v[3-9].*'", "'v[1-9][0-9].*'"]);
  assert.doesNotMatch(t, /'v\*'/);
  assert.match(t, /^ {2}workflow_dispatch:/m);
  assert.doesNotMatch(t, /^ {4}branches:/m, 'push em branch não dispara release');
});

test('publicar depende dos três e só roda na tag', () => {
  const b = blocosDosJobs(ler()).publicar;
  const needs = b.match(/^ {4}needs:\s*\[([^\]]*)\]/m);
  assert.ok(needs, 'publicar sem needs: [...]');
  assert.deepEqual(needs[1].split(',').map((s) => s.trim()).sort(), ['mac', 'motor', 'win']);
  // workflow_dispatch disparado de uma ref de tag também tem github.ref de tag: só o push publica
  assert.match(b, /^ {4}if:\s*github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)\s*$/m);
});

test('publish-release.ps1 só aparece no job publicar', () => {
  const blocos = blocosDosJobs(ler());
  for (const nome of JOBS) {
    const tem = blocos[nome].includes('publish-release.ps1');
    assert.equal(tem, nome === 'publicar', `publish-release.ps1 ${tem ? 'aparece' : 'falta'} em ${nome}`);
  }
  assert.ok(!topo(ler()).includes('publish-release.ps1'));
  assert.match(blocos.publicar, /FAROL_SO_ANEXAR:\s*'1'/);
});

test('todo job tem timeout-minutes, com os tetos do plano', () => {
  const blocos = blocosDosJobs(ler());
  const tetos = { motor: 15, mac: 45, win: 45, publicar: 15 };
  for (const nome of JOBS) {
    const m = blocos[nome].match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m);
    assert.ok(m, `${nome} sem timeout-minutes`);
    assert.equal(Number(m[1]), tetos[nome], `teto de ${nome}`);
  }
});

test('concorrência por ref', () => {
  assert.match(topo(ler()), /^concurrency:\n {2}group:.*\$\{\{ github\.ref \}\}/m);
});

test('permissões: contents read no topo, write só no publicar', () => {
  const texto = ler();
  assert.match(topo(texto), /^permissions:\n {2}contents: read\s*$/m);
  const blocos = blocosDosJobs(texto);
  for (const nome of JOBS) {
    const escreve = /contents:\s*write/.test(blocos[nome]);
    assert.equal(escreve, nome === 'publicar', `contents: write em ${nome}`);
  }
  assert.equal((texto.match(/contents:\s*write/g) || []).length, 1);
});

test('secret só entra por env:, nunca interpolado num comando', () => {
  const linhas = ler().split('\n').filter((l) => l.includes('${{ secrets.'));
  assert.ok(linhas.length > 0, 'nenhum secret usado');
  for (const l of linhas) {
    assert.match(l, /^\s+[A-Z][A-Z0-9_]*:\s*\$\{\{ secrets\.[A-Z][A-Z0-9_]* \}\}\s*$/, `secret fora de env: ${l.trim()}`);
  }
  assert.doesNotMatch(ler(), /run:.*\$\{\{ secrets\./);
});

test('os secrets usados são exatamente os documentados no docs/RELEASE.md', () => {
  const doc = fs.readFileSync(path.join(RAIZ, 'docs', 'RELEASE.md'), 'utf8');
  const paragrafo = doc.match(/\*\*Secrets da pipeline\*\*[\s\S]*?\n\n/);
  assert.ok(paragrafo, 'docs/RELEASE.md sem o parágrafo "Secrets da pipeline"');
  const documentados = new Set([...paragrafo[0].matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]));
  assert.ok(documentados.size >= 10, `poucos secrets documentados: ${[...documentados]}`);
  // o GITHUB_TOKEN é do próprio Actions, ninguém o cadastra
  const usados = new Set([...ler().matchAll(/\$\{\{ secrets\.([A-Z][A-Z0-9_]*) \}\}/g)]
    .map((m) => m[1]).filter((n) => n !== 'GITHUB_TOKEN'));
  assert.deepEqual([...usados].sort(), [...documentados].sort());
});

test('o GITHUB_TOKEN só chega ao publicar', () => {
  const blocos = blocosDosJobs(ler());
  for (const nome of JOBS) {
    assert.equal(blocos[nome].includes('secrets.GITHUB_TOKEN'), nome === 'publicar', nome);
  }
});

test('node-version é o do .nvmrc', () => {
  const nvmrc = fs.readFileSync(path.join(RAIZ, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
  const versoes = [...ler().matchAll(/node-version:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(versoes.length > 0, 'nenhum node-version');
  for (const v of versoes) assert.equal(v, nvmrc);
});

test('o chaveiro e o pfx temporários saem mesmo com falha', () => {
  const blocos = blocosDosJobs(ler());
  assert.match(blocos.mac, /if: always\(\)[\s\S]*?security delete-keychain/);
  assert.match(blocos.win, /if: always\(\)[\s\S]*?Remove-Item[^\n]*WIN_SIGNING_CERT_PFX/);
});

test('o win acha o signtool e o entrega ao assinar-win.ps1 por WIN_SIGNTOOL', () => {
  const b = blocosDosJobs(ler()).win;
  assert.match(b, /Windows Kits\\10\\bin/);
  assert.match(b, /"WIN_SIGNTOOL=\$[^"]+"\s*\|\s*Out-File -FilePath \$env:GITHUB_ENV/);
  assert.ok(b.indexOf('WIN_SIGNTOOL=') < b.indexOf('& tools/release/assinar-win.ps1'), 'WIN_SIGNTOOL antes de assinar');
});

test('o publicar baixa cada artefato na pasta que o anexos-da-release.js lê', () => {
  const b = blocosDosJobs(ler()).publicar;
  for (const [nome, pasta] of [['motor', 'dist'], ['mac', 'dist/mac'], ['win', 'dist/win']]) {
    const re = new RegExp(`name: ${nome}\\n\\s+path: ${pasta.replace('/', '\\/')}\\s*\\n`);
    assert.match(b, re, `artefato ${nome} em ${pasta}`);
  }
});
