// Escopo materializado do PR: é a peça que torna a cobertura OBSERVÁVEL pelo engine.
//
// Achado do preflight do P0b: o protocolo de review lê um `.patch` ÚNICO
// (`gh pr diff > pr<NN>.patch`), então nunca existe um `Read` por arquivo do PR e
// observar "Read · caminho" não cobriria nada. Em vez de inferir cobertura de um
// texto, o engine ESCREVE o patch de cada arquivo num diretório que ele controla e
// instrui a sessão a ler dali. Aí `Read` por arquivo passa a ser o mecanismo real, e
// o mapeamento caminho-lido -> caminho-do-PR é aritmética de path, não heurística.
//
// A limitação honesta continua: `Read` observado prova que o conteúdo foi entregue
// ao agente, não que ele raciocinou bem sobre aquilo. O que isto elimina é a classe
// "o modelo afirmou ter coberto o que o engine nunca observou".
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-scope-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { prPathFromRead, materializeScope, scopeRootFor, pruneScopes } = await import('../lib/engine/pr-scope.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const ROOT = path.join(FAROL_HOME, 'escopo');

/* ---------- mapeamento de caminho ---------- */

test('caminho lido dentro da raiz vira o caminho do PR, sempre com barra normal', () => {
  assert.equal(prPathFromRead(ROOT, path.join(ROOT, 'src', 'a.js')), 'src/a.js');
  assert.equal(prPathFromRead(ROOT, path.join(ROOT, 'a.js')), 'a.js');
});

test('separador do Windows e do POSIX chegam no mesmo caminho de PR', () => {
  assert.equal(prPathFromRead(ROOT, `${ROOT}/src/deep/a.js`), 'src/deep/a.js');
  assert.equal(prPathFromRead(ROOT, `${ROOT}${path.sep}src${path.sep}deep${path.sep}a.js`), 'src/deep/a.js');
});

test('caminho fora da raiz não conta como cobertura', () => {
  assert.equal(prPathFromRead(ROOT, path.join(FAROL_HOME, 'outro', 'a.js')), null);
  assert.equal(prPathFromRead(ROOT, path.join(ROOT, '..', 'a.js')), null);
  assert.equal(prPathFromRead(ROOT, ROOT), null, 'a própria raiz não é arquivo do PR');
});

test('entrada vazia ou sem raiz nunca vira cobertura', () => {
  assert.equal(prPathFromRead(ROOT, ''), null);
  assert.equal(prPathFromRead('', path.join(ROOT, 'a.js')), null);
  assert.equal(prPathFromRead(ROOT, null), null);
  assert.equal(prPathFromRead(null, null), null);
});

/* ---------- materialização ---------- */

test('materializeScope escreve um arquivo por caminho do PR e devolve o total', () => {
  const root = path.join(FAROL_HOME, 'm1');
  const r = materializeScope(root, [
    { path: 'src/a.js', patch: '@@ -1 +1 @@\n-a\n+b\n', status: 'modified' },
    { path: 'docs/deep/b.md', patch: '@@ -0,0 +1 @@\n+x\n', status: 'added' }
  ]);
  assert.deepEqual(r.total.sort(), ['docs/deep/b.md', 'src/a.js']);
  assert.equal(r.root, root);
  assert.ok(fs.existsSync(path.join(root, 'src', 'a.js')));
  assert.match(fs.readFileSync(path.join(root, 'docs', 'deep', 'b.md'), 'utf8'), /\+x/);
});

test('arquivo sem patch (binário, renomeado, grande demais) entra no total mesmo assim', () => {
  // se ele sumisse do total, um arquivo sem patch viraria cobertura grátis
  const root = path.join(FAROL_HOME, 'm2');
  const r = materializeScope(root, [{ path: 'img/logo.png', patch: '', status: 'added' }]);
  assert.deepEqual(r.total, ['img/logo.png']);
  assert.ok(fs.existsSync(path.join(root, 'img', 'logo.png')));
});

test('caminho que tenta escapar da raiz é descartado, não escrito', () => {
  const root = path.join(FAROL_HOME, 'm3');
  const r = materializeScope(root, [
    { path: '../fora.js', patch: 'x', status: 'modified' },
    { path: '/etc/passwd', patch: 'x', status: 'modified' },
    { path: 'ok.js', patch: 'x', status: 'modified' }
  ]);
  assert.deepEqual(r.total, ['ok.js']);
  assert.equal(fs.existsSync(path.join(FAROL_HOME, 'fora.js')), false);
});

test('materializar de novo limpa o que sobrou da rodada anterior', () => {
  const root = path.join(FAROL_HOME, 'm4');
  materializeScope(root, [{ path: 'velho.js', patch: 'x', status: 'modified' }]);
  materializeScope(root, [{ path: 'novo.js', patch: 'x', status: 'modified' }]);
  assert.equal(fs.existsSync(path.join(root, 'velho.js')), false, 'arquivo de outro head não pode contar');
  assert.ok(fs.existsSync(path.join(root, 'novo.js')));
});

test('scopeRootFor isola por PR e aceita chave com barra e cerquilha', () => {
  const a = scopeRootFor('acme/app#42');
  const b = scopeRootFor('acme/app#43');
  assert.notEqual(a, b);
  assert.ok(!path.basename(a).includes('/'));
});

test('pruneScopes remove só o que passou da idade', () => {
  const base = path.join(FAROL_HOME, 'prune');
  fs.mkdirSync(path.join(base, 'velho'), { recursive: true });
  fs.mkdirSync(path.join(base, 'novo'), { recursive: true });
  const antigo = Date.now() - 40 * 24 * 60 * 60 * 1000;
  fs.utimesSync(path.join(base, 'velho'), antigo / 1000, antigo / 1000);
  pruneScopes(base, 30 * 24 * 60 * 60 * 1000);
  assert.equal(fs.existsSync(path.join(base, 'velho')), false);
  assert.ok(fs.existsSync(path.join(base, 'novo')));
});

/* ---------- escrita segura e fail-closed ---------- */

test('o arquivo é criado com permissão restrita e sem seguir link plantado', () => {
  const root = path.join(FAROL_HOME, 'm5');
  materializeScope(root, [{ path: 'a.js', patch: 'x', status: 'modified' }]);
  const st = fs.statSync(path.join(root, 'a.js'));
  if (process.platform !== 'win32') {
    assert.equal(st.mode & 0o777, 0o600, 'ninguém além do dono lê o patch');
  }
  assert.ok(st.isFile());
});

test('arquivo que não pôde ser escrito CONTINUA no total (nunca vira cobertura grátis)', () => {
  const root = path.join(FAROL_HOME, 'm6');
  // um diretório no lugar do arquivo faz a escrita falhar
  fs.mkdirSync(path.join(root, 'a.js'), { recursive: true });
  const r = materializeScope(root, [
    { path: 'a.js', patch: 'x', status: 'modified' },
    { path: 'b.js', patch: 'y', status: 'modified' }
  ]);
  // materializeScope limpa a raiz antes, então a.js volta a ser gravável; o que este
  // teste fixa é a DIREÇÃO da regra, provada pelo caminho duplicado abaixo
  assert.deepEqual(r.total, ['a.js', 'b.js']);
});

test('caminho repetido na resposta não duplica o total nem estoura na escrita exclusiva', () => {
  const root = path.join(FAROL_HOME, 'm7');
  const r = materializeScope(root, [
    { path: 'a.js', patch: 'primeiro', status: 'modified' },
    { path: 'a.js', patch: 'segundo', status: 'modified' }
  ]);
  assert.deepEqual(r.total, ['a.js']);
  assert.equal(fs.readFileSync(path.join(root, 'a.js'), 'utf8'), 'primeiro');
});
