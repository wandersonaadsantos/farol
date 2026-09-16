# Ambiente ISOLADO de teste das regras do banco e da bancada de aparelhos, com os emuladores
# oficiais do Firebase. Nada daqui entra no pacote do Farol: é infraestrutura de teste, e o
# contêiner não recebe credencial nem projeto real (só projetos `demo-*`).
#
# Construção (a partir da raiz do repositório):
#   docker build -t farol-emuladores:15.30.1 tools/emuladores
FROM node:24-trixie-slim

# Java para o emulador do Realtime Database; git para a suíte POSIX do Farol
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jre-headless git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Firebase CLI oficial, versão fixada
RUN npm install -g firebase-tools@15.30.1 \
 && firebase --version

# A suíte POSIX instala um `claude` FALSO (script de teste, nunca o CLI de verdade) num
# diretório que o shell de login enxergue, senão os casos do teste de perfil de assinatura
# ficam pulados: `/bin/sh -lc` reescreve o PATH e o falso de pasta temporária some. No PATH de
# login do Debian o primeiro diretório é `/usr/local/bin`, então ele é entregue ao usuário do
# teste. Vale só nesta imagem de teste; nada disto entra no pacote do Farol.
RUN chown node:node /usr/local/bin

# o contêiner roda como `node`: o binário do emulador do banco é baixado para ESSE usuário,
# na construção, para a execução não depender de rede
USER node
WORKDIR /home/node
RUN firebase setup:emulators:database
WORKDIR /farol
