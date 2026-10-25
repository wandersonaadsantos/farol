// Replay offline do contrato de saída: não abre modelo, sessão nem capability de postagem.
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parseJson, safeStringify } from '../lib/io.js';
import { executadoDireto } from '../lib/paths.js';
import { expandReviewOutput } from '../lib/engine/review-output.js';
import { conferirEnvelope } from '../lib/engine/envelope-revisao.js';

function candidateFrom(legacy) {
  const payload = legacy.payloads?.[legacy.verdict];
  if (!payload || legacy.reviewOutputVersion) throw new Error('Envelope legado sem ação escolhida');
  const { payloads: _payloads, reviewMarkdown: _markdown, ...rest } = legacy;
  return { ...rest, reviewOutputVersion: 1, review: structuredClone(payload) };
}

function withoutPublic(result) {
  const { payloads: _payloads, reviewMarkdown: _markdown, reviewOutputVersion: _version, ...rest } = result;
  return rest;
}

function compareReviewOutput(legacy, candidate = candidateFrom(legacy)) {
  const before = conferirEnvelope(structuredClone(legacy));
  const after = conferirEnvelope(expandReviewOutput(structuredClone(candidate)));
  const action = legacy.verdict;
  const sameInternal = isDeepStrictEqual(withoutPublic(before), withoutPublic(after));
  const samePublic = isDeepStrictEqual(before.payloads?.[action], after.payloads?.[action]);
  const sameDisplay = before.reviewMarkdown === after.reviewMarkdown;
  return { sameInternal, samePublic, sameDisplay, lossless: sameInternal && samePublic && sameDisplay,
    bytesBefore: Buffer.byteLength(safeStringify(legacy)), bytesAfter: Buffer.byteLength(safeStringify(candidate)),
    decisionQualityMeasured: false };
}

function legacyFromFile(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Fonte acima do limite do replay');
  const text = bytes.toString('utf8');
  const direct = parseJson(text);
  if (direct?.payloads && direct.decision) return direct;
  // Transcrições são lidas apenas pelos caminhos explicitamente fornecidos.
  // O relatório nunca copia conteúdo, caminhos ou dados internos da revisão.
  const rows = text.split(/\r?\n/).map(line => parseJson(line)).filter(r => r?.type === 'assistant');
  const candidates = rows.flatMap(r => assistantResults(r.message?.content));
  const last = candidates.at(-1);
  if (!last) throw new Error('Envelope final não encontrado');
  return last;
}

function assistantResults(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(b => b.type === 'text').map(b => parseJson(b.text))
    .filter(r => r?.payloads && r.decision && r.reportMarkdown);
}

function main(files) {
  if (!files.length) throw new Error('Informe arquivos JSON ou JSONL explícitos para o replay offline');
  const cases = files.map(file => compareReviewOutput(legacyFromFile(file)));
  console.log(safeStringify({ schema: 1, cases, lossless: cases.every(c => c.lossless), decisionQualityMeasured: false }));
  return cases.every(c => c.lossless) ? 0 : 1;
}

if (executadoDireto(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch { console.error('Replay inconclusivo: fonte ou contrato incompatível. Nenhum dado de revisão foi exposto.'); process.exitCode = 2; }
}
export { compareReviewOutput };
