#!/bin/bash
# Farol: desinstalador macOS. Remove o app e o lancador; o estado (memoria do
# time, seen, config) e preservado por padrao.
# Uso: bash installer/uninstall.sh [--remove-data]
set -uo pipefail

ROOT="$HOME/.farol"

echo
echo '  Farol . desinstalador (macOS)'

pkill -f '\.farol/app' 2>/dev/null || true
sleep 1

rm -rf "$ROOT/app"
rm -rf "$HOME/Applications/Farol.app"

if [ "${1:-}" = "--remove-data" ]; then
  rm -rf "$ROOT"
  echo '  Farol removido, incluindo dados e estado.'
else
  echo "  Farol removido. Estado preservado em $ROOT (use --remove-data pra apagar tudo)."
fi
echo
