#!/bin/bash
# Farol: desinstalador macOS (duplo clique no Finder). Estado preservado;
# pra apagar tudo: bash installer/uninstall.sh --remove-data
cd "$(dirname "$0")"
bash installer/uninstall.sh
echo
read -n 1 -s -r -p 'Pressione qualquer tecla para fechar...'
echo
