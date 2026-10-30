#!/usr/bin/env bash
# Gera o projeto Xcode e compila o app Farol em Debug, sem assinatura.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodebuild >/dev/null 2>&1; then
    echo "erro: xcodebuild não encontrado (instale o Xcode)" >&2
    exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
    echo "erro: xcodegen não encontrado (instale com: brew install xcodegen)" >&2
    exit 1
fi

# Sempre regenera: o XcodeGen lista os arquivos de Farol/ na hora de gerar, e o projeto não é versionado.
xcodegen generate

xcodebuild build \
    -project Farol.xcodeproj \
    -scheme Farol \
    -configuration Debug \
    -destination "generic/platform=macOS" \
    -derivedDataPath DerivedData \
    CODE_SIGNING_ALLOWED=NO
