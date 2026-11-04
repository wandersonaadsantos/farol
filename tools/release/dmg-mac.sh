#!/usr/bin/env bash
# Farol: empacota o Farol.app (ja assinado e grampeado pelo assinar-mac.sh) num .dmg com o
# atalho para /Applications, e assina, notariza e grampeia o .dmg.
#
#   tools/release/dmg-mac.sh --app <Farol.app> [--saida <dir>/Farol-X.Y.Z.dmg] [--dry-run]
#
# X.Y.Z e o CFBundleShortVersionString do app; o appcast-mac.sh le a versao do nome do dmg,
# entao --saida com outra versao no nome e recusada. Padrao: dist/mac/Farol-X.Y.Z.dmg.
# Com MAC_SIGNING_IDENTITY: assina o dmg e notariza (credenciais conferidas ANTES do
# hdiutil). Sem ela: dmg sem assinatura, so para teste local, nunca artefato de release.
# Sucesso: imprime no stdout o caminho do dmg. --dry-run: imprime os comandos e nao cria nada.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREFIXO=dmg-mac
SECO=0
# shellcheck source=tools/release/comum-mac.sh
. "$RAIZ/tools/release/comum-mac.sh"

app=""
saida=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app | --saida)
      [ $# -ge 2 ] || falhar "falta o valor de $1"
      case "$1" in
        --app) app="$2" ;;
        --saida) saida="$2" ;;
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

[ -n "$app" ] || falhar 'falta --app <Farol.app>'
[ "$(uname -s)" = Darwin ] || falhar 'o dmg so se monta no macOS.'
app="${app%/}"
[ -f "$app/Contents/Info.plist" ] || falhar "app sem Contents/Info.plist: $app"
command -v plutil > /dev/null 2>&1 || falhar 'ferramenta ausente: plutil'
versao="$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist" 2> /dev/null)" \
  || falhar "app sem CFBundleShortVersionString: $app"
[[ "$versao" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || falhar "CFBundleShortVersionString malformado: $versao (esperado X.Y.Z)"
nome="Farol-$versao.dmg"
[ -n "$saida" ] || saida="$RAIZ/dist/mac/$nome"
[ "$(basename "$saida")" = "$nome" ] || falhar "a saida tem que se chamar $nome (versao do app), recebi $(basename "$saida")"

assinar=0
if [ -n "${MAC_SIGNING_IDENTITY:-}" ]; then
  assinar=1
  exigir_credenciais_notary
fi
if [ "$SECO" = 0 ]; then
  for ferramenta in hdiutil ditto codesign; do
    command -v "$ferramenta" > /dev/null 2>&1 || falhar "ferramenta ausente: $ferramenta"
  done
fi

palco="$(mktemp -d "${TMPDIR:-/tmp}/farol-dmg.XXXXXX")"
trap 'rm -rf "$palco"' EXIT
executar mkdir -p "$(dirname "$saida")"
executar ditto "$app" "$palco/Farol.app"
executar ln -s /Applications "$palco/Applications"
executar hdiutil create -volname Farol -srcfolder "$palco" -fs HFS+ -format UDZO -ov -quiet "$saida"

if [ "$assinar" = 1 ]; then
  executar codesign --force --sign "$MAC_SIGNING_IDENTITY" --timestamp "$saida"
  if [ "$SECO" = 1 ]; then
    "$RAIZ/tools/release/notarizar-mac.sh" --arquivo "$saida" --dry-run
  else
    "$RAIZ/tools/release/notarizar-mac.sh" --arquivo "$saida" > /dev/null
  fi
else
  aviso 'AVISO: MAC_SIGNING_IDENTITY ausente, dmg SEM assinatura e sem notarizacao. Nunca e artefato de release.'
fi

[ "$SECO" = 1 ] || aviso "dmg pronto: $saida"
[ "$SECO" = 1 ] || echo "$saida"
