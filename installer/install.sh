#!/bin/bash
# Farol: instalador macOS. Copia o app para ~/.farol/app, prepara o workspace
# do Claude e cria o lancador ~/Applications/Farol.app.
# Uso: bash installer/install.sh
#
# ATENCAO: portado do install.ps1 (Windows) sem um Mac real pra testar.
# Se algo falhar, o docs/MACOS.md (na fonte e em ~/.farol/app/docs) explica o
# desenho e o checklist de validacao.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ROOT="$HOME/.farol"
APP="$ROOT/app"
WS="$ROOT/workspace"
BUNDLE="$HOME/Applications/Farol.app"

step() { printf '  -> %s\n' "$1"; }
ok()   { printf '     %s\n' "$1"; }
die()  { printf '  x  %s\n' "$1"; exit 1; }

for destino in "$APP" "$BUNDLE" "$WS/.claude" "$WS/prompts"; do
  DEST_REAL="$destino"
  if [ -d "$destino" ]; then DEST_REAL="$(cd "$destino" && pwd -P)"; fi
  case "$SRC/" in
    "$DEST_REAL/"*) die 'Execute a partir de um repositorio fora da instalacao existente.' ;;
  esac
done


echo
echo '  Farol . instalador (macOS)'
echo '  =========================='

# apps de linha de comando do Homebrew etc. quando rodando fora do shell de login
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH

# --- pre-requisitos -----------------------------------------------------------
# Electron 44 exige Ventura; a verificacao precede pkill, copias e downloads
# para um update em Mac antigo nao desmontar a instalacao que ainda funciona.
[ "$(uname -s)" = 'Darwin' ] || die 'Use este instalador em macOS 13 (Ventura) ou posterior.'
MACOS_VERSION="$(sw_vers -productVersion 2>/dev/null || true)"
MACOS_MAJOR="${MACOS_VERSION%%.*}"
case "$MACOS_MAJOR" in
  ''|*[!0-9]*) die 'Nao foi possivel confirmar macOS 13 (Ventura) ou posterior. A instalacao existente foi preservada.' ;;
esac
[ "$MACOS_MAJOR" -ge 13 ] || die 'O Farol requer macOS 13 (Ventura) ou posterior (Electron 44). A instalacao existente foi preservada.'
case "$(uname -m)" in
  x86_64) TARGET_ARCH=x64 ;;
  arm64) TARGET_ARCH=arm64 ;;
  *) die 'O Farol requer Mac Intel (x64) ou Apple Silicon (arm64). A instalacao existente foi preservada.' ;;
esac

# Node/npm NAO sao exigidos aqui (mesma promessa do install.ps1): o modo offline
# (Electron no pacote ou zip darwin embutido) instala sem Node; so o fallback de
# rede (npm install) cobra, la embaixo. Exigir aqui derrubava o instalador
# offline E o auto-update em Mac sem Node.
command -v gh >/dev/null 2>&1 || echo "  !  'gh' nao encontrado: o Farol instala, mas precisa dele (brew install gh; gh auth login)."
command -v claude >/dev/null 2>&1 || echo "  !  'claude' nao encontrado: o Farol instala, mas precisa do Claude Code no PATH."

# --- runtime antes de alterar a instalacao -------------------------------------
source "$SRC/installer/electron-runtime.sh"
incluir_npm_de_gerenciador
preparar_runtime 'electron/dist/Electron.app/Contents/MacOS/Electron' "$SRC/installer/electron-darwin.zip"

LIVE_APP="$APP"
LIVE_WS="$WS"
mkdir -p "$ROOT" "$HOME/Applications"
STAGE="$(mktemp -d "$ROOT/.farol-instalar.XXXXXX")"
BUNDLE_STAGE=''
NEW_APP=0
NEW_BUNDLE=0
NEW_WORKSPACE=''
COMMITTED=0
cleanup() {
  result=$?
  trap - EXIT
  if [ "$COMMITTED" -eq 0 ]; then
    for item in $NEW_WORKSPACE; do rm -rf "${LIVE_WS:?}/$item"; done
    for item in CLAUDE.md .claude prompts; do
      [ ! -e "$STAGE/workspace-anterior/$item" ] || mv "$STAGE/workspace-anterior/$item" "$LIVE_WS/$item"
    done
    [ "$NEW_BUNDLE" -eq 0 ] || rm -rf "$BUNDLE"
    [ "$NEW_APP" -eq 0 ] || rm -rf "$LIVE_APP"
    [ ! -e "$STAGE/anterior" ] || mv "$STAGE/anterior" "$LIVE_APP"
    if [ -n "$BUNDLE_STAGE" ] && [ -e "$BUNDLE_STAGE/anterior.app" ]; then
      mv "$BUNDLE_STAGE/anterior.app" "$BUNDLE"
    fi
  fi
  rm -rf "${STAGE:?}"
  [ -z "$BUNDLE_STAGE" ] || rm -rf "${BUNDLE_STAGE:?}"
  [ -z "$RUNTIME_STAGE" ] || rm -rf "${RUNTIME_STAGE:?}"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
BUNDLE_STAGE="$(mktemp -d "$HOME/Applications/.farol-instalar.XXXXXX")"
APP="$STAGE/app"
WS="$STAGE/workspace"

# --- copia do app ----------------------------------------------------------------
step "Copiando o app para $APP"
mkdir -p "$APP"
for f in main.js server.js package.json README.md CLAUDE.md; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$APP/$f"
done
# tools/ carrega runtime (jira-mcp.js): sem ela, revisão com Jira cadastrado
# dispara o diálogo do Electron "Unable to find Electron app at .../tools/jira-mcp.js"
# (o pacote já leva o arquivo desde a v2.53.2, mas o installer não copiava a pasta).
for d in lib ui assets workspace-template installer tools; do
  [ -d "$SRC/$d" ] || continue
  rm -rf "${APP:?}/$d"
  cp -R "$SRC/$d" "$APP/$d"
done
# Guias distribuídos: allowlist explícita (decisão de 15/09/2026). A pasta é recriada para
# um guia que saia da lista não ficar para sempre na cópia instalada.
rm -rf "${APP:?}/docs"
mkdir -p "$APP/docs"
for doc in CONFIGURATION.md REVIEW-GATES.md MACOS.md RELEASE.md; do
  [ -f "$SRC/docs/$doc" ] || die "Guia ausente na origem: docs/$doc"
  cp "$SRC/docs/$doc" "$APP/docs/$doc"
done

# --- dependencias (Electron) -----------------------------------------------------
ELECTRON_BIN="$APP/node_modules/.bin/electron"
instalar_runtime
# bit de execucao: instalador montado fora do Mac (ou tar sem perms) perde o +x;
# o lancador chama o electron direto, entao garante que os binarios rodam.
chmod +x "$ELECTRON_BIN" 2>/dev/null || true
[ -d "$APP/node_modules/electron/dist/Electron.app" ] && chmod -R +x "$APP/node_modules/electron/dist/Electron.app" 2>/dev/null || true
# valida o binario que o LANCADOR executa (o nativo do dist), nao o .bin/electron:
# o .bin vem no cp -R do node_modules e existe mesmo com o dist quebrado, entao
# validar so ele declarava sucesso numa instalacao que nao abre (falha silenciosa)
NATIVE="$APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
[ -x "$NATIVE" ] || die "Electron nao instalado (faltou $NATIVE). Rode: cd $APP && npm install"

# --- workspace do Claude -----------------------------------------------------------
# protocolo sempre atualizado a partir do template; state/ nunca e tocado
step "Preparando o workspace do Claude em $WS"
mkdir -p "$WS/state/authors"
cp "$APP/workspace-template/CLAUDE.md" "$WS/CLAUDE.md"
rm -rf "$WS/.claude"
cp -R "$APP/workspace-template/.claude" "$WS/.claude"
mkdir -p "$WS/prompts"
[ ! -d "$LIVE_WS/prompts" ] || cp -R "$LIVE_WS/prompts/." "$WS/prompts/"
cp -R "$APP/workspace-template/prompts/." "$WS/prompts/"

# --- bundle nativo do macOS -------------------------------------------------------
step 'Criando o aplicativo ~/Applications/Farol.app'
bash "$APP/installer/native-bundle-mac.sh" "$APP" "$BUNDLE_STAGE/Farol.app"

# --- encerra instancias em execucao ---------------------------------------------
# A preparação falhou? O código, o workspace e o processo anterior continuam intactos.
step 'Encerrando instancias do Farol em execucao (se houver)'
pkill -f '\.farol/app' 2>/dev/null || true
pkill -f '/Applications/Farol[.]app/Contents/MacOS/(Electron|Farol)' 2>/dev/null || true
sleep 1

# Cada estágio fica no volume do respectivo destino. Falhas devolvem a versão anterior.
[ ! -e "$LIVE_APP" ] || mv "$LIVE_APP" "$STAGE/anterior"
NEW_APP=1
mv "$APP" "$LIVE_APP"
[ ! -e "$BUNDLE" ] || mv "$BUNDLE" "$BUNDLE_STAGE/anterior.app"
NEW_BUNDLE=1
mv "$BUNDLE_STAGE/Farol.app" "$BUNDLE"
mkdir -p "$LIVE_WS/state/authors" "$STAGE/workspace-anterior"
for item in CLAUDE.md .claude prompts; do
  [ ! -e "$LIVE_WS/$item" ] || mv "$LIVE_WS/$item" "$STAGE/workspace-anterior/$item"
  NEW_WORKSPACE="$item $NEW_WORKSPACE"
  mv "$WS/$item" "$LIVE_WS/$item"
done
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$BUNDLE"
COMMITTED=1
WS="$LIVE_WS"

echo
echo '  Instalacao concluida.'
echo '  Abra o Farol por ~/Applications (ou Spotlight: Farol).'
echo "  Dados e estado: $WS"
echo
