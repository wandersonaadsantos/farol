#!/usr/bin/env sh
# Roda a suíte do Farol num Linux isolado, SEM rede e como usuário comum, a partir da
# árvore commitada (git archive), com os arquivos no sistema de arquivos do container
# (onde chmod tem semântica real). Prova POSIX de Linux; NÃO vale como prova de
# Android/Termux.
#
# Uso: sh roteiros/posix-container.sh <imagem-node-24> [arquivos de teste...]
# Critério: 0 falhas fora dos testes que dependem de git (a imagem node:alpine não tem
# git) e nenhum teste de permissão 0600 pulado.
set -eu
IMAGEM="${1:?informe a imagem do Node 24 (ex.: o id da imagem node local)}"
shift || true
ALVO="${*:-}"
git archive HEAD | docker run --rm -i --network none --user node -e HOME=/tmp/casa "$IMAGEM" sh -c "
  mkdir -p /tmp/casa /tmp/work && tar -x -C /tmp/work && cd /tmp/work &&
  echo \"node \$(node -v), uid \$(id -u), fs \$(df -T /tmp/work | tail -1 | awk '{print \$2}')\" &&
  node --test --test-force-exit $ALVO 2>&1 | grep -E '^ℹ (tests|pass|fail|cancelled|skipped)|^✖'
"
