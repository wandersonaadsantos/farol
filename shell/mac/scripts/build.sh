#!/usr/bin/env bash
# Gera o projeto Xcode (quando preciso) e compila o app Farol em Debug, sem assinatura.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null 2>&1; then
    echo "erro: xcodegen não encontrado (instale com: brew install xcodegen)" >&2
    exit 1
fi

if [ ! -d Farol.xcodeproj ] || [ project.yml -nt Farol.xcodeproj/project.pbxproj ]; then
    xcodegen generate
fi

xcodebuild build \
    -project Farol.xcodeproj \
    -scheme Farol \
    -configuration Debug \
    -destination "generic/platform=macOS" \
    -derivedDataPath DerivedData \
    CODE_SIGNING_ALLOWED=NO
