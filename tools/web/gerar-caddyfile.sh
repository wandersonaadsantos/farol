#!/bin/bash
# Farol, web hospedada: gera o Caddyfile do proxy com TLS a partir de /etc/farol/portas.
# Um bloco por pessoa em <pessoa>.farol.<dominio> (tools/web/Caddyfile.template), montado
# pelo tools/web/caddyfile.js, que le a tabela pelas regras do tools/web/portas.js (o
# unico dono desse formato). Grava ao lado e renomeia, valida com o caddy quando ele
# existe e recarrega o servico.
#
# O dominio vem de --dominio e fica em /etc/farol/dominio (uma linha) para as proximas
# vezes e para o tools/web/smoke.sh; sem --dominio, e lido de la.
# Roda a partir do clone do repositorio na VPS, como root. Nao viaja no pacote.
#
# Uso:
#   sudo bash tools/web/gerar-caddyfile.sh [--dominio <dominio>] [--saida <arquivo>]
# Opcoes:
#   --dominio <dominio>  dominio do Farol (ex.: exemplo.com.br, sites em ana.farol.exemplo.com.br)
#   --saida <arquivo>    onde gravar (padrao /etc/caddy/Caddyfile, que passa a ser do Farol)
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CADDYFILE_JS="$SRC/tools/web/caddyfile.js"
ETC=/etc/farol
PORTAS="$ETC/portas"
DOMINIO_ARQ="$ETC/dominio"

step() { printf '  -> %s\n' "$1"; }
ok()   { printf '     %s\n' "$1"; }
die()  { printf '  x  %s\n' "$1" >&2; exit 1; }
uso()  { sed -n '12,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

DOMINIO=''
SAIDA=/etc/caddy/Caddyfile
while [ $# -gt 0 ]; do
  case "$1" in
    --dominio) [ $# -ge 2 ] || uso; DOMINIO="$2"; shift 2 ;;
    --saida)   [ $# -ge 2 ] || uso; SAIDA="$2"; shift 2 ;;
    *) uso ;;
  esac
done

echo
echo '  Farol . gerar Caddyfile (web hospedada)'
echo '  ======================================='

# --- pre-condicoes ---------------------------------------------------------------
[ "$(uname -s)" = 'Linux' ] || die 'Este script roda so na VPS Linux.'
[ "$(id -u)" -eq 0 ] || die 'Rode como root (sudo bash tools/web/gerar-caddyfile.sh ...).'
for cmd in stat readlink mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || die "Comando ausente: $cmd"
done
[ -f "$CADDYFILE_JS" ] || die "Rode a partir do clone do repositorio (faltou $CADDYFILE_JS)."
[ -f "$PORTAS" ] || die "$PORTAS nao existe: provisione alguem antes (tools/web/provisionar-pessoa.sh)."
if [ -z "$DOMINIO" ]; then
  [ -f "$DOMINIO_ARQ" ] || die "Sem --dominio e sem $DOMINIO_ARQ: passe --dominio <dominio> na primeira vez."
  DOMINIO="$(head -n 1 "$DOMINIO_ARQ")"
fi
# a regra completa do dominio e do caddyfile.js; aqui so o que importa para a linha de comando
[[ "$DOMINIO" =~ ^[a-z0-9.-]+$ ]] || die "Dominio invalido: $DOMINIO"
SAIDA_DIR="$(dirname "$SAIDA")"
[ -d "$SAIDA_DIR" ] || die "Pasta de saida ausente: $SAIDA_DIR (o Caddy esta instalado?)"

# node em que o root confia: o do PATH do root, com o arquivo real pertencendo ao root e
# sem escrita de grupo ou outros (a mesma regra do provisionar-pessoa.sh)
NODE_ROOT="$(command -v node || true)"
[ -n "$NODE_ROOT" ] || die 'node ausente no PATH do root (instale o Node 24 do sistema, ex.: /usr/bin/node).'
NODE_ROOT="$(readlink -f "$NODE_ROOT")"
[ "$(stat -c %u "$NODE_ROOT")" = 0 ] || die "O node do root ($NODE_ROOT) nao pertence ao root; use um node do sistema."
case "$(stat -c %A "$NODE_ROOT")" in ?????w????|????????w?) die "O node do root ($NODE_ROOT) aceita escrita de grupo ou outros." ;; esac

# --- geracao -----------------------------------------------------------------------
step "Gerando $SAIDA para *.farol.$DOMINIO"
# ao lado do destino, para o rename ser atomico; sai sozinho se algo falhar no meio
NOVO="$(mktemp "$SAIDA.XXXXXX")"
trap 'rm -f "$NOVO"' EXIT
"$NODE_ROOT" "$CADDYFILE_JS" "$PORTAS" "$DOMINIO" > "$NOVO" || die 'Geracao recusada (mensagem acima).'
chmod 644 "$NOVO"
ok "$(grep -c '^[a-z0-9].* {$' "$NOVO" || true) pessoa(s)"

CADDY="$(command -v caddy || true)"
if [ -n "$CADDY" ]; then
  step 'Validando com o caddy'
  # validar abre (e cria) os arquivos de log de cada site; como root, nasceriam do root e
  # o servico, que roda como o usuario caddy do pacote, nao conseguiria escrever neles
  VALIDAR=("$CADDY" validate --config "$NOVO" --adapter caddyfile)
  if id caddy >/dev/null 2>&1; then VALIDAR=(runuser -u caddy -- "${VALIDAR[@]}"); fi
  "${VALIDAR[@]}" >/dev/null 2>&1 \
    || { "${VALIDAR[@]}" >&2 || true; die 'O caddy recusou o Caddyfile gerado (nada foi trocado).'; }
  ok 'valido'
else
  ok 'caddy ausente: sem validacao nem recarga'
fi

mv -f "$NOVO" "$SAIDA"
trap - EXIT
ok "gravado em $SAIDA"

# o dominio so e lembrado depois de uma geracao que deu certo
if [ ! -f "$DOMINIO_ARQ" ] || [ "$(head -n 1 "$DOMINIO_ARQ")" != "$DOMINIO" ]; then
  mkdir -p "$ETC"
  printf '%s\n' "$DOMINIO" > "$DOMINIO_ARQ.tmp"
  chmod 644 "$DOMINIO_ARQ.tmp"
  mv -f "$DOMINIO_ARQ.tmp" "$DOMINIO_ARQ"
  ok "dominio lembrado em $DOMINIO_ARQ"
fi

# --- recarga -------------------------------------------------------------------------
if [ -n "$CADDY" ] && [ "$SAIDA" = /etc/caddy/Caddyfile ] && command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet caddy; then
    step 'Recarregando o caddy'
    systemctl reload caddy || die 'systemctl reload caddy falhou. Veja: journalctl -u caddy -n 50'
    ok 'recarregado (os certificados novos saem sozinhos pelo ACME)'
  else
    ok 'servico caddy parado: suba com systemctl enable --now caddy'
  fi
fi

echo
echo "  Pronto. Confira uma pessoa com: sudo bash tools/web/smoke.sh <login>"
echo
