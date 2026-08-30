// A varredura do gate de sintaxe casa por NOME de entrada em qualquer nível da
// árvore, e isso tem uma consequência que só aparece quando alguém procura:
// `.claude` na lista de ignorados não pula só o da raiz, pula
// `workspace-template/.claude/` junto. O template é artefato DISTRIBUÍDO, o
// protocolo de review que vai dentro do pacote, e um hook `.js` novo ali sairia
// sem nunca passar pelo `node --check`.
//
// Hoje só existem `.md` e `settings.json` lá, então nada muda no número. É por
// isso que o caso é escrito com um `.js` de mentira: sem ele, a exceção
// continuaria correta e invisível, e quem apagasse a linha não veria nada
// quebrar até o dia em que o arquivo real aparecesse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { varrer } from '../tools/check-syntax.js';

function arvore() {
  const raiz = mkdtempSync(join(tmpdir(), 'farol-varre-'));
  const escrever = (relativo) => {
    const partes = relativo.split('/');
    mkdirSync(join(raiz, ...partes.slice(0, -1)), { recursive: true });
    writeFileSync(join(raiz, ...partes), 'export const x = 1;\n', 'utf8');
  };
  escrever('lib/real.js');
  escrever('workspace-template/.claude/hooks/gancho.js');
  escrever('.claude/worktrees/copia/lib/real.js');
  escrever('.worktrees/outra/lib/real.js');
  escrever('node_modules/pacote/index.js');
  return { raiz, escrever };
}

test('a varredura entra no .claude do template distribuido e nao nos outros', () => {
  const { raiz } = arvore();
  try {
    const achados = varrer(raiz)
      .map((p) => p.slice(raiz.length + 1).split(sep).join('/'))
      .sort();
    assert.deepEqual(achados, ['lib/real.js', 'workspace-template/.claude/hooks/gancho.js']);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
