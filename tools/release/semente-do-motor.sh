#!/usr/bin/env bash
# Farol: semente do motor das cascas nativas. Gera o pacote leve pelo tools/make-package.sh
# (mesma lista e mesma auditoria do make-package.ps1) e o extrai em <destino>/engine/app/,
# o leiaute do bundle (<bundle>/engine/app/server.js). Imprime no stdout SO a versao do
# motor; o relato do empacotador vai para o stderr.
#
#   tools/release/semente-do-motor.sh --destino <dir> [--zip <farol-vX.Y.Z.zip>]
#
# --zip reaproveita um pacote ja gerado em vez de empacotar de novo.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

falhar() {
  echo "semente-do-motor: $*" >&2
  exit 1
}

destino=""
zip=""
while [ $# -gt 0 ]; do
  case "$1" in
    --destino) destino="${2:-}"; shift 2 ;;
    --zip) zip="${2:-}"; shift 2 ;;
    *) falhar "argumento desconhecido: $1" ;;
  esac
done
[ -n "$destino" ] || falhar 'falta --destino <dir>'
command -v node > /dev/null 2>&1 || falhar 'Node.js necessario para ler a versao do motor.'

ler_versao() {
  node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$1"
}

if [ -z "$zip" ]; then
  "$RAIZ/tools/make-package.sh" >&2
  zip="${FAROL_DIST:-$RAIZ/dist}/farol-v$(ler_versao "$RAIZ/package.json").zip"
fi
[ -f "$zip" ] || falhar "pacote ausente: $zip"

app="$destino/engine/app"
rm -rf "$app"
mkdir -p "$app"
unzip -q "$zip" -d "$app"
[ -f "$app/server.js" ] || falhar "pacote sem server.js: $zip"
ler_versao "$app/package.json"
echo
