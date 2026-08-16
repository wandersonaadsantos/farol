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
# Node/npm NAO sao exigidos aqui (mesma promessa do install.ps1): o modo offline
# (Electron no pacote ou zip darwin embutido) instala sem Node; so o fallback de
# rede (npm install) cobra, la embaixo. Exigir aqui derrubava o instalador
# offline E o auto-update em Mac sem Node.
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
for d in lib ui assets workspace-template installer; do
  rm -rf "${APP:?}/$d"
  cp -R "$SRC/$d" "$APP/$d"
done

# --- dependencias (Electron) -----------------------------------------------------
ELECTRON_BIN="$APP/node_modules/.bin/electron"
step 'Copiando dependencias (node_modules)'
rm -rf "$APP/node_modules"
cp -R "$SRC/node_modules" "$APP/node_modules"
# Electron para macOS, em ordem de preferencia:
#  1) o dist (.app) ja veio no pacote (instalador montado num Mac): usa direto;
#  2) veio o zip darwin embutido (instalador montado FORA do Mac): extrai AQUI,
#     porque o unzip do proprio Mac preserva os symlinks do .app (o Windows nao);
#  3) nada disso: baixa via npm (precisa de rede).
if [ -d "$APP/node_modules/electron/dist/Electron.app" ]; then
  ok 'Electron ja presente no pacote'
elif [ -f "$SRC/installer/electron-darwin.zip" ]; then
  step 'Montando o Electron para macOS (do pacote embutido)'
  command -v unzip >/dev/null || die 'unzip nao encontrado (necessario pro Electron embutido).'
  rm -rf "$APP/node_modules/electron/dist"; mkdir -p "$APP/node_modules/electron/dist"
  (cd "$APP/node_modules/electron/dist" && unzip -oq "$SRC/installer/electron-darwin.zip")
  printf 'Electron.app/Contents/MacOS/Electron' > "$APP/node_modules/electron/path.txt"
else
  step 'Baixando o Electron (npm install, pode levar alguns minutos)'
  command -v npm >/dev/null || die 'npm nao encontrado, e este pacote nao trouxe o Electron embutido. Instale o Node (brew install node) ou use o instalador offline.'
  (cd "$APP" && npm install --omit=dev --no-audit --no-fund)
fi
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

# --- lancador ~/Applications/Farol.app ----------------------------------------------
# bundle minimo: um script que executa o Electron apontando pro app instalado.
# Sem assinatura/notarizacao: e criado localmente, o Gatekeeper nao reclama.
step 'Criando o lancador ~/Applications/Farol.app'
# sem node de proposito (modo offline): a versao sai do JSON por sed
VER="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -1)"
[ -n "$VER" ] || VER='0.0.0'
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
# exec no binario NATIVO do Electron, nunca no .bin/electron: aquele e um script
# node (#!/usr/bin/env node) e Finder/Spotlight lancam com PATH minimo, sem node,
# entao o wrapper morreria em silencio ("cliquei e nao abriu")
exec "$HOME/.farol/app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$HOME/.farol/app"
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
