// Ferramenta local somente de leitura, executada no ambiente autorizado da sessão.
import { openPreparedSources } from '../review-source/index.js';
import { semAsVariaveis } from '../env.js';
import { parseJson, safeStringify } from '../io.js';
import { executadoDireto, CONFIG_FILE } from '../paths.js';
import { mascararSegredos } from '../engine/falhas.js';
import { searchSources } from './search.js';
import { readRegularFile } from '../bounded-file.js';

async function queryPrepared(operation, manifestFile, query, side = 'head') {
  if (!['read', 'search', 'tree'].includes(operation) || !['head', 'base', 'mergeBase'].includes(side)) throw new Error('Consulta inválida.');
  const manifest = parseJson(readRegularFile(manifestFile, 4 * 1024 * 1024).toString('utf8'));
  let config;
  try { config = parseJson(readRegularFile(CONFIG_FILE, 4 * 1024 * 1024).toString('utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Limites locais não verificáveis.');
    config = {};
  }
  if (!config) throw new Error('Limites locais não verificáveis.');
  // authorize confirma a conta efetiva com gh. Nenhuma credencial entra em argumentos/arquivos.
  const engine = { config: { sourceCacheLimits: config.sourceCacheLimits || {} }, accountForPr: () => manifest?.scope?.authAccount || manifest?.scope?.account,
    tokenFor: () => true, ghEnv: () => semAsVariaveis([]) };
  const source = await openPreparedSources(engine, manifest);
  try {
    if (operation === 'tree') return await source.reader.tree(side);
    if (operation === 'search') return await searchSources(source, query, { side });
    const data = await source.reader.read(query, side);
    if (typeof data.text !== 'string') return data;
    const text = mascararSegredos(data.text);
    return { ...data, text, redacted: text !== data.text };
  } finally { await source.release(); }
}

if (executadoDireto(import.meta.url)) {
  queryPrepared(...process.argv.slice(2)).then(result => console.log(safeStringify(result)))
    .catch(() => { console.error('Fontes indisponíveis ou autorização incompatível; não substitua pela branch atual.'); process.exitCode = 1; });
}
export { queryPrepared };
