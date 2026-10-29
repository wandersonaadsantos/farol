// Projeção opt-in: valores ficam somente na memória privada desta execução.
import { createHash, randomUUID } from 'node:crypto';
import { secretRanges } from '../sensitive-text.js';
import { check } from './contract.js';

const branded = new WeakSet();
const VERSION = 'source-redaction-v1';
const HIDDEN_BYTES = 8 * 1024 ** 2;
const HIDDEN_VALUES = 4096;

function closedQuote(text, quote, start = 0) {
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === quote) return true;
  }
  return false;
}

// Template público não comprova ausência de senha: somente chaves convencionais
// ficam visíveis. Valores, comentários e continuação de aspas nunca são copiados.
function templateProjection(value, opaque, project, issued) {
  const parts = String(value).split(/(\r?\n)/), redactions = [];
  let text = '', quote = null;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index], newline = parts[index + 1] || '', number = index / 2 + 1;
    let replacement = line;
    if (quote) {
      replacement = '# ' + opaque(line);
      if (closedQuote(line, quote)) quote = null;
    } else if (line.trim()) {
      const assignment = line.match(/^([ \t]*(?:export[ \t]+)?[A-Z_][A-Z0-9_]{0,127}[ \t]*=)(.*)$/);
      const comment = line.match(/^[ \t]*#[ \t]*(.*)$/);
      if (assignment) {
        const raw = assignment[2], trimmed = raw.trimStart();
        check(!/^\\+["'`]/.test(trimmed), 'Escape de template não suportado; projeção recusada.');
        if (['"', "'", '`'].includes(trimmed[0]) && !closedQuote(trimmed, trimmed[0], 1)) quote = trimmed[0];
        replacement = assignment[1] + (raw ? opaque(raw) : '');
      } else {
        check(comment, 'Formato de template não suportado; projeção recusada.');
        replacement = issued.has(comment[1]) ? line : '# ' + opaque(line);
      }
    }
    if (replacement !== line) redactions.push({ line: number, endLine: number, kind: 'template-content' });
    text += replacement + newline;
  }
  const result = project(text);
  return { ...result, kind: 'template-keys', redactions: [...redactions, ...result.redactions] };
}

function createSourceProjection() {
  const id = randomUUID(), values = new Map(), issued = new Set();
  let hiddenBytes = 0;
  function opaque(hidden) {
    if (issued.has(hidden)) return hidden;
    let marker = values.get(hidden);
    if (!marker) {
      const bytes = Buffer.byteLength(hidden);
      check(values.size < HIDDEN_VALUES && hiddenBytes + bytes <= HIDDEN_BYTES,
        'Limite de valores ocultos da projeção atingido; execução recusada.');
      marker = `[FAROL_REDACTED_${id}_${values.size + 1}]`;
      values.set(hidden, marker); issued.add(marker); hiddenBytes += bytes;
    }
    return marker;
  }
  function project(value) {
    const original = String(value), redactions = [];
    const protectedRanges = [...original.matchAll(new RegExp(`\\[FAROL_REDACTED_${id}_\\d+\\]`, 'g'))]
      .filter(match => issued.has(match[0])).map(match => ({ start: match.index, end: match.index + match[0].length }));
    let text = '', cursor = 0;
    for (const range of secretRanges(original)) {
      const hidden = original.slice(range.start, range.end);
      if (issued.has(hidden) || protectedRanges.some(known => range.start >= known.start && range.end <= known.end)) continue;
      const marker = opaque(hidden);
      const line = original.slice(0, range.start).split('\n').length;
      const newlines = hidden.match(/\r?\n/g) || [];
      issued.add(marker + newlines.join(''));
      redactions.push({ line, endLine: line + newlines.length, kind: range.kind, marker });
      text += original.slice(cursor, range.start) + marker + newlines.join('');
      cursor = range.end;
    }
    text += original.slice(cursor);
    return { text, redactions, digest: createHash('sha256').update(text).digest('hex') };
  }
  const projection = Object.freeze({ id, version: VERSION, project,
    projectTemplate: value => templateProjection(value, opaque, project, issued) });
  branded.add(projection);
  return projection;
}

function assertSourceProjection(value) {
  check(branded.has(value), 'Projeção de fonte sem identidade verificável.');
  return value;
}

export { VERSION, createSourceProjection, assertSourceProjection };
