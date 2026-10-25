// Parser nativo em worker: compila sintaxe, nunca instancia, liga ou executa o projeto.
import vm from 'node:vm';
import * as modules from 'node:module';
import { parentPort } from 'node:worker_threads';

function declarationText(text) {
  let out = '', quote = '', comment = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; out += c === '\n' ? c : ' '; continue; }
    if (comment === 'block') { if (c === '*' && next === '/') { comment = ''; out += '  '; i++; } else out += c === '\n' ? c : ' '; continue; }
    if (quote) {
      if (c === '\\') { out += next === '\n' ? ' \n' : '  '; i++; continue; }
      if (c === quote) quote = '';
      out += c === '\n' ? c : ' '; continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; out += '  '; i++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; out += '  '; i++; continue; }
    if (["'", '"', '`'].includes(c)) { quote = c; out += ' '; continue; }
    out += c;
  }
  return out;
}

function textSymbols(text) {
  // Candidatos textuais, sem alegar resolução semântica ou grafo completo de chamadas.
  const clean = declarationText(text);
  const symbols = [];
  const declarations = /\b(function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of clean.matchAll(declarations)) {
    symbols.push({ name: match[2], kind: match[1], line: clean.slice(0, match.index).split('\n').length, origin: 'textual', confidence: 'candidate' });
    if (symbols.length >= 100) break;
  }
  return symbols;
}

function parseFile(file) {
  let code = file.text, backend = 'v8-module', limitations = [];
  if (/\.[cm]?tsx?$/.test(file.path)) {
    if (typeof modules.stripTypeScriptTypes !== 'function' || /\.tsx$/.test(file.path)) {
      return { blob: file.blob, path: file.path, imports: [], symbols: textSymbols(code), backend: 'textual',
        limitations: ['TypeScript/TSX sem parser disponível neste runtime; use caminhos e busca textual.'] };
    }
    try {
      code = modules.stripTypeScriptTypes(code, { mode: 'strip' }); backend = 'amaro-v8';
      limitations.push('O mapa TypeScript cobre imports de runtime; relações somente de tipos exigem busca textual adicional.');
    }
    catch { return { blob: file.blob, path: file.path, imports: [], symbols: textSymbols(code), backend: 'textual', limitations: ['Sintaxe TypeScript não suportada pelo parser nativo.'] }; }
  }
  try {
    const parsed = new vm.SourceTextModule(code, { identifier: file.path });
    if (/\b(?:require|import)\s*\(/.test(declarationText(code))) limitations.push('CommonJS/import dinâmico exige busca textual; não foi resolvido como import estático.');
    return { blob: file.blob, path: file.path, backend, symbols: textSymbols(file.text),
      imports: parsed.dependencySpecifiers.map(specifier => ({ specifier, origin: 'parser', confidence: 'syntax' })), limitations };
  } catch {
    limitations = ['Sintaxe não suportada pelo parser de módulos; relações textuais não provam ausência de dependência.'];
    return { blob: file.blob, path: file.path, backend: 'textual', imports: [], symbols: textSymbols(file.text), limitations };
  }
}

parentPort.on('message', files => parentPort.postMessage(files.map(parseFile)));
