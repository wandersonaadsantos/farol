#!/usr/bin/env bash
# Sobe as três instâncias REAIS do Farol da bancada contra os emuladores oficiais e deixa
# cada uma logada, com o chaveiro destravado. Só o GitHub e a sessão de IA são dublês.
set -u
SP="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || dirname "$0")"
RAIZ="${FAROL_RAIZ_BANCADA:-C:/Users/wanderson/Documents/farol-md-exec}"
EMAIL=bancada@demo.local
SENHA=senha-da-bancada

for porta in 47301 47302 47303; do
  pid=$(netstat -ano | grep LISTENING | grep ":$porta " | awk '{print $NF}' | head -1)
  [ -n "${pid:-}" ] && powershell -NoProfile -Command "Stop-Process -Id $pid -Force" >/dev/null 2>&1
done
sleep 2

subir() { # pasta porta
  local pasta=$1 porta=$2
  ( cd "$RAIZ" && FAROL_RAIZ="$RAIZ" FAROL_HOME="$SP/$pasta" FAROL_GH_LOG="$SP/gh-${pasta#real-}.jsonl" \
    FAROL_GH_PRS="$SP/prs.json" FAROL_DIAG_LOG="$SP/diag-${pasta#real-}.jsonl" \
    FAROL_HEADLESS_CMD="node $SP/stub-sessao.cjs" \
    nohup node --import "file:///$SP/gh-falso3.mjs" --import "file:///$SP/diag-dist.mjs" server.js \
    > "$SP/$pasta-saida.log" 2>&1 & )
  echo "$pasta em $porta"
}

subir real-a 47301; subir real-c 47302; subir real-d 47303
sleep 12
for porta in 47301 47302 47303; do
  for rota in login unlock; do
    curl -s -X POST -H 'content-type: application/json' -H 'x-farol: 1' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$SENHA\"}" "http://127.0.0.1:$porta/api/sync/$rota"
  done
  echo " <- $porta"
done
