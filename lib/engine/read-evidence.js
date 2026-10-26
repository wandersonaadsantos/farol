// O experimento só credita conteúdo retornado e conferido contra o patch local.
import fs from 'node:fs';
import path from 'node:path';
import { prPathFromRead } from './pr-scope.js';

const observations = new WeakMap();
const linesOf = text => text.replaceAll('\r\n', '\n').replace(/\n$/, '').split('\n');
const keyFor = (event, id) => `${String(event.parent_tool_use_id || '').length}:${event.parent_tool_use_id || ''}:${id}`;

function deliveredLines(content) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.filter(b => b?.type === 'text').map(b => b.text).join('\n');
  const lines = new Map();
  for (const line of String(text || '').replaceAll('\r\n', '\n').split('\n')) {
    const match = line.match(/^\s*(\d+)(?:→|\t)(.*)$/);
    if (match) lines.set(Number(match[1]), match[2]);
  }
  return lines;
}

function observarLeitura(engine, opts, block) {
  if (block.name !== 'Read' || engine.config?.reviewBatchedReads === true) return;
  const review = engine.activeReviews?.get(opts.id);
  const file = prPathFromRead(review?.scopeRoot, block.input?.file_path);
  if (!file) return;
  if (!review.filesRead) review.filesRead = new Set();
  review.filesRead.add(file);
}

function observeReadEvent(engine, opts, event) {
  if (engine.config?.reviewBatchedReads !== true) return;
  const review = engine.activeReviews?.get(opts.id);
  if (!review?.scopeRoot || !Array.isArray(event.message?.content)) return;
  if (!observations.has(review)) observations.set(review, { pending: new Map(), files: new Map() });
  const state = observations.get(review);
  for (const block of event.message.content) {
    if (event.type === 'assistant' && block.type === 'tool_use' && block.name === 'Read' && typeof block.id === 'string') {
      const file = prPathFromRead(review.scopeRoot, block.input?.file_path);
      if (file) state.pending.set(keyFor(event, block.id), file);
    }
    if (event.type === 'user' && block.type === 'tool_result') acceptResult(review, state, event, block);
  }
}

function acceptResult(review, state, event, block) {
  const key = keyFor(event, block.tool_use_id), file = state.pending.get(key);
  if (!file) return;
  state.pending.delete(key);
  const result = event.tool_use_result;
  const returned = result?.file;
  if (block.is_error || result?.type !== 'text' || typeof returned?.content !== 'string'
    || prPathFromRead(review.scopeRoot, returned.filePath) !== file) return;
  let text;
  try { text = fs.readFileSync(path.join(review.scopeRoot, file), 'utf8'); }
  catch { return; }
  const expected = linesOf(text), start = returned.startLine, count = returned.numLines;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 1 || count < 1
    || start - 1 + count > expected.length || linesOf(returned.content).join('\n') !== expected.slice(start - 1, start - 1 + count).join('\n')) return;
  const delivered = deliveredLines(block.content);
  if (expected.slice(start - 1, start - 1 + count).some((line, i) => delivered.get(start + i) !== line)) return;
  let proof = state.files.get(file);
  if (!proof || proof.text !== text) { proof = { text, ranges: [] }; state.files.set(file, proof); }
  proof.ranges.push([start, start + count - 1]);
  let through = 0;
  for (const [from, to] of proof.ranges.sort((a, b) => a[0] - b[0])) {
    if (from > through + 1) break;
    through = Math.max(through, to);
  }
  if (through >= expected.length) {
    if (!review.filesRead) review.filesRead = new Set();
    review.filesRead.add(file);
  }
}
export { observarLeitura, observeReadEvent };
