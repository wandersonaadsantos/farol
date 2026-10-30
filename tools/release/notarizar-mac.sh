#!/usr/bin/env bash
# Farol: notariza e grampeia (staple) um Farol.app ou um .dmg ja assinado com o Developer ID.
#
#   tools/release/notarizar-mac.sh --arquivo <Farol.app | Farol-X.Y.Z.dmg> [--dry-run]
#
# Credenciais do ambiente: NOTARY_PROFILE (perfil do chaveiro) ou APPLE_ID, APPLE_TEAM_ID e
# APPLE_APP_PASSWORD (ver exigir_credenciais_notary em comum-mac.sh).
# O .app vai ao servico zipado pelo `ditto -c -k --keepParent` (o zip nao e grampeavel; o
# ticket e grampeado no proprio .app). O .dmg vai como esta e o ticket e grampeado nele.
# Recusa do servico: busca o log da submissao (`notarytool log <id>`), imprime no stderr e
# sai com erro. Sucesso: imprime no stdout o caminho grampeado.
# --dry-run: imprime os comandos, nao fala com a Apple.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREFIXO=notarizar-mac
SECO=0
# shellcheck source=tools/release/comum-mac.sh
. "$RAIZ/tools/release/comum-mac.sh"

arquivo=""
while [ $# -gt 0 ]; do
  case "$1" in
    --arquivo)
      [ $# -ge 2 ] || falhar "falta o valor de $1"
      arquivo="$2"
      shift 2
      ;;
    --dry-run)
      SECO=1
      shift
      ;;
    *) falhar "argumento desconhecido: $1" ;;
  esac
done

[ -n "$arquivo" ] || falhar 'falta --arquivo <Farol.app | .dmg>'
# no --dry-run do dmg-mac.sh o dmg ainda nao existe: so a linha de comando importa
[ "$SECO" = 1 ] || [ -e "$arquivo" ] || falhar "arquivo ausente: $arquivo"
[ "$(uname -s)" = Darwin ] || falhar 'a notarizacao so roda no macOS.'
exigir_credenciais_notary
if [ "$SECO" = 0 ]; then
  for ferramenta in xcrun ditto plutil; do
    command -v "$ferramenta" > /dev/null 2>&1 || falhar "ferramenta ausente: $ferramenta"
  done
fi

trabalho="$(mktemp -d "${TMPDIR:-/tmp}/farol-notarizar.XXXXXX")"
trap 'rm -rf "$trabalho"' EXIT

case "$arquivo" in
  *.app | *.app/)
    envio="$trabalho/$(basename "${arquivo%/}" .app).zip"
    executar ditto -c -k --keepParent "$arquivo" "$envio"
    ;;
  *.dmg) envio="$arquivo" ;;
  *) falhar "so notarizo .app ou .dmg: $arquivo" ;;
esac

comando=(xcrun notarytool submit "$envio" "${NOTARY_CRED[@]}" --wait --output-format json)
if [ "$SECO" = 1 ]; then
  linha_mascarada "${comando[@]}"
  echo "# se o status nao for Accepted:"
  linha_mascarada xcrun notarytool log '<id da submissao>' "${NOTARY_CRED[@]}"
else
  resposta="$trabalho/submit.json"
  codigo=0
  "${comando[@]}" > "$resposta" || codigo=$?
  id="$(plutil -extract id raw -o - "$resposta" 2> /dev/null || true)"
  status="$(plutil -extract status raw -o - "$resposta" 2> /dev/null || true)"
  if [ "$codigo" != 0 ] || [ "$status" != Accepted ]; then
    aviso "notarizacao recusada (saida $codigo, status '${status:-desconhecido}', id '${id:-desconhecido}')."
    if [ -n "$id" ]; then
      aviso "log da submissao $id:"
      xcrun notarytool log "$id" "${NOTARY_CRED[@]}" >&2 || aviso 'nao consegui baixar o log.'
    else
      cat "$resposta" >&2 || true
    fi
    exit 1
  fi
  aviso "notarizacao aceita ($id)."
fi

executar xcrun stapler staple "$arquivo"
executar xcrun stapler validate "$arquivo"
[ "$SECO" = 1 ] || echo "$arquivo"
