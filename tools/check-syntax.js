'use strict';
// Gate de sintaxe do Farol: valida TODO .js do projeto, não uma lista fixa.
//
// Antes o `npm run check` era `node --check` em três arquivos escolhidos a dedo
// (server.js, main.js, ui/app.js). Os 19 módulos de lib/ e lib/engine/, criados na
// decomposição da Engine, e os arquivos de test/ ficavam de fora: erro de sintaxe neles
// só aparecia quando alguém rodasse a suíte, e num arquivo pouco exercitado podia passar
// despercebido. Aqui a lista é DESCOBERTA, então módulo novo entra sozinho.
//
// Node puro, zero dependências (invariante 1). Usa vm.Script com o mesmo wrapper de
// função que o CommonJS aplica, que é exatamente o que `node --check` faz: parseia sem
// executar nada.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
// node_modules e dist não são nossos; .worktrees e scratchpad são scratch local
const IGNORAR = new Set(['node_modules', 'dist', '.git', '.worktrees', 'scratchpad_test']);

function varrer(dir, achados = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const p = path.join(dir, item.name);
    if (item.isDirectory()) varrer(p, achados);
    else if (item.name.endsWith('.js')) achados.push(p);
  }
  return achados;
}

const arquivos = varrer(RAIZ).sort();

// piso anti-vacuidade: se a varredura quebrar e devolver pouca coisa, o gate ficaria
// verde sem ter checado nada. Bem abaixo do que existe hoje, mas alto pra denunciar.
const PISO = 25;
if (arquivos.length < PISO) {
  console.error(`  x  check-syntax: só ${arquivos.length} arquivos encontrados (piso ${PISO}).`);
  console.error('     A varredura provavelmente quebrou; o gate NÃO validou o projeto.');
  process.exit(1);
}

const falhas = [];
for (const arq of arquivos) {
  const codigo = fs.readFileSync(arq, 'utf8');
  try {
    // mesmo wrapper do CommonJS: sem ele um `return` de topo (válido em módulo)
    // seria reportado como erro que o node --check não daria
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {${codigo}\n});`,
      { filename: arq, produceCachedData: false });
  } catch (e) {
    falhas.push({ arq: path.relative(RAIZ, arq), msg: e.message });
  }
}

if (falhas.length) {
  console.error('');
  console.error(`  x  ${falhas.length} arquivo(s) com erro de sintaxe:`);
  for (const f of falhas) console.error(`     ${f.arq}: ${f.msg}`);
  console.error('');
  process.exit(1);
}

console.log(`  ok  sintaxe validada em ${arquivos.length} arquivos .js`);
