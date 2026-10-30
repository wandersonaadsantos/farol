#!/usr/bin/env bash
# Farol: monta o Farol.app com o motor e o Node dentro, no leiaute que o EngineLocator le:
#   Contents/Resources/engine/app/server.js      (a semente do motor, o pacote leve)
#   Contents/Resources/engine/node/bin/node      (Node oficial universal, arm64 + x86_64)
#   Contents/Resources/engine/VERSAO             (a versao do motor, do package.json da semente)
#
#   tools/release/montar-mac.sh [--app <Farol.app ja compilado>] [--semente <dir com engine/app>]
#                               [--node-arm64 <bin/node>] [--node-x64 <bin/node>]
#                               [--chave-publica <SUPublicEDKey>] [--identidade <Developer ID>]
#                               [--saida <dir>]
#
# Sem --app: xcodegen + xcodebuild archive em Release universal, sem assinatura.
# Sem --semente: tools/release/semente-do-motor.sh em <saida>/semente.
# Sem --node-*: tools/release/baixar-node.sh em <saida>/node-<arch> (hash conferido).
# Sem --identidade: assina AD HOC (abre nesta maquina, nunca e artefato de release).
# Com --identidade: NAO assina; quem assina com o Developer ID e o assinar-mac.sh. E build
# de distribuicao, entao exige --chave-publica nao vazia: sem a SUPublicEDKey a Sparkle
# fica desligada e o app notarizado nunca mais recebe update.
# --saida: padrao dist/mac. O bundle sai em <saida>/Farol.app.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAC="$RAIZ/shell/mac"

falhar() {
  echo "montar-mac: $*" >&2
  exit 1
}

app=""
semente=""
node_arm64=""
node_x64=""
chave=""
identidade=""
saida="$RAIZ/dist/mac"
while [ $# -gt 0 ]; do
  case "$1" in
    --app | --semente | --node-arm64 | --node-x64 | --chave-publica | --identidade | --saida)
      [ $# -ge 2 ] || falhar "falta o valor de $1"
      case "$1" in
        --app) app="$2" ;;
        --semente) semente="$2" ;;
        --node-arm64) node_arm64="$2" ;;
        --node-x64) node_x64="$2" ;;
        --chave-publica) chave="$2" ;;
        --identidade) identidade="$2" ;;
        --saida) saida="$2" ;;
      esac
      shift 2
      ;;
    *) falhar "argumento desconhecido: $1" ;;
  esac
done

if [ -n "$identidade" ] && [ -z "$chave" ]; then
  falhar 'com --identidade (build de distribuicao) a --chave-publica e obrigatoria e nao pode ser vazia: sem a SUPublicEDKey o app sai sem update da Sparkle (confira o secret SPARKLE_PUBLIC_ED_KEY).'
fi
[ "$(uname -s)" = Darwin ] || falhar 'o bundle do macOS so se monta no macOS.'
for ferramenta in ditto lipo codesign plutil; do
  command -v "$ferramenta" > /dev/null 2>&1 || falhar "ferramenta ausente: $ferramenta"
done
mkdir -p "$saida"
saida="$(cd "$saida" && pwd)"

if [ -z "$app" ]; then
  command -v xcodebuild > /dev/null 2>&1 || falhar 'xcodebuild nao encontrado (instale o Xcode).'
  command -v xcodegen > /dev/null 2>&1 || falhar 'xcodegen nao encontrado (brew install xcodegen).'
  rm -rf "$saida/Farol.xcarchive"
  (
    cd "$MAC"
    xcodegen generate
    xcodebuild archive \
      -project Farol.xcodeproj \
      -scheme Farol \
      -configuration Release \
      -destination 'generic/platform=macOS' \
      -derivedDataPath DerivedData \
      -archivePath "$saida/Farol.xcarchive" \
      ARCHS='arm64 x86_64' \
      ONLY_ACTIVE_ARCH=NO \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGN_IDENTITY= \
      CODE_SIGNING_REQUIRED=NO
  ) >&2
  app="$saida/Farol.xcarchive/Products/Applications/Farol.app"
fi
if [ -z "$semente" ]; then
  semente="$saida/semente"
  "$RAIZ/tools/release/semente-do-motor.sh" --destino "$semente" > /dev/null
fi
for arch in arm64 x64; do
  var="node_$arch"
  if [ -z "${!var}" ]; then
    "$RAIZ/tools/release/baixar-node.sh" --plataforma "darwin-$arch" --destino "$saida/node-$arch" >&2
    printf -v "$var" '%s' "$saida/node-$arch/bin/node"
  fi
done

# confere tudo ANTES de tocar na saida: entrada faltando nao deixa bundle meio montado
[ -f "$app/Contents/Info.plist" ] || falhar "app sem Contents/Info.plist: $app"
[ -f "$semente/engine/app/server.js" ] || falhar "semente sem engine/app/server.js: $semente"
[ -f "$semente/engine/app/package.json" ] || falhar "semente sem engine/app/package.json: $semente"
[ -f "$node_arm64" ] || falhar "node arm64 ausente: $node_arm64"
[ -f "$node_x64" ] || falhar "node x64 ausente: $node_x64"
versao="$(plutil -extract version raw -o - "$semente/engine/app/package.json")" \
  || falhar "semente sem version no package.json: $semente"

montando="$saida/.montando"
rm -rf "$montando"
mkdir -p "$montando"
trap 'rm -rf "$montando"' EXIT
destino="$montando/Farol.app"
ditto "$app" "$destino"

engine="$destino/Contents/Resources/engine"
# o --app pode ser um bundle ja montado: o engine dele sai inteiro antes, senao a semente
# nova se mesclaria com arquivos da anterior
rm -rf "$engine"
mkdir -p "$engine/node/bin"
ditto "$semente/engine/app" "$engine/app"
lipo -create "$node_arm64" "$node_x64" -output "$engine/node/bin/node"
chmod 755 "$engine/node/bin/node"
printf '%s\n' "$versao" > "$engine/VERSAO"

if [ -n "$chave" ]; then
  plist="$destino/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :SUPublicEDKey $chave" "$plist" 2> /dev/null \
    || /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $chave" "$plist"
fi

if [ -z "$identidade" ]; then
  # o node primeiro, com os entitlements dele; depois o app, que sela o node como recurso
  codesign --force --sign - --entitlements "$MAC/Farol/Node.entitlements" "$engine/node/bin/node"
  codesign --force --deep --sign - --entitlements "$MAC/Farol/Farol.entitlements" "$destino"
  echo 'montar-mac: AVISO: bundle assinado AD HOC, so abre nesta maquina. Nunca e artefato de release.' >&2
else
  echo "montar-mac: bundle montado SEM assinatura; assine com o assinar-mac.sh ($identidade)." >&2
fi

rm -rf "$saida/Farol.app"
mv "$destino" "$saida/Farol.app"
echo "montar-mac: $saida/Farol.app (motor $versao)" >&2
echo "$saida/Farol.app"
