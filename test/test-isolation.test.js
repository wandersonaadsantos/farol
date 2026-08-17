// Isolamento do FAROL_HOME nos testes (regressão da migração ESM, achada num Mac real
// em 17/08/2026). O idioma da suíte é fixar `process.env.FAROL_HOME` num diretório
// temporário ANTES de carregar o engine, porque `lib/paths.js` lê a env UMA vez, em
// const de nível de módulo. Em CommonJS isso bastava: o `require('../server.js')`
// escrito depois da atribuição rodava depois dela.
//
// Em ESM não basta. Import ESTÁTICO é hasteado e avaliado ANTES de qualquer linha do
// corpo do módulo, então o `process.env.FAROL_HOME = ...` chega tarde e o paths.js já
// resolveu HOME pro ~/.farol REAL do usuário. O test/spawnlog.test.js caiu exatamente
// nisso: passava verde escrevendo em ~/.farol/workspace/state/spawns.log, semeando o
// workspace de verdade e reescrevendo o ~/.claude.json da máquina (o boot da Engine
// chama ensureWorkspaceTrusted), enquanto o after() apagava um diretório temporário
// que nunca foi usado. Suíte verde, isolamento quebrado: por isso a trava é estática.
//
// A regra: teste que SETA FAROL_HOME não pode importar estaticamente módulo do repo
// que alcance lib/paths.js. Quem precisa do módulo usa `await import()`, que é avaliado
// no ponto em que aparece, depois da env. Teste que NÃO seta FAROL_HOME fica de fora
// (ex.: review-protocol-lessons.test.js só lê TEMPLATE_DIR, ancorado no APP_ROOT).
import path from 'node:path';
import fs from 'node:fs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const TEST_DIR = path.join(RAIZ, 'test');
const PATHS_JS = path.join(RAIZ, 'lib', 'paths.js');

// import estático: linha que COMEÇA com a palavra `import`. Cobre as duas formas
// (`import x from '...'` e `import '...'`) e de propósito NÃO casa `await import('...')`
// nem linha de comentário, que é o jeito certo e não pode reprovar.
const ESTATICO_COM_FROM = /^[ \t]*import\s[^;\n]*?from\s*['"]([^'"]+)['"]/gm;
const ESTATICO_SEM_FROM = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
// qualquer referência a módulo do repo, estática ou dinâmica: usada pra andar o grafo
const QUALQUER_REF = /from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]/g;

function importsEstaticos(src) {
  const specs = [];
  for (const m of src.matchAll(ESTATICO_COM_FROM)) specs.push(m[1]);
  for (const m of src.matchAll(ESTATICO_SEM_FROM)) specs.push(m[1]);
  return specs.filter(s => s.startsWith('.'));
}

function resolve(deQuem, spec) {
  return path.resolve(path.dirname(deQuem), spec);
}

// Um módulo está "ancorado no FAROL_HOME" se é o paths.js ou se alcança o paths.js por
// import (estático ou dinâmico, tanto faz: carregar o módulo carrega a cadeia inteira).
const memo = new Map();
function ancorado(arquivo, visitando = new Set()) {
  if (arquivo === PATHS_JS) return true;
  if (memo.has(arquivo)) return memo.get(arquivo);
  if (visitando.has(arquivo)) return false; // ciclo: não decide, quem chamou decide
  visitando.add(arquivo);
  let src = '';
  try { src = fs.readFileSync(arquivo, 'utf8'); } catch { memo.set(arquivo, false); return false; }
  let alcanca = false;
  for (const m of src.matchAll(QUALQUER_REF)) {
    const alvo = resolve(arquivo, m[1] || m[2]);
    if (ancorado(alvo, visitando)) { alcanca = true; break; }
  }
  visitando.delete(arquivo);
  memo.set(arquivo, alcanca);
  return alcanca;
}

function arquivosDeTeste() {
  return fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.test.js')).sort();
}

test('teste que fixa FAROL_HOME não carrega o engine por import estático (hoisting do ESM)', () => {
  const infratores = [];
  for (const nome of arquivosDeTeste()) {
    const arquivo = path.join(TEST_DIR, nome);
    const src = fs.readFileSync(arquivo, 'utf8');
    if (!/^[ \t]*process\.env\.FAROL_HOME\s*=/m.test(src)) continue;
    for (const spec of importsEstaticos(src)) {
      if (ancorado(resolve(arquivo, spec))) infratores.push(`${nome} importa '${spec}' estaticamente`);
    }
  }
  assert.deepEqual(infratores, [],
    'import estático é hasteado acima do process.env.FAROL_HOME e o teste passa a escrever no ~/.farol REAL; troque por await import()');
});

// Guarda-corpo da própria trava: se o grafo parar de enxergar o paths.js (refactor de
// caminho, arquivo renomeado), o teste acima viraria verde permanente sem checar nada.
test('o grafo de imports enxerga o server.js como ancorado no paths.js', () => {
  assert.equal(ancorado(path.join(RAIZ, 'server.js')), true, 'server.js alcança lib/paths.js');
  assert.equal(ancorado(path.join(RAIZ, 'lib', 'spawnlog.js')), true, 'spawnlog.js alcança lib/paths.js');
  assert.equal(ancorado(path.join(RAIZ, 'lib', 'engine', 'public-review.js')), false,
    'public-review.js é puro: não alcança o paths.js, então import estático dele é legítimo');
});
