#!/bin/sh
# Roda a suíte do Farol DENTRO do contêiner, sobre um CLONE do repositório montado somente
# leitura em /fonte-git. O clone existe porque os testes que consultam o versionamento
# (`protocolo-versionado`) precisam de um repositório de verdade: com `git archive` a árvore
# chega sem `.git` e eles falham por transporte, não por POSIX.
#
# Este arquivo é o que roda DE DENTRO. Quem chama está no `posix-com-git.md` ao lado.
# Critério: `rc=0`, e nenhum pulo sem motivo escrito na saída.
set -u
export HOME=/tmp/casa
mkdir -p /tmp/casa
# o clone pertence ao usuário do contêiner, mas o dono do /fonte-git montado pode não bater
git config --global --add safe.directory '*'
git clone --quiet --no-hardlinks --branch "${RAMO:?informe o ramo em RAMO}" /fonte-git /tmp/work || exit 90
cd /tmp/work
echo "node $(node -v), $(git --version), uid $(id -u), fs $(df -T /tmp/work | tail -1 | awk '{print $2}')"
echo "HEAD $(git rev-parse HEAD)"
echo "arvore limpa: $(git status --porcelain | wc -l) alteracoes"
node --test --test-force-exit ${ALVO:-}
rc=$?
echo "rc=$rc"
exit $rc
