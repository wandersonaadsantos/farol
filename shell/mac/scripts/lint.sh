#!/usr/bin/env bash
# Confere a formatação do código Swift com o swift-format (modo estrito).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v swift-format >/dev/null 2>&1; then
    echo "erro: swift-format não encontrado (instale com: brew install swift-format)" >&2
    exit 1
fi

swift-format lint --strict --recursive \
    --configuration .swift-format \
    Farol \
    Packages/FarolKit/Package.swift \
    Packages/FarolKit/Sources \
    Packages/FarolKit/Tests
