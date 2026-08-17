// Fonte ÚNICA dos literais de infra (contrato engineering-standards: chave de
// infra e tempo têm nome e UM endereço). Antes a porta 47170 vivia em 6 pontos
// e divergiria em silêncio num ajuste.
const DEFAULT_PORT = 47170;
const TEMPOS = {
  GH_TIMEOUT_MS: 60000,          // teto dos comandos gh/shell (io.run/runShell)
  SESSAO_HEADLESS_MS: 30 * 60 * 1000, // teto de uma revisao headless
  SSE_PING_MS: 25000,            // keepalive do EventSource
  LOG_ROTACAO_BYTES: 2 * 1024 * 1024, // teto do farol.log antes de rotacionar
  AUTO_UPDATE_BACKOFF_MS: 30 * 60 * 1000, // espera entre tentativas de auto-update que FALHARAM, pra nao martelar download a cada ciclo de 30s
  PROVA_ARQUIVO_MAX_AGE_MS: 30 * 24 * 3600 * 1000, // poda da prova por arquivo (state/file-proof): PR morto ha semanas nao herda mais nada
};
export default { DEFAULT_PORT, TEMPOS };
export { DEFAULT_PORT, TEMPOS };
