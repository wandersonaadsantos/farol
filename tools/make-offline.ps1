# Farol: gera o pacote OFFLINE do Windows (dist\Farol-Offline-Windows-vX.Y.Z.zip).
# Diferente do make-package (leve, sem node_modules), este LEVA o Electron embutido:
# a pessoa extrai e da duplo clique em "Instalar Farol.cmd" — sem Node, sem npm,
# sem download, sem terminal. Requer o node_modules da fonte com o electron baixado.
$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $Src 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$dist = Join-Path $Src 'dist'
$zip = Join-Path $dist "Farol-Offline-Windows-v$version.zip"
$staging = Join-Path $env:TEMP ("farol-offline-" + [guid]::NewGuid().ToString('N').Substring(0,8))

Write-Host ''
Write-Host "  Farol · pacote offline (Windows) v$version" -ForegroundColor Yellow

$electron = Join-Path $Src 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) {
  throw "Electron nao encontrado em node_modules. Rode 'npm install' na fonte antes (o offline precisa do binario embutido)."
}

New-Item -ItemType Directory -Force -Path $staging | Out-Null

# arquivos do app + os lancadores de duplo clique (o install.ps1 le tudo daqui)
Write-Host '  -> Reunindo o app, os lancadores e o Electron' -ForegroundColor Cyan
foreach ($f in @('main.js', 'server.js', 'package.json', 'README.md', 'CLAUDE.md',
    'Instalar.cmd', 'Desinstalar.cmd', 'Instalar.command', 'Desinstalar.command')) {
  Copy-Item (Join-Path $Src $f) (Join-Path $staging $f) -Force
}
foreach ($d in @('ui', 'assets', 'workspace-template', 'installer', 'tools', 'node_modules')) {
  robocopy (Join-Path $Src $d) (Join-Path $staging $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy falhou em $d" }
}

Write-Host '  -> Compactando (pode levar um minuto, ~140 MB)' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($staging, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ''
Write-Host "  ok  $zip ($mb MB)" -ForegroundColor Green
Write-Host '      A pessoa extrai e da duplo clique em "Instalar Farol.cmd" (renomeie o Instalar.cmd se quiser).' -ForegroundColor DarkGray
Write-Host '      Sem Node, sem npm, sem download, sem terminal.' -ForegroundColor DarkGray
Write-Host ''
