// Higiene de repositório (doutrina do engineering-standards, adaptada ao Farol):
// número de card em código só aponta pra frente, na forma TODO(BT-123).
// "Veio do card X" mora no git blame, não no fonte. CHANGELOG e docs/ ficam
// fora (mapear release a card é o papel deles). Artefatos de ferramenta NÃO são
// checados aqui: workspace-template/ é o produto do Farol e o CLAUDE.md da raiz
// vai no zip de auditoria por decisão registrada (16/08/2026).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = path.join(import.meta.dirname, '..', '..');
const IGNORAR = new Set(['node_modules', 'dist', '.git', '.worktrees', 'scratchpad_test', 'docs', 'workspace-template', 'assets', '.superpowers']);
// Arquivo especifico ignorado: test/quality-higiene.test.js contém fixtures
// com BT-*/BUGS-* literais como dados de teste para validar a detecção.
const ARQUIVOS_IGNORADOS = new Set(['test/quality-higiene.test.js']);
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
  try {
    let total = 0;
    for (const abs of listar(RAIZ)) {
      const rel = path.relative(RAIZ, abs).replace(/\\/g, '/');
      if (ARQUIVOS_IGNORADOS.has(rel)) continue;
      const n = refsForaDeTodo(fs.readFileSync(abs, 'utf8'));
      if (n) { console.error(`  ${rel}: ${n} referencia(s) de card fora de TODO(...)`); total += n; }
    }
    if (total) { console.error(`FALHA: ${total} referencia(s). Mova a procedencia pro git/PR ou converta em TODO(CARD-N).`); return 1; }
    console.log('higiene: sem referencia de card solta');
    return 0;
  } catch (err) {
    console.error(`higiene: falha de execucao: ${err.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
export default { refsForaDeTodo };
export { refsForaDeTodo };
