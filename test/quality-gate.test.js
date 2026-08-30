import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { comparar, scanRepo } from '../tools/quality/gate.js';

test('comparar: contagem igual ou menor passa', () => {
  const base = { 'a.js': { emptyCatch: 2 } };
  assert.deepEqual(comparar({ 'a.js': { emptyCatch: 1 } }, base).regressoes, []);
  assert.deepEqual(comparar({ 'a.js': { emptyCatch: 2 } }, base).regressoes, []);
});

test('comparar: contagem maior e arquivo novo com violacao reprovam', () => {
  const base = { 'a.js': { emptyCatch: 1 } };
  assert.equal(comparar({ 'a.js': { emptyCatch: 2 } }, base).regressoes.length, 1);
  assert.equal(comparar({ 'a.js': { emptyCatch: 1 }, 'novo.js': { varUse: 1 } }, base).regressoes.length, 1);
});

test('comparar: arquivo deletado nao reprova', () => {
  assert.deepEqual(comparar({}, { 'a.js': { emptyCatch: 5 } }).regressoes, []);
});

/*
 * O gate anda no sistema de arquivos, não no git, então diretório de ferramenta
 * que não é fonte do projeto precisa estar na lista de ignorados uma a uma. O
 * `.worktrees/` já estava; o `.claude/` não, e é onde o harness cria worktree
 * hoje. Com uma worktree ali, a varredura contava o repositório inteiro DE NOVO
 * sob outro caminho: 340 arquivos no lugar de 171, e 76 regressões falsas que
 * travavam o gate por completo sem uma linha de código ter mudado.
 *
 * O caso monta a árvore em disco e chama o scanRepo de verdade, porque o que
 * está sob teste é justamente a travessia.
 */
test('scanRepo nao entra em diretorio de ferramenta, mesmo com codigo violador dentro', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'farol-scan-'));
  try {
    const sujo = 'export function f() { try { f(); } catch {} }\nvar x = 1;\n';
    // o mesmo conteúdo em dois lugares: um que conta, três que não contam
    mkdirSync(join(raiz, 'lib'), { recursive: true });
    writeFileSync(join(raiz, 'lib', 'real.js'), sujo, 'utf8');
    for (const dir of ['.claude/worktrees/x/lib', '.worktrees/y/lib', '.superpowers/z']) {
      mkdirSync(join(raiz, ...dir.split('/')), { recursive: true });
      writeFileSync(join(raiz, ...dir.split('/'), 'copia.js'), sujo, 'utf8');
    }

    const achados = Object.keys(scanRepo(raiz)).map((p) => p.split(sep).join('/'));
    assert.deepEqual(achados, ['lib/real.js']);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
