# Farol: baixa o Node oficial que entra no bundle das cascas nativas e confere o hash
# contra o SHASUMS256.txt da mesma versao ANTES de extrair. Hash que nao confere aborta.
#
#   tools\release\baixar-node.ps1 --plataforma darwin-arm64|darwin-x64|win-x64 --destino <dir>
#                                 [--versao X.Y.Z] [--origem <url>]
#
# Mesmos argumentos do baixar-node.sh (estilo --nome, lidos de $args). --versao: padrao e o
# .nvmrc da raiz. --origem: padrao https://nodejs.org/dist. Do pacote sai SO o binario:
# <destino>\node.exe no Windows, <destino>/bin/node no macOS.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Falhar([string]$msg) {
  [Console]::Error.WriteLine("baixar-node: $msg")
  exit 1
}

$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$versao = ''
$plataforma = ''
$destino = ''
$origem = 'https://nodejs.org/dist'
for ($i = 0; $i -lt $args.Count; $i += 2) {
  $valor = if ($i + 1 -lt $args.Count) { [string]$args[$i + 1] } else { '' }
  switch ([string]$args[$i]) {
    '--versao' { $versao = $valor }
    '--plataforma' { $plataforma = $valor }
    '--destino' { $destino = $valor }
    '--origem' { $origem = $valor }
    default { Falhar "argumento desconhecido: $($args[$i])" }
  }
}

if (-not $destino) { Falhar 'falta --destino <dir>' }
if (-not $versao) { $versao = (Get-Content (Join-Path $Raiz '.nvmrc') -Raw).Trim() }
$versao = $versao -replace '^v', ''
if ($versao -notmatch '^\d+\.\d+\.\d+$') { Falhar "versao invalida: '$versao' (esperado X.Y.Z)" }

switch ($plataforma) {
  { $_ -in @('darwin-arm64', 'darwin-x64') } {
    $arquivo = "node-v$versao-$plataforma.tar.gz"
    $membro = "node-v$versao-$plataforma/bin/node"
    $saida = 'bin/node'
  }
  'win-x64' {
    $arquivo = "node-v$versao-$plataforma.zip"
    $membro = "node-v$versao-$plataforma/node.exe"
    $saida = 'node.exe'
  }
  default { Falhar "plataforma invalida: '$plataforma' (aceitas: darwin-arm64, darwin-x64, win-x64)" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) "farol-node-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $base = "$($origem.TrimEnd('/'))/v$versao"
  $shasums = Join-Path $tmp 'SHASUMS256.txt'
  try { Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -OutFile $shasums }
  catch { Falhar "Node v${versao}: SHASUMS256.txt ausente em $base" }
  $pacote = Join-Path $tmp $arquivo
  try { Invoke-WebRequest -UseBasicParsing -Uri "$base/$arquivo" -OutFile $pacote }
  catch { Falhar "Node v${versao}: download de $arquivo falhou em $base" }

  $esperado = ''
  foreach ($linha in Get-Content $shasums) {
    $partes = $linha -split '\s+'
    if ($partes.Count -ge 2 -and $partes[1] -eq $arquivo) { $esperado = $partes[0].ToLowerInvariant() }
  }
  if (-not $esperado) { Falhar "Node v${versao}: $arquivo nao aparece no SHASUMS256.txt" }
  $obtido = (Get-FileHash -Algorithm SHA256 -LiteralPath $pacote).Hash.ToLowerInvariant()
  if ($esperado -ne $obtido) {
    Falhar "Node v${versao}: hash de $arquivo nao confere (esperado $esperado, obtido $obtido)"
  }

  $extraido = Join-Path $tmp 'x'
  New-Item -ItemType Directory -Force -Path $extraido | Out-Null
  if ($arquivo.EndsWith('.zip')) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($pacote)
    try {
      $entrada = $zip.Entries | Where-Object { $_.FullName -eq $membro } | Select-Object -First 1
      if (-not $entrada) { Falhar "Node v${versao}: $membro ausente dentro de $arquivo" }
      $alvo = Join-Path $extraido 'binario'
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entrada, $alvo, $true)
    } finally { $zip.Dispose() }
  } else {
    & tar -xzf $pacote -C $extraido $membro
    if ($LASTEXITCODE -ne 0) { Falhar "Node v${versao}: $membro ausente dentro de $arquivo" }
    $alvo = Join-Path $extraido $membro
  }

  $final = Join-Path $destino $saida
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $final) | Out-Null
  Copy-Item -LiteralPath $alvo -Destination $final -Force
  if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { & chmod 755 $final }
  Write-Output $final
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
