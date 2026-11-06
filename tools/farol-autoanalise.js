// Comando do agente da autoanálise (issue #346): pedir, ler e listar, e nada mais. Fala com
// o motor local pelas rotas /api/self-review/agent/*, com a credencial própria (emitida por
// `node tools/farol-parear.js --autoanalise`) no cabeçalho x-farol-autoanalise. Lê a credencial
// de FAROL_AUTOANALISE_TOKEN, nunca de argumento, e imprime a resposta do motor em JSON.
// Saída 0 quando o motor respondeu ok, 1 na recusa ou falha, 2 no uso errado.
import { executadoDireto, CONFIG_FILE } from '../lib/paths.js';
import { DEFAULT_PORT } from '../lib/constants.js';
import { readJson, parseJson, safeStringify } from '../lib/io.js';
import { lerCasca } from '../lib/engine/casca-arquivo.js';
import { autoanaliseToken } from '../lib/env.js';

const USO = 'Uso: node tools/farol-autoanalise.js pedir <url> | ler <url> | listar\n';
const ROTAS = {
  pedir: (url) => ['POST', '/api/self-review/agent/request', safeStringify({ url })],
  ler: (url) => ['GET', `/api/self-review/agent/read?url=${encodeURIComponent(url)}`, undefined],
  listar: () => ['GET', '/api/self-review/agent/list', undefined],
};

// No modo casca a porta real está no casca.json; fora dele, a do config.json.
// shortcut: casca.json que sobrou de uma queda aponta para porta morta, e a falha diz a porta tentada.
function portaDoMotor() {
  return lerCasca()?.porta || readJson(CONFIG_FILE, {}).port || DEFAULT_PORT;
}

function usoValido(args) {
  const [comando, url] = args;
  if (!Object.hasOwn(ROTAS, comando) || args.length > 2) return false;
  return (comando === 'listar') === (url === undefined);
}

async function executar(args, saida, erro, { fetch = globalThis.fetch, token = autoanaliseToken(), port = portaDoMotor() } = {}) {
  if (!usoValido(args)) { erro.write(USO); return 2; }
  if (!token) { erro.write('Defina FAROL_AUTOANALISE_TOKEN com a credencial de: node tools/farol-parear.js --autoanalise\n'); return 2; }
  const [method, rota, body] = ROTAS[args[0]](args[1]);
  const headers = { 'x-farol': '1', 'content-type': 'application/json', 'x-farol-autoanalise': token };
  try {
    const resposta = await fetch(`http://127.0.0.1:${port}${rota}`, { method, body, headers });
    const texto = await resposta.text();
    saida.write(`${texto}\n`);
    return resposta.ok && parseJson(texto, {})?.ok === true ? 0 : 1;
  } catch (e) {
    erro.write(`O motor do Farol não respondeu em 127.0.0.1:${port}: ${e.message}\n`);
    return 1;
  }
}

if (executadoDireto(import.meta.url)) process.exitCode = await executar(process.argv.slice(2), process.stdout, process.stderr);

export default { executar };
export { executar };
