// Ferramenta local somente de leitura, executada no ambiente autorizado da sessão.
import { openPreparedSources } from '../review-source/index.js';
import { semAsVariaveis } from '../env.js';
import { parseJson, safeStringify } from '../io.js';
import { executadoDireto, CONFIG_FILE } from '../paths.js';
import { TEMPOS } from '../constants.js';
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

// Encerra explicitamente, depois de entregar a saída. Rodado pelo Farol.exe sem
// ELECTRON_RUN_AS_NODE, o processo é um app Electron e não sai quando o script acaba: ficava
// órfão, segurando o pipe da sessão de revisão (biblioteca-cnbb-api#144, 30/10/2026).
function encerrar(stream, texto, code) {
  stream.write(`${texto}\n`, () => process.exit(code));
}

if (executadoDireto(import.meta.url)) {
  setTimeout(() => encerrar(process.stderr, 'Consulta às fontes excedeu o tempo; encerrada.', 1), TEMPOS.CONSULTA_FONTES_MS);
  queryPrepared(...process.argv.slice(2)).then(result => encerrar(process.stdout, safeStringify(result), 0))
    .catch(() => encerrar(process.stderr, 'Fontes indisponíveis ou autorização incompatível; não substitua pela branch atual.', 1));
}
export { queryPrepared };
