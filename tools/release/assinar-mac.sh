#!/usr/bin/env bash
# Farol: assina o Farol.app montado (montar-mac.sh --identidade) com o Developer ID,
# notariza, grampeia e confere com o Gatekeeper.
#
#   tools/release/assinar-mac.sh --app <Farol.app> [--dry-run]
#
# Ambiente: MAC_SIGNING_IDENTITY ("Developer ID Application: Nome (TEAMID)", ja no chaveiro:
# importar o p12 num chaveiro temporario e trabalho do job do CI, nao deste script) e as
# credenciais do notarytool (ver notarizar-mac.sh). Tudo e conferido ANTES de assinar.
#
# Ordem (cada passo depende do anterior):
#   1. o node embutido, com os entitlements DELE (Node.entitlements: allow-jit e o resto
#      que o V8 precisa sob o runtime endurecido); o --deep do passo 2 nao desce em
#      Contents/Resources, entao a assinatura do node sobrevive e e selada como recurso;
#   2. o app inteiro com --deep e Farol.entitlements, o que inclui o Sparkle.framework
#      (XPC services, Autoupdate e Updater.app);
#   3. codesign --verify --deep --strict;
#   4. notarizacao e staple (notarizar-mac.sh);
#   5. spctl --assess --type execute, so DEPOIS do staple: antes dele o Gatekeeper recusa.
# Sucesso: imprime no stdout o caminho do app. --dry-run: imprime os comandos e nao roda nada.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAC="$RAIZ/shell/mac"
PREFIXO=assinar-mac
SECO=0
# shellcheck source=tools/release/comum-mac.sh
. "$RAIZ/tools/release/comum-mac.sh"

app=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app)
      [ $# -ge 2 ] || falhar "falta o valor de $1"
      app="$2"
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
[ "$(uname -s)" = Darwin ] || falhar 'a assinatura do bundle do macOS so roda no macOS.'
exigir_var MAC_SIGNING_IDENTITY
exigir_credenciais_notary
app="${app%/}"
[ -f "$app/Contents/Info.plist" ] || falhar "app sem Contents/Info.plist: $app"
node="$app/Contents/Resources/engine/node/bin/node"
[ -f "$node" ] || falhar "app sem o node embutido: $node (monte com o montar-mac.sh)"
if [ "$SECO" = 0 ]; then
  for ferramenta in codesign spctl xcrun; do
    command -v "$ferramenta" > /dev/null 2>&1 || falhar "ferramenta ausente: $ferramenta"
  done
fi

executar codesign --force --sign "$MAC_SIGNING_IDENTITY" --options runtime --timestamp \
  --entitlements "$MAC/Farol/Node.entitlements" "$node"
executar codesign --force --deep --sign "$MAC_SIGNING_IDENTITY" --options runtime --timestamp \
  --entitlements "$MAC/Farol/Farol.entitlements" "$app"
executar codesign --verify --deep --strict --verbose=2 "$app"

# no --dry-run os comandos dele entram no stdout, na sequencia; de verdade o stdout dele
# e so o caminho grampeado, que este script imprime no fim
if [ "$SECO" = 1 ]; then
  "$RAIZ/tools/release/notarizar-mac.sh" --arquivo "$app" --dry-run
else
  "$RAIZ/tools/release/notarizar-mac.sh" --arquivo "$app" > /dev/null
fi

executar spctl --assess --type execute --verbose=2 "$app"
[ "$SECO" = 1 ] || aviso "assinado, notarizado e aceito pelo Gatekeeper: $app"
[ "$SECO" = 1 ] || echo "$app"
