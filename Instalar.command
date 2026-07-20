#!/bin/bash
# Farol: instalador macOS (duplo clique no Finder).
# Se o zip nao preservou a permissao de execucao, rode no Terminal:
#   bash Instalar.command
cd "$(dirname "$0")"
bash installer/install.sh
status=$?
echo
read -n 1 -s -r -p 'Pressione qualquer tecla para fechar...'
echo
exit $status
