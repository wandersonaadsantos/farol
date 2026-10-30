#!/usr/bin/env bash
# Farol: baixa o Node oficial que entra no bundle das cascas nativas e confere o hash
# contra o SHASUMS256.txt da mesma versao ANTES de extrair. Hash que nao confere aborta.
#
#   tools/release/baixar-node.sh --plataforma darwin-arm64|darwin-x64|win-x64 --destino <dir>
#                                [--versao X.Y.Z] [--origem <url>]
#
# --versao: padrao e o .nvmrc da raiz. --origem: padrao https://nodejs.org/dist (o teste
# aponta para um servidor local). Do pacote sai SO o binario: <destino>/bin/node no macOS,
# <destino>/node.exe no Windows.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

falhar() {
  echo "baixar-node: $*" >&2
  exit 1
}

versao=""
plataforma=""
destino=""
origem="https://nodejs.org/dist"
while [ $# -gt 0 ]; do
  case "$1" in
    --versao | --plataforma | --destino | --origem)
      [ $# -ge 2 ] || falhar "falta o valor de $1"
      case "$1" in
        --versao) versao="$2" ;;
        --plataforma) plataforma="$2" ;;
        --destino) destino="$2" ;;
        --origem) origem="$2" ;;
      esac
      shift 2
      ;;
    *) falhar "argumento desconhecido: $1" ;;
  esac
done

[ -n "$destino" ] || falhar "falta --destino <dir>"
if [ -z "$versao" ]; then
  versao="$(tr -d '[:space:]' < "$RAIZ/.nvmrc")"
fi
versao="${versao#v}"
[[ "$versao" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || falhar "versao invalida: '$versao' (esperado X.Y.Z)"

case "$plataforma" in
  darwin-arm64 | darwin-x64)
    arquivo="node-v$versao-$plataforma.tar.gz"
    membro="node-v$versao-$plataforma/bin/node"
    saida="bin/node"
    ;;
  win-x64)
    arquivo="node-v$versao-$plataforma.zip"
    membro="node-v$versao-$plataforma/node.exe"
    saida="node.exe"
    ;;
  *) falhar "plataforma invalida: '$plataforma' (aceitas: darwin-arm64, darwin-x64, win-x64)" ;;
esac

if command -v shasum > /dev/null 2>&1; then
  hash_de() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v sha256sum > /dev/null 2>&1; then
  hash_de() { sha256sum "$1" | awk '{print $1}'; }
else
  falhar "nem shasum nem sha256sum disponivel para conferir o hash"
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/farol-node-XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT

base="${origem%/}/v$versao"
curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" \
  || falhar "Node v$versao: SHASUMS256.txt ausente em $base"
curl -fsSL -o "$tmp/$arquivo" "$base/$arquivo" \
  || falhar "Node v$versao: download de $arquivo falhou em $base"

esperado="$(awk -v a="$arquivo" '$2 == a {print $1}' "$tmp/SHASUMS256.txt")"
[ -n "$esperado" ] || falhar "Node v$versao: $arquivo nao aparece no SHASUMS256.txt"
obtido="$(hash_de "$tmp/$arquivo")"
if [ "$esperado" != "$obtido" ]; then
  falhar "Node v$versao: hash de $arquivo nao confere (esperado $esperado, obtido $obtido)"
fi

mkdir -p "$tmp/x"
# a falha da ferramenta (membro ausente, pacote truncado) vira a mensagem do Farol
case "$arquivo" in
  *.tar.gz) tar -xzf "$tmp/$arquivo" -C "$tmp/x" "$membro" 2> /dev/null || true ;;
  *.zip) unzip -q "$tmp/$arquivo" "$membro" -d "$tmp/x" 2> /dev/null || true ;;
esac
[ -f "$tmp/x/$membro" ] || falhar "Node v$versao: $membro ausente dentro de $arquivo (ou pacote ilegivel)"

mkdir -p "$(dirname "$destino/$saida")"
cp "$tmp/x/$membro" "$destino/$saida"
chmod 755 "$destino/$saida"
echo "$destino/$saida"
