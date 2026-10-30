# Farol: pedacos comuns dos scripts de release do macOS (assinar, notarizar, dmg, appcast).
# Carregado com `source`; nao e executavel sozinho. Quem carrega define PREFIXO (o nome
# do script nas mensagens) e SECO (1 no --dry-run).
#
# Segredos vem SO do ambiente e nunca sao impressos: o --dry-run mascara o valor que
# segue --password e qualquer argumento igual a APPLE_APP_PASSWORD ou SPARKLE_PRIVATE_KEY.
# shellcheck shell=bash

falhar() {
  echo "${PREFIXO:-release}: $*" >&2
  exit 1
}

aviso() {
  echo "${PREFIXO:-release}: $*" >&2
}

# exige uma variavel de ambiente nao vazia, nomeando-a na falha (nunca o valor)
exigir_var() {
  [ -n "${!1:-}" ] || falhar "variavel de ambiente ausente: $1"
}

# a linha de comando como o shell a leria, com os segredos trocados por ****
linha_mascarada() {
  local saida="+" mascarar=0 arg
  for arg in "$@"; do
    if [ "$mascarar" = 1 ] \
      || { [ -n "${APPLE_APP_PASSWORD:-}" ] && [ "$arg" = "$APPLE_APP_PASSWORD" ]; } \
      || { [ -n "${SPARKLE_PRIVATE_KEY:-}" ] && [ "$arg" = "$SPARKLE_PRIVATE_KEY" ]; }; then
      saida="$saida ****"
    else
      saida="$saida $(printf '%q' "$arg")"
    fi
    mascarar=0
    [ "$arg" = "--password" ] && mascarar=1
  done
  printf '%s\n' "$saida"
}

# roda o comando, ou no --dry-run so imprime (no stdout) a linha exata que rodaria
executar() {
  if [ "${SECO:-0}" = 1 ]; then
    linha_mascarada "$@"
  else
    "$@"
  fi
}

# Credenciais do notarytool, no array NOTARY_CRED.
# Com NOTARY_PROFILE: --keychain-profile (criado uma vez com `xcrun notarytool
# store-credentials`), e a senha nunca aparece no `ps`. Sem ele: --apple-id, --team-id e
# --password lidos do ambiente. O --password fica visivel no `ps` enquanto o submit roda;
# no runner do CI (efemero, um usuario so) isso e aceitavel, numa maquina compartilhada use
# o perfil do chaveiro. Confere tudo ANTES de qualquer assinatura: falha cedo, nada pela metade.
# NOTARY_CRED e lido por quem carrega este arquivo
# shellcheck disable=SC2034
exigir_credenciais_notary() {
  if [ -n "${NOTARY_PROFILE:-}" ]; then
    NOTARY_CRED=(--keychain-profile "$NOTARY_PROFILE")
    return
  fi
  exigir_var APPLE_ID
  exigir_var APPLE_TEAM_ID
  exigir_var APPLE_APP_PASSWORD
  NOTARY_CRED=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD")
}
