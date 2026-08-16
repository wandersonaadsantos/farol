#!/bin/bash
# Farol: instalador Linux (EXPERIMENTAL, v2.45.0). Copia o app para ~/.farol/app,
# prepara o workspace do Claude, cria o lancador ~/.farol/bin/farol e o atalho
# .desktop em ~/.local/share/applications.
# Uso: bash installer/install-linux.sh
# Teste sem tocar a instalacao real: FAROL_INSTALL_ROOT=/tmp/x bash installer/install-linux.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${FAROL_INSTALL_ROOT:-$HOME/.farol}"
APP="$ROOT/app"
WS="$ROOT/workspace"
BIN="$ROOT/bin"

step() { printf '  -> %s\n' "$1"; }
ok()   { printf '     %s\n' "$1"; }
die()  { printf '  x  %s\n' "$1"; exit 1; }

echo
echo '  Farol . instalador (Linux, experimental)'
echo '  ========================================'

command -v gh >/dev/null 2>&1 || echo "  !  'gh' nao encontrado: o Farol instala, mas precisa dele (https://cli.github.com; gh auth login)."
command -v claude >/dev/null 2>&1 || echo "  !  'claude' nao encontrado: o Farol instala, mas precisa do Claude Code no PATH."

# --- encerra instancias em execucao ------------------------------------------
step 'Encerrando instancias do Farol em execucao (se houver)'
pkill -f '\.farol/app' 2>/dev/null || true
sleep 1

# --- copia do app -------------------------------------------------------------
step "Copiando o app para $APP"
mkdir -p "$APP"
for f in main.js server.js package.json README.md CLAUDE.md; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$APP/$f"
done
for d in lib ui assets workspace-template installer; do
  rm -rf "${APP:?}/$d"
  cp -R "$SRC/$d" "$APP/$d"
done

# --- dependencias (Electron) --------------------------------------------------
step 'Copiando dependencias (node_modules)'
rm -rf "$APP/node_modules"
# fonte sem node_modules (clone limpo) cai direto no npm install la embaixo
[ -d "$SRC/node_modules" ] && cp -R "$SRC/node_modules" "$APP/node_modules" || true
NATIVE="$APP/node_modules/electron/dist/electron"
if [ -x "$NATIVE" ]; then
  ok 'Electron ja presente no pacote'
else
  step 'Baixando o Electron (npm install, pode levar alguns minutos)'
  command -v npm >/dev/null || die 'npm nao encontrado e o Electron linux nao veio no pacote. Instale o Node (https://nodejs.org) e rode de novo.'
  (cd "$APP" && npm install --omit=dev --no-audit --no-fund)
fi
chmod +x "$NATIVE" 2>/dev/null || true
# valida o binario que o lancador executa (mesma licao do install.sh do mac)
[ -x "$NATIVE" ] || die "Electron nao instalado (faltou $NATIVE). Rode: cd $APP && npm install"

# --- workspace do Claude ------------------------------------------------------
# protocolo sempre atualizado a partir do template; state/ nunca e tocado
step "Preparando o workspace do Claude em $WS"
mkdir -p "$WS/state/authors"
cp "$APP/workspace-template/CLAUDE.md" "$WS/CLAUDE.md"
rm -rf "$WS/.claude"
cp -R "$APP/workspace-template/.claude" "$WS/.claude"
mkdir -p "$WS/prompts"
cp -R "$APP/workspace-template/prompts/." "$WS/prompts/"

# --- lancador + .desktop ------------------------------------------------------
step "Criando o lancador $BIN/farol"
mkdir -p "$BIN"
cat > "$BIN/farol" <<LAUNCH
#!/bin/bash
# exec no binario NATIVO do Electron (mesma licao do launcher do mac: nada de
# .bin/electron, que depende de node no PATH e morre em silencio no Dock/menu)
exec "$NATIVE" "$APP"
LAUNCH
chmod +x "$BIN/farol"

step 'Criando o atalho de aplicativo (.desktop)'
DESK="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$DESK"
cat > "$DESK/farol.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Farol
Comment=Radar de Pull Requests
Exec=$BIN/farol
Icon=$APP/assets/png/farol-256.png
Terminal=false
Categories=Development;
DESKTOP
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESK" 2>/dev/null || true

echo
echo '  Instalacao concluida.'
echo "  Abra pelo menu de aplicativos (Farol) ou rode: $BIN/farol"
echo "  Dados e estado: $WS"
echo
