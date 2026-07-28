# Farol: gera o instalador de arquivo unico do Windows (dist\Farol-Setup-vX.Y.Z.exe).
# Um exe so: a pessoa da duplo clique e pronto. Embute o app + o Electron; roda o
# install.ps1 por dentro. Requer o Electron ja baixado em node_modules (o offline
# precisa do binario embutido) e o makensis (vem com o Tauri; ou instale o NSIS).
$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $Src 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$dist = Join-Path $Src 'dist'
$out = Join-Path $dist "Farol-Setup-v$version.exe"

Write-Host ''
Write-Host "  Farol · instalador unico (Windows) v$version" -ForegroundColor Yellow

# --- makensis -----------------------------------------------------------------
$makensis = @(
  (Join-Path $env:LOCALAPPDATA 'tauri\NSIS\Bin\makensis.exe'),
  'C:\Program Files (x86)\NSIS\makensis.exe',
  'C:\Program Files\NSIS\makensis.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $makensis) {
  $cmd = Get-Command makensis -ErrorAction SilentlyContinue
  if ($cmd) { $makensis = $cmd.Source }
}
if (-not $makensis) { throw 'makensis nao encontrado (instale o NSIS ou o bundle do Tauri em AppData\Local\tauri\NSIS).' }

# --- Electron embutido obrigatorio --------------------------------------------
if (-not (Test-Path (Join-Path $Src 'node_modules\electron\dist\electron.exe'))) {
  throw "Electron nao encontrado em node_modules. Rode a instalacao de deps antes (o offline precisa do binario embutido)."
}

# --- staging do payload -------------------------------------------------------
$staging = Join-Path $env:TEMP ("farol-nsis-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$payload = Join-Path $staging 'payload'
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Write-Host '  -> Reunindo o app + Electron' -ForegroundColor Cyan
foreach ($f in @('main.js', 'server.js', 'package.json', 'README.md', 'CLAUDE.md')) {
  Copy-Item (Join-Path $Src $f) (Join-Path $payload $f)
}
foreach ($d in @('lib', 'ui', 'assets', 'workspace-template', 'installer', 'node_modules')) {
  robocopy (Join-Path $Src $d) (Join-Path $payload $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy falhou em $d" }
}

# --- compila -------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }
Write-Host '  -> Compilando o instalador (makensis, pode levar um minuto)' -ForegroundColor Cyan
& $makensis "/DVERSION=$version" "/DPAYLOAD=$payload" "/DOUTFILE=$out" (Join-Path $Src 'installer\farol.nsi') | Out-Null
$rc = $LASTEXITCODE
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
if ($rc -ne 0 -or -not (Test-Path $out)) { throw "makensis falhou (codigo $rc)" }

$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ''
Write-Host "  ok  $out ($mb MB)" -ForegroundColor Green
Write-Host '      Um arquivo so: a pessoa da duplo clique e o Farol instala e abre.' -ForegroundColor DarkGray
Write-Host ''
