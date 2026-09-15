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
  // intervalo minimo entre gravacoes do consumo parcial no diario de tentativas
  // (lib/engine/usage-tentativas.js). O fim de cada turno grava sempre; entre turnos,
  // uma sessao que emite dezenas de eventos por segundo nao reescreve o arquivo a cada um.
  TENTATIVA_PARCIAL_MS: 5000,
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
  // Espera LONGA do mesmo debounce (v2.59.3): vale depois de MAX_RODADAS_PRESAS rodadas
  // seguidas que terminaram de novo com commit novo no meio (lib/engine/review.js). O
  // autor ainda está empurrando; meia hora de PR quieto antes de gastar outra sessão,
  // e o round volta sozinho depois dela, sem clique.
  HEAD_QUIETO_LONGO_MS: HORA_MS / 2,
  // Validade do sinal de "revisão em andamento" (ref git em refs/farol/revisando/,
  // ver lib/engine/review-signal.js). A sessão headless tem teto de 30 min
  // (SESSAO_HEADLESS_MS); 1h dá folga dupla. O TTL vale pros DOIS lados do
  // relógio na leitura: máquina com relógio adiantado não pode produzir ref
  // imortal, então sinal "do futuro" além disto também é ignorado.
  SINAL_REVISAO_TTL_MS: HORA_MS,
  // Arbitragem de postagem entre aparelhos (CT-POST, lib/engine/postagem-arbitragem.js).
  // Uma postagem INCERTA só é dada como não enviada com duas leituras da lista de reviews
  // separadas por esta janela e ambas começando esta janela depois da intenção.
  POSTAGEM_RECONCILIACAO_ESPERA_MS: HORA_MS / 60,
  // Folga exigida entre agora e o vencimento da posse antes de cada envio: o POST não sai
  // com uma posse que venceria durante o próprio gh. Metade do batimento do lease.
  POSTAGEM_MARGEM_POSSE_MS: 15 * 1000,
  // Autenticação da API local (A4, spec 2026-09-15-operacao-multidispositivo, 7.A4).
  // Código de pareamento: 10 minutos de vida, uso único.
  PAREAMENTO_VALIDADE_MS: HORA_MS / 6,
  // Sessão autorizada: expira com 30 dias sem uso ou 90 dias desde a criação.
  SESSAO_LOCAL_OCIOSA_MS: 30 * 24 * HORA_MS,
  SESSAO_LOCAL_ABSOLUTA_MS: 90 * 24 * HORA_MS,
  // O último uso só é regravado quando ficou mais velho que isto: sem a folga, toda
  // chamada da API reescreveria o arquivo de sessões.
  SESSAO_LOCAL_TOQUE_MS: HORA_MS,
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

// Sincronização entre dispositivos (Firebase RTDB por REST). Nomes MAIÚSCULOS de
// propósito: `tempoMagico` casa `ttl:`/`timeout:` minúsculos, e o lar do número é aqui.
// LEASE_TTL_MS < LEASE_TTL_MAX_MS: as regras do banco (firebase/database.rules.json)
// recusam expiresAt acima de now + LEASE_TTL_MAX_MS, então um relógio adiantado no
// cliente não produz lease imortal.
const DIA_MS = 24 * HORA_MS;
const SYNC = {
  LEASE_TTL_MS: 120 * 1000,          // validade de um lease sem renovação
  LEASE_TTL_MAX_MS: 300 * 1000,      // teto que as regras aceitam para expiresAt - now
  HEARTBEAT_MS: 30 * 1000,           // renovação do lease (bem abaixo do TTL)
  PRESENCE_TICK_MS: HORA_MS / 12,    // carimbo de lastSeenAt no máximo a cada 5 min
  TOKEN_MARGIN_MS: HORA_MS / 12,     // renova o ID token 5 min antes de vencer
  REQUEST_TIMEOUT_MS: 15 * 1000,     // teto de UMA chamada REST
  STREAM_RECONNECT_MS: 5 * 1000,     // espera mínima antes de reabrir o SSE
  STREAM_RECONNECT_MAX_MS: HORA_MS / 60, // teto do backoff do SSE (1 min)
  STREAM_IDLE_MS: 90 * 1000,         // sem nada no SSE por isto (o banco manda keep-alive a cada ~30 s), a conexão está morta
  ESPERA_ALHEIO_MS: 120 * 1000,      // quanto o toReview pula um PR cujo lease é de outro aparelho
  RECEIPT_TTL_MS: 180 * DIA_MS,      // rede de segurança dos recibos
  ROUNDS_TTL_MS: 8 * DIA_MS,         // poda de dailyRounds
  FAXINA_MS: DIA_MS,                 // retenção do banco (dailyRounds velho, recibo vencido) roda uma vez por dia
  FAXINA_MAX_PRS: 200,               // nós de PR visitados por faxina, pra ela nunca segurar o tick
  ORPHAN_AFTER_MS: 7 * DIA_MS,       // recibo pending/failed de aparelho sem atividade vira "órfão" na tela
  DAILY_ROUNDS_MAX: 3,               // fonte única do teto de rodadas automáticas por PR/dia (review.js lê daqui)
  OUTBOX_BATCH: 50,                  // eventos por PATCH multi-path
  OUTBOX_MAX_REJEICOES: 5,           // recusa do próprio evento (400/413) repetida move para "rejeitado"
  IDENTITY_TOOLKIT_URL: 'https://identitytoolkit.googleapis.com/v1',
  SECURE_TOKEN_URL: 'https://securetoken.googleapis.com/v1/token',
  // emulador do Auth (porta fixada em firebase/firebase.json): ele serve as duas APIs
  // com o host de produção como prefixo de caminho. Só vale com o banco do emulador.
  AUTH_EMULATOR_IDENTITY_URL: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1',
  AUTH_EMULATOR_TOKEN_URL: 'http://127.0.0.1:9099/securetoken.googleapis.com/v1/token',
  CREDENTIALS_FILE: 'sync-credentials.json', // em ~/.farol/, FORA do config.json
  DEVICE_FILE: 'sync-device.json',           // em state/
  OUTBOX_FILE: 'sync-outbox.json',           // em state/
  DAY_TZ: 'America/Sao_Paulo',               // dia canônico do teto compartilhado
};

// Limites da autenticação da API local (A4). Os caminhos moram em lib/paths.js.
const LOCAL_AUTH = {
  CODIGO_TAMANHO: 10,     // caracteres base32 do código de pareamento
  CODIGO_MAX_ERROS: 5,    // tentativas erradas que invalidam o código
  TOKEN_BYTES: 32,        // bytes aleatórios do token de sessão
  ROTULO_MAX: 60,         // tamanho máximo do rótulo descritivo da sessão
};

// Exigência automática no modo celular. Nasce false e só vira true quando a tela de
// pareamento existir (Claude Design, D9) e a detecção for validada num Termux real
// (spec, seção 13). Ligada antes, a interface do celular ficaria trancada sem ter onde
// digitar o código. test/local-auth-modo.test.js trava o valor.
const ATIVACAO_AUTOMATICA_A4 = false;

export default { DEFAULT_PORT, TEMPOS, JIRA, SYNC, LOCAL_AUTH, ATIVACAO_AUTOMATICA_A4 };
export { DEFAULT_PORT, TEMPOS, JIRA, SYNC, LOCAL_AUTH, ATIVACAO_AUTOMATICA_A4 };
