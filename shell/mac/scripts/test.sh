#!/usr/bin/env bash
# Roda os testes do pacote FarolKit e confere que o app Farol compila.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v swift >/dev/null 2>&1; then
    echo "erro: swift não encontrado (instale o Xcode ou as Command Line Tools)" >&2
    exit 1
fi

swift test --package-path Packages/FarolKit
scripts/build.sh
