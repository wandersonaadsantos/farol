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

# npm instalado por gerenciador de versao (nvm, fnm, volta) so entra no PATH
# dentro do profile do shell. O instalador chega aqui pelo APP (auto-update),
# que o Finder/atalho abriu com PATH minimo, entao `command -v npm` falha mesmo
# com o Node instalado e o fallback de rede morre em "npm nao foi encontrado".
# Caso medido em 11/09/2026 (Mac, nvm do Homebrew): Electron 43 instalado, a
# release exigindo 44, e o npm em /opt/homebrew/opt/nvm/versions/node/vX/bin.
# So mexe no PATH quando npm NAO esta acessivel: npm ja visivel sempre vence.
# No nvm a versao escolhida e a MAIS NOVA instalada (`sort -V`, que o sort do
# macOS e do GNU aceitam); no fnm e no volta vale o alias default deles. A raiz
# do Homebrew sai de HOMEBREW_PREFIX (o `brew shellenv` exporta; sem ela valem
# os dois defaults, Apple Silicon e Intel), o que tambem deixa o teste isolar
# a maquina de quem roda a suite.
incluir_npm_de_gerenciador() {
  command -v npm >/dev/null 2>&1 && return 0
  local raiz versao dir=''
  for raiz in "${NVM_DIR:-}" "$HOME/.nvm" "${HOMEBREW_PREFIX:-/opt/homebrew}/opt/nvm" "${HOMEBREW_PREFIX:-/usr/local}/opt/nvm"; do
    [ -n "$raiz" ] && [ -d "$raiz/versions/node" ] || continue
    versao="$(ls -1 "$raiz/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "$versao" ] && [ -x "$raiz/versions/node/$versao/bin/npm" ] || continue
    dir="$raiz/versions/node/$versao/bin"
    break
  done
  if [ -z "$dir" ]; then
    for raiz in "${FNM_DIR:-}/aliases/default/bin" "$HOME/.local/share/fnm/aliases/default/bin" \
                "$HOME/Library/Application Support/fnm/aliases/default/bin" "$HOME/.volta/bin"; do
      [ -x "$raiz/npm" ] || continue
      dir="$raiz"
      break
    done
  fi
  [ -n "$dir" ] || return 0
  PATH="$dir:$PATH"
  export PATH
  ok "npm encontrado fora do PATH do app: $dir"
}
