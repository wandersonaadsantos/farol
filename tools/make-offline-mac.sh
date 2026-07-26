#!/bin/bash
# Farol: gera o instalador OFFLINE do macOS (dist/Farol-Instalar-mac.command).
#
# RODA EM QUALQUER SO (Windows/Linux/macOS). Baixa o Electron para macOS do
# GitHub e EMBUTE o zip no pacote; o .app so e montado NO MAC do usuario, na hora
# da instalacao. Isso e de proposito: o unzip do proprio Mac preserva os symlinks
# do .app, que a extracao no Windows quebraria. Assim da pra buildar o instalador
# de macOS sem ter um Mac (e continua offline: o Electron viaja embutido).
#
# ARCH: arm64 (Apple Silicon, default) ou x64 (Intel):
#   ARCH=x64 bash tools/make-offline-mac.sh
#
# Gatekeeper: o .command vem baixado (quarentena); na 1a vez, botao direito >
# Abrir (uma vez). Sem assinatura/notarizacao (conta paga da Apple) esse passo fica.
#
# ATENCAO: o runtime do Farol no macOS nunca rodou num Mac de verdade (ver a secao
# macOS do CLAUDE.md). Trate o instalador gerado como BETA e valide com o
# "Exportar diagnostico" (aba Sistema > Saude) do primeiro Mac que instalar.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# require com caminho RELATIVO (cd no SRC): o node do Windows nao entende caminho
# estilo git-bash "/c/...". Assim funciona em qualquer SO.
VER="$(cd "$SRC" && node -p "require('./package.json').version")"
ELVER="$(cd "$SRC" && node -p "require('./node_modules/electron/package.json').version")"
DIST="$SRC/dist"
OUT="$DIST/Farol-Instalar-mac.command"
ARCH="${ARCH:-arm64}"; [ "$ARCH" = "x64" ] || ARCH="arm64"
ZIP_URL="https://github.com/electron/electron/releases/download/v$ELVER/electron-v$ELVER-darwin-$ARCH.zip"

echo
echo "  Farol . instalador offline (macOS $ARCH) v$VER . electron v$ELVER"

command -v node >/dev/null || { echo '  x  Node.js necessario pro build.'; exit 1; }
command -v curl >/dev/null || { echo '  x  curl necessario pro build.'; exit 1; }
command -v tar  >/dev/null || { echo '  x  tar necessario pro build.'; exit 1; }
[ -d "$SRC/node_modules/electron" ] || { echo '  x  node_modules ausente. Rode npm install antes.'; exit 1; }

BUILD="$(mktemp -d)"; STAGING="$BUILD/payload"; mkdir -p "$STAGING"
trap 'rm -rf "$BUILD"' EXIT

echo "  -> Baixando o Electron para macOS ($ARCH)"
curl -fL --retry 3 -o "$BUILD/electron-darwin.zip" "$ZIP_URL"

echo '  -> Reunindo o app + Electron (embutido, montado no Mac)'
for f in main.js server.js package.json README.md CLAUDE.md; do cp "$SRC/$f" "$STAGING/$f"; done
for d in ui assets workspace-template installer node_modules; do cp -R "$SRC/$d" "$STAGING/$d"; done
# tira o dist do Electron (arco do build, ex.: win32) e embute o zip darwin. O
# install.sh descompacta NO Mac, preservando os symlinks do .app.
rm -rf "$STAGING/node_modules/electron/dist"
cp "$BUILD/electron-darwin.zip" "$STAGING/installer/electron-darwin.zip"
chmod +x "$STAGING/node_modules/.bin/electron" 2>/dev/null || true

echo '  -> Compactando o payload'
tar czf "$BUILD/payload.tar.gz" -C "$STAGING" .

# --- stub autoextraivel (makeself-style) ---------------------------------------
mkdir -p "$DIST"
STUB="$BUILD/stub.sh"
cat > "$STUB" <<'STUBEOF'
#!/bin/bash
# Instalador offline do Farol (macOS). Extrai o payload embutido e instala.
set -e
cd "$(dirname "$0")" 2>/dev/null || true
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH
echo
echo "  Instalando o Farol, aguarde..."
LINE=$(awk '/^__FAROL_ARCHIVE__/ {print NR + 1; exit 0}' "$0")
TMP="$(mktemp -d)"
tail -n +"$LINE" "$0" | tar xz -C "$TMP"
bash "$TMP/installer/install.sh"
RC=$?
rm -rf "$TMP"
echo
if [ "$RC" -eq 0 ]; then echo "  Pronto. Abra o Farol por ~/Applications (ou Spotlight: Farol)."; fi
read -n 1 -s -r -p '  Pressione qualquer tecla para fechar...'
echo
exit $RC
__FAROL_ARCHIVE__
STUBEOF

cat "$STUB" "$BUILD/payload.tar.gz" > "$OUT"
chmod +x "$OUT" 2>/dev/null || true

MB=$(( $(wc -c < "$OUT") / 1024 / 1024 ))
echo
echo "  ok  $OUT (${MB} MB, macOS $ARCH)"
echo "      duplo clique instala (1a vez: botao direito > Abrir, por causa da quarentena)."
echo "      Intel (x64): ARCH=x64 bash tools/make-offline-mac.sh"
echo "      Anexe na release: gh release upload vX.Y.Z \"$OUT\" --repo wandersonaadsantos/farol"
echo
