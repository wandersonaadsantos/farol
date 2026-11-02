// Cache efêmero por reader: somente texto projetado e metadados, nunca blob bruto.
import { check } from './contract.js';
import { safeStringify } from '../io.js';

const PROJECTED_CACHE_BYTES = 32 * 1024 ** 2;
function projectedTextCache(limit = PROJECTED_CACHE_BYTES) {
  check(Number.isSafeInteger(limit) && limit > 0, 'Limite do cache projetado inválido.');
  const entries = new Map();
  let bytes = 0;
  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    entries.delete(key); entries.set(key, entry);
    return structuredClone(entry.value);
  }
  function put(key, record) {
    check(typeof key === 'string' && key.length <= 128 && typeof record?.text === 'string'
      && record.representation && typeof record.representation === 'object' && !Array.isArray(record.representation)
      && Number.isSafeInteger(record.size) && record.size >= 0, 'Texto projetado inválido.');
    const value = { size: record.size, text: record.text, representation: structuredClone(record.representation) };
    const length = Buffer.byteLength(key) + Buffer.byteLength(safeStringify(value));
    if (length > limit) return false;
    if (entries.has(key)) { bytes -= entries.get(key).bytes; entries.delete(key); }
    while (bytes + length > limit) {
      const first = entries.keys().next().value;
      bytes -= entries.get(first).bytes; entries.delete(first);
    }
    entries.set(key, { value, bytes: length }); bytes += length;
    return true;
  }
  return { get, put };
}
export { projectedTextCache, PROJECTED_CACHE_BYTES };
