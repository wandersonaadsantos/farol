// Fonte MCP fechada sobre um snapshot. Não recebe comandos, URLs ou caminhos absolutos.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseJson, safeStringify } from '../io.js';
import { executadoDireto } from '../paths.js';
import { SOURCE_PAGE_LINES as MAX_LINES, SOURCE_PAGE_CHARS as MAX_CHARS,
  SOURCE_REPLY_BYTES, SOURCE_RPC_ID_CHARS, materialPath } from './restricted-source-contract.js';

const SIDES = new Set(['patches', 'head', 'base', 'mergeBase']);
const READ_TOOL = { name: 'read_source', description: 'Leia fonte fixada por caminho relativo e lado. Retorna linhas numeradas. Sem escrita ou comandos.',
  inputSchema: { type: 'object', properties: { side: { type: 'string', enum: [...SIDES] },
    path: { type: 'string' }, start: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 1, maximum: MAX_LINES } },
  required: ['side', 'path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
const INDEX_TOOL = { name: 'list_sources', description: 'Liste caminhos disponíveis no snapshot, com paginação.',
  inputSchema: { type: 'object', properties: { side: { type: 'string', enum: [...SIDES] }, offset: { type: 'integer', minimum: 0 } },
    required: ['side'], additionalProperties: false }, annotations: READ_TOOL.annotations };

async function sourceRead(root, input) {
  if (!SIDES.has(input?.side) || typeof input.path !== 'string' || !input.path
    || /[\\:\x00-\x1f]/.test(input.path) || input.path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Fonte fora do snapshot.');
  materialPath(input.path);
  const base = await fs.realpath(path.join(root, input.side));
  const target = await fs.realpath(path.join(base, input.path));
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fonte fora do snapshot.');
  const text = await fs.readFile(target, 'utf8');
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const start = input.start ?? 1, count = input.count ?? MAX_LINES;
  if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(count) || count < 1 || count > MAX_LINES) throw new Error('Intervalo inválido.');
  const selected = [];
  let chars = 0;
  for (const line of lines.slice(start - 1, start - 1 + count)) {
    if (chars + line.length > MAX_CHARS) break;
    selected.push(line); chars += line.length;
  }
  if (!selected.length) throw new Error('Intervalo vazio ou linha acima do limite.');
  return { side: input.side, path: input.path, start, count: selected.length, totalLines: lines.length,
    text: selected.join('\n'), rendered: selected.map((line, i) => `${start + i}→${line}`).join('\n') };
}

async function dispatchSource(root, request) {
  if (request.method === 'initialize') return { protocolVersion: request.params?.protocolVersion || '2024-11-05',
    capabilities: { tools: {} }, serverInfo: { name: 'farol-fixed-source', version: '1.0.0' } };
  if (request.method === 'tools/list') return { tools: [READ_TOOL, INDEX_TOOL] };
  if (request.method === 'ping') return {};
  if (request.method === 'tools/call' && request.params?.name === INDEX_TOOL.name) return sourceIndex(root, request.params.arguments);
  if (request.method !== 'tools/call' || request.params?.name !== READ_TOOL.name) throw new Error('Método não permitido.');
  const { rendered, ...metadata } = await sourceRead(root, request.params.arguments);
  const result = { content: [{ type: 'text', text: rendered }, { type: 'text', text: safeStringify(metadata) }], isError: false };
  if (Buffer.byteLength(safeStringify(result)) > SOURCE_REPLY_BYTES) throw new Error('Resposta acima do orçamento.');
  return result;
}

async function sourceIndex(root, input) {
  if (!SIDES.has(input?.side)) throw new Error('Lado não permitido.');
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Página inválida.');
  const files = [];
  const base = path.join(root, input.side);
  await walkSources(base, '', files);
  const paths = [];
  let bytes = 0;
  for (const file of files.slice(offset, offset + MAX_LINES)) {
    const size = Buffer.byteLength(safeStringify(file));
    if (bytes + size > MAX_CHARS * 4) break;
    paths.push(file); bytes += size;
  }
  const page = { total: files.length, paths, next: null };
  if (offset + paths.length < files.length) page.next = offset + paths.length;
  return { content: [{ type: 'text', text: safeStringify(page) }], isError: false };
}

async function walkSources(base, relative, files) {
  const entries = await fs.readdir(path.join(base, relative), { withFileTypes: true });
  for (const entry of entries) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await walkSources(base, file, files);
    else if (entry.isFile()) files.push(file);
  }
}

function serveSource(root, input = process.stdin, output = process.stdout) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > MAX_CHARS * 4) { input.destroy(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      const request = parseJson(line, null);
      if (request?.id != null && validId(request.id)) answerSource(root, request, output);
    }
  });
}

function validId(id) {
  return Number.isSafeInteger(id) || (typeof id === 'string' && id.length <= SOURCE_RPC_ID_CHARS);
}

async function answerSource(root, request, output) {
  let response;
  try { response = { jsonrpc: '2.0', id: request.id, result: await dispatchSource(root, request) }; }
  catch { response = refusedSource(request.id); }
  output.write(safeStringify(response) + '\n');
}

function refusedSource(id) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Fonte ou operação recusada.' }], isError: true } };
}

if (executadoDireto(import.meta.url)) serveSource(path.resolve(process.argv[2] || '.'));
export { sourceRead, dispatchSource, serveSource };
