#!/usr/bin/env bash
# Roda os testes do pacote FarolKit e confere que o app Farol compila.
set -euo pipefail
cd "$(dirname "$0")/.."

swift test --package-path Packages/FarolKit
scripts/build.sh
