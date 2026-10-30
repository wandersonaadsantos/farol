#!/usr/bin/env bash
# Farol: gera o appcast.xml da Sparkle para o dmg da release, assinado com a chave EdDSA.
#
#   tools/release/appcast-mac.sh --dmg <Farol-X.Y.Z.dmg> --saida <dir>
#                                [--appcast-anterior <appcast.xml publicado>] [--dry-run]
#
# Recusa quando X.Y.Z nao e MAIOR que a ultima versao do appcast publicado (regra unica em
# tools/release/versao-maior.js, a mesma comparacao do update do motor). Sem
# --appcast-anterior (primeira release) qualquer versao bem formada passa.
# Copia o dmg e o appcast anterior para <dir> (o generate_appcast estende o appcast.xml que
# acha na pasta, entao o historico se mantem) e roda o generate_appcast de SPARKLE_BIN ou do
# PATH com a URL de download da release v<X.Y.Z>. Sai <dir>/appcast.xml.
#
# SPARKLE_PRIVATE_KEY (ambiente): a chave privada EdDSA, como o generate_keys a exporta.
# Ela vai num arquivo temporario criado com umask 077 e apagado na saida (trap), passado por
# --ed-key-file: nunca na linha de comando, onde o `ps` a mostraria.
# --dry-run: confere a versao, imprime o comando e nao grava a chave nem roda o generate_appcast.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREFIXO=appcast-mac
SECO=0
REPO_DE_RELEASE='https://github.com/wandersonaadsantos/farol/releases/download'
# shellcheck source=tools/release/comum-mac.sh
. "$RAIZ/tools/release/comum-mac.sh"

dmg=""
saida=""
anterior=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dmg | --saida | --appcast-anterior)
      [ $# -ge 2 ] || falhar "falta o valor de $1"
      case "$1" in
        --dmg) dmg="$2" ;;
        --saida) saida="$2" ;;
        --appcast-anterior) anterior="$2" ;;
      esac
      shift 2
      ;;
    --dry-run)
      SECO=1
      shift
      ;;
    *) falhar "argumento desconhecido: $1" ;;
  esac
done

[ -n "$dmg" ] || falhar 'falta --dmg <Farol-X.Y.Z.dmg>'
[ -n "$saida" ] || falhar 'falta --saida <dir>'
[ -f "$dmg" ] || falhar "dmg ausente: $dmg"
nome="$(basename "$dmg")"
[[ "$nome" =~ ^Farol-([0-9]+\.[0-9]+\.[0-9]+)\.dmg$ ]] \
  || falhar "o dmg tem que se chamar Farol-X.Y.Z.dmg (como o dmg-mac.sh gera), recebi $nome"
versao="${BASH_REMATCH[1]}"
if [ -n "$anterior" ]; then
  [ -f "$anterior" ] || falhar "appcast anterior ausente: $anterior"
fi

command -v node > /dev/null 2>&1 || falhar 'ferramenta ausente: node'
regra=(node "$RAIZ/tools/release/versao-maior.js" "$versao")
[ -z "$anterior" ] || regra+=("$anterior")
motivo="$("${regra[@]}" 2>&1)" || falhar "$motivo"

exigir_var SPARKLE_PRIVATE_KEY

gerador=""
if [ -n "${SPARKLE_BIN:-}" ] && [ -x "$SPARKLE_BIN/generate_appcast" ]; then
  gerador="$SPARKLE_BIN/generate_appcast"
elif command -v generate_appcast > /dev/null 2>&1; then
  gerador="$(command -v generate_appcast)"
elif [ "$SECO" = 1 ]; then
  gerador=generate_appcast
  aviso 'generate_appcast nao encontrado (SPARKLE_BIN ou PATH); no --dry-run sigo com o nome.'
else
  falhar 'generate_appcast nao encontrado: defina SPARKLE_BIN (a pasta bin da distribuicao da Sparkle) ou ponha no PATH.'
fi

prefixo_url="$REPO_DE_RELEASE/v$versao/"
if [ "$SECO" = 1 ]; then
  linha_mascarada "$gerador" --ed-key-file '<arquivo temporario com SPARKLE_PRIVATE_KEY>' \
    --download-url-prefix "$prefixo_url" "$saida"
  exit 0
fi

mkdir -p "$saida"
cp "$dmg" "$saida/$nome"
[ -z "$anterior" ] || cp "$anterior" "$saida/appcast.xml"

chave="$(umask 077 && mktemp "${TMPDIR:-/tmp}/farol-sparkle.XXXXXX")"
trap 'rm -f "$chave"' EXIT
printf '%s' "$SPARKLE_PRIVATE_KEY" > "$chave"
"$gerador" --ed-key-file "$chave" --download-url-prefix "$prefixo_url" "$saida" >&2
rm -f "$chave"

[ -f "$saida/appcast.xml" ] || falhar "o generate_appcast nao gerou $saida/appcast.xml"
aviso "appcast pronto para v$versao: $saida/appcast.xml"
echo "$saida/appcast.xml"
