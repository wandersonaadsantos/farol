// Busca literal nas fontes fixadas. Resultado vazio em coleta parcial não prova ausência.
import { eligible, bounded } from './map.js';
import { mascararSegredos } from '../engine/falhas.js';

async function searchSources(source, query, options = {}) {
  if (typeof query !== 'string' || !query || query.length > 120) throw new Error('Busca exige texto de 1 a 120 caracteres.');
  const limits = bounded(options.limits), side = options.side || 'head';
  const tree = await source.reader.tree(side);
  const entries = tree.entries.filter(e => e.type === 'blob' && eligible(e.path));
  const matches = [];
  let readFiles = 0, bytes = 0, omitted = 0;
  const started = Date.now();
  for (const entry of entries) {
    if (options.signal?.aborted) throw new Error('Busca cancelada.');
    if (readFiles >= limits.files || bytes >= limits.bytes || Date.now() - started > limits.timeMs || matches.length >= 50) { omitted++; continue; }
    if (entry.size > limits.fileBytes) { omitted++; continue; }
    const data = await source.reader.read(entry.path, side);
    if (data.status !== 'available') { omitted++; continue; }
    const size = Buffer.byteLength(data.text);
    if (size > limits.fileBytes || bytes + size > limits.bytes) { omitted++; continue; }
    bytes += size; readFiles++;
    for (const [index, line] of data.text.split(/\r?\n/).entries()) {
      if (!line.includes(query)) continue;
      if (matches.length >= 50) { omitted++; break; }
      matches.push({ path: entry.path, line: index + 1, blob: data.blob, commit: data.commit,
        text: mascararSegredos(line).slice(0, 500), lineTruncated: line.length > 500, origin: 'textual', confidence: 'candidate' });
    }
  }
  return { schema: 1, query: mascararSegredos(query), side, matches, complete: tree.complete === true && omitted === 0,
    omitted, readFiles, bytes, limitation: 'Correspondência textual não resolve chamadas; limites e exclusões impedem provar ausência.' };
}

export { searchSources };
