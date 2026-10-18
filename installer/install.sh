#!/bin/bash
# Farol: instalador macOS. Copia o app para ~/.farol/app, prepara o workspace
# do Claude e cria o lancador ~/Applications/Farol.app.
# Uso: bash installer/install.sh
#
# ATENCAO: portado do install.ps1 (Windows) sem um Mac real pra testar.
# Se algo falhar, o docs/MACOS.md (na fonte e em ~/.farol/app/docs) explica o
# desenho e o checklist de validacao.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$HOME/.farol"
APP="$ROOT/app"
WS="$ROOT/workspace"

step() { printf '  -> %s\n' "$1"; }
ok()   { printf '     %s\n' "$1"; }
die()  { printf '  x  %s\n' "$1"; exit 1; }


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

# --- encerra instancias em execucao ---------------------------------------------
step 'Encerrando instancias do Farol em execucao (se houver)'
pkill -f '\.farol/app' 2>/dev/null || true
pkill -f '/Applications/Farol[.]app/Contents/MacOS/(Electron|Farol)' 2>/dev/null || true
sleep 1

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
cp -R "$APP/workspace-template/prompts/." "$WS/prompts/"

# --- bundle nativo do macOS -------------------------------------------------------
step 'Criando o aplicativo ~/Applications/Farol.app'
bash "$APP/installer/native-bundle-mac.sh"

echo
echo '  Instalacao concluida.'
echo '  Abra o Farol por ~/Applications (ou Spotlight: Farol).'
echo "  Dados e estado: $WS"
echo
