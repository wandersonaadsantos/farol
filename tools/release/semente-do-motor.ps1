# Farol: semente do motor das cascas nativas (Windows). Gera o pacote leve pelo
# tools\make-package.ps1 e o extrai em <destino>\engine\app\, o leiaute do bundle
# (<bundle>\engine\app\server.js). Imprime no stdout SO a versao do motor.
#
#   tools\release\semente-do-motor.ps1 --destino <dir> [--zip <farol-vX.Y.Z.zip>]
#
# Mesmos argumentos do semente-do-motor.sh (estilo --nome, lidos de $args). --zip
# reaproveita um pacote ja gerado em vez de empacotar de novo.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Falhar([string]$msg) {
  [Console]::Error.WriteLine("semente-do-motor: $msg")
  exit 1
}

$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$destino = ''
$zip = ''
for ($i = 0; $i -lt $args.Count; $i += 2) {
  $valor = if ($i + 1 -lt $args.Count) { [string]$args[$i + 1] } else { '' }
  switch ([string]$args[$i]) {
    '--destino' { $destino = $valor }
    '--zip' { $zip = $valor }
    default { Falhar "argumento desconhecido: $($args[$i])" }
  }
}
if (-not $destino) { Falhar 'falta --destino <dir>' }

if (-not $zip) {
  $versaoFonte = (Get-Content (Join-Path $Raiz 'package.json') -Raw | ConvertFrom-Json).version
  $zip = Join-Path (Join-Path $Raiz 'dist') "farol-v$versaoFonte.zip"
  # o zip velho sai antes: o empacotador termina com `exit 1` (sem lancar) quando a
  # auditoria reprova, e o $LASTEXITCODE dele nao e confiavel (o robocopy devolve 1 no
  # sucesso). Zip presente depois da chamada e a prova de que ele terminou limpo.
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  # o empacotador escreve o relato pelo host; nada dele vai para o stdout deste script
  & (Join-Path (Join-Path $Raiz 'tools') 'make-package.ps1') | Out-Null
}
if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { Falhar "pacote ausente: $zip" }

$app = Join-Path (Join-Path $destino 'engine') 'app'
if (Test-Path -LiteralPath $app) { Remove-Item -LiteralPath $app -Recurse -Force }
New-Item -ItemType Directory -Force -Path $app | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $app -Force
if (-not (Test-Path -LiteralPath (Join-Path $app 'server.js'))) { Falhar "pacote sem server.js: $zip" }
Write-Output (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
