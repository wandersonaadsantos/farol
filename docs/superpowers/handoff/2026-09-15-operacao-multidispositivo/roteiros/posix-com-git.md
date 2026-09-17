# Roteiro: suíte POSIX num contêiner que TEM git

Substitui o `posix-container.sh` (que usava `git archive` e uma imagem sem git) quando o que
se quer é a suíte INTEIRA verde em Linux. A imagem é a de teste dos emuladores
(`tools/emuladores/Dockerfile`), que já traz Node 24, git e bash.

O que roda de dentro do contêiner está em [`posix-com-git-dentro.sh`](posix-com-git-dentro.sh).

## Construir a imagem

    docker build -t farol-posix:teste tools/emuladores

## Rodar a suíte

Sem rede, como usuário comum (uid 1000), sobre um CLONE do repositório montado somente
leitura. Nada é escrito no hospedeiro.

    docker run --rm --name farol-posix --network none --user node \
      -e HOME=/tmp/casa -e RAMO=<seu-ramo> \
      -v "<raiz-do-repositorio>/.git:/fonte-git:ro" \
      -v "<pasta-dos-roteiros>:/roteiro:ro" \
      farol-posix:teste sh /roteiro/posix-com-git-dentro.sh

No Windows, com Git Bash, prefixe `MSYS_NO_PATHCONV=1` e escreva os caminhos do hospedeiro
no formato `C:/...`.

## Por que um CLONE, e não `git archive`

`git archive` entrega a árvore SEM `.git`. Três casos de `test/protocolo-versionado.test.js`
consultam o versionamento (o protocolo do workspace-template está commitado? a config local
de ferramenta continua fora?) e falham com `not a git repository`. A falha é do transporte,
não do sistema operacional, e um clone resolve sem afrouxar nada.

## Critério

`rc=0`. Pulo é aceitável apenas com motivo escrito na saída (`# <motivo>`), e o motivo
precisa ser verdadeiro: caso que não rodou nunca conta como aprovado.
