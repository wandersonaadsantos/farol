# Farol: gera o Farol.appinstaller da casca do Windows, o arquivo que o Windows rele para
# achar o MSIX novo (sem prompt, checagem a cada abertura e em segundo plano). O XML sai
# da funcao pura tools\release\appinstaller.js, a mesma que o teste confere; este script
# so confere os argumentos e chama o node.
#
#   tools\release\appinstaller-win.ps1 --msix <Farol-X.Y.Z.msix> --saida <Farol.appinstaller>
#                                      --versao X.Y.Z.W --repo <dono/nome>
#
# Name e Publisher vem do Identity do shell\win\Farol.App\Package.appxmanifest. O Uri do
# appinstaller aponta para releases/latest/download/ (a copia instalada sempre acha o
# manifesto mais novo); o do pacote, para o asset da release vX.Y.Z.
$ErrorActionPreference = 'Stop'

function Falhar([string]$msg) {
  [Console]::Error.WriteLine("appinstaller-win: $msg")
  exit 1
}

$msix = ''
$saida = ''
$versao = ''
$repo = ''
for ($i = 0; $i -lt $args.Count; $i += 2) {
  $opcao = [string]$args[$i]
  if ($opcao -notmatch '^--') { Falhar "argumento desconhecido: $opcao" }
  if ($i + 1 -ge $args.Count) { Falhar "falta o valor de $opcao" }
  $valor = [string]$args[$i + 1]
  switch ($opcao) {
    '--msix' { $msix = $valor }
    '--saida' { $saida = $valor }
    '--versao' { $versao = $valor }
    '--repo' { $repo = $valor }
    default { Falhar "argumento desconhecido: $opcao" }
  }
}
if (-not $msix) { Falhar 'falta --msix <arquivo>' }
if (-not $saida) { Falhar 'falta --saida <Farol.appinstaller>' }
if (-not $versao) { Falhar 'falta --versao X.Y.Z.W' }
if (-not $repo) { Falhar 'falta --repo <dono/nome>' }
if (-not (Test-Path -LiteralPath $msix -PathType Leaf)) { Falhar "msix ausente: $msix" }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Falhar 'node nao encontrado no PATH' }

$gerador = Join-Path $PSScriptRoot 'appinstaller.js'
& $node.Source $gerador --msix $msix --saida $saida --versao $versao --repo $repo
if ($LASTEXITCODE -ne 0) { exit 1 }
[Console]::Error.WriteLine("appinstaller-win: $saida (versao $versao)")
