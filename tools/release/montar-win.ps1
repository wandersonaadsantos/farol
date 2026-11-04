# Farol: monta o MSIX da casca do Windows com o motor e o Node dentro, no leiaute que o
# EngineLocator (shell\win\Farol.Sidecar) le, relativo a pasta de instalacao do pacote:
#   engine\app\server.js      (a semente do motor, o pacote leve)
#   engine\node\node.exe      (Node oficial win-x64, hash conferido pelo baixar-node.ps1)
#
#   tools\release\montar-win.ps1 [--semente <dir com engine\app>] [--node <node.exe>]
#                                [--saida <dir>] [--dry-run]
#
# Sem --semente: tools\release\semente-do-motor.ps1 em <saida>\semente.
# Sem --node: tools\release\baixar-node.ps1 --plataforma win-x64 em <saida>\node.
# --saida: padrao dist\win. O pacote sai em <saida>\Farol-<X.Y.Z>.msix, SEM assinatura
# (quem assina e o assinar-win.ps1), com X.Y.Z dos tres primeiros campos da Version do
# Package.appxmanifest.
# --dry-run: confere as entradas dadas e imprime as copias e a linha exata do dotnet
# publish, sem copiar nada e sem rodar o dotnet.
#
# O motor e ENCENADO dentro do projeto (shell\win\Farol.App\engine\, fora do git) antes do
# publish, e o Farol.App.csproj o inclui como Content (engine\**), entao ele entra no MSIX
# em engine\... Se um dia o tooling do MSIX ignorar esse Content, o caminho alternativo e
# desempacotar o .msix gerado (makeappx unpack), copiar engine\ para dentro e empacotar de
# novo (makeappx pack) antes de assinar. Esse caminho nao esta implementado.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Falhar([string]$msg) {
  [Console]::Error.WriteLine("montar-win: $msg")
  exit 1
}

$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Projeto = Join-Path (Join-Path (Join-Path $Raiz 'shell') 'win') 'Farol.App'
$Release = Join-Path (Join-Path $Raiz 'tools') 'release'

$semente = ''
$node = ''
$saida = Join-Path (Join-Path $Raiz 'dist') 'win'
$dryRun = $false
$i = 0
while ($i -lt $args.Count) {
  $opcao = [string]$args[$i]
  if ($opcao -eq '--dry-run') { $dryRun = $true; $i += 1; continue }
  if ($i + 1 -ge $args.Count) { Falhar "falta o valor de $opcao" }
  $valor = [string]$args[$i + 1]
  switch ($opcao) {
    '--semente' { $semente = $valor }
    '--node' { $node = $valor }
    '--saida' { $saida = $valor }
    default { Falhar "argumento desconhecido: $opcao" }
  }
  $i += 2
}

# a versao do pacote: Version do Identity do manifesto (X.Y.Z.W); o nome final leva X.Y.Z
$manifesto = Join-Path $Projeto 'Package.appxmanifest'
$identidade = [regex]::Match((Get-Content -LiteralPath $manifesto -Raw), '<Identity\b[^>]*>').Value
$versaoDoPacote = [regex]::Match($identidade, '\bVersion="(\d+\.\d+\.\d+\.\d+)"').Groups[1].Value
if (-not $versaoDoPacote) { Falhar "Version de 4 partes ausente no Identity de $manifesto" }
$versao = ($versaoDoPacote -split '\.')[0..2] -join '.'
$nomeFinal = "Farol-$versao.msix"

if (-not $dryRun) {
  if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { Falhar 'o MSIX so se monta no Windows (WinUI 3 e o tooling do MSIX).' }
  if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Falhar 'dotnet nao encontrado (instale o SDK do .NET 8).' }
  New-Item -ItemType Directory -Force -Path $saida | Out-Null
  $saida = (Resolve-Path -LiteralPath $saida).Path
}

# no dry-run, o que seria gerado ainda nao existe: so a entrada DADA e conferida
$sementeGerada = -not $semente
$nodeGerado = -not $node
if ($sementeGerada) {
  $semente = Join-Path $saida 'semente'
  if ($dryRun) { Write-Output "$(Join-Path $Release 'semente-do-motor.ps1') --destino $semente" }
  else {
    # o $LASTEXITCODE dele nao prova nada (o ultimo nativo e robocopy/git); a prova e o
    # engine\app\server.js conferido logo abaixo
    & (Join-Path $Release 'semente-do-motor.ps1') --destino $semente | Out-Null
  }
}
if ($nodeGerado) {
  $pastaDoNode = Join-Path $saida 'node'
  $node = Join-Path $pastaDoNode 'node.exe'
  if ($dryRun) { Write-Output "$(Join-Path $Release 'baixar-node.ps1') --plataforma win-x64 --destino $pastaDoNode" }
  else {
    # a prova e o node.exe presente, conferido logo abaixo (nao o $LASTEXITCODE)
    & (Join-Path $Release 'baixar-node.ps1') --plataforma win-x64 --destino $pastaDoNode | Out-Host
  }
}

# confere as entradas ANTES de tocar no projeto: entrada faltando nao deixa encenacao pela metade
$appDaSemente = Join-Path (Join-Path $semente 'engine') 'app'
if (-not ($dryRun -and $sementeGerada) -and -not (Test-Path -LiteralPath (Join-Path $appDaSemente 'server.js') -PathType Leaf)) {
  Falhar "semente sem engine\app\server.js: $semente"
}
if (-not ($dryRun -and $nodeGerado) -and -not (Test-Path -LiteralPath $node -PathType Leaf)) {
  Falhar "node.exe ausente: $node"
}

$encenado = Join-Path $Projeto 'engine'
$encenadoApp = Join-Path $encenado 'app'
$encenadoNode = Join-Path (Join-Path $encenado 'node') 'node.exe'
$pacotes = $saida.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$publicar = @('publish', $Projeto, '-c', 'Release', '-r', 'win-x64', '-p:Platform=x64',
  '-p:GenerateAppxPackageOnBuild=true', "-p:AppxPackageDir=$pacotes", '-p:AppxBundle=Never',
  '-p:UapAppxPackageBuildMode=SideloadOnly', '-p:AppxPackageSigningEnabled=false')

if ($dryRun) {
  Write-Output "copiar $appDaSemente -> $encenadoApp"
  Write-Output "copiar $node -> $encenadoNode"
  Write-Output "dotnet $($publicar -join ' ')"
  Write-Output "msix: $(Join-Path $saida $nomeFinal)"
  exit 0
}

if (Test-Path -LiteralPath $encenado) { Remove-Item -LiteralPath $encenado -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $encenadoNode) | Out-Null
Copy-Item -LiteralPath $appDaSemente -Destination $encenadoApp -Recurse
Copy-Item -LiteralPath $node -Destination $encenadoNode

# so os .msix desta versao que ESTE publish produz contam; os de antes saem
Get-ChildItem -LiteralPath $saida -Recurse -Filter "*_$($versaoDoPacote)_x64.msix" -ErrorAction SilentlyContinue |
  Remove-Item -Force
& dotnet @publicar | Out-Host
if ($LASTEXITCODE -ne 0) { Falhar "dotnet publish falhou (codigo $LASTEXITCODE)" }

# o tooling grava em <saida>\<Projeto>_<versao>_x64_Test\<Nome>_<versao>_x64.msix
$gerado = @(Get-ChildItem -LiteralPath $saida -Recurse -Filter "*_$($versaoDoPacote)_x64.msix")
if ($gerado.Count -ne 1) { Falhar "esperado 1 msix *_$($versaoDoPacote)_x64.msix em $saida, achei $($gerado.Count)" }
$final = Join-Path $saida $nomeFinal
Copy-Item -LiteralPath $gerado[0].FullName -Destination $final -Force
[Console]::Error.WriteLine("montar-win: $final (sem assinatura; assine com o assinar-win.ps1)")
Write-Output $final
