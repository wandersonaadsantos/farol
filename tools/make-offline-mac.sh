#!/bin/bash
# Farol: gera o instalador OFFLINE do macOS (dist/Farol-Instalar-mac.command).
#
# IMPORTANTE: RODE ESTE SCRIPT NUM MAC. Ele baixa o Electron para macOS (do arco
# da maquina que builda) e monta um instalador autoextraivel unico: a pessoa da
# duplo clique e pronto, sem extrair zip, sem Node, sem npm. O Electron viaja
# embutido (offline). O .app e montado LOCALMENTE na maquina do usuario, entao o
# Gatekeeper nao bloqueia por falta de assinatura.
#
# Ressalva do Gatekeeper: como o .command vem baixado (quarentena), na PRIMEIRA
# vez o usuario abre com botao direito > Abrir (uma vez so). Sem assinatura/
# notarizacao (que exigem conta paga da Apple) nao da pra eliminar esse passo.
#
# Arco: builda pro arco da maquina (arm64 no Apple Silicon, x64 no Intel). Pra
# cobrir os dois, rode uma vez em cada, ou passe ARCH=x64/arm64.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$(node -p "require('$SRC/package.json').version")"
DIST="$SRC/dist"
OUT="$DIST/Farol-Instalar-mac.command"
ARCH="${ARCH:-$(uname -m)}"; [ "$ARCH" = "arm64" ] && ARCH="arm64" || ARCH="x64"

echo
echo "  Farol . instalador offline (macOS $ARCH) v$VER"

command -v node >/dev/null || { echo '  x  Node.js necessario pro build (nao pro usuario final).'; exit 1; }
command -v npm  >/dev/null || { echo '  x  npm necessario pro build.'; exit 1; }

# --- garante o Electron para macOS embutido ------------------------------------
NM_ELECTRON="$SRC/node_modules/electron/dist/Electron.app"
if [ ! -d "$NM_ELECTRON" ]; then
  echo '  -> Baixando o Electron para macOS (npm install)'
  (cd "$SRC" && npm_config_platform=darwin npm_config_arch="$ARCH" npm install --omit=dev --no-audit --no-fund)
fi
[ -d "$NM_ELECTRON" ] || { echo "  x  Electron para macOS ausente em node_modules."; exit 1; }

BUILD="$(mktemp -d)"; STAGING="$BUILD/payload"; mkdir -p "$STAGING"
trap 'rm -rf "$BUILD"' EXIT

echo '  -> Reunindo o app + Electron'
for f in main.js server.js package.json README.md CLAUDE.md; do cp "$SRC/$f" "$STAGING/$f"; done
for d in ui assets workspace-template installer node_modules; do cp -R "$SRC/$d" "$STAGING/$d"; done

echo '  -> Compactando o payload'
TARBALL="$BUILD/payload.tar.gz"
tar czf "$TARBALL" -C "$STAGING" .

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

cat "$STUB" "$TARBALL" > "$OUT"
chmod +x "$OUT"

MB=$(( $(wc -c < "$OUT") / 1024 / 1024 ))
echo
echo "  ok  $OUT (${MB} MB, macOS $ARCH)"
echo "      duplo clique instala (1a vez: botao direito > Abrir, por causa da quarentena)."
echo
