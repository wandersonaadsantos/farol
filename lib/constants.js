// Fonte ÚNICA dos literais de infra (core.duplication.business-rule: chave de
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
  // teto do state/spawns.log antes de rotacionar. Maior que o do farol.log porque
  // este e de alto volume por natureza (uma linha por comando disparado, e o ciclo
  // de polling dispara dezenas por minuto), e menor do que o que ele ja alcancou
  // sozinho: medido em 30/08/2026, com debugSpawns ligado, o arquivo estava com
  // 60 MB e crescendo, porque NADA o rotacionava. Diagnostico e sobre o passado
  // recente; historico infinito so ocupa disco.
  SPAWN_LOG_ROTACAO_BYTES: 8 * 1024 * 1024,
  AUTO_UPDATE_BACKOFF_MS: 30 * 60 * 1000, // espera entre tentativas de auto-update que FALHARAM, pra nao martelar download a cada ciclo de 30s
  // validade do marcador de reabertura silenciosa (10 min): update que falhou nao
  // pode deixar a proxima abertura MANUAL sem janela (pareceria app quebrado)
  REABERTURA_SILENCIOSA_MS: HORA_MS / 6,
  HORA_MS,                       // base de TTLs curtos de cache
  DIA_MS: 24 * HORA_MS,          // base das janelas contadas em dias
  // poda do escopo materializado (state/pr-scope): patch por arquivo de PR que ninguem
  // reanalisa ha uma semana e so disco ocupado; a proxima analise materializa de novo
  ESCOPO_PR_MAX_AGE_MS: 7 * 24 * 3600 * 1000,
  PROVA_ARQUIVO_MAX_AGE_MS: 30 * 24 * 3600 * 1000, // poda da prova por arquivo (state/file-proof): PR morto ha semanas nao herda mais nada
  // poda do rascunho que as SESSOES deixam em workspace/tmp (clone de repositorio,
  // patch avulso). Mesma regua do escopo materializado, e a folga e deliberada: sessao
  // headless vive no maximo SESSAO_HEADLESS_MS, entao material de uma semana nao pode
  // pertencer a nada em andamento. Medido em 31/08/2026: 4,0 GB em 394.683 arquivos,
  // o mais novo com quatro dias, porque nada olhava para esse diretorio.
  TMP_SESSAO_MAX_AGE_MS: 7 * 24 * 3600 * 1000,
  // cache da lista de checks OBRIGATORIOS de um repo@branch. Ela muda por mudanca de
  // ruleset, que e raro; meia hora e a mesma janela que o fetchRuleBlocked ja usa pra
  // ler o mesmo endpoint, e evita uma chamada gh por PR por ciclo.
  CHECKS_EXIGIDOS_TTL_MS: HORA_MS / 2,
  // memoria do review que ACABOU de sair (dedup da fila de postagem, decision.js).
  // Curta DE PROPOSITO: ela cobre a CORRIDA entre duas vias (10 segundos no caso
  // real do biud-esg#230), e so isso. Passada a janela, quem decide e o dedup
  // remoto de cada via, que sabe o que esta memoria nao sabe: review DISMISSED
  // pelo autor nao conta como postado, entao aprovar de novo no MESMO head e
  // legitimo depois que a aprovacao anterior foi derrubada. Com janela longa a
  // memoria vetaria essa repostagem e o app daria a pendencia por resolvida sem
  // nada ter ido pro PR.
  POSTAGEM_MEMORIA_MS: HORA_MS / 12,  // 5 min
  // Debounce do round automático pós-push: o head precisa estar quieto por esta
  // janela antes de gastar sessão, senão uma rajada de pushes (caso engine-ai#90,
  // 14 commits em ciclos rápidos) viraria uma sessão por push. Na prática o
  // ciclo de polling já espaça; isto garante o mínimo mesmo com polling curto.
  HEAD_QUIETO_MS: 300000,
  // Validade do sinal de "revisão em andamento" (ref git em refs/farol/revisando/,
  // ver lib/engine/review-signal.js). A sessão headless tem teto de 30 min
  // (SESSAO_HEADLESS_MS); 1h dá folga dupla. O TTL vale pros DOIS lados do
  // relógio na leitura: máquina com relógio adiantado não pode produzir ref
  // imortal, então sinal "do futuro" além disto também é ignorado.
  SINAL_REVISAO_TTL_MS: HORA_MS,
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
