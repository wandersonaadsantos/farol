# Quality Gate engineering-standards no Farol — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impor as regras do `@biudtech/engineering-standards` no Farol SEM instalar o pacote nem qualquer dependência npm: um gate de qualidade em Node puro (`tools/quality/`) com ratchet por baseline (a contagem de violações só desce), uma primeira onda de correções que reduz a dívida medida, e a migração completa do repositório de CommonJS pra **ESM** (decisão do usuário em 16/08/2026: "quero o sistema bem atual").

**Architecture:** Espelha o `tools/check-syntax.js` já existente: scripts Node zero-dependência, testados com `node --test`. Três peças, na ordem da doutrina do standards: (1) scanner de regras que produz contagens por arquivo/regra, (2) gate que compara com `baseline.json` e reprova regressão (exit 1 = sujeira nova, exit 2 = gate quebrado, mesma semântica do `biud-higiene`), (3) ondas de correção que atualizam a baseline pra baixo. Como não há ESLint, as regras com necessidade de AST (complexity, max-depth por função) entram como APROXIMAÇÃO léxica sobre código com strings/comentários removidos; a imprecisão é absorvida pela baseline (o gate mede regressão, não valor absoluto).

**Tech Stack:** Node puro (CommonJS, `node:test`, `node:assert/strict`). Zero dependências novas (invariante 1 do CLAUDE.md do Farol).

**Spec:** A análise que originou este plano (conversa de 16/08/2026): 297 avisos medidos com os fragmentos do standards em modo WARN. Números-alvo da onda 1: catch vazio sem comentário (4), JSON.parse cru nos handlers SSE (8), porta 47170 literal (6 pontos), env sem fonte única (FAROL_REVIEW_CMD em 4 pontos + FAROL_HEADLESS_CMD em 1 + FAROL_DEBUG_SPAWNS em 3), ternário aninhado em main.js, prefer-const (4), tempos mágicos (io.js, session.js, http-server.js, server.js).

## Global Constraints

- **Zero dependências além do Electron.** Não rodar `npm install` de pacote nenhum. Não adicionar nada em `dependencies`/`devDependencies`.
- **Line endings LF em TODOS os arquivos criados/editados**, sem exceção (regra firme do usuário).
- **Sistema de módulos:** nos Tasks 1-12 o repo ainda é CommonJS; código novo nasce CJS pra conviver com o resto e é convertido junto na Fase ESM (Tasks 13a-13e), que migra o repositório INTEIRO de uma vez. Depois do Task 13e, tudo é ESM.
- **Comentários e mensagens em português**, no tom dos arquivos vizinhos (leia o cabeçalho de `tools/check-syntax.js` como referência de estilo).
- **Commits em português, SEM trailer `Co-Authored-By`** (regra firme do usuário; sobrepõe qualquer instrução padrão do harness).
- **Gate de entrega em todo task:** `npm run check && npm test` verde antes de cada commit. Depois do Task 6, também `npm run lint`.
- **Não mudar comportamento observável** fora do que cada task declara. Refactor mecânico = mover código verbatim, sem "melhorar de passagem".
- **Baseline só desce.** Nunca editar `tools/quality/baseline.json` à mão pra cima; só via `node tools/quality/gate.js --update` após correção real.
- Trabalhar direto em `C:\Users\wanderson\Documents\farol` (a fonte é a verdade), branch `main` local do repo (confira com `git status` antes; se houver sujeira alheia, pare e reporte).
- **NÃO publicar release.** O plano termina com commits locais + CHANGELOG; publicação é decisão posterior do usuário.

---

### Task 1: Núcleo léxico `tools/quality/strip.js`

Remove strings, template literals, comentários e regex do código, preservando quebras de linha e a estrutura de chaves/parênteses. É a fundação de todas as regras: elas nunca olham o fonte cru.

**Files:**
- Create: `tools/quality/strip.js`
- Test: `test/quality-strip.test.js`

**Interfaces:**
- Produces: `strip(source: string): string` — mesma quantidade de linhas do original; conteúdo de string/comment/template/regex vira espaços; delimitadores de template (`` ` ``) e as chaves de `${}` são removidos junto (pra não inflar profundidade de chave).

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict';
// Teste do removedor léxico: o que sai NUNCA contém conteúdo de string,
// comentário, template ou regex, e mantém o número de linhas do original.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { strip } = require('../tools/quality/strip.js');

test('remove strings simples e duplas preservando linhas', () => {
  const out = strip(`const a = 'if (x) {';\nconst b = "} else {";`);
  assert.equal(out.includes('if (x)'), false);
  assert.equal(out.includes('else'), false);
  assert.equal(out.split('\n').length, 2);
});

test('remove comentarios de linha e bloco', () => {
  const out = strip(`x(); // catch {}\n/* var y;\n var z; */\nfim();`);
  assert.equal(out.includes('catch'), false);
  assert.equal(out.includes('var'), false);
  assert.equal(out.split('\n').length, 4);
  assert.equal(out.includes('x()'), true);
  assert.equal(out.includes('fim()'), true);
});

test('remove template literal inclusive interpolacao aninhada', () => {
  const out = strip('const s = `a ${x ? `b ${y}` : "c"} d`;');
  assert.equal(out.includes('a '), false);
  assert.equal(out.includes(' d'), false);
  // o codigo DENTRO de ${} sobrevive (e codigo de verdade)
  assert.equal(out.includes('x ?'), true);
});

test('remove regex literal sem confundir com divisao', () => {
  const out = strip('const r = /catch {}/g; const d = a / b / c;');
  assert.equal(out.includes('catch'), false);
  assert.equal(out.includes('a / b / c'), true);
});

test('escape dentro de string nao encerra a string', () => {
  const out = strip(`const a = 'it\\'s a var trap';`);
  assert.equal(out.includes('var'), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/quality-strip.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementar**

```js
'use strict';
// Removedor léxico: apaga o conteúdo de strings, templates, comentários e regex,
// preservando quebras de linha e a estrutura de código (chaves, parênteses,
// operadores). As regras de tools/quality/rules.js SÓ olham o resultado disto,
// nunca o fonte cru: "catch {}" dentro de uma string não é um catch vazio.
//
// Heurística de regex vs divisão: uma / abre regex quando o último token
// significativo anterior indica posição de EXPRESSÃO (operador, abre-parêntese,
// vírgula, return, etc.). É a mesma heurística de scanners clássicos; imprecisão
// residual é aceitável porque o gate mede REGRESSÃO por baseline, não valor exato.

function strip(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  // pilha de modos pra template com interpolação aninhada: 'code' | 'tpl'
  const stack = ['code'];
  let lastSig = ''; // último caractere significativo do modo code (pra regex/div)

  const push = (ch) => { out.push(ch); };
  const blank = (ch) => { out.push(ch === '\n' ? '\n' : ' '); };

  while (i < n) {
    const mode = stack[stack.length - 1];
    const c = source[i];
    const c2 = source[i + 1];

    if (mode === 'tpl') {
      if (c === '\\') { blank(c); if (i + 1 < n) blank(source[i + 1]); i += 2; continue; }
      if (c === '`') { blank(c); stack.pop(); i++; continue; }
      if (c === '$' && c2 === '{') { blank(c); blank(c2); stack.push('code'); i += 2; continue; }
      blank(c); i++; continue;
    }

    // mode === 'code'
    if (c === '/' && c2 === '/') { // comentário de linha
      while (i < n && source[i] !== '\n') { blank(source[i]); i++; }
      continue;
    }
    if (c === '/' && c2 === '*') { // comentário de bloco
      blank(c); blank(c2); i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { blank(source[i]); i++; }
      if (i < n) { blank('*'); blank('/'); i += 2; }
      continue;
    }
    if (c === "'" || c === '"') { // string
      blank(c); i++;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') { blank(source[i]); i++; if (i < n) { blank(source[i]); i++; } continue; }
        blank(source[i]); i++;
      }
      if (i < n) { blank(c); i++; }
      continue;
    }
    if (c === '`') { blank(c); stack.push('tpl'); i++; continue; }
    if (c === '}' && stack.length > 1) { blank(c); stack.pop(); i++; continue; }
    if (c === '/' && regexPossivel(lastSig)) { // regex literal
      blank(c); i++;
      let emClasse = false;
      while (i < n && (emClasse || source[i] !== '/')) {
        if (source[i] === '\\') { blank(source[i]); i++; if (i < n) { blank(source[i]); i++; } continue; }
        if (source[i] === '[') emClasse = true;
        if (source[i] === ']') emClasse = false;
        if (source[i] === '\n') break; // regex não cruza linha; aborta com segurança
        blank(source[i]); i++;
      }
      if (i < n && source[i] === '/') { blank('/'); i++; }
      while (i < n && /[a-z]/i.test(source[i])) { blank(source[i]); i++; } // flags
      continue;
    }

    push(c);
    if (!/\s/.test(c)) lastSig = ultimaPalavraOuChar(out, c);
    i++;
  }
  return out.join('');
}

// / abre regex quando o token anterior é operador/abertura/palavra de expressão.
function regexPossivel(lastSig) {
  if (lastSig === '') return true;
  if (/^[=([{,;:!&|?+\-*%^~<>]$/.test(lastSig)) return true;
  return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof'].includes(lastSig);
}

// devolve a palavra terminada neste char (pra reconhecer `return` etc.), ou o próprio char
function ultimaPalavraOuChar(out, c) {
  if (!/[a-zA-Z_$]/.test(c)) return c;
  let w = '';
  for (let k = out.length - 1; k >= 0 && /[a-zA-Z0-9_$]/.test(out[k]); k--) w = out[k] + w;
  return w;
}

module.exports = { strip };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/quality-strip.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Gate + commit**

Run: `npm run check && npm test`
Expected: tudo verde (a suíte inteira, não só o novo arquivo).

```bash
git add tools/quality/strip.js test/quality-strip.test.js
git commit -m "qualidade: removedor lexico (base do gate de standards)"
```

---

### Task 2: Regras em `tools/quality/rules.js`

**Files:**
- Create: `tools/quality/rules.js`
- Test: `test/quality-rules.test.js`

**Interfaces:**
- Consumes: `strip(source)` de `tools/quality/strip.js`.
- Produces: `scanFile(source: string, relPath: string): { [regra: string]: number }` com as chaves EXATAS: `maxLines`, `emptyCatch`, `varUse`, `jsonParseCru`, `jsonStringifyCru`, `processEnvDireto`, `ternarioAninhado`, `tempoMagico`, `portaLiteral`, `profundidadeExcedida`. Também exporta `LIMITES = { maxLines: 400, maxDepth: 3 }` e `ENV_FONTE_UNICA = ['lib/env.js', 'lib/paths.js']`.

- [ ] **Step 1: Escrever os testes que falham**

```js
'use strict';
// Cada regra do contrato engineering-standards tem ao menos 1 caso que viola e
// 1 que não viola. As contagens alimentam o ratchet (gate.js), então o que se
// testa aqui é: a regra ENXERGA a violação e NÃO alucina em código limpo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scanFile } = require('../tools/quality/rules.js');

test('emptyCatch: pega catch {} e catch (e) {}, ignora catch com corpo', () => {
  const r = scanFile('try{a()}catch{}\ntry{b()}catch(e){}\ntry{c()}catch(e){log(e)}', 'x.js');
  assert.equal(r.emptyCatch, 2);
});

test('emptyCatch: catch vazio COM comentario de intencao nao conta', () => {
  // o comentario e removido pelo strip, entao o corpo fica so espacos; a regra
  // usa o fonte CRU pra checar se havia comentario dentro do corpo
  const r = scanFile('try{a()}catch{/* best-effort: log nunca derruba */}', 'x.js');
  assert.equal(r.emptyCatch, 0);
});

test('varUse: pega var, ignora dentro de string', () => {
  const r = scanFile(`var a = 1; const s = 'var b';`, 'x.js');
  assert.equal(r.varUse, 1);
});

test('jsonParseCru: conta JSON.parse fora de arquivo santuario', () => {
  assert.equal(scanFile('const a = JSON.parse(s);', 'ui/app.js').jsonParseCru, 1);
  // io.js e o wrapper legitimo (readJson): la ele mora com try/catch
  assert.equal(scanFile('const a = JSON.parse(s);', 'lib/io.js').jsonParseCru, 0);
});

test('processEnvDireto: conta fora da fonte unica, zera dentro', () => {
  assert.equal(scanFile('const x = process.env.FOO;', 'server.js').processEnvDireto, 1);
  assert.equal(scanFile('const x = process.env.FOO;', 'lib/env.js').processEnvDireto, 0);
});

test('ternarioAninhado: pega 2 ? no mesmo statement, ignora ?. e ??', () => {
  assert.equal(scanFile('const a = x ? y ? 1 : 2 : 3;', 'x.js').ternarioAninhado, 1);
  assert.equal(scanFile('const a = b?.c ?? (d ? 1 : 2);', 'x.js').ternarioAninhado, 0);
});

test('tempoMagico: literal de tempo em propriedade e multiplicacao de minutos', () => {
  assert.equal(scanFile('f({ timeout: 60000 });', 'x.js').tempoMagico, 1);
  assert.equal(scanFile('const t = 30 * 60 * 1000;', 'x.js').tempoMagico, 1);
  assert.equal(scanFile('f({ timeout: TEMPOS.GH });', 'x.js').tempoMagico, 0);
});

test('portaLiteral: 47170 fora de lib/constants.js conta', () => {
  assert.equal(scanFile('const p = 47170;', 'server.js').portaLiteral, 1);
  assert.equal(scanFile('const p = 47170;', 'lib/constants.js').portaLiteral, 0);
});

test('maxLines: 1 quando o arquivo passa de 400 linhas nao vazias', () => {
  const grande = Array.from({ length: 401 }, (_, i) => `x${i}();`).join('\n');
  assert.equal(scanFile(grande, 'x.js').maxLines, 1);
  assert.equal(scanFile('a();\nb();', 'x.js').maxLines, 0);
});

test('profundidadeExcedida: chaves aninhadas alem de 3 dentro de funcao', () => {
  const fundo = 'function f(){ if(a){ if(b){ if(c){ if(d){ x(); } } } } }';
  assert.equal(scanFile(fundo, 'x.js').profundidadeExcedida >= 1, true);
  assert.equal(scanFile('function f(){ if(a){ x(); } }', 'x.js').profundidadeExcedida, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/quality-rules.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementar**

```js
'use strict';
// As regras do contrato engineering-standards que dá pra medir sem AST, sobre o
// código já limpo pelo strip.js. APROXIMAÇÕES ASSUMIDAS (o gate mede regressão
// por baseline, então imprecisão estável não machuca):
//  - ternarioAninhado: 2+ '?' de ternário no mesmo statement (separado por ;),
//    depois de remover '?.' e '??'. Não distingue encadeado (estilo else-if,
//    tolerado na prática) de aninhado de verdade; a baseline absorve os atuais.
//  - profundidadeExcedida: profundidade de CHAVES dentro de função, contando
//    a partir da chave do corpo. Objeto literal inflaciona; baseline absorve.
//  - emptyCatch: só conta catch cujo corpo era vazio JÁ NO FONTE CRU (catch
//    vazio com comentário de intenção é tolerado, vide doutrina do repo).
const { strip } = require('./strip.js');

const LIMITES = { maxLines: 400, maxDepth: 3 };
// arquivos onde a leitura direta é o lar legítimo da coisa
const ENV_FONTE_UNICA = ['lib/env.js', 'lib/paths.js'];
const JSON_SANTUARIOS = ['lib/io.js'];
const PORTA_SANTUARIOS = ['lib/constants.js'];

function norm(p) { return p.replace(/\\/g, '/'); }

function scanFile(source, relPath) {
  const p = norm(relPath);
  const code = strip(source);
  const linhas = code.split('\n');
  const r = {};

  const uteis = linhas.filter((l) => l.trim() !== '').length;
  r.maxLines = uteis > LIMITES.maxLines ? 1 : 0;

  // catch vazio: casa no CRU (comentário dentro do corpo salva) E no limpo
  // (pra não casar "catch {}" dentro de string)
  const vaziosLimpo = [...code.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)];
  let emptyCatch = 0;
  for (const m of vaziosLimpo) {
    const cru = source.slice(m.index, m.index + m[0].length);
    if (!/\/\/|\/\*/.test(cru)) emptyCatch++;
  }
  r.emptyCatch = emptyCatch;

  r.varUse = (code.match(/\bvar\s/g) || []).length;
  r.jsonParseCru = JSON_SANTUARIOS.includes(p) ? 0 : (code.match(/JSON\s*\.\s*parse\s*\(/g) || []).length;
  r.jsonStringifyCru = JSON_SANTUARIOS.includes(p) ? 0 : (code.match(/JSON\s*\.\s*stringify\s*\(/g) || []).length;
  r.processEnvDireto = ENV_FONTE_UNICA.includes(p) ? 0 : (code.match(/process\s*\.\s*env\b/g) || []).length;

  // ternário aninhado por statement
  const semOpcionais = code.replace(/\?\./g, '  ').replace(/\?\?/g, '  ');
  r.ternarioAninhado = semOpcionais
    .split(';')
    .filter((s) => (s.match(/\?/g) || []).length >= 2).length;

  const tempoProp = (code.match(/\b(ttl|ttlMs|timeout|timeoutMs|delay|delayMs|maxAge|expiresIn)\s*:\s*\d/g) || []).length;
  const tempoMult = (code.match(/\b\d+\s*\*\s*60\s*\*\s*1000\b/g) || []).length;
  r.tempoMagico = tempoProp + tempoMult;

  r.portaLiteral = PORTA_SANTUARIOS.includes(p) ? 0 : (code.match(/\b47170\b/g) || []).length;

  r.profundidadeExcedida = profundidadeExcedida(code);
  return r;
}

// conta pontos onde a profundidade de chaves dentro de uma função passa do teto.
// baseline absorve o ruído de objeto literal; o que importa é não CRESCER.
function profundidadeExcedida(code) {
  let depth = 0;
  let estouros = 0;
  let dentroDeEstouro = false;
  for (const c of code) {
    if (c === '{') {
      depth++;
      // depth 1 = corpo da função/bloco raiz; teto efetivo = maxDepth + 1
      if (depth > LIMITES.maxDepth + 1 && !dentroDeEstouro) { estouros++; dentroDeEstouro = true; }
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (depth <= LIMITES.maxDepth + 1) dentroDeEstouro = false;
    }
  }
  return estouros;
}

module.exports = { scanFile, LIMITES, ENV_FONTE_UNICA };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/quality-rules.test.js`
Expected: PASS. Se `profundidadeExcedida` falhar por off-by-one, ajuste o teto na comparação (`> LIMITES.maxDepth + 1`), NUNCA o teste.

- [ ] **Step 5: Gate + commit**

```bash
git add tools/quality/rules.js test/quality-rules.test.js
git commit -m "qualidade: regras do contrato engineering-standards (aproximacao lexica)"
```

---

### Task 3: Scanner de repositório + gate de ratchet

**Files:**
- Create: `tools/quality/gate.js`
- Create: `tools/quality/baseline.json` (gerado, não escrito à mão)
- Test: `test/quality-gate.test.js`

**Interfaces:**
- Consumes: `scanFile` de `tools/quality/rules.js`.
- Produces: CLI `node tools/quality/gate.js` (compara com baseline; exit 0 ok, 1 regressão, 2 erro de execução) e `--update` (reescreve a baseline com a contagem atual). Exporta `scanRepo(raiz): { [arquivo]: { [regra]: number } }` e `comparar(atual, baseline): { regressoes: string[] }` pra teste.

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { comparar } = require('../tools/quality/gate.js');

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
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/quality-gate.test.js`, FAIL.

- [ ] **Step 3: Implementar**

```js
'use strict';
// Gate de ratchet do contrato engineering-standards. A baseline registra a
// dívida ATUAL por arquivo/regra; o gate reprova qualquer contagem que SUBA
// (arquivo novo com violação = subir de zero). Corrigiu dívida? Rode --update
// pra travar o número novo, mais baixo. A baseline NUNCA sobe à mão.
// Exit codes (mesma semântica do biud-higiene): 0 limpo, 1 regressão no repo,
// 2 o gate não conseguiu rodar.
const fs = require('fs');
const path = require('path');
const { scanFile } = require('./rules.js');

const RAIZ = path.join(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'baseline.json');
const IGNORAR = new Set(['node_modules', 'dist', '.git', '.worktrees', 'scratchpad_test', 'test', 'docs', 'workspace-template', 'installer', 'assets']);

function listar(dir, achados = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const p = path.join(dir, item.name);
    if (item.isDirectory()) listar(p, achados);
    else if (item.name.endsWith('.js')) achados.push(p);
  }
  return achados;
}

function scanRepo(raiz = RAIZ) {
  const resultado = {};
  for (const abs of listar(raiz)) {
    const rel = path.relative(raiz, abs).replace(/\\/g, '/');
    const contagens = scanFile(fs.readFileSync(abs, 'utf8'), rel);
    const comViolacao = Object.fromEntries(Object.entries(contagens).filter(([, v]) => v > 0));
    if (Object.keys(comViolacao).length) resultado[rel] = comViolacao;
  }
  return resultado;
}

function comparar(atual, baseline) {
  const regressoes = [];
  for (const [arq, regras] of Object.entries(atual)) {
    for (const [regra, n] of Object.entries(regras)) {
      const teto = (baseline[arq] && baseline[arq][regra]) || 0;
      if (n > teto) regressoes.push(`${arq}: ${regra} subiu de ${teto} pra ${n}`);
    }
  }
  return { regressoes };
}

function main() {
  const atual = scanRepo();
  if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify(atual, null, 2) + '\n');
    console.log(`baseline atualizada: ${Object.keys(atual).length} arquivos com dívida registrada`);
    return 0;
  }
  if (!fs.existsSync(BASELINE)) {
    console.error('baseline.json ausente: rode node tools/quality/gate.js --update uma vez');
    return 2;
  }
  let baseline;
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }
  catch { console.error('baseline.json ilegível: regenere com --update'); return 2; }
  const { regressoes } = comparar(atual, baseline);
  if (regressoes.length) {
    console.error('== regressão de qualidade (contrato engineering-standards) ==');
    for (const r of regressoes) console.error('  ' + r);
    console.error('Corrija a violação nova; a baseline só desce.');
    return 1;
  }
  console.log('gate de qualidade: sem regressão');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { scanRepo, comparar };
```

- [ ] **Step 4: Rodar testes** — `node --test test/quality-gate.test.js`, PASS.

- [ ] **Step 5: Gerar a baseline real e sanity check**

Run: `node tools/quality/gate.js --update` e depois `node tools/quality/gate.js`
Expected: primeiro comando registra a dívida (esperado: `server.js`, `ui/app.js`, `lib/engine/*.js` etc. presentes), segundo sai com "sem regressão", exit 0. Inspecione `baseline.json`: `ui/app.js` deve ter `maxLines: 1` e `jsonParseCru >= 8`; se vier vazio, o scanner está quebrado, PARE e investigue.

- [ ] **Step 6: Gate + commit**

```bash
git add tools/quality/gate.js tools/quality/baseline.json test/quality-gate.test.js
git commit -m "qualidade: gate de ratchet com baseline (a divida so desce)"
```

---

### Task 4: Higiene de repositório (cards fora de TODO)

**Files:**
- Create: `tools/quality/higiene.js`
- Test: `test/quality-higiene.test.js`

**Interfaces:**
- Produces: CLI `node tools/quality/higiene.js` (exit 0/1/2) e `refsForaDeTodo(texto): number` exportada. Regra: referência `BT-\d+` ou `BUGS-\d+` fora da forma `TODO(BT-123)` conta; `CHANGELOG.md` e `docs/` ficam FORA da varredura (mapear release/retrô a card é papel deles). Sobre artefatos de ferramenta: `CLAUDE.md` da raiz e `workspace-template/**` são domínio legítimo do Farol (o template É o produto; o CLAUDE.md da raiz vai no zip de auditoria por decisão registrada), então NÃO entram na checagem.

- [ ] **Step 1: Teste que falha**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { refsForaDeTodo } = require('../tools/quality/higiene.js');

test('TODO(BT-123) e legitimo; BT-123 solto conta', () => {
  assert.equal(refsForaDeTodo('// TODO(BT-123): migrar'), 0);
  assert.equal(refsForaDeTodo('// veio do card BT-123'), 1);
  assert.equal(refsForaDeTodo('// BT-1 e BUGS-22 juntos'), 2);
});
```

- [ ] **Step 2: Rodar, ver falhar.** `node --test test/quality-higiene.test.js`

- [ ] **Step 3: Implementar**

```js
'use strict';
// Higiene de repositório (doutrina do engineering-standards, adaptada ao Farol):
// número de card em código só aponta pra frente, na forma TODO(BT-123).
// "Veio do card X" mora no git blame, não no fonte. CHANGELOG e docs/ ficam
// fora (mapear release a card é o papel deles). Artefatos de ferramenta NÃO são
// checados aqui: workspace-template/ é o produto do Farol e o CLAUDE.md da raiz
// vai no zip de auditoria por decisão registrada (16/08/2026).
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const IGNORAR = new Set(['node_modules', 'dist', '.git', '.worktrees', 'scratchpad_test', 'docs', 'workspace-template', 'assets']);
const PREFIXOS = /\b(BT|BUGS)-\d+\b/g;

function refsForaDeTodo(texto) {
  const semTodo = texto.replace(/TODO\((?:BT|BUGS)-\d+\)/g, '');
  return (semTodo.match(PREFIXOS) || []).length;
}

function listar(dir, achados = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const p = path.join(dir, item.name);
    if (item.isDirectory()) listar(p, achados);
    else if (/\.(js|md|json|ps1|sh|cmd|command|html|css)$/.test(item.name) && !/^CHANGELOG/i.test(item.name)) achados.push(p);
  }
  return achados;
}

function main() {
  let total = 0;
  for (const abs of listar(RAIZ)) {
    const rel = path.relative(RAIZ, abs).replace(/\\/g, '/');
    const n = refsForaDeTodo(fs.readFileSync(abs, 'utf8'));
    if (n) { console.error(`  ${rel}: ${n} referencia(s) de card fora de TODO(...)`); total += n; }
  }
  if (total) { console.error(`FALHA: ${total} referencia(s). Mova a procedencia pro git/PR ou converta em TODO(CARD-N).`); return 1; }
  console.log('higiene: sem referencia de card solta');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { refsForaDeTodo };
```

- [ ] **Step 4: Rodar teste, PASS. Depois rodar o CLI de verdade:**

Run: `node tools/quality/higiene.js`
Expected: FALHA apontando `test/public-review-language.test.js` (2 refs BT-807) e `test/ui-pure.test.js` (2 refs BT-1119). São os alvos do Step 5.

- [ ] **Step 5: Limpar as 4 referências**

Em `test/public-review-language.test.js` linhas ~64 e ~366 e `test/ui-pure.test.js` linhas ~1059 e ~1068: reescreva o comentário tirando o número do card e mantendo a EXPLICAÇÃO (ex.: `// regressão do BT-807: ...` vira `// regressão real de 2026-07: ...` preservando o resto da frase). NÃO apague o comentário, só a referência. Rode `npm test` depois (são comentários, nada quebra).

- [ ] **Step 6: Rodar `node tools/quality/higiene.js` de novo** — Expected: exit 0.

- [ ] **Step 7: Gate + commit**

```bash
git add tools/quality/higiene.js test/quality-higiene.test.js test/public-review-language.test.js test/ui-pure.test.js
git commit -m "qualidade: higiene de referencias de card + limpeza das 4 existentes"
```

---

### Task 5: Fiação no `npm run` e no guia do mantenedor

**Files:**
- Modify: `package.json` (bloco `scripts`)
- Modify: `CLAUDE.md` (seção do gate de qualidade, linha ~175)
- Modify: `docs/QUALITY.md` (registrar o gate novo)

**Interfaces:**
- Produces: `npm run lint` (gate + higiene), `npm run lint:update` (baseline), e o gate de entrega documentado passa a ser `npm run check && npm run lint && npm test`.

- [ ] **Step 1: Editar `package.json`** — o bloco `scripts` fica:

```json
"scripts": {
  "start": "electron .",
  "server": "node server.js",
  "check": "node tools/check-syntax.js",
  "lint": "node tools/quality/gate.js && node tools/quality/higiene.js",
  "lint:update": "node tools/quality/gate.js --update",
  "test": "node --test"
}
```

- [ ] **Step 2: Atualizar CLAUDE.md** — na linha do gate de qualidade ("Gate de qualidade (rodar antes de QUALQUER entrega)"), trocar `npm run check && npm test` por `npm run check && npm run lint && npm test` e acrescentar uma frase: "O `lint` é o gate de ratchet do contrato engineering-standards em Node puro (`tools/quality/`): compara as violações com `baseline.json` e reprova qualquer contagem que SUBA. Corrigiu dívida? `npm run lint:update` trava o número mais baixo. A baseline nunca sobe à mão."

- [ ] **Step 3: Acrescentar em docs/QUALITY.md** uma seção curta "Gate de ratchet (v2.46)" com o mesmo parágrafo e a lista das 10 regras medidas (chaves do rules.js).

- [ ] **Step 4: Verificar** — `npm run check && npm run lint && npm test`, tudo verde.

- [ ] **Step 5: Commit**

```bash
git add package.json CLAUDE.md docs/QUALITY.md
git commit -m "qualidade: npm run lint no gate de entrega"
```

---

### Task 6: Cercar os 8 `JSON.parse` dos handlers SSE

Evento SSE torto hoje derruba o handler. Correção: parser seguro em `pure.js` (testável) + uso nos 8 pontos.

**Files:**
- Modify: `ui/pure.js` (nova função + export no rodapé CommonJS)
- Modify: `ui/app.js` (8 call sites, linhas ~3918, 3930, 3955, 3959, 3976, 3979, 3984, 3991)
- Test: `test/ui-pure.test.js` (acrescentar bloco)

**Interfaces:**
- Produces: `safeJsonParse(texto: string): any|null` em pure.js (null em JSON inválido, nunca lança). Exportar no rodapé CommonJS de pure.js junto das demais (procure `module.exports` no fim do arquivo e acrescente `safeJsonParse`).

- [ ] **Step 1: Teste que falha** (acrescentar em `test/ui-pure.test.js`, no fim, seguindo o estilo do arquivo):

```js
test('safeJsonParse: objeto valido volta, lixo vira null, nunca lanca', () => {
  assert.deepEqual(pure.safeJsonParse('{"a":1}'), { a: 1 });
  assert.equal(pure.safeJsonParse('{torto'), null);
  assert.equal(pure.safeJsonParse(''), null);
  assert.equal(pure.safeJsonParse(undefined), null);
});
```

(Confira no topo do arquivo de teste como o pure é requerido; use o mesmo identificador, provavelmente `pure` ou destructuring.)

- [ ] **Step 2: Rodar, ver falhar.**

- [ ] **Step 3: Implementar em `ui/pure.js`** (junto das outras funções utilitárias, com o comentário no estilo da casa):

```js
// Parser seguro pros eventos SSE: evento torto NUNCA derruba o handler; o
// contrato do engenharia-standards é "entrada não confiável se valida, não se
// afirma". Devolve null em vez de lançar; quem chama decide se ignora.
function safeJsonParse(texto) {
  if (typeof texto !== 'string' || texto === '') return null;
  try { return JSON.parse(texto); } catch { return null; }
}
```

E no rodapé CommonJS, acrescentar `safeJsonParse` ao objeto exportado.

- [ ] **Step 4: Trocar os 8 call sites em `ui/app.js`.** Padrão da troca (aplicar um a um, procurando por `JSON.parse(e.data)` na seção dos `es.addEventListener`):

Antes: `STATE = JSON.parse(e.data);` → Depois: `const d = safeJsonParse(e.data); if (!d) return; STATE = d;`
Antes: `const { id, item } = JSON.parse(e.data);` → `const d = safeJsonParse(e.data); if (!d) return; const { id, item } = d;`
Antes (inline): `es.addEventListener('new-prs', (e) => notifyNewPRs(JSON.parse(e.data)));` → `es.addEventListener('new-prs', (e) => { const d = safeJsonParse(e.data); if (d) notifyNewPRs(d); });`

Aplicar o mesmo molde nos 8. `safeJsonParse` está no escopo global do browser via `<script src="pure.js">` (mesmo mecanismo de `esc`).

- [ ] **Step 5: Verificar tudo** — `npm run check && npm test` verde; depois `npm run lint:update` (o `jsonParseCru` de app.js cai de ~8; conferir no diff da baseline que NADA subiu) e `npm run lint` verde.

- [ ] **Step 6: Commit**

```bash
git add ui/pure.js ui/app.js test/ui-pure.test.js tools/quality/baseline.json
git commit -m "ui: evento SSE torto nao derruba handler (safeJsonParse)"
```

---

### Task 7: Fonte única de porta e tempos (`lib/constants.js`)

**Files:**
- Create: `lib/constants.js`
- Modify: `server.js:89` (DEFAULTS), `server.js:560`, `lib/engine/session.js:41,68,73,277`, `main.js` (se houver 47170; procurar), `lib/io.js:88,103`, `lib/http-server.js` (ping 25000), `server.js:375` (rotação de log), `lib/engine/session.js` (30 min)
- Test: `test/quality-constants.test.js`

**Interfaces:**
- Produces:

```js
// lib/constants.js
'use strict';
// Fonte ÚNICA dos literais de infra (contrato engineering-standards: chave de
// infra e tempo têm nome e UM endereço). Antes a porta 47170 vivia em 6 pontos
// e divergiria em silêncio num ajuste.
const DEFAULT_PORT = 47170;
const TEMPOS = {
  GH_TIMEOUT_MS: 60000,          // teto dos comandos gh/shell (io.run/runShell)
  SESSAO_HEADLESS_MS: 30 * 60 * 1000, // teto de uma revisao headless
  SSE_PING_MS: 25000,            // keepalive do EventSource
  LOG_ROTACAO_BYTES: 2 * 1024 * 1024, // teto do farol.log antes de rotacionar
};
module.exports = { DEFAULT_PORT, TEMPOS };
```

- [ ] **Step 1: Teste que falha**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PORT, TEMPOS } = require('../lib/constants.js');

test('constantes de infra: valores historicos preservados', () => {
  assert.equal(DEFAULT_PORT, 47170);
  assert.equal(TEMPOS.GH_TIMEOUT_MS, 60000);
  assert.equal(TEMPOS.SESSAO_HEADLESS_MS, 1800000);
  assert.equal(TEMPOS.SSE_PING_MS, 25000);
});
```

- [ ] **Step 2: Ver falhar, criar `lib/constants.js` (código acima), ver passar.**

- [ ] **Step 3: Substituir os literais, um arquivo por vez, rodando `npm test` entre cada um:**
  - `server.js`: `require` no topo junto dos outros; `port: 47170` → `port: DEFAULT_PORT`; `this.config.port || 47170` → `this.config.port || DEFAULT_PORT`; rotação `2 * 1024 * 1024` → `TEMPOS.LOG_ROTACAO_BYTES`.
  - `lib/engine/session.js`: idem nos 4 pontos de porta; `30 * 60 * 1000` → `TEMPOS.SESSAO_HEADLESS_MS`.
  - `lib/io.js`: `timeout: 60000` (2 pontos) → `timeout: TEMPOS.GH_TIMEOUT_MS`.
  - `lib/http-server.js`: `25000` do ping → `TEMPOS.SSE_PING_MS`.
  - `main.js`: procurar `47170`; se existir, mesmo tratamento.

- [ ] **Step 4: Verificação completa** — `npm run check && npm test` verde; `npm run lint:update` (cai `portaLiteral` e `tempoMagico`; conferir que nada subiu); `npm run lint` verde.

- [ ] **Step 5: Commit**

```bash
git add lib/constants.js server.js lib/engine/session.js lib/io.js lib/http-server.js main.js test/quality-constants.test.js tools/quality/baseline.json
git commit -m "infra: porta e tempos com fonte unica em lib/constants.js"
```

---

### Task 8: Fonte única de env (`lib/env.js`)

**Files:**
- Create: `lib/env.js`
- Modify: `lib/engine/session.js` (linhas ~32, 56, 250, 268, 470), `lib/spawnlog.js:20`, `server.js:168,1290`
- Test: `test/quality-env.test.js`

**Interfaces:**
- Produces (ATENÇÃO: leitura PREGUIÇOSA, funções e não snapshot, porque os testes do repo setam `process.env` stubs depois do require):

```js
// lib/env.js
'use strict';
// Fonte ÚNICA de leitura de process.env fora de lib/paths.js (contrato
// engineering-standards). LEITURA PREGUIÇOSA de propósito: os testes setam os
// stubs FAROL_*_CMD depois do require, então snapshot no load quebraria a suíte.
module.exports = {
  reviewCmdStub: () => process.env.FAROL_REVIEW_CMD,     // usado só em teste: substitui o claude
  headlessCmdStub: () => process.env.FAROL_HEADLESS_CMD, // idem, caminho headless
  debugSpawns: () => process.env.FAROL_DEBUG_SPAWNS === '1',
  setDebugSpawns: (ligado) => { process.env.FAROL_DEBUG_SPAWNS = ligado ? '1' : ''; },
};
```

- [ ] **Step 1: Teste que falha**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const env = require('../lib/env.js');

test('env e preguicoso: stub setado DEPOIS do require e enxergado', () => {
  delete process.env.FAROL_REVIEW_CMD;
  assert.equal(env.reviewCmdStub(), undefined);
  process.env.FAROL_REVIEW_CMD = 'node fake.js';
  assert.equal(env.reviewCmdStub(), 'node fake.js');
  delete process.env.FAROL_REVIEW_CMD;
});

test('debugSpawns liga e desliga pelo setter', () => {
  env.setDebugSpawns(true);
  assert.equal(env.debugSpawns(), true);
  env.setDebugSpawns(false);
  assert.equal(env.debugSpawns(), false);
});
```

- [ ] **Step 2: Ver falhar, criar `lib/env.js`, ver passar.**

- [ ] **Step 3: Substituições (uma por vez, `npm test` entre cada):**
  - `session.js`: `const stub = process.env.FAROL_REVIEW_CMD;` (4 pontos) → `const stub = env.reviewCmdStub();` (require `const env = require('../env.js');` no topo, ajustando o caminho relativo). Linha ~470 idem com `headlessCmdStub()`. Manter os comentários existentes.
  - `spawnlog.js:20`: `if (process.env.FAROL_DEBUG_SPAWNS !== '1') return;` → `if (!env.debugSpawns()) return;`.
  - `server.js:168` e `:1290`: `process.env.FAROL_DEBUG_SPAWNS = this.config.debugSpawns ? '1' : '';` → `env.setDebugSpawns(this.config.debugSpawns);` (preserva os comentários da linha).
  - NÃO tocar em `process.env.PATH`, `GH_TELEMETRY`, `FAROL_PORT` (env de PROCESSO FILHO, é escrita legítima de spawn, não leitura de config) nem `process.env.TZ` dos testes.

- [ ] **Step 4: Verificação completa** — `npm run check && npm test` (a suíte usa esses stubs pesadamente: qualquer vermelho aqui é regressão SUA, reverta o ponto e refaça); `npm run lint:update` (cai `processEnvDireto`); `npm run lint` verde.

- [ ] **Step 5: Commit**

```bash
git add lib/env.js lib/engine/session.js lib/spawnlog.js server.js test/quality-env.test.js tools/quality/baseline.json
git commit -m "infra: leitura de env com fonte unica preguicosa em lib/env.js"
```

---

### Task 9: Miudezas de forma (ternário aninhado, catch mudo, prefer-const)

**Files:**
- Modify: `main.js` (~linha 178, ~91, ~198), `lib/engine/session.js` (~132, ~146)

- [ ] **Step 1: Ternário aninhado do badge (main.js ~178).** Localizar a expressão `d <= r - 0.5 ? 255 : d >= r + 0.5 ? 0 : Math.round(...)` e extrair pra função nomeada logo acima do uso, com early return:

```js
// alpha do pixel da bolinha do badge: cheio dentro do raio, zero fora,
// borda com meio-tom de 1px (anti-alias manual)
function alphaBolinha(d, r) {
  if (d <= r - 0.5) return 255;
  if (d >= r + 0.5) return 0;
  return Math.round(255 * (r + 0.5 - d));
}
```

Substituir a expressão pelo call `alphaBolinha(d, r)` MANTENDO o terceiro braço original (copie a expressão real do arquivo pro `return` final; a do plano é ilustrativa, a do fonte manda).

- [ ] **Step 2: Catches mudos.** Nos 4 pontos (main.js ~91 e ~198; session.js ~132 e ~146, os `catch { }` do unlink): acrescentar comentário de intenção no corpo, no padrão da casa, ex.: `catch { /* best-effort: unlink de tmp que pode nem existir */ }`. NÃO adicionar log (invariante 3: log só de falhas reais). Ler 3 linhas de contexto antes de escrever o comentário pra ele dizer a verdade.

- [ ] **Step 3: prefer-const.** Rodar `node tools/quality/gate.js` não mede isso; localizar na mão: `grep -n "let " main.js server.js lib -r` e trocar por `const` só onde não há reatribuição (eram 4 casos na medição; se não achar com certeza, pular, é cosmético).

- [ ] **Step 4: Verificação** — `npm run check && npm test`; `npm run lint:update` (cai `ternarioAninhado` e `emptyCatch`); `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add main.js lib/engine/session.js server.js lib
git commit -m "forma: ternario do badge vira funcao, catch mudo ganha intencao"
```

---

### Task 10: Quebrar `check()` (297 linhas → orquestrador + 3 colaboradores)

Maior violação individual. Movimento MECÂNICO: recortar blocos verbatim pra métodos privados, sem reescrever lógica. A suíte existente é o guarda-costas (reconcile-pending, retry-net, hidden-prs, merge-gates cobrem esse fluxo).

**Files:**
- Modify: `server.js` (método `check()`, ~linhas 578-875)

**Interfaces:**
- Produces: 3 métodos novos na classe Engine, chamados APENAS por `check()`: `_coletarPanorama()` (o bloco inicial de busca por conta + montagem de `fresh`/dedup multi-conta), `_podarEstacionamento()` (o bloco de poda de `autoReviewParked` e desocultação), `_dispararAutomacoes()` (o bloco final: filtro da fila elegível, gates de orçamento, scanPushbacks, refreshMergeStates). Os nomes dos blocos acima são descritivos; o executor DELIMITA cada bloco pelos comentários de seção que já existem dentro de `check()` e move fronteiras inteiras (nunca meia responsabilidade).

- [ ] **Step 1: Ler `check()` inteiro** (server.js:578-875) e anotar as fronteiras de seção pelos comentários existentes. Se as 3 fronteiras propostas não casarem com a estrutura real, ajustar os NOMES mas manter o critério: cada método = um bloco contíguo com entrada/saída clara, `check()` vira só a sequência.

- [ ] **Step 2: Extrair UM bloco por vez.** Recortar o bloco verbatim pra um método `async _nome() { ... }` logo abaixo de `check()`, trocar `const x =` locais compartilhados por retorno/parâmetro explícito (o menor conjunto possível; se um bloco compartilha 5+ variáveis com o resto, escolha uma fronteira melhor). Depois de CADA extração: `npm run check && npm test` verde antes da próxima.

- [ ] **Step 3: Conferir o resultado** — `check()` final deve ter menos de 80 linhas (sequência de awaits + guardas). Nenhuma linha de lógica nova.

- [ ] **Step 4: Verificação completa** — `npm run check && npm test`; `npm run lint:update` (deve cair `profundidadeExcedida` de server.js; `maxLines` de server.js continua 1, quebrar o ARQUIVO fica pra onda futura); `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add server.js tools/quality/baseline.json
git commit -m "engine: check() vira orquestrador de 3 colaboradores extraidos verbatim"
```

---

### Task 11: Achatar `handleEvent` (session.js, profundidade 6 → ≤3)

**Files:**
- Modify: `lib/engine/session.js` (dentro de `runClaudeStream`, ~linhas 535-570)

- [ ] **Step 1: Ler o trecho.** O aninhamento é: else-if do tipo de evento > for de content > else-if > if(name==='Bash') > if(m) > try. Extrair o corpo do `for` pra função de módulo (fora da classe/closure, recebendo o que usa por parâmetro), com early return/`continue` no lugar dos ifs aninhados:

```js
// registra o uso de ferramenta do stream headless; Bash ganha o comando
// resumido pro painel. Extraído do handleEvent pra achatar o fluxo (era
// profundidade 6; contrato: máximo 3).
function registrarUsoDeFerramenta(bloco, colecionador) {
  if (!bloco || bloco.type !== 'tool_use') return;
  // ... (mover o corpo real verbatim, invertendo cada if aninhado em guard)
}
```

O nome/assinatura reais saem do código que existe; a regra é: cada `if` aninhado vira `if (!cond) return;` no topo.

- [ ] **Step 2: `npm run check && npm test`** — a suíte `session-stream.test.js` e `session-checkpoint-capture.test.js` cobrem esse caminho; vermelho = reverter e re-extrair com fronteira maior.

- [ ] **Step 3: `npm run lint:update` + `npm run lint`** (cai `profundidadeExcedida` de session.js).

- [ ] **Step 4: Commit**

```bash
git add lib/engine/session.js tools/quality/baseline.json
git commit -m "engine: handleEvent achatado com guard clauses (profundidade 6 vira 3)"
```

---

### Task 12: `buildFixPrompt` migra pra `ui/pure.js`

Função de ~187 linhas em app.js que é quase toda montagem de texto puro: candidata natural ao movimento que o repo já pratica (lógica pura sai do app.js).

**Files:**
- Modify: `ui/app.js` (~2387-2573), `ui/pure.js`
- Test: `test/ui-pure.test.js`

- [ ] **Step 1: Ler `buildFixPrompt` inteira.** Separar o que é PURO (recebe dados, devolve string do prompt) do que toca DOM/STATE (provavelmente só a coleta dos argumentos no início). O miolo puro vira `buildFixPrompt(args)` em pure.js (mesmo nome), exportada no rodapé CommonJS; o app.js mantém um wrapper fino que coleta do STATE/DOM e chama a pura.

- [ ] **Step 2: Teste ANTES de mover:** capturar o comportamento atual com 2 casos representativos (um PR com achados, um sem) chamando a função pura com fixtures e assertando trechos estáveis do prompt (`assert.match` em âncoras de texto, não igualdade total, pro teste não quebrar com ajuste de fraseado):

```js
test('buildFixPrompt: inclui url do PR e cada achado com arquivo:linha', () => {
  const p = pure.buildFixPrompt({ url: 'https://github.com/o/r/pull/1', findings: [{ file: 'a.js', line: 3, note: 'x' }] });
  assert.match(p, /pull\/1/);
  assert.match(p, /a\.js/);
});
```

(Assinatura real sai da leitura do Step 1; o teste usa a assinatura REAL, este é o molde.)

- [ ] **Step 3: Mover, rodar `npm run check && npm test`.** A UI carrega pure.js antes de app.js via `<script src>`, então a função fica disponível no browser sem mudança no index.html.

- [ ] **Step 4: `npm run lint:update` + `npm run lint`.**

- [ ] **Step 5: Commit**

```bash
git add ui/app.js ui/pure.js test/ui-pure.test.js tools/quality/baseline.json
git commit -m "ui: buildFixPrompt puro migra pro pure.js com teste de contrato"
```

---

## Fase ESM (Tasks 13a-13e): migração completa CommonJS → ES Modules

Decisão do usuário: o repo migra pra ESM. Electron 43 suporta main process ESM (suporte existe desde o Electron 28) e o Node do repo (24.x) tem `import.meta.dirname`. A migração é UMA fase atômica em branch dedicada: meio-migrado não existe (CJS não faz `require` de ESM). Estratégia que preserva a semântica e os testes:

**Receita de conversão (vale pra TODOS os arquivos):**
1. `module.exports = { a, b }` → `export default { a, b }` E TAMBÉM `export { a, b }` (named). O default preserva o consumo estilo objeto; os named permitem import seletivo.
2. `const x = require('./y')` → `import x from './y.js'` (SEMPRE com extensão `.js`, ESM exige).
3. `const { a, b } = require('./y')` → `import { a, b } from './y.js'`.
4. Builtins: `require('fs')` → `import fs from 'node:fs'` (prefixo `node:`, forma atual).
5. `__dirname` → `import.meta.dirname`; `__filename` → `import.meta.filename`.
6. `require.main === module` → `import.meta.url === pathToFileURL(process.argv[1]).href` (com `import { pathToFileURL } from 'node:url'`).
7. Remover `'use strict'` (ESM já é strict).
8. **PONTO CRÍTICO, testes que fazem monkey-patch:** namespace de ESM é congelado, `io.run = fake` num `import * as io` QUEBRA. Por isso a regra 1 mantém o `export default` de OBJETO MUTÁVEL: consumidor interno importa o default (`import io from './io.js'`) e chama `io.run(...)` — patch de propriedade continua funcionando igual CJS. Módulo cujos testes o patcham (no mínimo `lib/io.js`; confirmar com `grep -l "\.run = \|\.runShell = " test/`) DEVE ser consumido via default em TODO o repo, nunca por named import (senão o patch não é visto pelo consumidor).
9. **Ordem de carga em teste:** teste que hoje patcha ANTES do `require` do módulo sob teste (padrão do `merge-gates.test.js`, documentado no próprio arquivo) converte esse require pra **`await import('...')` dinâmico DEPOIS do patch** (import estático é içado e carregaria antes).

### Task 13a: chave geral + gate de sintaxe novo

**Files:**
- Modify: `package.json` (acrescentar `"type": "module"`)
- Modify: `tools/check-syntax.js` (o wrapper `vm.Script` CommonJS não parseia ESM)

- [ ] **Step 1:** Adicionar `"type": "module"` no package.json. A partir daqui `npm test` quebra em massa: é o esperado, a fase fecha verde no 13e; commits intermediários desta fase são permitidos com suíte vermelha SÓ dentro da branch da fase (criar branch `esm-migration` antes: `git checkout -b esm-migration`).
- [ ] **Step 2:** Reescrever `tools/check-syntax.js` (e converter ele mesmo pra ESM): em vez de `vm.Script`, usar `node --check` por processo filho, que respeita o `"type": "module"` do package.json mais próximo:

```js
// dentro do laço de arquivos, no lugar do vm.Script:
import { execFileSync } from 'node:child_process';
try {
  execFileSync(process.execPath, ['--check', arquivo], { stdio: 'pipe' });
} catch (e) {
  erros.push(`${arquivo}: ${String(e.stderr || e.message).split('\n')[0]}`);
}
```

Manter a varredura descoberta (função `varrer`) e o relatório como estão, só convertidos pela receita. EXCEÇÃO: `ui/app.js` e `ui/pure.js` são script de BROWSER até o 13d; se o `--check` reclamar deles neste ponto, pular esses dois com um Set temporário `PENDENTES_ESM` e removê-lo no 13d.
- [ ] **Step 3:** `npm run check` verde (sintaxe só; testes ainda vermelhos). Commit na branch: `git commit -am "esm: chave geral type module + gate de sintaxe por node --check"`.

### Task 13b: `lib/` e `tools/` convertidos

**Files:**
- Modify: todos os `.js` de `lib/`, `lib/engine/`, `tools/quality/` (receita acima, arquivo a arquivo)

- [ ] **Step 1:** Converter na ordem das dependências (folhas primeiro): `lib/paths.js`, `lib/constants.js`, `lib/env.js`, `lib/format.js`, `lib/taxonomy.js`, `lib/log-taxonomy.js`, `lib/parse.js`, `lib/io.js`, `lib/spawnlog.js`, `lib/workspace.js`, `lib/http-server.js`, depois `lib/engine/*.js`, depois `tools/quality/*.js` e `tools/check-syntax.js` se restou algo. Em cada arquivo: aplicar a receita completa, conferindo com `node --check <arquivo>` antes de seguir pro próximo.
- [ ] **Step 2:** `lib/io.js` e qualquer outro módulo patchado em teste: garantir `export default` de objeto e busca no repo por named imports dele (`grep -rn "import {.*} from.*io.js" lib server.js main.js` deve voltar vazio; consumo só via default).
- [ ] **Step 3:** `npm run check` verde. Commit: `git commit -am "esm: lib e tools convertidos"`.

### Task 13c: `server.js` e `main.js`

- [ ] **Step 1:** Converter os dois pela receita. Atenção no `main.js`: `require('electron')` → `import { app, BrowserWindow, Tray, ... } from 'electron'` (usar exatamente os nomes que o destructuring atual já usa). No `server.js`, o modo standalone (`require.main === module`) usa a regra 6 da receita.
- [ ] **Step 2:** Fumaça manual: `node server.js` sobe sem exceção de import (Ctrl+C depois); `npx electron .` abre a janela (fechar). Se o Electron reclamar de ESM no main, conferir `"main": "main.js"` + `"type": "module"` no package.json (é o suportado; erro aqui é de conversão, não de suporte).
- [ ] **Step 3:** `npm run check` verde. Commit: `git commit -am "esm: engine e shell electron convertidos"`.

### Task 13d: UI em módulos de verdade

O truque atual (`<script src>` global + rodapé CommonJS em pure.js) morre; vira módulo dos dois lados.

**Files:**
- Modify: `ui/index.html`, `ui/pure.js`, `ui/app.js`

- [ ] **Step 1:** `ui/pure.js`: remover o rodapé CommonJS inteiro (o bloco `module.exports`/detecção de ambiente no fim do arquivo) e acrescentar `export` na declaração de cada função que o rodapé exportava (lista de nomes = a do rodapé atual, copiada antes de apagar). Funções internas não exportadas ficam como estão.
- [ ] **Step 2:** `ui/app.js`: no topo, `import { esc, md, safeJsonParse, buildFixPrompt, ... } from './pure.js';` com TODOS os nomes que o app.js usa (descobrir por erro: carregar e ver o console, ou grep de cada exportada no app.js). Nada mais muda no corpo.
- [ ] **Step 3:** `ui/index.html`: trocar as duas tags por UMA: remover `<script src="pure.js">` e trocar `<script src="app.js">` por `<script type="module" src="app.js"></script>`.
- [ ] **Step 4:** Remover o Set `PENDENTES_ESM` do check-syntax se criado no 13a. `npm run check` verde.
- [ ] **Step 5:** Fumaça visual: `npx electron .`, abrir DevTools (console), confirmar zero erro de import e a lista de PRs renderizando. Commit: `git commit -am "esm: ui vira modulos nativos, morre o truque de carga dupla"`.

### Task 13e: os 58 arquivos de teste + fechamento da fase

- [ ] **Step 1:** Converter `test/*.test.js` pela receita, em lotes de ~10 com `node --test test/<lote>` entre lotes. Regras específicas:
  - `require('node:test')`/`assert` viram import named (regra 3/4).
  - Testes que patcham módulo (procurar por atribuição a propriedade de módulo importado: `merge-gates.test.js` e afins): regra 8/9 — patch no default importado + `await import()` do módulo sob teste DEPOIS do patch, dentro do próprio `test()` ou de um `before`.
  - Testes que setam `process.env` ANTES do require por causa de snapshot no load (`ui-pure.test.js` seta `TZ` antes; o comentário no arquivo explica): mesmo tratamento, `await import()` depois do set.
  - Meta-testes que leem o FONTE (`ui-widgets.test.js`, `ui-contract.test.js`): as âncoras textuais que eles grepam podem ter mudado com a conversão (ex.: procurar `<script src="pure.js"` que não existe mais); atualizar a EXPECTATIVA do teste pro texto novo, preservando a intenção do invariante. Proibido apagar invariante; só re-ancorar.
- [ ] **Step 2:** Suíte INTEIRA verde: `npm run check && npm run lint && npm test`. Aqui não tem "quase": os 58 arquivos passam ou a fase não fecha.
- [ ] **Step 3:** Atualizar `CLAUDE.md`: onde o guia menciona o truque de carga dupla do pure.js e o CommonJS, reescrever refletindo ESM (pure.js importado por app.js e pelos testes; `"type": "module"`). Atualizar também a linha do check-syntax (agora `node --check` por filho).
- [ ] **Step 4:** Merge da branch na principal (merge, NUNCA rebase, regra do usuário): `git checkout <branch principal> && git merge esm-migration`. Rodar o gate completo de novo na principal.
- [ ] **Step 5:** Commit/merge feito: `git branch -d esm-migration`.

---

### Task 14: Fechamento — CHANGELOG, versão e baseline final

**Files:**
- Modify: `CHANGELOG.md`, `package.json` (version)

- [ ] **Step 1: Rodar o gate completo do zero:** `npm run check && npm run lint && npm test`. Tudo verde, senão volte ao task quebrado.

- [ ] **Step 2: Comparar a baseline final com a inicial** (`git log -p tools/quality/baseline.json | head -100` ou diff do primeiro commit dela): montar o resumo numérico (ex.: "jsonParseCru 32→24, portaLiteral 6→0, processEnvDireto 17→9, emptyCatch 45→41, ternarioAninhado −1, profundidadeExcedida −N"). Citar CONTAGENS, nunca estimativa de horas economizadas (regra do repo).

- [ ] **Step 3: CHANGELOG.md** — nova entrada no topo, estilo das existentes, versão conforme a doutrina de semver do repo (ler `docs/` ou a seção de versionamento do CLAUDE.md). A migração ESM muda a plataforma do código inteiro sem mudar comportamento observável do app: pela doutrina interna do Farol tende a MINOR (`2.46.0`); na dúvida da doutrina, seguir o que ela manda. Conteúdo da entrada: migração ESM (repo inteiro, fim do truque de carga dupla da UI), o gate novo (`npm run lint`, ratchet, 10 regras) e as correções da onda 1 com o resumo numérico do Step 2.

- [ ] **Step 4: Bump `package.json`** pra versão escolhida. ANTES de commitar, conferir a última release publicada em `wandersonaadsantos/farol` (`gh release list -R wandersonaadsantos/farol --limit 3`) pra não colidir número com sessão paralela (pegadinha registrada do projeto).

- [ ] **Step 5: Commit final. NÃO publicar release** (fora do escopo; o usuário decide depois).

```bash
git add CHANGELOG.md package.json
git commit -m "release: v2.46.0, gate de qualidade engineering-standards + onda 1 de correcoes"
```

---

## Fora de escopo deste plano (dívida que o ratchet segura)

Declarado de propósito, seguindo a receita do standards (nunca big-bang):
- **Quebra dos arquivos >400 linhas** (app.js 3316, server.js ~850 pós-Task 10, decision/review/selfpr/session ~460-520): são as Ondas seguintes do refactor já previsto em docs/QUALITY.md. O gate impede que cresçam.
- **Os ~40 catch vazios COM comentário**: a doutrina da casa os tolera (best-effort documentado); converter num extrator único de erro é decisão de arquitetura pro mantenedor, não pra execução mecânica.
- **Logs estruturados** (hoje frase livre + taxonomia por regex): mudança de contrato do Diagnóstico inteiro, precisa de desenho próprio.
- **readBody devolver 400 em JSON inválido**: mudança de comportamento de API, decidir à parte.

## Self-review (executado)

- Cobertura: as 8 classes de achado da análise têm task (SSE=6, porta/tempos=7, env=8, forma=9, função gigante=10/11/12) ou estão declaradas fora de escopo com o porquê.
- Placeholders: os únicos trechos não literais são os movimentos verbatim (Tasks 10-12), onde o código-fonte é a fonte e o plano dá fronteira, critério e verificação; assinaturas ilustrativas estão marcadas como tal.
- Consistência de nomes: `safeJsonParse`, `DEFAULT_PORT`, `TEMPOS.*`, `env.reviewCmdStub()` usados iguais em interface e steps; chaves de regra do rules.js batem com os testes do gate.
- Risco Haiku: cada task fecha com a suíte inteira verde e commit isolado; qualquer vermelho tem instrução de reverter o ponto, nunca "consertar por cima".
