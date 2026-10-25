// Ferramenta local somente de leitura, executada no ambiente autorizado da sessão.
import fs from 'node:fs';
import { openPreparedSources } from '../review-source/index.js';
import { semAsVariaveis } from '../env.js';
import { parseJson, safeStringify } from '../io.js';
import { executadoDireto, CONFIG_FILE } from '../paths.js';
import { mascararSegredos } from '../engine/falhas.js';
import { searchSources } from './search.js';

async function queryPrepared(operation, manifestFile, query, side = 'head') {
  if (!['read', 'search', 'tree'].includes(operation) || !['head', 'base', 'mergeBase'].includes(side)) throw new Error('Consulta inválida.');
  if (fs.statSync(manifestFile).size > 4 * 1024 * 1024) throw new Error('Manifesto acima do limite.');
  const manifest = parseJson(fs.readFileSync(manifestFile, 'utf8'));
  const config = fs.existsSync(CONFIG_FILE) ? parseJson(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
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
