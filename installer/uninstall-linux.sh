#!/bin/bash
# Farol: desinstalador Linux. Remove o app, o lancador e o .desktop.
# O estado (workspace) fica, a menos que se passe --remove-data.
set -euo pipefail

ROOT="${FAROL_INSTALL_ROOT:-$HOME/.farol}"

echo
echo '  Farol . desinstalador (Linux)'

pkill -f '\.farol/app' 2>/dev/null || true
sleep 1

rm -rf "$ROOT/app" "$ROOT/bin"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/farol.desktop"

if [ "${1:-}" = '--remove-data' ]; then
  rm -rf "$ROOT"
  echo '  Removido, incluindo dados e estado.'
else
  echo "  Removido. Dados e estado preservados em $ROOT/workspace"
fi
echo
