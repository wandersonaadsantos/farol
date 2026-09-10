# Preparacao compartilhada pelos instaladores POSIX. So altera um temporario;
# a instalacao anterior e os processos ficam intactos ate o runtime ser provado.
runtime_compativel() {
  local native="$1"
  [ -x "$native" ] || return 1
  ELECTRON_RUN_AS_NODE=1 "$native" "$SRC/lib/electron-runtime.js" check-running "$SRC/package.json" >/dev/null 2>&1
}

preparar_runtime() {
  local relativo="$1"
  local zip="${2:-}"
  RUNTIME_SOURCE="$APP/node_modules"
  RUNTIME_STAGE=''
  if [ -x "$SRC/node_modules/$relativo" ]; then
    runtime_compativel "$SRC/node_modules/$relativo" || die 'O Electron do pacote nao atende ao package.json ou nao roda nesta arquitetura. Use o instalador correto. A instalacao existente foi preservada.'
    RUNTIME_SOURCE="$SRC/node_modules"
    return
  fi
  if [ -z "$zip" ] || [ ! -f "$zip" ]; then
    if runtime_compativel "$APP/node_modules/$relativo"; then
      ok 'Electron instalado atende ao runtime exigido; sera preservado'
      return
    fi
    command -v npm >/dev/null 2>&1 || die 'O Electron exigido nao esta disponivel e npm nao foi encontrado. Use o instalador offline. A instalacao existente foi preservada.'
  fi
  RUNTIME_STAGE="$(mktemp -d)"
  trap 'rm -rf "${RUNTIME_STAGE:?}"' EXIT
  if [ -n "$zip" ] && [ -f "$zip" ]; then
    command -v unzip >/dev/null 2>&1 || die 'unzip nao encontrado. A instalacao existente foi preservada.'
    [ -d "$SRC/node_modules" ] || die 'Pacote offline sem node_modules. A instalacao existente foi preservada.'
    cp -R "$SRC/node_modules" "$RUNTIME_STAGE/node_modules"
    mkdir -p "$RUNTIME_STAGE/node_modules/electron/dist"
    (cd "$RUNTIME_STAGE/node_modules/electron/dist" && unzip -oq "$zip") || die 'Falha ao extrair Electron. A instalacao existente foi preservada.'
    printf 'Electron.app/Contents/MacOS/Electron' > "$RUNTIME_STAGE/node_modules/electron/path.txt"
  else
    step 'Preparando o Electron exigido em pasta temporaria'
    cp "$SRC/package.json" "$RUNTIME_STAGE/package.json"
    (cd "$RUNTIME_STAGE" && npm install --omit=dev --no-audit --no-fund --arch="$TARGET_ARCH") || die 'Falha ao baixar Electron. A instalacao existente foi preservada.'
    if [ ! -x "$RUNTIME_STAGE/node_modules/$relativo" ] && [ -f "$RUNTIME_STAGE/node_modules/electron/install.js" ]; then
      (cd "$RUNTIME_STAGE/node_modules/electron" && npm_config_arch="$TARGET_ARCH" node install.js) || die 'Falha ao preparar Electron. A instalacao existente foi preservada.'
    fi
  fi
  runtime_compativel "$RUNTIME_STAGE/node_modules/$relativo" || die 'O Electron preparado nao atende ao runtime exigido ou nao executa. A instalacao existente foi preservada.'
  RUNTIME_SOURCE="$RUNTIME_STAGE/node_modules"
}

instalar_runtime() {
  if [ "$RUNTIME_SOURCE" != "$APP/node_modules" ]; then
    step 'Copiando o Electron validado'
    rm -rf "${APP:?}/node_modules"
    cp -R "$RUNTIME_SOURCE" "$APP/node_modules"
  fi
}
