// Servidor MCP local do Farol, falado em JSON-RPC por stdin e stdout com uma
// mensagem por linha (transporte stdio do MCP). Não decide nada: traduz chamada
// de ferramenta em chamada do cliente REST, já apontado pro site da organização
// dona do PR.
//
// Recebe SÓ o id do site por argumento. A credencial ele lê do disco, porque o
// caminho do --mcp-config vira argumento de linha de comando e o logSpawn grava a
// linha inteira no state/spawns.log.
//
// Encerramento: o processo morre quando o stdin fecha, que é como o cliente MCP
// desliga um servidor stdio. Não há conexão nem arquivo aberto pra fechar antes,
// então não existe shutdown a coordenar.
import { createInterface } from 'node:readline';
import { CONFIG_FILE, executadoDireto } from '../lib/paths.js';
import { JIRA } from '../lib/constants.js';
import io from '../lib/io.js';
import { parseJiraSites } from '../lib/jira/sites.js';
import { credentialFor } from '../lib/jira/credentials.js';
import { createJiraClient } from '../lib/jira/client.js';
import { normalizeIssue, issueValida } from '../lib/jira/card.js';

const PROTOCOLO_PADRAO = '2024-11-05';
// hasteada pro topo porque, dentro do return do initialize, a profundidade de
// chaves (função, if, objeto do resultado, capabilities, tools) passa do teto do gate
const CAPACIDADES = { tools: {} };

const FERRAMENTAS = [
  {
    name: 'getJiraIssue',
    description: 'Lê um card do Jira desta organização pela chave e devolve título, status, critérios de aceite, escopo técnico e fora de escopo.',
    inputSchema: {
      type: 'object',
      properties: { issueIdOrKey: { type: 'string', description: 'chave do card, no formato PROJETO-NUMERO' } },
      required: ['issueIdOrKey'],
    },
  },
  {
    name: 'searchJiraIssuesUsingJql',
    description: 'Busca cards do Jira desta organização por JQL.',
    inputSchema: {
      type: 'object',
      properties: {
        jql: { type: 'string', description: 'consulta JQL' },
        maxResults: { type: 'number', description: 'teto de resultados, default 10' },
      },
      required: ['jql'],
    },
  },
];

function resposta(id, result) { return { jsonrpc: '2.0', id, result }; }
function erroRpc(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function conteudo(texto, isError) { return { content: [{ type: 'text', text: texto }], isError: !!isError }; }

async function umCard(deps, chave) {
  const bruto = await deps.cliente.getIssue(chave);
  // mesma prova de forma do compositor: 200 com envelope de erro é JSON válido e
  // viraria card de chave vazia entregue ao modelo como leitura boa
  if (!issueValida(bruto)) return conteudo('o Jira respondeu em formato inesperado (resposta_invalida)', true);
  return conteudo(io.safeStringify(normalizeIssue(bruto)), false);
}

async function chamarFerramenta(params, deps) {
  const nome = (params && params.name) || '';
  const args = (params && params.arguments) || {};
  try {
    if (nome === 'getJiraIssue') return await umCard(deps, String(args.issueIdOrKey || ''));
    if (nome === 'searchJiraIssuesUsingJql') {
      const bruto = await deps.cliente.searchJql(String(args.jql || ''), args.maxResults);
      const achados = ((bruto && bruto.issues) || []).filter(issueValida).map(normalizeIssue);
      return conteudo(io.safeStringify(achados), false);
    }
    return conteudo(`ferramenta desconhecida: ${nome}`, true);
  } catch (err) {
    // sai com o CÓDIGO, nunca com a credencial nem com a URL montada
    return conteudo(`falha ao consultar o Jira (${err.code || 'indisponivel'}): ${err.message || 'sem detalhe'}`, true);
  }
}

async function handle(mensagem, deps) {
  const { id, method, params } = mensagem || {};
  if (method === 'initialize') {
    return resposta(id, {
      protocolVersion: (params && params.protocolVersion) || PROTOCOLO_PADRAO,
      capabilities: CAPACIDADES,
      serverInfo: { name: JIRA.MCP_SERVER_NAME, version: '1.0.0' },
    });
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return null;
  if (method === 'tools/list') return resposta(id, { tools: FERRAMENTAS });
  if (method === 'tools/call') return resposta(id, await chamarFerramenta(params, deps));
  return erroRpc(id, -32601, `método não suportado: ${method}`);
}

function montarDeps(siteId) {
  const config = io.readJson(CONFIG_FILE, {});
  const site = parseJiraSites((config && config.jiraSites) || []).find((s) => s.id === siteId) || null;
  if (!site) throw new Error(`site do Jira não encontrado: ${siteId}`);
  const credencial = credentialFor(site.id);
  if (!credencial) throw new Error(`site do Jira sem credencial: ${site.label}`);
  return { cliente: createJiraClient({ baseUrl: site.baseUrl, email: credencial.email, token: credencial.token }) };
}

function servir(deps) {
  const linhas = createInterface({ input: process.stdin });
  linhas.on('line', async (linha) => {
    const mensagem = io.parseJson(linha, null);
    if (!mensagem) return;
    const saida = await handle(mensagem, deps);
    if (saida) process.stdout.write(`${io.safeStringify(saida)}\n`);
  });
  linhas.on('close', () => process.exit(0));
}

if (executadoDireto(import.meta.url)) servir(montarDeps(process.argv[2] || ''));

export default { handle, FERRAMENTAS };
export { handle, FERRAMENTAS };
