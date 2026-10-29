#!/bin/bash
# Farol, web hospedada: smoke de UMA pessoa pelo proxy com TLS, de ponta a ponta.
# Fala so com https://<pessoa>.farol.<dominio> (o dominio vem de --dominio ou de
# /etc/farol/dominio, gravado pelo tools/web/gerar-caddyfile.sh) e confere:
#   1. GET / da 200 com o index.html da tela (o <script> do /app.js);
#   2. GET /api/state sem token da 401;
#   3. POST com Origin alheio leva 403 do proprio Caddy, e com a origem da pessoa nao;
#   4. GET /api/events com token recebe event: ping em ate 30 s (SSE sem buffer);
#   5. o log do Caddy da pessoa nao tem token=, nem o token, nem o codigo de pareamento.
#
# O token vem de FAROL_SMOKE_TOKEN; sem ele, o smoke gera um codigo de pareamento COMO a
# pessoa (tools/farol-parear.js, com o node da unidade dela), pareia pelo proxy com o
# rotulo "smoke" e revoga essa sessao no fim. Codigo e token nunca vao para URL, linha
# de comando (o curl le os dois do stdin, com -K -), log ou tela.
# Roda na VPS, como root (gera o codigo como a pessoa e le o log do Caddy).
#
# Uso:
#   sudo bash tools/web/smoke.sh <login> [--dominio <dominio>] [--resolve <ip>]
# Opcoes:
#   --dominio <dominio>  dominio do Farol; sem ele, o de /etc/farol/dominio
#   --resolve <ip>       fala com este IP no lugar do DNS (o certificado continua conferido)
set -euo pipefail

DOMINIO_ARQ=/etc/farol/dominio

die()    { printf '  x  %s\n' "$1" >&2; exit 1; }
uso()    { sed -n '17,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }
FALHAS=0
passou() { printf '  ok %s\n' "$1"; }
falhou() { printf '  x  %s\n' "$1" >&2; FALHAS=$((FALHAS + 1)); }

LOGIN=''
DOMINIO=''
IP=''
while [ $# -gt 0 ]; do
  case "$1" in
    --dominio) [ $# -ge 2 ] || uso; DOMINIO="$2"; shift 2 ;;
    --resolve) [ $# -ge 2 ] || uso; IP="$2"; shift 2 ;;
    -*) uso ;;
    *) [ -z "$LOGIN" ] || uso; LOGIN="$1"; shift ;;
  esac
done
[ -n "$LOGIN" ] || uso

echo
echo "  Farol . smoke de $LOGIN (web hospedada)"
echo '  ========================================'

# --- pre-condicoes ----------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die 'Rode como root (sudo bash tools/web/smoke.sh <login>).'
command -v curl >/dev/null 2>&1 || die 'curl ausente.'
[[ "$LOGIN" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]] || die "Login invalido como subdominio: $LOGIN"
if [ -z "$DOMINIO" ]; then
  [ -f "$DOMINIO_ARQ" ] || die "Sem --dominio e sem $DOMINIO_ARQ (rode o gerar-caddyfile.sh antes)."
  DOMINIO="$(head -n 1 "$DOMINIO_ARQ")"
fi
[[ "$DOMINIO" =~ ^[a-z0-9.-]+$ ]] || die "Dominio invalido: $DOMINIO"
HOST="$LOGIN.farol.$DOMINIO"
BASE="https://$HOST"
LOG="/var/log/caddy/farol-$LOGIN.log"

CURL=(curl -sS --proto "=https")
if [ -n "$IP" ]; then CURL+=(--resolve "$HOST:443:$IP"); fi

TMP="$(mktemp -d)"
TOKEN="${FAROL_SMOKE_TOKEN:-}"
CODIGO=''
SESSAO_DO_SMOKE=0
# shellcheck disable=SC2329 # chamada pelo trap EXIT
limpar() {
  # sessao aberta pelo smoke e revogada mesmo quando ele para no meio
  if [ "$SESSAO_DO_SMOKE" -eq 1 ]; then revogar >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap limpar EXIT

# pedir <arquivo do corpo> <argumentos do curl...>: imprime so o codigo HTTP (000 sem resposta)
pedir() {
  local corpo="$1"
  shift
  "${CURL[@]}" --max-time 15 -o "$corpo" -w '%{http_code}' "$@" || true
}
# o cabecalho do token vai pelo stdin do curl (-K -), nunca pela linha de comando
com_token() { printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"; }

revogar() {
  local id
  com_token | pedir "$TMP/sessoes" -K - -X POST -H 'x-farol: 1' "$BASE/api/auth/sessions" >/dev/null
  id="$(grep -o '"id":"[0-9a-f]\{16\}"[^}]*"atual":true' "$TMP/sessoes" | sed -n 's/^"id":"\([0-9a-f]*\)".*/\1/p' | head -n 1)"
  [ -n "$id" ] || return 1
  com_token | pedir "$TMP/revogou" -K - -X POST -H 'x-farol: 1' -H 'content-type: application/json' \
    --data "{\"id\":\"$id\"}" "$BASE/api/auth/revoke" >/dev/null
  grep -q '"ok":true' "$TMP/revogou"
}

# --- 1. a tela --------------------------------------------------------------------------
codigo="$(pedir "$TMP/index" "$BASE/")"
if [ "$codigo" = 200 ] && grep -qF '<script type="module" src="/app.js">' "$TMP/index"; then
  passou "GET / da 200 com o index.html"
else
  falhou "GET / deu $codigo (esperado 200 com o <script> do /app.js)"
fi

# --- 2. sem token ---------------------------------------------------------------------
codigo="$(pedir "$TMP/state" "$BASE/api/state")"
if [ "$codigo" = 401 ]; then passou 'GET /api/state sem token da 401'; else falhou "GET /api/state sem token deu $codigo (esperado 401)"; fi
# uma query com cara de credencial, para provar que o log corta a query string (passo 5)
pedir "$TMP/query" "$BASE/api/state?token=smoke-nao-e-segredo" >/dev/null

# --- 3. Origin na borda ----------------------------------------------------------------
codigo="$(pedir "$TMP/alheio" -X POST -H 'x-farol: 1' -H 'Origin: https://evil.example' "$BASE/api/check")"
if [ "$codigo" = 403 ] && [ ! -s "$TMP/alheio" ]; then
  passou 'POST com Origin alheio leva 403 do Caddy (corpo vazio, o motor nem viu)'
else
  falhou "POST com Origin alheio deu $codigo (esperado 403 do Caddy, sem corpo do motor)"
fi
codigo="$(pedir "$TMP/proprio" -X POST -H 'x-farol: 1' -H "Origin: $BASE" "$BASE/api/check")"
if [ "$codigo" = 401 ]; then
  passou 'POST com a origem da pessoa passa a borda e o motor (401 sem token)'
else
  falhou "POST com a origem da pessoa deu $codigo (esperado 401 do motor; 403 e o Origin barrado)"
fi

# --- 4. token e SSE ---------------------------------------------------------------------
if [ -z "$TOKEN" ]; then
  CASA="$(getent passwd "$LOGIN" | cut -d: -f6 || true)"
  [ -n "$CASA" ] || die "Usuario $LOGIN nao existe nesta maquina (ou passe FAROL_SMOKE_TOKEN)."
  # o node e o mesmo da unidade da pessoa; lido e executado COMO ela
  NODE="$(sudo -u "$LOGIN" cat "$CASA/.config/systemd/user/farol.service" | sed -n 's|^ExecStart=\([^ ]*\) .*|\1|p' | head -n 1)"
  [ -n "$NODE" ] || die "Sem ExecStart na unidade de $LOGIN (provisionada?)."
  SAIDA_PAREAR="$(sudo -u "$LOGIN" -H env FAROL_HOME="$CASA/.farol" "$NODE" "$CASA/.farol/app/tools/farol-parear.js")" \
    || die 'farol-parear.js falhou.'
  CODIGO="$(printf '%s\n' "$SAIDA_PAREAR" | sed -n 's/^C.*digo de pareamento: \([A-Z2-7]\{1,64\}\)$/\1/p' | head -n 1)"
  SAIDA_PAREAR=''
  [ -n "$CODIGO" ] || die 'Saida do farol-parear.js sem a linha do codigo.'
  printf 'data = "{\\"codigo\\":\\"%s\\",\\"rotulo\\":\\"smoke\\"}"\n' "$CODIGO" \
    | pedir "$TMP/par" -K - -X POST -H 'x-farol: 1' -H 'content-type: application/json' "$BASE/api/auth/pair" >/dev/null
  TOKEN="$(sed -n 's/.*"token":"\([A-Za-z0-9_-][A-Za-z0-9_-]*\)".*/\1/p' "$TMP/par")"
  rm -f "$TMP/par"
  [ -n "$TOKEN" ] || die 'O pareamento pelo proxy nao devolveu token.'
  SESSAO_DO_SMOKE=1
  passou 'pareado pelo proxy (sessao "smoke", revogada no fim)'
fi
[[ "$TOKEN" =~ ^[A-Za-z0-9_-]+$ ]] || die 'FAROL_SMOKE_TOKEN fora do formato do token.'

# o motor manda ping a cada 25 s; o curl corta em 30 (saida 28 e o esperado)
{ printf 'header = "x-farol: 1"\n'; com_token; } \
  | "${CURL[@]}" -N --max-time 30 -K - -o "$TMP/sse" "$BASE/api/events" 2>/dev/null || true
if grep -q '^event: ping' "$TMP/sse"; then
  passou 'GET /api/events com token recebe event: ping em ate 30 s'
else
  falhou 'GET /api/events nao recebeu event: ping em 30 s (buffer no proxy? token recusado?)'
fi
rm -f "$TMP/sse"

if [ "$SESSAO_DO_SMOKE" -eq 1 ]; then
  if revogar; then passou 'sessao "smoke" revogada'; else falhou 'nao consegui revogar a sessao "smoke" (Sistema > Seguranca)'; fi
  SESSAO_DO_SMOKE=0
fi

# --- 5. o log ----------------------------------------------------------------------------
if [ -r "$LOG" ]; then
  # os segredos vao ao grep por arquivo (-f), nunca por argumento
  printf '%s\n' "$TOKEN" > "$TMP/segredos"
  [ -z "$CODIGO" ] || printf '%s\n' "$CODIGO" >> "$TMP/segredos"
  if grep -qF 'token=' "$LOG"; then
    falhou "$LOG tem token= (a query string nao foi cortada)"
  elif grep -qF -f "$TMP/segredos" "$LOG"; then
    falhou "$LOG tem o token ou o codigo de pareamento"
  else
    passou "$LOG sem token=, sem token e sem codigo"
  fi
  rm -f "$TMP/segredos"
else
  falhou "$LOG ausente ou ilegivel (o Caddyfile foi gerado e recarregado?)"
fi
TOKEN=''
CODIGO=''

echo
if [ "$FALHAS" -eq 0 ]; then
  echo "  Smoke verde: $BASE"
  echo
  exit 0
fi
echo "  Smoke vermelho: $FALHAS falha(s) em $BASE" >&2
echo
exit 1
