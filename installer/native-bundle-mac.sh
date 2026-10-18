#!/bin/bash
# Cria um bundle executável próprio, sem alterar o runtime canônico do npm.
set -euo pipefail
APP="$HOME/.farol/app"
RUNTIME="$APP/node_modules/electron/dist/Electron.app"
DEST="$HOME/Applications/Farol.app"
[ "$(uname -s)" = Darwin ] || { echo 'Este instalador exige macOS.' >&2; exit 1; }
[ -x "$RUNTIME/Contents/MacOS/Electron" ] || { echo 'Runtime Electron ausente.' >&2; exit 1; }
mkdir -p "$HOME/Applications"
STAGE="$(mktemp -d "$HOME/Applications/.farol-bundle.XXXXXX")"
trap 'rm -rf "${STAGE:?}"' EXIT
BUNDLE="$STAGE/Farol.app"
/usr/bin/ditto "$RUNTIME" "$BUNDLE"
PLIST="$BUNDLE/Contents/Info.plist"
set_string() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"
}
set_string CFBundleName 'Farol'
set_string CFBundleDisplayName 'Farol'
set_string CFBundleIdentifier 'com.biud.farol'
set_string LSMinimumSystemVersion '13.0'
set_string CFBundleIconFile 'farol.icns'
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP/package.json" | head -1)"
[ -n "$VERSION" ] || { echo 'Versão do aplicativo ausente.' >&2; exit 1; }
set_string CFBundleVersion "$VERSION"
set_string CFBundleShortVersionString "$VERSION"
# O bootstrap fica DENTRO do bundle assinado; o código e seus dados mantêm
# os caminhos existentes, inclusive depois de um update do pacote leve.
mkdir -p "$BUNDLE/Contents/Resources/app"
printf '{"name":"farol","version":"%s","main":"bootstrap.cjs"}\n' "$VERSION" > "$BUNDLE/Contents/Resources/app/package.json"
cat > "$BUNDLE/Contents/Resources/app/bootstrap.cjs" <<'JS'
const { homedir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
import(pathToFileURL(join(homedir(), '.farol', 'app', 'main.js')).href).catch((error) => {
  console.error(error);
  require('electron').app.exit(1);
});
JS
if [ -f "$APP/assets/farol.icns" ]; then
  cp "$APP/assets/farol.icns" "$BUNDLE/Contents/Resources/farol.icns"
else
  ICONSET="$STAGE/farol.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    /usr/bin/sips -z "$size" "$size" "$APP/assets/png/farol-256.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    /usr/bin/sips -z "$double" "$double" "$APP/assets/png/farol-256.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  /usr/bin/iconutil -c icns "$ICONSET" -o "$BUNDLE/Contents/Resources/farol.icns"
fi
# Alterar Info.plist invalida a assinatura original. Assinatura local ad hoc
# permite executar o bundle gerado; distribuição notarizada é outro processo.
/usr/bin/codesign --force --deep --sign - --preserve-metadata=entitlements "$BUNDLE"
/usr/bin/codesign --verify --deep --strict "$BUNDLE"
# Mantém o bundle anterior até o novo estar pronto e validado.
if [ -e "$DEST" ]; then mv "$DEST" "$STAGE/anterior.app"; fi
if ! mv "$BUNDLE" "$DEST"; then
  [ ! -e "$STAGE/anterior.app" ] || mv "$STAGE/anterior.app" "$DEST"
  exit 1
fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
echo "Bundle nativo instalado: $DEST"
