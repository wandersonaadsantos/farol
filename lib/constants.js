'use strict';
// Fonte ÚNICA dos literais de infra (contrato engineering-standards: chave de
// infra e tempo têm nome e UM endereço). Antes a porta 47170 vivia em 6 pontos
// e divergiria em silêncio num ajuste.
const DEFAULT_PORT = 47170;
const TEMPOS = {
  GH_TIMEOUT_MS: 60000,          // teto dos comandos gh/shell (io.run/runShell)
  SESSAO_HEADLESS_MS: 30 * 60 * 1000, // teto de uma revisao headless
  SSE_PING_MS: 25000,            // keepalive do EventSource
  LOG_ROTACAO_BYTES: 2 * 1024 * 1024, // teto do farol.log antes de rotacionar
};
module.exports = { DEFAULT_PORT, TEMPOS };
