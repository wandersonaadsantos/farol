#!/bin/bash
# Gera assets/farol.icns a partir do maior PNG de assets/png.
# PRECISA rodar num macOS (usa sips e iconutil, nativos do sistema).
# Uso: bash tools/make-icns.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNGDIR="$SRC/assets/png"

command -v sips >/dev/null || { echo 'sips nao encontrado (rode num macOS)'; exit 1; }
command -v iconutil >/dev/null || { echo 'iconutil nao encontrado (rode num macOS)'; exit 1; }

# o maior PNG disponivel como base (hoje: farol-256.png)
BASE="$(ls "$PNGDIR"/farol-*.png 2>/dev/null | sort -t- -k2 -n | tail -1)"
[ -n "$BASE" ] || { echo "nenhum PNG em $PNGDIR"; exit 1; }
echo "base: $BASE"

TMP="$(mktemp -d)/farol.iconset"
mkdir -p "$TMP"
for s in 16 32 64 128 256 512; do
  sips -z "$s" "$s" "$BASE" --out "$TMP/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$BASE" --out "$TMP/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP" -o "$SRC/assets/farol.icns"
echo "ok: $SRC/assets/farol.icns"
echo 'reinstale (bash installer/install.sh) pra levar o icone pro lancador.'
