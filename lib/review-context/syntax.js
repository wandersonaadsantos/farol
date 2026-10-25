// AST de texto; nenhum módulo, configuração ou código do repositório é carregado.
import { carregarParserDistribuido } from '../parser-runtime.js';
const { parse } = carregarParserDistribuido();
const MAX_NODES = 100000;
function importKind(node) {
  if (node.importKind === 'type' || node.exportKind === 'type') return 'type';
  if (node.specifiers?.some(item => item.importKind === 'type')) return 'mixed';
  return 'value';
}
function moduleReference(node, imports, limitations, unresolved) {
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
    imports.push({ specifier: node.source.value, origin: 'parser', confidence: 'syntax', kind: importKind(node),
      form: node.type, line: node.loc.start.line });
  }
  const dynamic = node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee?.type === 'Import');
  const common = node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require';
  const equals = node.type === 'TSImportEqualsDeclaration' && node.moduleReference?.type === 'TSExternalModuleReference';
  if (!dynamic && !common && !equals) return;
  let argument = node.source || node.arguments?.[0];
  if (equals) argument = node.moduleReference.expression;
  const reason = dynamic ? 'Import dinâmico não comprova execução ou conjunto completo de dependências.'
    : 'CommonJS é candidato sintático; require pode estar sombreado e a resolução exige confirmação.';
  limitations.add(reason);
  const kind = equals && node.importKind === 'type' ? 'type' : 'value';
  const form = dynamic ? 'dynamic' : 'commonjs';
  if (argument?.type === 'StringLiteral') imports.push({ specifier: argument.value, origin: 'parser', confidence: 'candidate',
    kind, form, line: node.loc.start.line });
  else unresolved.push({ specifier: null, reason: dynamic ? 'dependência dinâmica calculada' : 'require não literal', line: node.loc.start.line });
}
function declaredSymbol(node, symbols) {
  const name = node.id?.name;
  if (!name || !['VariableDeclarator', 'FunctionDeclaration', 'ClassDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'].includes(node.type)) return;
  if (symbols.length < 100) symbols.push({ name, kind: node.type, line: node.loc.start.line, origin: 'parser', confidence: 'syntax' });
}
function appendNodes(value, stack) {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) if (value[i]?.type) stack.push(value[i]);
  } else if (value?.type) stack.push(value);
}
function inspect(ast) {
  const imports = [], symbols = [], unresolved = [], limitations = new Set(), stack = [ast];
  let count = 0;
  while (stack.length) {
    const node = stack.pop();
    if (++count > MAX_NODES) throw new Error('AST acima do limite de nós.');
    moduleReference(node, imports, limitations, unresolved); declaredSymbol(node, symbols);
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'tokens', 'comments', 'errors', 'extra'].includes(key)) continue;
      appendNodes(value, stack);
    }
  }
  return { imports, symbols, unresolved, limitations: [...limitations] };
}
function fallback(file) {
  const imports = [];
  // Deliberadamente candidato textual: comentários/strings podem gerar falsos positivos.
  for (const match of file.text.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(?\s*)['"]([^'"\n]+)['"]/g)) {
    imports.push({ specifier: match[1], origin: 'textual', confidence: 'candidate', kind: 'unknown', form: 'fallback' });
    if (imports.length >= 200) break;
  }
  return { path: file.path, blob: file.blob, backend: 'textual', imports, symbols: [],
    unresolved: [{ specifier: null, reason: 'parser degradado; dependências podem estar ausentes' }],
    limitations: ['Sintaxe não suportada ou limite do parser; relações textuais não provam ausência de dependência.'] };
}
function parseFile(file) {
  const plugins = [];
  if (/\.[cm]?tsx?$/.test(file.path)) plugins.push('typescript');
  if (!/\.[cm]?ts$/.test(file.path)) plugins.push('jsx');
  try {
    const ast = parse(file.text, { sourceType: 'unambiguous', plugins, createImportExpressions: true,
      errorRecovery: false, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    return { path: file.path, blob: file.blob, backend: 'babel-parser-7.28.5', ...inspect(ast) };
  } catch { return fallback(file); }
}
export { parseFile };
