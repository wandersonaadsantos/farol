#!/usr/bin/env bash
# Farol: porta POSIX do tools/make-package.ps1 (pacote leve dist/farol-vX.Y.Z.zip).
# MESMA lista, MESMA guarda de arvore suja e MESMA auditoria anti-vazamento do .ps1:
# as listas e os padroes sao conferidos contra o .ps1 em test/release-make-package-sh.test.js.
# FAROL_DIST troca a pasta de saida (padrao dist/ na raiz); FAROL_ALLOW_DIRTY=1 e a mesma
# escotilha consciente do .ps1 (dev local, teste), nunca o fluxo de publicacao.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

falhar() {
  echo "  x  $*" >&2
  exit 1
}

command -v node > /dev/null 2>&1 || falhar 'Node.js necessario para validar o parser distribuido.'
node "$SRC/lib/node-runtime.js" "$SRC/package.json" \
  || falhar 'Atualize o Node deste ambiente antes do build. A instalacao existente foi preservada.'
node "$SRC/lib/parser-runtime.js" "$SRC" \
  || falhar 'Parser distribuido ausente ou corrompido. Reconstrua o artefato antes de empacotar.'
versao="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$SRC/package.json")"
dist="${FAROL_DIST:-$SRC/dist}"
mkdir -p "$dist"
dist="$(cd "$dist" && pwd)"
zip="$dist/farol-v$versao.zip"
staging="$(mktemp -d "${TMPDIR:-/tmp}/farol-pkg-XXXXXXXX")"
auditoria=""
limpar() {
  rm -rf "$staging"
  if [ -n "$auditoria" ]; then rm -rf "$auditoria"; fi
}
trap limpar EXIT

echo ''
echo "  Farol · empacotador v$versao"

# --- whitelist: o que viaja no pacote (a mesma do make-package.ps1) ------------
do_pacote=()
for f in main.js server.js package.json README.md CLAUDE.md Instalar.cmd Desinstalar.cmd Instalar.command Desinstalar.command; do
  cp "$SRC/$f" "$staging/$f"
  do_pacote+=("$f")
done
for d in lib ui assets workspace-template installer; do
  cp -R "$SRC/$d" "$staging/$d"
  do_pacote+=("$d")
done
# jira-mcp.js e farol-parear.js sao runtime (ver o comentario no make-package.ps1)
mkdir -p "$staging/tools"
for t in jira-mcp.js farol-parear.js make-icons.ps1 pack-ico.js make-package.ps1 make-icns.sh; do
  cp "$SRC/tools/$t" "$staging/tools/$t"
  do_pacote+=("tools/$t")
done
# guias distribuidos: allowlist explicita, so estes quatro de docs/ viajam
mkdir -p "$staging/docs"
for doc in CONFIGURATION.md REVIEW-GATES.md MACOS.md RELEASE.md; do
  cp "$SRC/docs/$doc" "$staging/docs/$doc"
  do_pacote+=("docs/$doc")
done

# --- guarda de arvore suja (incidente de 15/08/2026, ver o make-package.ps1) ----
if [ "${FAROL_ALLOW_DIRTY:-}" != '1' ]; then
  if sujos="$(git -C "$SRC" status --porcelain -- "${do_pacote[@]}" 2> /dev/null)" && [ -n "$sujos" ]; then
    echo '  ERRO: arvore com mudancas nao commitadas nos arquivos do pacote:' >&2
    printf '    %s\n' "$sujos" >&2
    falhar 'arvore suja: o pacote sairia diferente do commit. Commite, ou construa de uma worktree limpa (FAROL_ALLOW_DIRTY=1 so pra teste local).'
  fi
fi

# --- zip ----------------------------------------------------------------------
# so arquivos (sem entrada de pasta), separador '/', em ordem estavel
rm -f "$zip"
(cd "$staging" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | zip -q -X "$zip" -@)

# --- auditoria anti-vazamento (as mesmas regras do make-package.ps1) ------------
entradas="$(unzip -Z1 "$zip")"
quantas="$(printf '%s\n' "$entradas" | grep -c .)"

# caminho torto (backslash ou raiz absoluta) invalida o pacote no macOS
torto="$(printf '%s\n' "$entradas" | grep -E '\\|^/' || true)"
if [ -n "$torto" ]; then
  echo '  x  ENTRADAS COM CAMINHO INVALIDO (quebra o unzip do macOS):' >&2
  printf '%s\n' "$torto" | head -5 | sed 's/^/     /' >&2
  rm -f "$zip"
  exit 1
fi

proibidos="$(printf '%s\n' "$entradas" | grep -E 'node_modules|config\.json|(^|/)state/|(^|/)sessions/|\.log|(^|/)seen$|baselined|highlights\.md|(^|/)authors/' || true)"
if [ -n "$proibidos" ]; then
  echo '  x  ARQUIVOS PROIBIDOS NO PACOTE:' >&2
  printf '%s\n' "$proibidos" | sed 's/^/     /' >&2
  rm -f "$zip"
  exit 1
fi

# extrai e procura credenciais e contas pessoais em TODO arquivo do pacote, sem lista
# de extensao, ignorando caixa como o Select-String do .ps1
auditoria="$(mktemp -d "${TMPDIR:-/tmp}/farol-audit-XXXXXXXX")"
unzip -q "$zip" -d "$auditoria"
achados="$(grep -raniE --exclude=make-package.ps1 'wandersonbiuder|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|ATATT[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._~+/=-]{20,}' "$auditoria" || true)"
if [ -n "$achados" ]; then
  echo '  x  POSSIVEL CREDENCIAL/CONTA PESSOAL NO PACOTE:' >&2
  printf '%s\n' "$achados" | head -10 | sed "s|^$auditoria/|     |" >&2
  rm -f "$zip"
  exit 1
fi

tamanho="$(du -k "$zip" | awk '{print $1}')"
echo "  ok  pacote limpo: $zip ($tamanho KB, $quantas arquivos)"
echo '      auditado: sem estado, sem config, sem tokens, sem conta pessoal.'
echo ''
