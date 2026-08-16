#!/bin/bash
# Farol: instalador macOS (duplo clique no Finder).
# Se o zip nao preservou a permissao de execucao, rode no Terminal:
#   bash Instalar.command
cd "$(dirname "$0")"
bash installer/install.sh
status=$?
echo
if [ "$status" -eq 0 ]; then
  # o app instala em ~/Applications, que nao aparece na barra lateral do Finder
  # ("nao acho o app" e a pegadinha nro 1 do mac); oferecer abrir fecha o buraco
  read -n 1 -r -p 'Abrir o Farol agora? (s/n) ' abrir
  echo
  case "$abrir" in [sSyY]) open "$HOME/Applications/Farol.app" ;; esac
else
  read -n 1 -s -r -p 'Pressione qualquer tecla para fechar...'
  echo
fi
exit $status
