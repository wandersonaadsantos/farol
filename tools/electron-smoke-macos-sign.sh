#!/bin/bash
# Assinatura exclusiva do teste em runner efemero. Nao assina distribuicao.
# Derivado do helper/CI do Electron v44.1.0: keychain do usuario, sem TCC
# nem alteracao de confianca. UNUserNotificationCenter exige bundle assinado.
# https://github.com/electron/electron/blob/v44.1.0/script/codesign/generate-identity.sh
set +x
set -euo pipefail

die() { printf '%s\n' "$1" >&2; exit 1; }
[ "${CI:-}" = true ] && [ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_OS:-}" = macOS ] && [ "$(uname -s)" = Darwin ] ||
  die 'Assinatura de teste permitida somente no job macOS do GitHub Actions.'
[ -n "${GITHUB_WORKSPACE:-}" ] && [ -d "$GITHUB_WORKSPACE" ] && [ -n "${RUNNER_TEMP:-}" ] && [ -d "$RUNNER_TEMP" ] ||
  die 'Checkout e temporario do runner sao obrigatorios.'
root=$(cd "$(dirname "$0")/.." && pwd -P)
[ "$root" = "$(cd "$GITHUB_WORKSPACE" && pwd -P)" ] || die 'O wrapper deve pertencer ao checkout do job.'
bundle="$root/node_modules/electron/dist/Electron.app"
[ -d "$bundle" ] && [ ! -L "$bundle" ] || die 'Electron.app deve existir no checkout, sem symlink externo.'
[ "$(cd "$bundle" && pwd -P)" = "$bundle" ] || die 'Electron.app deve estar fisicamente dentro do checkout.'
cd "$root"
umask 077
stage=$(mktemp -d "$(cd "$RUNNER_TEMP" && pwd -P)/farol-smoke-sign.XXXXXX")
keychain="$stage/test.keychain-db"
created=false
list_changed=false
old_keychains=()
old_count=0

cleanup() {
  result=$?
  trap - EXIT INT TERM
  set +e
  if [ "$list_changed" = true ]; then
    if [ "$old_count" -gt 0 ]; then
      security list-keychains -d user -s "${old_keychains[@]}" >/dev/null 2>&1
    else
      security list-keychains -d user -s >/dev/null 2>&1
    fi
    if [ "$?" -ne 0 ]; then printf '%s\n' 'Falha ao restaurar a lista de keychains do usuario.' >&2; [ "$result" -ne 0 ] || result=1; fi
  fi
  if [ "$created" = true ]; then
    if ! security delete-keychain "$keychain" >/dev/null 2>&1; then
      printf '%s\n' 'Falha ao remover o keychain temporario do teste.' >&2
      [ "$result" -ne 0 ] || result=1
    fi
  fi
  # stage veio exclusivamente de mktemp dentro de RUNNER_TEMP.
  if ! rm -rf -- "$stage"; then [ "$result" -ne 0 ] || result=1; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Ler a lista sem eval nem word splitting: caminhos de keychain podem ter espacos.
security list-keychains -d user > "$stage/original-keychains"
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [ -n "$line" ] || continue
  case "$line" in \"*\") old_keychains+=("${line:1:${#line}-2}"); old_count=$((old_count + 1));; *) die 'Lista de keychains inesperada.';; esac
done < "$stage/original-keychains"

cat > "$stage/codesign.cnf" <<EOF
[req]
default_md = sha512
distinguished_name = identity
prompt = no
[identity]
O = Farol CI
OU = Temporary runtime smoke
CN = FarolSmoke-${stage##*/}
[extended]
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
openssl req -new -newkey rsa:2048 -x509 -days 1 -nodes -config "$stage/codesign.cnf" -extensions extended -batch \
  -out "$stage/certificate.cer" -keyout "$stage/certificate.key" >/dev/null 2>&1 || die 'Falha ao gerar identidade temporaria.'
password=$(openssl rand -hex 24)
[ -n "$password" ] || die 'Senha temporaria ausente.'
# Nunca imprimir comandos que recebem senha ou chave privada.
# create-keychain tambem pode incluir a chave na lista de busca.
list_changed=true
security create-keychain -p "$password" "$keychain" >/dev/null 2>&1 || die 'Falha ao criar keychain temporario.'
created=true
security set-keychain-settings -t 3600 -u "$keychain" >/dev/null 2>&1
security unlock-keychain -p "$password" "$keychain" >/dev/null 2>&1
if [ "$old_count" -gt 0 ]; then
  security list-keychains -d user -s "$keychain" "${old_keychains[@]}" >/dev/null 2>&1
else
  security list-keychains -d user -s "$keychain" >/dev/null 2>&1
fi
security import "$stage/certificate.cer" -k "$keychain" -T /usr/bin/codesign >/dev/null 2>&1
security import "$stage/certificate.key" -k "$keychain" -T /usr/bin/codesign -A >/dev/null 2>&1
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null 2>&1
unset password
identity=$(openssl x509 -in "$stage/certificate.cer" -noout -fingerprint -sha1 | sed 's/.*=//;s/://g')
[[ "$identity" =~ ^[[:xdigit:]]{40}$ ]] || die 'Fingerprint de assinatura ausente ou invalido.'
security find-identity -p codesigning "$keychain" > "$stage/identities"
grep -Fq "$identity" "$stage/identities" || die 'Identidade de assinatura nao foi importada.'
codesign --sign "$identity" --keychain "$keychain" --deep --force "$bundle"
codesign --verify --deep --strict "$bundle"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$bundle"

# O keychain continua disponivel ate os processos terminarem. Qualquer falha
# preserva seu exit code; a assinatura nao substitui autorizacao nem evento show.
node --test --test-force-exit test/jira-mcp-processo.test.js
node tools/electron-smoke.js --output artifacts/electron-smoke
