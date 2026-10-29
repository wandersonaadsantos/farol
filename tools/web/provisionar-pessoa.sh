#!/bin/bash
# Farol, web hospedada: provisiona a instancia de UMA pessoa numa VPS Linux.
# Cria o usuario Linux, instala o pacote leve em ~/.farol/app (ou liga um clone git),
# aloca a porta em /etc/farol/portas (proxima livre a partir da padrao; login ou porta
# repetidos sao recusados por tools/web/portas.js, unico leitor desse arquivo), grava
# ~/.farol/config.json com a porta e localAuth "exigir", instala a unidade systemd de
# usuario e liga o servico com linger, para o motor subir sem sessao aberta.
#
# O motor fica em 127.0.0.1 na porta da pessoa; quem expoe com TLS e o proxy (Caddy).
# Roda a partir do clone do repositorio na VPS, como root. Nao viaja no pacote.
#
# Uso:
#   sudo bash tools/web/provisionar-pessoa.sh <login-linux> [porta] [opcoes]
# Opcoes:
#   --pacote <zip|pasta>  instala deste pacote leve (farol-vX.Y.Z.zip ou a pasta extraida);
#                         sem ele, baixa farol-v*.zip da ultima release com o gh
#   --clone <pasta git>   liga ~/.farol/app a um clone (link simbolico) e marca a unidade com
#                         FAROL_UPDATE_MANAGER=external: quem atualiza e o operador (git pull)
#   --forcar              aceita login ja existente (usuario Linux ou linha em
#                         /etc/farol/portas): reaproveita a porta, troca o app e a unidade e
#                         reinicia o servico, preservando o resto de ~/.farol
# Ambiente:
#   FAROL_NODE            caminho absoluto do node que a unidade usa; sem ele, o node que o
#                         usuario criado enxerga (com o nvm dele, se houver)
#
# Seguranca: o root nunca executa binario nem escreve em caminho que a pessoa controla.
# A tabela de portas roda com o node DO ROOT (dono uid 0, sem escrita de grupo ou outros);
# o node da pessoa so entra na unidade e roda como ela. Tudo dentro da pasta pessoal
# (app, config.json, unidade) e escrito COMO a pessoa, entao um link simbolico plantado
# ali so alcanca o que ela ja alcanca.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORTAS_JS="$SRC/tools/web/portas.js"
TEMPLATE="$SRC/tools/web/farol.service.template"
ETC=/etc/farol
PORTAS="$ETC/portas"
RELEASE_REPO=wandersonaadsantos/farol

step() { printf '  -> %s\n' "$1"; }
ok()   { printf '     %s\n' "$1"; }
die()  { printf '  x  %s\n' "$1" >&2; exit 1; }
uso()  { sed -n '12,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

# --- argumentos ----------------------------------------------------------------
LOGIN=''
PORTA=''
PACOTE=''
CLONE=''
FORCAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pacote) [ $# -ge 2 ] || uso; PACOTE="$2"; shift 2 ;;
    --clone)  [ $# -ge 2 ] || uso; CLONE="$2"; shift 2 ;;
    --forcar) FORCAR=1; shift ;;
    -h|--help) uso ;;
    -*) uso ;;
    *)
      if [ -z "$LOGIN" ]; then LOGIN="$1"
      elif [ -z "$PORTA" ]; then PORTA="$1"
      else uso
      fi
      shift ;;
  esac
done
[ -n "$LOGIN" ] || uso
[ -z "$PACOTE" ] || [ -z "$CLONE" ] || die 'Use --pacote OU --clone, nao os dois.'

echo
echo '  Farol . provisionar pessoa (web hospedada)'
echo '  =========================================='

# --- pre-condicoes, antes de tocar qualquer coisa -------------------------------
[ "$(uname -s)" = 'Linux' ] || die 'Este script roda so na VPS Linux.'
[ "$(id -u)" -eq 0 ] || die 'Rode como root (sudo bash tools/web/provisionar-pessoa.sh ...).'
for cmd in useradd loginctl systemctl getent sed flock stat readlink; do
  command -v "$cmd" >/dev/null 2>&1 || die "Comando ausente: $cmd"
done
[ -f "$PORTAS_JS" ] && [ -f "$TEMPLATE" ] || die "Rode a partir do clone do repositorio (faltou $PORTAS_JS ou $TEMPLATE)."
# mesma regra de nome que tools/web/portas.js aplica; conferir aqui evita criar usuario
# que o arquivo de portas recusaria depois
[[ "$LOGIN" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Login invalido: $LOGIN (minusculas, digitos, _ e -, ate 32)."
if [ -n "$PACOTE" ]; then [ -e "$PACOTE" ] || die "Pacote nao encontrado: $PACOTE"; fi
if [ -n "$CLONE" ]; then
  [ -d "$CLONE/.git" ] && [ -f "$CLONE/server.js" ] || die "--clone precisa de um clone git do Farol: $CLONE"
  CLONE="$(cd "$CLONE" && pwd)"
fi
if [ -z "$PACOTE" ] && [ -z "$CLONE" ]; then
  command -v gh >/dev/null 2>&1 || die "Sem --pacote, o pacote vem da release pelo gh, que nao esta instalado."
  command -v unzip >/dev/null 2>&1 || die 'unzip ausente (apt install unzip).'
fi
if [ -n "$PACOTE" ] && [ -f "$PACOTE" ]; then
  command -v unzip >/dev/null 2>&1 || die 'unzip ausente (apt install unzip).'
fi

# node em que o root confia para rodar tools/web/portas.js: o do PATH do root, com o
# arquivo real pertencendo ao root e sem escrita de grupo ou outros. Nunca o da pessoa.
NODE_ROOT="$(command -v node || true)"
[ -n "$NODE_ROOT" ] || die 'node ausente no PATH do root (instale o Node 24 do sistema, ex.: /usr/bin/node).'
NODE_ROOT="$(readlink -f "$NODE_ROOT")"
[ "$(stat -c %u "$NODE_ROOT")" = 0 ] || die "O node do root ($NODE_ROOT) nao pertence ao root; use um node do sistema."
case "$(stat -c %A "$NODE_ROOT")" in ?????w????|????????w?) die "O node do root ($NODE_ROOT) aceita escrita de grupo ou outros." ;; esac

USUARIO_EXISTE=0
id "$LOGIN" >/dev/null 2>&1 && USUARIO_EXISTE=1
NA_TABELA=0
[ -f "$PORTAS" ] && grep -q "^$LOGIN " "$PORTAS" && NA_TABELA=1
if [ "$FORCAR" -eq 0 ]; then
  [ "$USUARIO_EXISTE" -eq 0 ] || die "O usuario $LOGIN ja existe. Para reprovisionar, use --forcar."
  [ "$NA_TABELA" -eq 0 ] || die "$LOGIN ja tem porta em $PORTAS. Para reprovisionar, use --forcar."
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- usuario ---------------------------------------------------------------------
if [ "$USUARIO_EXISTE" -eq 1 ]; then
  step "Usuario $LOGIN ja existe (--forcar): mantido"
else
  step "Criando o usuario $LOGIN"
  useradd --create-home --shell /bin/bash "$LOGIN"
fi
UID_PESSOA="$(id -u "$LOGIN")"
CASA="$(getent passwd "$LOGIN" | cut -d: -f6)"
[ -n "$CASA" ] && [ -d "$CASA" ] || die "Pasta pessoal de $LOGIN nao encontrada."
FAROL="$CASA/.farol"
APP="$FAROL/app"
como() { sudo -u "$LOGIN" -H "$@"; }
# grava a entrada padrao em $2 COMO a pessoa, com a umask $1 (vale so para arquivo novo)
# shellcheck disable=SC2016
gravar_como() { como sh -c 'umask "$1"; cat > "$2"' sh "$1" "$2"; }

# --- node absoluto (o systemd de usuario tem PATH minimo e nao ve o nvm) ------------
step 'Resolvendo o node da unidade'
if [ -n "${FAROL_NODE:-}" ]; then
  NODE="$FAROL_NODE"
else
  # aspas simples de proposito: $HOME e $NVM_DIR expandem no shell do usuario, nao no do root
  # shellcheck disable=SC2016
  NODE="$(como bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; command -v node' || true)"
fi
[ -n "$NODE" ] || die "node nao encontrado para $LOGIN. Instale o Node 24 (nvm do usuario ou pacote do sistema) ou passe FAROL_NODE=/caminho/absoluto/node."
case "$NODE" in /*) ;; *) die "FAROL_NODE precisa ser caminho absoluto: $NODE" ;; esac
case "$NODE" in *'|'*|*'&'*|*' '*) die "Caminho do node com caractere nao suportado na unidade: $NODE" ;; esac
como test -x "$NODE" || die "$LOGIN nao consegue executar $NODE (permissao da pasta?)."
# a versao sai rodando COMO a pessoa: o binario pode ser dela
ok "$NODE ($(como "$NODE" --version))"

# --- porta ---------------------------------------------------------------------------
step "Alocando a porta em $PORTAS"
mkdir -p "$ETC"
chmod 755 "$ETC"
# trava ate o fim da alocacao: dois provisionamentos ao mesmo tempo leriam a mesma tabela
# e dariam a mesma porta. O portas.js recusa login repetido, entao a conferencia de
# NA_TABELA feita antes da trava nao abre brecha.
exec 9> "$ETC/portas.lock"
flock -w 60 9 || die "Outro provisionamento segura $ETC/portas.lock ha mais de 60 s."
[ -f "$PORTAS" ] || { : > "$PORTAS"; chmod 644 "$PORTAS"; }
if [ "$NA_TABELA" -eq 1 ]; then
  PORTA_ATUAL="$("$NODE_ROOT" "$PORTAS_JS" listar "$PORTAS" | awk -v l="$LOGIN" '$1 == l { print $2 }')"
  [ -z "$PORTA" ] || [ "$PORTA" = "$PORTA_ATUAL" ] || die "$LOGIN ja esta na porta $PORTA_ATUAL; para trocar, edite $PORTAS antes."
  PORTA="$PORTA_ATUAL"
  ok "porta $PORTA reaproveitada"
else
  if [ -n "$PORTA" ]; then
    PORTA="$("$NODE_ROOT" "$PORTAS_JS" alocar "$PORTAS" "$LOGIN" "$PORTA")" || die 'Alocacao recusada (mensagem acima).'
  else
    PORTA="$("$NODE_ROOT" "$PORTAS_JS" alocar "$PORTAS" "$LOGIN")" || die 'Alocacao recusada (mensagem acima).'
  fi
  ok "porta $PORTA"
fi
flock -u 9
exec 9>&-

# --- app -----------------------------------------------------------------------------
# daqui em diante, tudo na pasta pessoal roda COMO a pessoa (ver Seguranca no topo)
como mkdir -p "$FAROL"
como chmod 700 "$FAROL"
if [ -n "$CLONE" ]; then
  step "Ligando $APP ao clone $CLONE"
  como rm -rf "${APP:?}"
  como ln -s "$CLONE" "$APP"
  como test -r "$APP/server.js" || die "$LOGIN nao consegue ler $CLONE (permissao da pasta?)."
  AMBIENTE_EXTRA='Environment=FAROL_UPDATE_MANAGER=external'
else
  if [ -z "$PACOTE" ]; then
    step "Baixando farol-v*.zip da ultima release de $RELEASE_REPO"
    gh release download --repo "$RELEASE_REPO" --pattern 'farol-v*.zip' --dir "$TMP" \
      || die 'Falha ao baixar a release (o gh deste root esta autenticado?). Alternativa: --pacote <zip>.'
    BAIXADOS=("$TMP"/farol-v*.zip)
    [ -f "${BAIXADOS[0]}" ] || die 'A release nao trouxe farol-v*.zip.'
    PACOTE="${BAIXADOS[0]}"
  fi
  if [ -f "$PACOTE" ]; then
    step "Extraindo $PACOTE"
    mkdir -p "$TMP/pacote"
    # saida 1 do unzip e aviso, nao erro (mesma leitura do lib/engine/update.js)
    unzip -q -o "$PACOTE" -d "$TMP/pacote" || [ $? -eq 1 ] || die "Falha ao extrair $PACOTE"
    ORIGEM="$TMP/pacote"
  else
    ORIGEM="$(cd "$PACOTE" && pwd)"
  fi
  [ -f "$ORIGEM/server.js" ] && [ -f "$ORIGEM/package.json" ] || die "O pacote nao parece o pacote leve do Farol (faltou server.js na raiz)."
  # a copia roda como a pessoa, entao ela precisa ler a origem (o mktemp nasce 0700)
  chmod 755 "$TMP"
  como test -r "$ORIGEM/server.js" || die "$LOGIN nao consegue ler $ORIGEM (permissao da pasta?)."
  step "Copiando o pacote para $APP"
  # o conteudo inteiro, sem lista de arquivos: uma quinta lista de distribuicao e
  # exatamente a divergencia que test/distribuicao-listas.test.js existe para impedir
  como rm -rf "${APP:?}"
  como mkdir -p "$APP"
  como cp -R "$ORIGEM/." "$APP/"
  AMBIENTE_EXTRA=''
fi

# --- config.json ---------------------------------------------------------------------
CONFIG="$FAROL/config.json"
# -L tambem: link simbolico pendurado conta como existente e nao e seguido
if [ -e "$CONFIG" ] || [ -L "$CONFIG" ]; then
  step "Mantendo $CONFIG que ja existe"
  ok "confira nele \"port\": $PORTA e \"localAuth\": \"exigir\""
else
  step "Gravando $CONFIG"
  printf '{ "port": %s, "localAuth": "exigir" }\n' "$PORTA" | gravar_como 077 "$CONFIG"
fi

# --- unidade systemd de usuario --------------------------------------------------------
UNIDADE_DIR="$CASA/.config/systemd/user"
UNIDADE="$UNIDADE_DIR/farol.service"
step "Instalando $UNIDADE"
como mkdir -p "$UNIDADE_DIR"
# o texto da unidade e montado pelo root a partir do template do clone e conferido antes
# de ir ao disco; a gravacao e da pessoa
if [ -n "$AMBIENTE_EXTRA" ]; then
  TEXTO_UNIDADE="$(sed -e "s|@NODE@|$NODE|g" -e "s|@PORTA@|$PORTA|g" -e "s|@AMBIENTE_EXTRA@|$AMBIENTE_EXTRA|" "$TEMPLATE")"
else
  TEXTO_UNIDADE="$(sed -e "s|@NODE@|$NODE|g" -e "s|@PORTA@|$PORTA|g" -e '/@AMBIENTE_EXTRA@/d' "$TEMPLATE")"
fi
! grep -q '@[A-Z_]*@' <<< "$TEXTO_UNIDADE" || die "Marcador sem substituir na unidade"
printf '%s\n' "$TEXTO_UNIDADE" | gravar_como 022 "$UNIDADE"

# --- linger e servico ----------------------------------------------------------------
step "Ligando o linger de $LOGIN (o servico sobe sem sessao aberta)"
loginctl enable-linger "$LOGIN"
RUNTIME="/run/user/$UID_PESSOA"
for _ in $(seq 1 20); do
  [ -S "$RUNTIME/bus" ] && break
  sleep 0.5
done
[ -S "$RUNTIME/bus" ] || die "O systemd de usuario de $LOGIN nao subiu ($RUNTIME/bus ausente)."
usuario_systemctl() { sudo -u "$LOGIN" XDG_RUNTIME_DIR="$RUNTIME" systemctl --user "$@"; }

step 'Ligando o servico farol'
usuario_systemctl daemon-reload
usuario_systemctl enable farol >/dev/null
# restart e start quando parado e reinicio quando ja rodava (caso do --forcar)
usuario_systemctl restart farol
sleep 3
usuario_systemctl is-active --quiet farol \
  || die "O servico nao ficou ativo. Veja: sudo -u $LOGIN XDG_RUNTIME_DIR=$RUNTIME journalctl --user -u farol -n 50"
ok 'ativo'

echo
echo "  Pronto: $LOGIN na porta $PORTA (127.0.0.1)."
echo
echo '  Proximos passos:'
echo "   1. Login do GitHub como $LOGIN:"
echo "        sudo -iu $LOGIN gh auth login"
echo "   2. Codigo de pareamento para a pessoa abrir a tela (uso unico, 10 minutos):"
echo "        sudo -u $LOGIN FAROL_HOME=$FAROL $NODE $APP/tools/farol-parear.js"
echo "   3. Expor pelo proxy com TLS (Caddy, Task 2 da web hospedada) apontando para 127.0.0.1:$PORTA."
echo "   O login do Claude a pessoa faz pela propria tela (Sistema > Plano e chaves)."
echo
