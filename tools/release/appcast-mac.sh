#!/usr/bin/env bash
# Farol: gera o appcast.xml da Sparkle para o dmg da release, assinado com a chave EdDSA.
#
#   tools/release/appcast-mac.sh --dmg <Farol-X.Y.Z.dmg> --saida <dir>
#                                [--appcast-anterior <appcast.xml publicado>]
#                                [--versao-build <CFBundleVersion>] [--dry-run]
#
# Duas versoes sobem a cada release (regra unica em tools/release/versao-maior.js, a mesma
# comparacao do update do motor): a curta X.Y.Z, do nome do dmg, e o build (CFBundleVersion,
# o sparkle:version pelo qual a Sparkle ORDENA os updates). O build sai do Farol.app dentro
# do dmg, montado so para leitura (`hdiutil attach -readonly -nobrowse`), que tambem confere
# a versao curta do app contra o nome; --versao-build dispensa a montagem. Recusa quando a
# curta nao e maior que a do appcast publicado, ou quando o build nao e maior que o build
# publicado (se o appcast tiver um). Sem --appcast-anterior (primeira release) passa.
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
build=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dmg | --saida | --appcast-anterior | --versao-build)
      [ $# -ge 2 ] || falhar "falta o valor de $1"
      case "$1" in
        --versao-build) build="$2" ;;
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

if [ -z "$build" ]; then
  [ "$(uname -s)" = Darwin ] || falhar 'sem --versao-build preciso montar o dmg, o que so roda no macOS.'
  montagem="$(mktemp -d "${TMPDIR:-/tmp}/farol-appcast-dmg.XXXXXX")"
  hdiutil attach -readonly -nobrowse -noautoopen -quiet -mountpoint "$montagem" "$dmg" \
    || { rmdir "$montagem"; falhar "nao consegui montar o dmg para ler o build: $dmg (ou passe --versao-build)"; }
  plist="$montagem/Farol.app/Contents/Info.plist"
  curta_do_app="$(plutil -extract CFBundleShortVersionString raw -o - "$plist" 2> /dev/null || true)"
  build="$(plutil -extract CFBundleVersion raw -o - "$plist" 2> /dev/null || true)"
  hdiutil detach -quiet "$montagem" || hdiutil detach -quiet -force "$montagem" || true
  rmdir "$montagem" 2> /dev/null || true
  [ -n "$build" ] || falhar "o Farol.app do dmg nao tem CFBundleVersion: $dmg"
  [ "$curta_do_app" = "$versao" ] \
    || falhar "o Farol.app do dmg e a versao ${curta_do_app:-desconhecida}, mas o nome diz $versao"
fi

command -v node > /dev/null 2>&1 || falhar 'ferramenta ausente: node'
regra=(node "$RAIZ/tools/release/versao-maior.js" "$versao" "$build")
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
aviso "appcast pronto para v$versao (build $build): $saida/appcast.xml"
echo "$saida/appcast.xml"
