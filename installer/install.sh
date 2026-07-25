#!/bin/bash
# Farol: instalador macOS. Copia o app para ~/.farol/app, prepara o workspace
# do Claude e cria o lancador ~/Applications/Farol.app.
# Uso: bash installer/install.sh
#
# ATENCAO: portado do install.ps1 (Windows) sem um Mac real pra testar.
# Se algo falhar, a secao macOS do CLAUDE.md na raiz da fonte explica o
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
command -v node >/dev/null || die 'Node.js nao encontrado no PATH. Instale em https://nodejs.org (ou: brew install node).'
command -v npm  >/dev/null || die 'npm nao encontrado no PATH.'
command -v gh >/dev/null 2>&1 || echo "  !  'gh' nao encontrado: o Farol instala, mas precisa dele (brew install gh; gh auth login)."
command -v claude >/dev/null 2>&1 || echo "  !  'claude' nao encontrado: o Farol instala, mas precisa do Claude Code no PATH."

# --- encerra instancias em execucao ---------------------------------------------
step 'Encerrando instancias do Farol em execucao (se houver)'
pkill -f '\.farol/app' 2>/dev/null || true
sleep 1

# --- copia do app ----------------------------------------------------------------
step "Copiando o app para $APP"
mkdir -p "$APP"
for f in main.js server.js package.json README.md CLAUDE.md; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$APP/$f"
done
for d in ui assets workspace-template installer; do
  rm -rf "${APP:?}/$d"
  cp -R "$SRC/$d" "$APP/$d"
done

# --- dependencias (Electron) -----------------------------------------------------
ELECTRON_BIN="$APP/node_modules/.bin/electron"
if [ -x "$SRC/node_modules/.bin/electron" ] && [ -d "$SRC/node_modules/electron/dist" ]; then
  step 'Copiando dependencias ja baixadas (node_modules)'
  rm -rf "$APP/node_modules"
  cp -R "$SRC/node_modules" "$APP/node_modules"
elif [ ! -x "$ELECTRON_BIN" ]; then
  step 'Baixando o Electron (npm install, pode levar alguns minutos)'
  (cd "$APP" && npm install --omit=dev --no-audit --no-fund)
fi
# bit de execucao: instaladores gerados no Windows (ou tar sem perms) perdem o
# +x; o lancador chama o electron direto, entao garante que os binarios rodam.
chmod +x "$ELECTRON_BIN" 2>/dev/null || true
[ -d "$APP/node_modules/electron/dist/Electron.app" ] && chmod -R +x "$APP/node_modules/electron/dist/Electron.app" 2>/dev/null || true
[ -x "$ELECTRON_BIN" ] || die "Electron nao instalado. Rode: cd $APP && npm install"

# --- workspace do Claude -----------------------------------------------------------
# protocolo sempre atualizado a partir do template; state/ nunca e tocado
step "Preparando o workspace do Claude em $WS"
mkdir -p "$WS/state/authors"
cp "$APP/workspace-template/CLAUDE.md" "$WS/CLAUDE.md"
rm -rf "$WS/.claude"
cp -R "$APP/workspace-template/.claude" "$WS/.claude"
mkdir -p "$WS/prompts"
cp -R "$APP/workspace-template/prompts/." "$WS/prompts/"

# --- lancador ~/Applications/Farol.app ----------------------------------------------
# bundle minimo: um script que executa o Electron apontando pro app instalado.
# Sem assinatura/notarizacao: e criado localmente, o Gatekeeper nao reclama.
step 'Criando o lancador ~/Applications/Farol.app'
VER="$(node -p "require('$SRC/package.json').version")"
BUNDLE="$HOME/Applications/Farol.app"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Farol</string>
  <key>CFBundleDisplayName</key><string>Farol</string>
  <key>CFBundleIdentifier</key><string>com.biud.farol</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Farol</string>
  <key>CFBundleIconFile</key><string>farol</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST
cat > "$BUNDLE/Contents/MacOS/Farol" <<'LAUNCH'
#!/bin/bash
exec "$HOME/.farol/app/node_modules/.bin/electron" "$HOME/.farol/app"
LAUNCH
chmod +x "$BUNDLE/Contents/MacOS/Farol"
if [ -f "$SRC/assets/farol.icns" ]; then
  cp "$SRC/assets/farol.icns" "$BUNDLE/Contents/Resources/farol.icns"
else
  ok 'sem assets/farol.icns (icone generico); gere com: bash tools/make-icns.sh'
fi

echo
echo '  Instalacao concluida.'
echo '  Abra o Farol por ~/Applications (ou Spotlight: Farol).'
echo "  Dados e estado: $WS"
echo
