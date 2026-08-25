// O pacote de distribuição tem que carregar TODO arquivo de tools/ que o app usa
// em RUNTIME (bug real, macOS do Guilherme, 25/08/2026).
//
// Desde a v2.52.0 o lib/engine/jira.js grava uma config de MCP apontando pra
// `APP_ROOT/tools/jira-mcp.js`, mas a whitelist do make-package.ps1 só levava os
// 4 scripts de BUILD da pasta tools. Resultado: na máquina do mantenedor (rodando
// do fonte) tudo funcionava, e em toda cópia instalada a sessão de revisão com
// site de Jira cadastrado estourava o diálogo do Electron "Unable to find Electron
// app at ~/.farol/app/tools/jira-mcp.js". Classe de erro conhecida por aqui: a
// mesma da fachada da v2.28.0 e do agente fora da lista `synced` (o fonte tem, a
// cópia distribuída não), e nenhum teste olhava.
//
// A trava tem duas metades:
//  1. todo `tools/<arquivo>` referenciado por código de lib/ tem que estar na
//     whitelist do empacotador (derivado do fonte, não tabela curada: referência
//     nova entra na trava sozinha);
//  2. o arquivo referenciado tem que existir no repo (referência morta também é
//     defeito, só que de outro dono).
import fs from 'node:fs';
import path from 'node:path';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const raiz = path.dirname(import.meta.dirname);

function arquivosJs(dir) {
  const saida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivosJs(p));
    else if (e.name.endsWith('.js')) saida.push(p);
  }
  return saida;
}

// referências `'tools', 'arquivo.ext'` (path.join) ou `tools/arquivo.ext` literais
function referenciasATools(fonte) {
  const refs = new Set();
  for (const m of fonte.matchAll(/'tools',\s*'([^']+)'/g)) refs.add(m[1]);
  for (const m of fonte.matchAll(/tools\/([\w.-]+\.\w+)/g)) refs.add(m[1]);
  return refs;
}

const referenciados = new Set();
for (const arq of arquivosJs(path.join(raiz, 'lib'))) {
  for (const r of referenciasATools(fs.readFileSync(arq, 'utf8'))) referenciados.add(r);
}

test('lib/ referencia pelo menos o jira-mcp.js (o parser não envelheceu)', () => {
  assert.ok(referenciados.has('jira-mcp.js'),
    'nenhuma referência a tools/jira-mcp.js achada em lib/: o parser deste teste quebrou ou o arquivo mudou de casa (atualize os dois lados)');
});

const empacotador = fs.readFileSync(path.join(raiz, 'tools', 'make-package.ps1'), 'utf8');

for (const ref of referenciados) {
  test(`tools/${ref} referenciado em runtime: existe no repo e viaja no pacote`, () => {
    assert.ok(fs.existsSync(path.join(raiz, 'tools', ref)),
      `lib/ referencia tools/${ref} e o arquivo não existe no repo`);
    assert.ok(empacotador.includes(`'${ref}'`),
      `tools/${ref} é usado em runtime e não está na whitelist do make-package.ps1: cópia instalada quebraria (o bug do jira-mcp.js de 25/08/2026)`);
  });
}
