// Fonte ÚNICA dos literais de infra (contrato engineering-standards: chave de
// infra e tempo têm nome e UM endereço). Antes a porta 47170 vivia em 6 pontos
// e divergiria em silêncio num ajuste.
const DEFAULT_PORT = 47170;
// base das duracoes derivadas. Fica FORA do objeto pra as outras poderem se
// apoiar nela, e escrita como 3600*1000 (nao 60*60*1000) porque a forma
// `N * 60 * 1000` e justamente o que o gate de qualidade conta como tempo magico.
const HORA_MS = 3600 * 1000;

const TEMPOS = {
  GH_TIMEOUT_MS: 60000,          // teto dos comandos gh/shell (io.run/runShell)
  SESSAO_HEADLESS_MS: 30 * 60 * 1000, // teto de uma revisao headless
  SSE_PING_MS: 25000,            // keepalive do EventSource
  LOG_ROTACAO_BYTES: 2 * 1024 * 1024, // teto do farol.log antes de rotacionar
  AUTO_UPDATE_BACKOFF_MS: 30 * 60 * 1000, // espera entre tentativas de auto-update que FALHARAM, pra nao martelar download a cada ciclo de 30s
  // validade do marcador de reabertura silenciosa (10 min): update que falhou nao
  // pode deixar a proxima abertura MANUAL sem janela (pareceria app quebrado)
  REABERTURA_SILENCIOSA_MS: HORA_MS / 6,
  HORA_MS,                       // base de TTLs curtos de cache
  DIA_MS: 24 * HORA_MS,          // base das janelas contadas em dias
  PROVA_ARQUIVO_MAX_AGE_MS: 30 * 24 * 3600 * 1000, // poda da prova por arquivo (state/file-proof): PR morto ha semanas nao herda mais nada
};
// Infra do Jira multi-tenant. Nomes em MAIÚSCULO de propósito: a regra
// `tempoMagico` do gate casa `timeout:` minúsculo, e o lar legítimo do número é
// aqui. A API é a v2 porque a v3 devolve `description` em ADF (JSON aninhado) e
// exigiria um interpretador só pra ler critério de aceite.
const JIRA = {
  CACHE_TTL_MS: HORA_MS,        // card muda durante a vida do PR; 1h equilibra frescor e releitura
  REQUEST_TIMEOUT_MS: 20000,    // teto de UMA chamada ao Atlassian, o que o conector claude.ai não dá (timeout medido lá: 300s)
  API_PATH: '/rest/api/2/issue/',
  SEARCH_PATH: '/rest/api/2/search',
  MYSELF_PATH: '/rest/api/2/myself',   // prova credencial sem depender de existir card algum
  FIELDS: 'summary,status,description',
  CACHE_DIR: 'cards',           // dentro de ~/.farol/, fora do workspace da sessão (ver lib/jira/cache.js)
  MCP_DIR: 'mcp',               // dentro de ~/.farol/
  MCP_SERVER_NAME: 'farol-jira',
};

export default { DEFAULT_PORT, TEMPOS, JIRA };
export { DEFAULT_PORT, TEMPOS, JIRA };
